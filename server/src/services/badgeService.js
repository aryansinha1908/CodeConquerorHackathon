// Badges (architecture.md §6 Badges and §7.2, backend.md B-09 and the Badge / UserBadge models in §5,
// frontend.md F-14). Members browse the catalogue, request a badge (with evidence if the badge needs
// it) and see their own; the issuing unit's managers, or an admin, work the request queue or grant a
// badge directly after in-person training. Controllers pass the Zod-validated input and req.user.id.
//
// One UserBadge row per user and badge carries the whole story: a new request after a rejection,
// a revocation or an expiry reuses the row, and the audit log keeps every earlier decision.
// As with bookings, nobody but an admin decides on their own request or grants themselves a badge.
//
// The catalogue is one shared cache entry, cache:badges (architecture.md §10). It stores each issuer
// as an id; names come from the org unit catalogue at read time, so a unit rename needs no badge
// invalidation. Holdings are per user and never cached, so a decision shows in the eligibility
// checklist at once.
import {
  conflict,
  fieldError,
  forbidden,
  fromValidationError,
  invalid,
  notFound,
} from "../lib/serviceError.js";
import { DAY, formatIstFullDate } from "../lib/time.js";
import { USER_BADGE_STATUSES } from "../models/enums.js";
import { Badge, OrgUnit, User, UserBadge } from "../models/index.js";
import {
  auditRole,
  isAdmin,
  managesUnit,
  requireUnitManager,
} from "./access.js";
import { record } from "./auditService.js";
import { cachedCatalogue, invalidateCatalogue } from "./cacheService.js";
import { send } from "./notifyService.js";
import { listOrgUnits } from "./orgUnitService.js";
import { discardAsset } from "./uploadService.js";
import {
  absent,
  assertValid,
  isId,
  isPlainObject,
  readEnum,
  readId,
  readPaging,
  readText,
  requireUser,
  sameId,
} from "./params.js";

const CATALOGUE = "badges";
const CATALOGUE_FIELDS = {
  name: 1,
  code: 1,
  orgUnit: 1,
  description: 1,
  validityDays: 1,
  evidenceRequired: 1,
  selfServe: 1,
};
// The POST /badges body (architecture.md §6). code is the badge's handle in fix links
// (/badges?request=3d-printing-basics), so it is set once, like an org unit's.
const CREATABLE = [
  "name",
  "code",
  "orgUnit",
  "description",
  "validityDays",
  "evidenceRequired",
];
const LOCKED = {
  selfServe:
    "Self-serve badges come with the training quiz (C-13), which isn't built yet.",
};
const DECISIONS = ["approve", "reject"];
const MAX_TEXT = 500;
const MAX_PUBLIC_ID = 255;

// What the issuer, the member and the queue need to say about the badge.
const BADGE_REF = {
  path: "badge",
  select: "name code orgUnit validityDays evidenceRequired selfServe",
  populate: { path: "orgUnit", select: "name code" },
};

const DECIDED = {
  active: "This badge has already been granted.",
  rejected: "This request has already been rejected.",
  revoked: "This badge has been revoked.",
};

// What Redis hands back: ids and dates as strings. A cache miss returns the same.
const plain = (value) => JSON.parse(JSON.stringify(value));

const changedMeanwhile = () =>
  conflict("This badge changed while you were saving. Reload and try again.");

// The upload service's result for the multipart file: { publicId } of a Cloudinary `authenticated`
// asset (backend.md §8.4). The controller uploads, then calls requestBadge with it.
function readEvidence(value, problems) {
  if (absent(value)) return undefined;
  const publicId = isPlainObject(value) ? value.publicId : undefined;
  if (
    typeof publicId === "string" &&
    publicId.trim() &&
    publicId.length <= MAX_PUBLIC_ID
  )
    return { publicId: publicId.trim() };
  problems.push({
    path: "evidence",
    message: "Must be an uploaded file's { publicId }.",
  });
  return undefined;
}

