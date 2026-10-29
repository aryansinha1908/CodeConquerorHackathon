// ID-card verification (architecture.md §6 Verification and §8, backend.md B-03 and the User model in
// §5). A member uploads a student or faculty ID card with their member type and department; an admin
// opens it through a 5-minute signed URL, then approves (confirming or correcting both) or rejects
// with a reason. "Verified" everywhere else means verification.status === "approved".
//
// Privacy (architecture.md §8, §16 "ID documents"): the card is a Cloudinary `authenticated` asset that
// only admins open, every view is audited, and the image is deleted once a decision is made; the
// decision (who, when, outcome, reason) stays on the user and in the audit log. The asset's public id
// never leaves this module: views say hasIdCard instead.
//
// Verification events are audited with no org unit, so only admins read them (progress.md §5).
//
// Demo admins (architecture.md §16 "Demo data"): while DEMO_MODE is on, anyone can be the seeded
// demo admin with one click and no password, on the same deployment where real members register.
// So a demo account reviews demo accounts only: real members aren't in its queue, and their card and
// decision answer 404, the same as an id that doesn't exist. A real admin reviews everyone.
import { sendMail } from "../config/mailer.js";
import { log } from "../lib/log.js";
import {
  ServiceError,
  conflict,
  fieldError,
  forbidden,
  invalid,
  notFound,
} from "../lib/serviceError.js";
import { fileTypeFromBuffer } from "file-type";
import { discardBody, readCapped } from "../lib/readCapped.js";
import { MEMBER_TYPES } from "../models/enums.js";
import { OrgUnit, User } from "../models/index.js";
import { requireAdmin } from "./access.js";
import { record } from "./auditService.js";
import { DEMO_EMAIL, isDemoAccount } from "./authService.js";
import { render, send } from "./notifyService.js";
import {
  absent,
  assertValid,
  isId,
  isPlainObject,
  readEnum,
  readId,
  readInstant,
  readPaging,
  readText,
  requireUser,
  sameId,
} from "./params.js";
import {
  deleteAsset,
  discardAsset,
  signedUrl,
  storeFiles,
} from "./uploadService.js";

const KIND = "id-cards";
const QUEUE_STATUSES = ["pending", "approved", "rejected"];
// A pending card is replaced by a new upload; an approved one is final.
const CAN_SUBMIT = ["unsubmitted", "pending", "rejected"];
const DECISIONS = ["approve", "reject"];
const DECISION_FIELDS = [
  "decision",
  "submittedAt",
  "reason",
  "memberType",
  "department",
];
const REASON = { min: 5, max: 500 }; // backend.md §7 admin.verify

const DEPARTMENT = { path: "department", select: "code name" };
const WITH_CARD = "+verification.idCardPublicId";

// The on-device check's answers, in the order they're shown (client idCardCheck.js ID_CHECKS).
export const OCR_CHECKS = ["institute", "rollNumber", "name", "year"];

// Which checks apply to `user` (as the client's scoreIdCard decides): the institute and the year
// always; the roll number when the email is one; the name when it has a word of 3+ letters.
function applicableChecks(user) {
  const local = String(user.email ?? "").split("@")[0];
  const nameWords = String(user.name ?? "")
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ");
  return OCR_CHECKS.filter(
    (name) =>
      (name !== "rollNumber" || /^(?:19|20)\d{2}[a-z]{2,6}\d{2,4}$/i.test(local)) &&
      (name !== "name" || nameWords.some((w) => w.length >= 3)),
  );
}

// The optional ocrCheck field of the upload: a JSON string (a multipart field) of { v: 1, checks: {
// institute, rollNumber?, name?, year: booleans } }. → { checks, score, total }, null when absent; a
// problem when it has any other shape. Which checks count is decided here, from the member's own
// email and name: one that applies but is missing counts as not found, one that doesn't apply is
// dropped, so leaving checks out can't make a perfect score. (The answers are still the browser's
// word: a hint for the admin, never proof.)
function readOcrCheck(value, user, problems) {
  if (absent(value) || value === "") return null;
  let parsed = null;
  if (typeof value === "string" && value.length <= 300) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  const checks = isPlainObject(parsed) && parsed.v === 1 && isPlainObject(parsed.checks) ? parsed.checks : null;
  const names = checks ? Object.keys(checks) : [];
  const valid =
    checks &&
    names.length > 0 &&
    Object.keys(parsed).every((key) => key === "v" || key === "checks") &&
    names.every((name) => OCR_CHECKS.includes(name) && typeof checks[name] === "boolean");
  if (!valid) {
    problems.push({ path: "ocrCheck", message: "Must be the device check's answers." });
    return null;
  }
  const counted = Object.fromEntries(applicableChecks(user).map((name) => [name, checks[name] === true]));
  return { checks: counted, score: Object.values(counted).filter(Boolean).length, total: Object.keys(counted).length };
}

// The device check as the admin's queue shows it.
const ocrCheckView = (ocr) =>
  ocr?.checks && Number.isInteger(ocr.total)
    ? { checks: { ...ocr.checks }, score: ocr.score ?? 0, total: ocr.total, at: ocr.at ?? null }
    : null;

const loadUser = (userId) =>
  isId(userId)
    ? User.findById(userId).select(WITH_CARD).populate(DEPARTMENT).lean()
    : null;

async function findUser(userId) {
  const user = await loadUser(userId);
  if (!user) throw notFound("User");
  return user;
}

const requireAdminActor = async (actorId) =>
  requireAdmin(
    await requireUser(actorId),
    "Only an admin can review ID cards.",
  );

// The queue filter that keeps a demo admin to demo accounts (see the top of this file).
const reviewableBy = (admin) =>
  isDemoAccount(admin) ? { email: DEMO_EMAIL } : {};

// The user under review, or 404 when there is none, or none this admin may review.
async function findReviewable(admin, userId) {
  const user = await findUser(userId);
  if (isDemoAccount(admin) && !isDemoAccount(user)) throw notFound("User");
  return user;
}

const departmentView = (dept) =>
  dept?.code
    ? { _id: String(dept._id), code: dept.code, name: dept.name }
    : null;

const idOf = (value) => (value == null ? null : String(value._id ?? value));

// The member's own view (GET /verification/status). Never the public id.
export function statusView(user) {
  const v = user.verification ?? {};
  return {
    status: v.status ?? "unsubmitted",
    reason: v.reason ?? null,
    submittedAt: v.submittedAt ?? null,
    reviewedAt: v.reviewedAt ?? null,
    memberType: user.memberType ?? null,
    department: departmentView(user.department),
    hasIdCard: Boolean(v.idCardPublicId),
  };
}

// An admin's queue row. Admins see the email and its hints: they check them against the card.
export function queueItem(user) {
  const v = user.verification ?? {};
  const hints = user.emailHints;
  return {
    user: {
      _id: String(user._id),
      name: user.name,
      email: user.email,
      emailHints:
        hints && (hints.year != null || hints.level)
          ? {
              year: hints.year ?? null,
              level: hints.level ?? null,
              branch: hints.branch ?? null,
              serial: hints.serial ?? null,
            }
          : null,
      memberType: user.memberType ?? null,
      department: departmentView(user.department),
    },
    status: v.status ?? "unsubmitted",
    submittedAt: v.submittedAt ?? null,
    reviewedAt: v.reviewedAt ?? null,
    reason: v.reason ?? null,
    hasIdCard: Boolean(v.idCardPublicId),
    ocrCheck: ocrCheckView(v.ocrCheck),
  };
}

// The unit a member says they belong to: it must exist and be active. → its id.
async function requireActiveUnit(orgUnitId) {
  const unit = await OrgUnit.findById(orgUnitId, { isActive: 1 }).lean();
  if (!unit || unit.isActive === false)
    throw fieldError(
      "department",
      unit ? "This unit is inactive." : "No such unit.",
    );
  return unit._id;
}

// The status as a filter, so an update only lands on the state that was read. Users created before
// the field existed have no status at all, which reads as unsubmitted.
const statusFilter = (status) =>
  status === "unsubmitted" ? { $in: ["unsubmitted", null] } : status;

const changes = (pairs) =>
  Object.fromEntries(
    Object.entries(pairs).filter(([, [a, b]]) => String(a) !== String(b)),
  );