// ── Views ───────────────────────────────────────────────────────────────────

// "expired" is worked out, never stored: the same test as the eligibility engine's BADGES rule.
export function badgeState(userBadge, now = new Date()) {
  if (
    userBadge.status === "active" &&
    userBadge.expiresAt &&
    new Date(userBadge.expiresAt) <= now
  )
    return "expired";
  return userBadge.status;
}

const expiryFrom = (badge, now) =>
  badge.validityDays
    ? new Date(now.getTime() + badge.validityDays * DAY)
    : null;

// The member's own row. Who decided stays out (a user id the member has no use for, architecture.md
// §16 "Least data"), and the evidence shows only as hasEvidence.
const memberView = (row, now) =>
  plain({
    _id: row._id,
    badge: row.badge,
    status: row.status,
    state: badgeState(row, now),
    note: row.note ?? null,
    reason: row.reason ?? null,
    requestedAt: row.requestedAt ?? null,
    decidedAt: row.decidedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    hasEvidence: Boolean(row.evidence?.publicId),
  });

// The queue's row: the member's name, member type and department, never their email or ID card. The
// evidence's publicId opens nothing by itself; the upload service signs a URL for it.
const managerView = (row, now) =>
  plain({
    ...memberView(row, now),
    user: row.user,
    decidedBy: row.decidedBy ?? null,
    evidence: row.evidence?.publicId
      ? { publicId: row.evidence.publicId }
      : null,
  });

const withMember = (query) =>
  query
    .populate(BADGE_REF)
    .populate({
      path: "user",
      select: "name memberType department",
      populate: { path: "department", select: "code name" },
    })
    .populate("decidedBy", "name")
    .lean();

const loadMemberRow = (rowId) =>
  UserBadge.findById(rowId).populate(BADGE_REF).lean();
const loadQueueRow = (rowId) => withMember(UserBadge.findById(rowId));

// ── Catalogue ───────────────────────────────────────────────────────────────

// Every badge with its issuer { _id, name, code, isActive }, sorted by name.
async function catalogue() {
  const [badges, units] = await Promise.all([
    cachedCatalogue(CATALOGUE, () =>
      Badge.find({}, CATALOGUE_FIELDS).sort({ name: 1, _id: 1 }).lean(),
    ),
    listOrgUnits({ includeInactive: true }),
  ]);
  const unitsById = new Map(units.map((u) => [String(u._id), u]));
  return plain(
    badges.flatMap((badge) => {
      const unit = unitsById.get(String(badge.orgUnit));
      if (!unit) return [];
      const { _id, name, code, isActive } = unit;
      return [{ ...badge, orgUnit: { _id, name, code, isActive } }];
    }),
  );
}

// GET /badges. query: { orgUnit? } → the badges members can request, sorted by name. Badges of a
// deactivated unit are left out: nobody there reviews requests.
export async function listBadges(query = {}) {
  const problems = [];
  const orgUnit = readId(query.orgUnit, "orgUnit", problems);
  assertValid(problems, "parameter");
  return (await catalogue()).filter(
    (badge) =>
      badge.orgUnit.isActive !== false &&
      (!orgUnit || badge.orgUnit._id === orgUnit),
  );
}

// E11000 can only come from the unique code index; checking it there means two managers racing to
// create the same code can't both succeed. A 400 on the code field, so the form marks it (§8.3).
function saveError(err, code) {
  if (err?.code !== 11000) return fromValidationError(err);
  return invalid(`A badge with the code "${code}" already exists.`, [
    { path: "code", message: "Already used by another badge." },
  ]);
}

// POST /badges (a manager of input.orgUnit, or an admin). input: { name, code, orgUnit, description?,
// validityDays? (null = never expires), evidenceRequired? }. Throws 400 VALIDATION_ERROR (including a
// code already in use or an unknown or inactive unit) or 403. → the badge as stored.
export async function createBadge(actorId, input, { requestId } = {}) {
  const actor = await requireUser(actorId);
  if (!isPlainObject(input))
    throw invalid("Send the badge's fields as an object.");
  const fields = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  // Other keys are refused, not dropped, so a mistyped field doesn't look saved.
  assertValid(
    Object.keys(fields)
      .filter((path) => !CREATABLE.includes(path))
      .sort()
      .map((path) => ({
        path,
        message: LOCKED[path] ?? "This field can't be set.",
      })),
    "field",
  );
  if (!isId(fields.orgUnit)) {
    throw fieldError(
      "orgUnit",
      absent(fields.orgUnit) ? "Required." : "Must be a valid id.",
    );
  }
  // Scope before existence, so a manager learns nothing about units they don't run.
  requireUnitManager(
    actor,
    fields.orgUnit,
    "Only this unit's managers can create badges for it.",
  );
  const unit = await OrgUnit.findById(fields.orgUnit, { isActive: 1 }).lean();
  if (!unit || unit.isActive === false)
    throw fieldError(
      "orgUnit",
      unit ? "This unit is inactive." : "No such unit.",
    );

  const badge = new Badge(fields);
  await badge.save().catch((err) => {
    throw saveError(err, badge.code);
  });
  const created = badge.toObject();

  await invalidateCatalogue(CATALOGUE);
  await record({
    actor: { id: actor._id, role: auditRole(actor, created.orgUnit) },
    action: "badge.created",
    entity: { type: "badge", id: created._id },
    orgUnit: created.orgUnit,
    changes: Object.fromEntries(
      CREATABLE.filter((f) => created[f] !== undefined).map((f) => [
        f,
        [null, created[f]],
      ]),
    ),
    requestId,
  });
  return created;
}

// ── Member side ─────────────────────────────────────────────────────────────

// GET /badges/mine → the viewer's badges and requests, most recently changed first, each with its
// badge and a state: active | expired | requested | rejected | revoked.
export async function listMyBadges(userId, { now = new Date() } = {}) {
  const user = await requireUser(userId);
  const rows = await UserBadge.find({ user: user._id })
    .sort({ updatedAt: -1, _id: -1 })
    .populate(BADGE_REF)
    .lean();
  return rows.filter((row) => row.badge).map((row) => memberView(row, now));
}