// ── Member side ─────────────────────────────────────────────────────────────

// GET /verification/status → statusView.
export async function getVerificationStatus(userId) {
  return statusView(await findUser(userId));
}

// POST /verification/id-card. input: the multipart text fields { memberType, department }; files:
// req.files from receiveFiles("idCard", { maxCount: 1 }). Allowed while unsubmitted, pending (the new
// card replaces the earlier one, which is deleted) or rejected; approved is 409 INVALID_TRANSITION.
// The user goes (back) to pending with submittedAt = now; an earlier decision is cleared from the
// user, and stays in the audit log. → statusView, 201 at the route.
export async function submitIdCard(
  userId,
  input,
  files,
  { requestId, now = new Date() } = {},
) {
  const user = await findUser(userId);
  const before = user.verification?.status ?? "unsubmitted";
  if (!CAN_SUBMIT.includes(before))
    throw conflict("Your ID card is already verified.");
  // Sign-in already needs a verified email (architecture.md §6: "auth (email verified)"); this keeps
  // the rule true for any other caller.
  if (!user.emailVerified)
    throw new ServiceError(
      403,
      "EMAIL_NOT_VERIFIED",
      "Verify your email before uploading your ID card.",
    );

  const fields = isPlainObject(input) ? input : {};
  const problems = [];
  const memberType = readEnum(
    fields.memberType,
    MEMBER_TYPES,
    "memberType",
    problems,
    { required: true },
  );
  const department = readId(fields.department, "department", problems);
  if (absent(fields.department))
    problems.push({ path: "department", message: "Required." });
  const ocrCheck = readOcrCheck(fields.ocrCheck, user, problems);
  const received = Array.isArray(files) ? files : [];
  if (received.length !== 1)
    problems.push({
      path: "idCard",
      message: received.length
        ? "Attach only one file."
        : "Attach a photo or PDF of your ID card.",
    });
  assertValid(problems, "field");
  const departmentId = await requireActiveUnit(department);

  // Uploaded before anything is saved: a refused file (400) or Cloudinary being down (503) leaves the
  // user as they were.
  const [{ publicId }] = await storeFiles(received, KIND, { field: "idCard" });
  const previous = user.verification?.idCardPublicId ?? null;

  // Conditional on the state as read: an admin's decision, or another upload, that landed meanwhile
  // wins, and this upload is removed again. So is it when the save itself fails (a primary stepdown,
  // a write-concern timeout): nothing refers to it, and an ID image must not outlive its use.
  let updated;
  try {
    updated = await User.findOneAndUpdate(
      {
        _id: user._id,
        "verification.status": statusFilter(before),
        "verification.idCardPublicId": previous,
      },
      {
        $set: {
          "verification.status": "pending",
          "verification.idCardPublicId": publicId,
          "verification.submittedAt": now,
          "verification.reason": null,
          ...(ocrCheck && { "verification.ocrCheck": { ...ocrCheck, at: now } }),
          memberType,
          department: departmentId,
        },
        $unset: {
          "verification.reviewedBy": 1,
          "verification.reviewedAt": 1,
          // A new card without a check drops the earlier card's.
          ...(!ocrCheck && { "verification.ocrCheck": 1 }),
        },
      },
      { returnDocument: "after", projection: { _id: 1 }, runValidators: true },
    ).lean();
  } catch (err) {
    await discardAsset(publicId, KIND);
    throw err;
  }
  if (!updated) {
    await discardAsset(publicId, KIND);
    throw conflict(
      "Your verification changed while you were uploading. Reload and try again.",
    );
  }
  // The earlier card is no longer needed by anyone (architecture.md §16 "Least data").
  if (previous) await discardAsset(previous, KIND);

  await record({
    actor: { id: user._id, role: "member" },
    action: "verification.submitted",
    entity: { type: "user", id: user._id },
    changes: {
      status: [before, "pending"],
      ...changes({
        memberType: [user.memberType ?? null, memberType],
        department: [idOf(user.department), String(departmentId)],
      }),
    },
    meta: { replacedCard: Boolean(previous), ...(ocrCheck && { deviceCheck: `${ocrCheck.score}/${ocrCheck.total}` }) },
    requestId,
  });
  return statusView(await findUser(user._id));
}

// ── Admin side ──────────────────────────────────────────────────────────────

// The card's id only to say hasIdCard. Listed field by field: Mongoose refuses "verification" and
// "+verification.idCardPublicId" together (a path collision).
const QUEUE_FIELDS = [
  "name email emailHints memberType department",
  "verification.status verification.submittedAt verification.reviewedAt verification.reason verification.ocrCheck",
  WITH_CARD,
].join(" ");

// GET /admin/verifications (admins). query: { status = "pending", page, limit } → { items, meta:
// { page, limit, total } }. Pending submissions come oldest first, so nobody waits behind later
// ones; decided ones newest decision first.
export async function listVerifications(viewerId, query = {}) {
  const admin = await requireAdminActor(viewerId);
  const problems = [];
  const status =
    readEnum(query.status, QUEUE_STATUSES, "status", problems) ?? "pending";
  const { page, limit } = readPaging(query, problems);
  assertValid(problems);

  const filter = { "verification.status": status, ...reviewableBy(admin) };
  const [rows, total] = await Promise.all([
    User.find(filter)
      .select(QUEUE_FIELDS)
      .sort(
        status === "pending"
          ? { "verification.submittedAt": 1, _id: 1 }
          : { "verification.reviewedAt": -1, _id: -1 },
      )
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(DEPARTMENT)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items: rows.map(queueItem), meta: { page, limit, total } };
}

// GET /admin/verifications/:userId/id-card (admins) → { url, expiresAt }, a link that stops working
// within 5 minutes. Every call writes "verification.id_viewed" (architecture.md §8). No card on file
// (never uploaded, or deleted after the decision) is 404.
export async function getIdCardUrl(
  viewerId,
  userId,
  { requestId, now = new Date() } = {},
) {
  const admin = await requireAdminActor(viewerId);
  const user = await findReviewable(admin, userId);
  const publicId = user.verification?.idCardPublicId;
  const noCard = () => notFound("ID card");
  if (!publicId) throw noCard();
  const link = await signedUrl(publicId, KIND, { now });
  if (!link) throw noCard();

  await record({
    actor: { id: admin._id, role: "admin" },
    action: "verification.id_viewed",
    entity: { type: "user", id: user._id },
    meta: { expiresAt: link.expiresAt },
    requestId,
  });
  return link;
}

// Swappable in tests, as useUploader() is: (url, init) → a fetch Response.
let cardFetchOverride = null;
export function useCardFetcher(next) {
  cardFetchOverride = next;
}

// What the card's bytes are (never what the upstream header says): → the Content-Type to send.
const CARD_TYPES = { "image/jpeg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp" };
const CARD_BYTES_MAX = 6 * 1024 * 1024; // the upload limit is 5 MB; a PDF converted to JPG can grow
const CARD_FETCH_MS = 8_000;
const cardUnavailable = () =>
  new ServiceError(503, "SERVICE_UNAVAILABLE", "The ID card can't be loaded right now. Try again in a minute.");

// One redirect is followed, and only within our own Cloudinary account (the Download API may answer
// with one to the delivery host); anything else is refused.
function cloudinaryRedirect(res, cloud) {
  if (res.status < 300 || res.status >= 400) return null;
  try {
    const next = new URL(res.headers.get("location") ?? "", "https://api.cloudinary.com");
    const ours =
      next.protocol === "https:" &&
      ((next.host === "res.cloudinary.com" && next.pathname.startsWith(`/${cloud}/`)) ||
        (next.host === "api.cloudinary.com" && next.pathname.startsWith(`/v1_1/${cloud}/`)));
    return ours ? next.href : null;
  } catch {
    return null;
  }
}

// GET /admin/verifications/:userId/id-card/file (admins) → { bytes, contentType }: the card itself,
// for the admin's on-device check (FC-12), which can't read Cloudinary's image from the page (another
// origin, and the CSP allows connections to this site only). The same checks, limit and audit entry
// as getIdCardUrl, with meta.purpose "device_check". Fetched through a 5-minute signed link (at most
// one redirect, within our account), read with a size cap, and served only when the bytes are a JPEG,
// PNG or WebP (a PDF card is stored as JPG), under the type the bytes say. Nothing about the card is
// logged.
export async function getIdCardFile(viewerId, userId, { requestId, now = new Date() } = {}) {
  const admin = await requireAdminActor(viewerId);
  const user = await findReviewable(admin, userId);
  const publicId = user.verification?.idCardPublicId;
  if (!publicId) throw notFound("ID card");
  const link = await signedUrl(publicId, KIND, { now });
  if (!link) throw notFound("ID card");

  const get = (url, redirect) =>
    (cardFetchOverride ?? fetch)(url, { redirect, signal: AbortSignal.timeout(CARD_FETCH_MS) });
  let bytes;
  try {
    let res = await get(link.url, "manual");
    const next = cloudinaryRedirect(res, process.env.CLOUDINARY_CLOUD_NAME);
    if (next) {
      await discardBody(res);
      res = await get(next, "error");
    }
    if (!res.ok) {
      await discardBody(res);
      throw cardUnavailable();
    }
    if (Number(res.headers.get("content-length") ?? 0) > CARD_BYTES_MAX) {
      await discardBody(res);
      throw cardUnavailable();
    }
    bytes = await readCapped(res, CARD_BYTES_MAX);
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    log.warn({ err: { name: err?.name } }, "Couldn't fetch an ID card for a device check");
    throw cardUnavailable();
  }
  if (!bytes) throw cardUnavailable();
  const contentType = CARD_TYPES[(await fileTypeFromBuffer(bytes))?.mime];
  if (!contentType) throw conflict("This file can't be checked on the device. Open it and check it yourself.");

  await record({
    actor: { id: admin._id, role: "admin" },
    action: "verification.id_viewed",
    entity: { type: "user", id: user._id },
    meta: { purpose: "device_check" },
    requestId,
  });
  return { bytes, contentType };
}

function readDecision(input) {
  if (!isPlainObject(input)) throw invalid("Send the decision as an object.");
  const unknown = Object.keys(input)
    .filter((key) => !DECISION_FIELDS.includes(key) && input[key] !== undefined)
    .sort()
    .map((path) => ({ path, message: "This field can't be set." }));
  const problems = [...unknown];
  const decision = readEnum(input.decision, DECISIONS, "decision", problems, {
    required: true,
  });
  // Which submission the admin reviewed: the queue item's submittedAt, sent back as it came (null
  // for a submission that has none).
  const submittedAt =
    input.submittedAt === null
      ? null
      : readInstant(input.submittedAt, "submittedAt", problems, {
          required: true,
        });
  const reason = readText(input.reason, "reason", problems, {
    ...REASON,
    required: decision === "reject",
    requiredMessage: "Say why, so the member knows what to fix.",
  });
  const memberType = readEnum(
    input.memberType,
    MEMBER_TYPES,
    "memberType",
    problems,
  );
  const department = readId(input.department, "department", problems);
  assertValid(problems, "field");
  return { decision, submittedAt, reason, memberType, department };
}

const sameInstant = (a, b) =>
  (a == null ? null : new Date(a).getTime()) ===
  (b == null ? null : new Date(b).getTime());

const MAIL = {
  "verification.approved": "Your CampusCommons ID card is verified",
  "verification.rejected": "Your CampusCommons ID card wasn't verified",
};

// backend.md §8.2: the member is also emailed, unless they turned email off. Not awaited: the
// decision is saved whatever happens to the mail, and a failure is logged (the mailer never sends
// to the seeded *.test accounts). The template is rendered without the reason, which the in-app
// notice cuts to fit its 500 characters; an email has room for all of it.
function emailDecision(user, event, reason) {
  if (user.notificationPrefs?.email === false) return;
  const { body, link } = render(event, {});
  const site = (process.env.CLIENT_URL || "http://localhost:5173").replace(
    /\/+$/,
    "",
  );
  sendMail({
    to: user.email,
    subject: MAIL[event],
    text: [
      `Hi ${user.name},`,
      "",
      body,
      ...(reason ? ["", `Reason: ${reason}`] : []),
      "",
      `See your verification status: ${site}${link}`,
    ].join("\n"),
  }).catch((err) =>
    log.error(
      { err, userId: String(user._id), event },
      "Couldn't email a verification decision",
    ),
  );
}

// PATCH /admin/verifications/:userId (admins). input: { decision: "approve" | "reject", submittedAt,
// reason (5–500, required to reject), memberType?, department? }; the corrections apply when
// approving. submittedAt is the queue item's, so the decision lands only on the submission the admin
// reviewed: a card sent since then is 409 INVALID_TRANSITION, with nothing deleted. The member must
// be pending (409 otherwise), and an admin never decides on their own card (403). The ID card image
// is deleted first, so a decision is only saved once it is gone; Cloudinary being down is a 503 that
// changes nothing. → queueItem.
export async function decideVerification(
  viewerId,
  userId,
  input,
  { requestId, now = new Date() } = {},
) {
  const admin = await requireAdminActor(viewerId);
  const user = await findReviewable(admin, userId);
  if (sameId(admin._id, user._id))
    throw forbidden(
      "You can't decide on your own verification. Another admin must.",
    );
  const { decision, submittedAt, reason, memberType, department } =
    readDecision(input);
  const status = user.verification?.status ?? "unsubmitted";
  if (status !== "pending")
    throw conflict(
      status === "unsubmitted"
        ? "This member hasn't submitted an ID card."
        : "This verification has already been decided.",
    );
  const onFile = user.verification?.submittedAt ?? null;
  if (!sameInstant(onFile, submittedAt))
    throw conflict(
      "This member has sent a new ID card since you opened theirs. Reload and review it.",
    );

  const approve = decision === "approve";
  let confirmed = {};
  if (approve) {
    const finalType = memberType ?? user.memberType;
    const finalDept = department ?? idOf(user.department);
    const missing = [
      !finalType && { path: "memberType", message: "Required to approve." },
      !finalDept && { path: "department", message: "Required to approve." },
    ].filter(Boolean);
    assertValid(missing, "field");
    confirmed = {
      memberType: finalType,
      department: await requireActiveUnit(finalDept),
    };
  }

  const publicId = user.verification?.idCardPublicId ?? null;
  if (publicId) {
    try {
      await deleteAsset(publicId, KIND);
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      log.warn({ err }, "Couldn't delete an ID card before a decision");
      throw new ServiceError(
        503,
        "SERVICE_UNAVAILABLE",
        "The ID card image couldn't be deleted, so the decision wasn't saved. Try again in a minute.",
      );
    }
  }

  const decided = {
    "verification.reviewedBy": admin._id,
    "verification.reviewedAt": now,
  };
  // Conditional on the submission that was read: a new upload meanwhile is one this admin hasn't
  // seen (that upload's own request deletes the card this one just deleted, so nothing is lost).
  const updated = await User.findOneAndUpdate(
    {
      _id: user._id,
      "verification.status": "pending",
      "verification.idCardPublicId": publicId,
      "verification.submittedAt": onFile,
    },
    {
      $set: approve
        ? {
            ...decided,
            "verification.status": "approved",
            "verification.reason": null,
            ...confirmed,
          }
        : {
            ...decided,
            "verification.status": "rejected",
            "verification.reason": reason,
          },
      $unset: { "verification.idCardPublicId": 1, "verification.ocrCheck": 1 },
    },
    { returnDocument: "after", projection: { _id: 1 }, runValidators: true },
  ).lean();
  if (!updated)
    throw conflict(
      "This verification changed while you were deciding. Reload and try again.",
    );

  const event = approve ? "verification.approved" : "verification.rejected";
  await record({
    actor: { id: admin._id, role: "admin" },
    action: event,
    entity: { type: "user", id: user._id },
    reason,
    changes: {
      status: ["pending", approve ? "approved" : "rejected"],
      ...(approve &&
        changes({
          memberType: [user.memberType ?? null, confirmed.memberType],
          department: [idOf(user.department), String(confirmed.department)],
        })),
    },
    meta: { hadIdCard: Boolean(publicId) },
    requestId,
  });
  await send([user._id], event, approve ? {} : { reason });
  emailDecision(user, event, approve ? null : reason);
  return queueItem(await findUser(user._id));
}