// POST /badges/:id/requests (verified members). input: { note?, evidence? }, evidence required when
// the badge says so. Allowed when the member has no row yet, or theirs was rejected, revoked or has
// expired; 409 INVALID_TRANSITION when a request is already open or the badge is held, or the issuing
// unit is inactive. The unit's managers are notified. → the row as listMyBadges shows it.
//
// Suspension is the route middleware's check (architecture.md §7.1); the ID-card check is here, since
// it is what "verified" means for this route.
export async function requestBadge(
  userId,
  badgeId,
  input = {},
  { requestId, now = new Date() } = {},
) {
  if (!isId(badgeId)) throw notFound("Badge");
  const [user, badge] = await Promise.all([
    requireUser(userId),
    Badge.findById(badgeId, {
      name: 1,
      orgUnit: 1,
      evidenceRequired: 1,
    }).lean(),
  ]);
  if (!badge) throw notFound("Badge");
  if (user.verification?.status !== "approved")
    throw forbidden(
      "Your ID card must be verified before you can request badges.",
    );

  if (!isPlainObject(input)) throw invalid("Send the request as an object.");
  const problems = [];
  const note = readText(input.note, "note", problems, { max: MAX_TEXT });
  const evidence = readEvidence(input.evidence, problems);
  if (badge.evidenceRequired && !evidence && !problems.length)
    problems.push({
      path: "evidence",
      message: "This badge needs evidence, such as a training certificate.",
    });
  assertValid(problems, "field");

  const [unit, existing] = await Promise.all([
    OrgUnit.findById(badge.orgUnit, {
      name: 1,
      managers: 1,
      isActive: 1,
    }).lean(),
    UserBadge.findOne({ user: user._id, badge: badge._id }).lean(),
  ]);
  if (!unit || unit.isActive === false)
    throw conflict(
      `${unit?.name ?? "The issuing unit"} isn't taking badge requests right now.`,
    );
  const before = existing && badgeState(existing, now);
  if (before === "requested")
    throw conflict(
      `You've already requested this badge. ${unit.name} will review it.`,
    );
  if (before === "active") throw conflict("You already hold this badge.");

  // The earlier decision is cleared from the row; the audit log keeps it.
  const fields = {
    status: "requested",
    requestedAt: now,
    ...(note && { note }),
    ...(evidence && { evidence }),
  };
  const cleared = [
    "decidedBy",
    "decidedAt",
    "reason",
    ...(note ? [] : ["note"]),
    ...(evidence ? [] : ["evidence"]),
  ];
  let rowId;
  if (!existing) {
    // A concurrent request or grant for the same user and badge hits the unique index.
    const row = await UserBadge.create({
      user: user._id,
      badge: badge._id,
      ...fields,
    }).catch((err) => {
      throw err?.code === 11000 ? changedMeanwhile() : fromValidationError(err);
    });
    rowId = row._id;
  } else {
    // Conditional on the row as read, so a grant that lands meanwhile isn't turned back into a request.
    const updated = await UserBadge.findOneAndUpdate(
      { _id: existing._id, updatedAt: existing.updatedAt },
      {
        $set: fields,
        $unset: Object.fromEntries(cleared.map((f) => [f, 1])),
      },
      { returnDocument: "after", projection: { _id: 1 }, runValidators: true },
    )
      .lean()
      .catch((err) => {
        throw fromValidationError(err);
      });
    if (!updated) throw changedMeanwhile();
    rowId = updated._id;
    // The earlier request's file was referenced by this row alone (the audit log keeps only
    // hasEvidence), so once it is replaced or cleared nothing could ever find or delete it.
    const replaced = existing.evidence?.publicId;
    if (replaced && replaced !== evidence?.publicId)
      await discardAsset(replaced, "evidence");
  }

  await record({
    actor: { id: user._id, role: "member" },
    action: "badge.requested",
    entity: { type: "user_badge", id: rowId },
    orgUnit: badge.orgUnit,
    changes: { status: [before ?? null, "requested"] },
    meta: {
      badge: badge._id,
      user: user._id,
      hasEvidence: Boolean(evidence),
    },
    requestId,
  });
  await send(
    (unit.managers ?? []).filter((id) => !sameId(id, user._id)),
    "badge.requested",
    { userName: user.name, badgeName: badge.name, audience: "manager" },
  );
  return memberView(await loadMemberRow(rowId), now);
}

// For the route, after requestBadge failed: deletes the evidence file it stored for the request,
// unless a request row points to it (the row was saved and a later step, such as the audit entry,
// failed). When that can't be checked the file is kept: an orphan can be removed by hand from the
// log, but a request whose evidence is gone can't be reviewed. → true when the file was deleted.
export async function releaseEvidence(publicId) {
  const used = await UserBadge.exists({ "evidence.publicId": publicId }).catch(
    () => true,
  );
  return used ? false : discardAsset(publicId, "evidence");
}

// ── Manager side ────────────────────────────────────────────────────────────

// The rows a viewer may see in the queue: an admin every badge's, a manager their units' badges'.
async function queueScope(viewer, badgeId) {
  if (isAdmin(viewer)) return badgeId ? { badge: badgeId } : {};
  if (!viewer.roles?.includes("manager"))
    throw forbidden("Only unit managers can see badge requests.");
  if (badgeId) {
    // A 403 for a badge that doesn't exist too, so the answer says nothing about other units' ids.
    const badge = await Badge.findById(badgeId, { orgUnit: 1 }).lean();
    if (!badge || !managesUnit(viewer, badge.orgUnit))
      throw forbidden("You can only see requests for your units' badges.");
    return { badge: badge._id };
  }
  const badges = await Badge.find(
    { orgUnit: { $in: viewer.managedOrgUnits ?? [] } },
    { _id: 1 },
  ).lean();
  return { badge: { $in: badges.map((b) => b._id) } };
}

// GET /badge-requests (managers of the issuing unit, or admins). query: { status = "requested",
// badgeId?, page, limit } → { items, meta: { page, limit, total } }. Open requests come oldest first,
// like the booking queue; decided rows come newest decision first.
export async function listBadgeRequests(
  viewerId,
  query = {},
  { now = new Date() } = {},
) {
  const viewer = await requireUser(viewerId);
  const problems = [];
  const status =
    readEnum(query.status, USER_BADGE_STATUSES, "status", problems) ??
    "requested";
  const badgeId = readId(query.badgeId, "badgeId", problems);
  const { page, limit } = readPaging(query, problems);
  assertValid(problems, "parameter");

  const filter = { ...(await queueScope(viewer, badgeId)), status };
  const [rows, total] = await Promise.all([
    withMember(
      UserBadge.find(filter)
        .sort(
          status === "requested"
            ? { requestedAt: 1, _id: 1 }
            : { decidedAt: -1, _id: -1 },
        )
        .skip((page - 1) * limit)
        .limit(limit),
    ),
    UserBadge.countDocuments(filter),
  ]);
  return {
    items: rows.map((row) => managerView(row, now)),
    meta: { page, limit, total },
  };
}

function refuseOwn(actor, userId, message) {
  if (sameId(actor._id, userId) && !isAdmin(actor)) throw forbidden(message);
}

const grantedData = (badge, expiresAt) => ({
  badgeName: badge.name,
  ...(expiresAt && { expiresOn: formatIstFullDate(expiresAt) }),
});

// PATCH /badge-requests/:id (managers of the issuing unit, or admins). input: { decision: "approve" |
// "reject", reason } with reason required to reject. Approving makes the badge active until now +
// validityDays (or for good). Throws 400, 403, 404, or 409 INVALID_TRANSITION once it is decided.
// → the row as listBadgeRequests shows it.
export async function decideBadgeRequest(
  viewerId,
  userBadgeId,
  input = {},
  { requestId, now = new Date() } = {},
) {
  if (!isId(userBadgeId)) throw notFound("Badge request");
  const [manager, row] = await Promise.all([
    requireUser(viewerId),
    UserBadge.findById(userBadgeId)
      .populate("badge", "name orgUnit validityDays")
      .lean(),
  ]);
  if (!row?.badge) throw notFound("Badge request");
  const { badge } = row;
  requireUnitManager(
    manager,
    badge.orgUnit,
    "Only the issuing unit's managers can decide this request.",
  );
  refuseOwn(
    manager,
    row.user,
    "You can't decide on your own badge request. Another manager of this unit or an admin must.",
  );

  if (!isPlainObject(input)) throw invalid("Send the decision as an object.");
  const problems = [];
  const decision = readEnum(input.decision, DECISIONS, "decision", problems);
  if (absent(input.decision))
    problems.push({ path: "decision", message: "Required." });
  const reason = readText(input.reason, "reason", problems, {
    max: MAX_TEXT,
    required: decision === "reject",
    requiredMessage: "Say why, so the member knows what to do next.",
  });
  assertValid(problems, "field");
  if (row.status !== "requested")
    throw conflict(DECIDED[row.status] ?? "This request has been decided.");

  const approve = decision === "approve";
  const expiresAt = expiryFrom(badge, now);
  const decided = { decidedBy: manager._id, decidedAt: now };
  // Conditional on the request as read: a member who re-requested after a rejection meanwhile made a
  // new request, which this manager hasn't seen.
  const updated = await UserBadge.findOneAndUpdate(
    { _id: row._id, status: "requested", updatedAt: row.updatedAt },
    approve
      ? {
          $set: { status: "active", ...decided, expiresAt },
          $unset: { reason: 1 },
        }
      : { $set: { status: "rejected", ...decided, reason } },
    { returnDocument: "after", projection: { _id: 1 } },
  ).lean();
  if (!updated) throw changedMeanwhile();

  await record({
    actor: { id: manager._id, role: auditRole(manager, badge.orgUnit) },
    action: approve ? "badge.granted" : "badge.rejected",
    entity: { type: "user_badge", id: row._id },
    orgUnit: badge.orgUnit,
    reason,
    changes: {
      status: ["requested", approve ? "active" : "rejected"],
      ...(approve && { expiresAt: [row.expiresAt ?? null, expiresAt] }),
    },
    meta: { badge: badge._id, user: row.user },
    requestId,
  });
  await send(
    [row.user],
    approve ? "badge.granted" : "badge.rejected",
    approve ? grantedData(badge, expiresAt) : { badgeName: badge.name, reason },
  );
  return managerView(await loadQueueRow(row._id), now);
}

// POST /badges/:id/grant (managers of the issuing unit, or admins), e.g. after an in-person induction.
// input: { userId, note? }. Any row (none, an open request, rejected, revoked, expired, or held with an
// expiry to renew) becomes active until now + validityDays; regranting a held badge that never
// expires changes nothing and isn't audited. The member's own request note is kept; the manager's note
// goes to the audit log. Throws 400 (including an unknown userId), 403 or 404.
// → the row as listBadgeRequests shows it.
export async function grantBadge(
  viewerId,
  badgeId,
  input = {},
  { requestId, now = new Date() } = {},
) {
  if (!isId(badgeId)) throw notFound("Badge");
  const [manager, badge] = await Promise.all([
    requireUser(viewerId),
    Badge.findById(badgeId, { name: 1, orgUnit: 1, validityDays: 1 }).lean(),
  ]);
  if (!badge) throw notFound("Badge");
  requireUnitManager(
    manager,
    badge.orgUnit,
    "Only the issuing unit's managers can grant this badge.",
  );

  if (!isPlainObject(input)) throw invalid("Send the grant as an object.");
  const problems = [];
  const userId = readId(input.userId, "userId", problems);
  if (absent(input.userId))
    problems.push({ path: "userId", message: "Required." });
  const note = readText(input.note, "note", problems, { max: MAX_TEXT });
  assertValid(problems, "field");
  const member = await User.findById(userId, { _id: 1 }).lean();
  if (!member) throw fieldError("userId", "No such user.");
  refuseOwn(
    manager,
    member._id,
    "You can't grant a badge to yourself. Another manager of this unit or an admin must.",
  );

  const expiresAt = expiryFrom(badge, now);
  const current = await UserBadge.findOne(
    { user: member._id, badge: badge._id },
    { status: 1, expiresAt: 1 },
  ).lean();
  if (current?.status === "active" && !current.expiresAt && !expiresAt)
    return managerView(await loadQueueRow(current._id), now);

  // One upsert: two managers granting at once both end with the badge active, and "before" is
  // whatever each of them actually replaced.
  const before = await UserBadge.findOneAndUpdate(
    { user: member._id, badge: badge._id },
    {
      $set: {
        status: "active",
        decidedBy: manager._id,
        decidedAt: now,
        expiresAt,
      },
      $unset: { reason: 1 },
    },
    { upsert: true, returnDocument: "before" },
  ).lean();
  const row = await UserBadge.findOne(
    { user: member._id, badge: badge._id },
    { _id: 1 },
  ).lean();

  await record({
    actor: { id: manager._id, role: auditRole(manager, badge.orgUnit) },
    action: "badge.granted",
    entity: { type: "user_badge", id: row._id },
    orgUnit: badge.orgUnit,
    reason: note,
    changes: {
      status: [before ? badgeState(before, now) : null, "active"],
      expiresAt: [before?.expiresAt ?? null, expiresAt],
    },
    meta: { badge: badge._id, user: member._id, direct: true },
    requestId,
  });
  await send([member._id], "badge.granted", grantedData(badge, expiresAt));
  return managerView(await loadQueueRow(row._id), now);
}
