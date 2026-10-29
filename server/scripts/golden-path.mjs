// `npm run golden-path [base URL] [--no-photos]`: the judge script (frontend.md §11, steps 1–12) over
// HTTP against a running server, as the demo users, so a deployment can be checked end to end before
// the judges try it. One line per step; the first unexpected answer stops the run with exit code 1.
//
// It signs in through POST /auth/demo-login (DEMO_MODE=true and `npm run seed` first). Should the demo
// tier be used up (60 sign-ins per role in 15 minutes), it signs in with the demo email and
// SEED_PASSWORD instead, which that tier doesn't count. The base URL comes from the first argument,
// then GOLDEN_PATH_URL, then http://localhost:$PORT (5000); "/api/v1" is added if it's missing.
//
// Step 1 lists its own uniquely named copy of the printer, open every day all day with no lead time,
// so the booking can start two minutes later and be checked in at once; the run archives it at the
// end, and closes the bookings it made, even after a failure. Photos are attached to the handovers
// only when the server's uploads are configured. The student must not hold 3D Printing Basics yet,
// and step 4 grants it, which no route takes back: once a run gets that far it ends by saying to run
// `npm run seed`, which resets it, before the judges try the script.
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { formatIstRange } from "../src/lib/time.js";

const STEPS = 12;
const DEMO_DOMAIN = "demo.campuscommons.test";
const PRINTING_BADGE = "3d-printing-basics";
const ROLES = ["manager", "student", "student2", "admin"];
const MINUTE = 60_000;
const IST_OFFSET = 330 * MINUTE;
const CHECKLIST = [
  "Nozzle clean",
  "Build plate undamaged",
  "Filament spool mounted",
];
const RESEED =
  "Reset needed: the demo student now holds 3D Printing Basics, so steps 2-4 of the judge script won't work until you run npm run seed.";

// A 1×1 PNG, enough for the upload service to read and Cloudinary to store.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export class GoldenPathError extends Error {
  constructor(message, { step = null, requestId = null } = {}) {
    super(message);
    this.name = "GoldenPathError";
    this.step = step;
    this.requestId = requestId;
  }
}

// "http://host:5000", ".../api/v1" or ".../api/v1/" → "http://host:5000/api/v1".
export function apiBase(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new GoldenPathError(`"${baseUrl}" isn't a URL.`);
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api/v1") ? path : `${path}/api/v1`;
  return url.toString().replace(/\/+$/, "");
}

// A slot that starts two minutes from `now` and lasts up to an hour, inside one IST day, since a slot
// can't cross midnight. Check-in opens 15 minutes before the start, so it is open straight away; in
// the last minutes of a day the slot starts at the next midnight instead, still within those 15.
export function slotFrom(now) {
  const start = Math.ceil((now.getTime() + 2 * MINUTE) / MINUTE) * MINUTE;
  const dayEnd =
    Math.floor((start + IST_OFFSET) / (1440 * MINUTE)) * 1440 * MINUTE -
    IST_OFFSET +
    (23 * 60 + 59) * MINUTE;
  if (dayEnd - start >= 5 * MINUTE)
    return {
      start: new Date(start),
      end: new Date(Math.min(start + 60 * MINUTE, dayEnd)),
    };
  const midnight = dayEnd + MINUTE;
  return { start: new Date(midnight), end: new Date(midnight + 60 * MINUTE) };
}

// The listing of step 1 (the judge script's "FDM 3D Printer #2"): requires 3D Printing Basics,
// manual approval, at most 4 hours and 6 hours a week, bookable at any minute of any day.
function listingFor(tag, unitId, badgeId) {
  return {
    orgUnit: unitId,
    title: `FDM 3D Printer #2 (golden path ${tag})`,
    description: `A copy of the DIC's FDM printer listed by the API golden-path script (${tag}). The run archives it when it ends.`,
    category: "equipment",
    bookingMode: "slot",
    quantity: 1,
    riskLevel: "medium",
    location: {
      building: "Design and Innovation Centre",
      room: "Prototyping Lab",
      floor: "Ground",
    },
    availability: {
      weekly: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        open: "00:00",
        close: "23:59",
      })),
      slotMinutes: 15,
    },
    eligibility: {
      memberTypes: ["ug", "pg", "rs", "faculty", "staff"],
      departments: [],
      badges: [badgeId],
      approvalMode: "manual",
    },
    limits: {
      minDurationMins: 5,
      maxDurationMins: 240,
      maxHoursPerWeek: 6,
      maxActiveBookings: 1,
      leadTimeMins: 0,
      maxAdvanceDays: 14,
    },
    usageRules: "PLA and PETG only. Remove your print before the slot ends.",
    checklist: CHECKLIST,
  };
}

// ── HTTP ────────────────────────────────────────────────────────────────────

function client(api, fetchImpl) {
  // → { status, body, data, meta }. Throws GoldenPathError when the server can't be reached, or
  // answers with a status not in `expect`.
  return async function call(
    session,
    method,
    path,
    { json, form, expect = [200] } = {},
  ) {
    const headers = {};
    if (session) headers.authorization = `Bearer ${session.accessToken}`;
    if (json !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetchImpl(`${api}${path}`, {
        method,
        headers,
        body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
      });
    } catch (err) {
      throw new GoldenPathError(
        `${method} ${path} didn't reach ${api}: ${err?.cause?.code ?? err?.cause?.message ?? err?.message ?? err}. Is the server running?`,
      );
    }
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON: reported below if the status was unexpected
    }
    const requestId = body?.requestId ?? res.headers.get("x-request-id");
    if (!expect.includes(res.status)) {
      const error = body?.error;
      const why = error
        ? `${error.code} "${error.message}"${error.details ? ` ${JSON.stringify(error.details)}` : ""}`
        : JSON.stringify(text.slice(0, 200));
      throw new GoldenPathError(
        `${method} ${path} answered ${res.status} ${why}; expected ${expect.join(" or ")}${requestId ? ` (request id ${requestId})` : ""}.`,
        { requestId },
      );
    }
    return { status: res.status, body, data: body?.data, meta: body?.meta };
  };
}

// The demo-login session for `role`; with a password, POST /auth/login when the demo tier answers
// 429. → { accessToken, user, via }
export async function signIn(call, role, password) {
  const demo = await call(null, "POST", "/auth/demo-login", {
    json: { role },
    expect: [200, 404, 429],
  });
  if (demo.status === 200) return { ...demo.data, via: "demo-login" };
  if (demo.status === 429 && password) {
    const login = await call(null, "POST", "/auth/login", {
      json: { email: `${role}@${DEMO_DOMAIN}`, password },
    });
    return { ...login.data, via: "password" };
  }
  throw new GoldenPathError(
    demo.status === 404
      ? `POST /auth/demo-login answered 404: "${demo.body?.error?.message}" Turn DEMO_MODE on and run npm run seed.`
      : `POST /auth/demo-login answered 429: the demo sign-ins for "${role}" are used up for now. Set SEED_PASSWORD to sign in with the password instead.`,
  );
}

function check(condition, message) {
  if (!condition) throw new GoldenPathError(message);
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// ── The run ─────────────────────────────────────────────────────────────────

// The judge script's steps 1–12, then the clean-up. print gets one line per step. fetch and now are
// for tests. → what it made: { resourceId, bookingId, waitlistedId, incidentId, photos }.
// Throws GoldenPathError (with .step) at the first unexpected answer, after the clean-up.
export async function runGoldenPath({
  baseUrl,
  password,
  photos = true,
  print = console.log,
  fetch: fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const api = apiBase(baseUrl);
  const call = client(api, fetchImpl);
  const tag = `gp${randomBytes(4).toString("hex")}`;
  const made = {
    resourceId: null,
    bookingId: null,
    waitlistedId: null,
    incidentId: null,
    photos: 0,
  };
  const as = {};
  let badgeGranted = false;

  let current = null;
  async function step(n, title, body) {
    current = n;
    try {
      const detail = await body();
      print(`PASS ${String(n).padStart(2)}/${STEPS}  ${title}: ${detail}`);
    } catch (err) {
      const reason =
        err instanceof GoldenPathError
          ? err.message
          : String(err?.stack ?? err);
      print(`FAIL ${String(n).padStart(2)}/${STEPS}  ${title}: ${reason}`);
      if (err instanceof GoldenPathError) err.step = n;
      throw err;
    }
  }

  let failure = null;
  try {
    print(`Golden path against ${api} (listing tag ${tag})`);
    for (const role of ROLES) as[role] = await signIn(call, role, password);
    const vias = [...new Set(ROLES.map((r) => as[r].via))].join(" and ");
    print(`Signed in as ${ROLES.join(", ")} (${vias}).`);
    const { manager, student, student2, admin } = as;

    const units = (await call(manager, "GET", "/org-units")).data;
    const dic = units.find((u) => u.code === "dic");
    check(dic, 'No org unit with code "dic". Run npm run seed.');
    const badges = (await call(manager, "GET", "/badges")).data;
    const badge = badges.find((b) => b.code === PRINTING_BADGE);
    check(badge, `No "${PRINTING_BADGE}" badge. Run npm run seed.`);
    const listing = listingFor(tag, dic._id, badge._id);
    const resourcePath = () => `/resources/${made.resourceId}`;
    const bookingPath = () => `/bookings/${made.bookingId}`;

    await step(1, "Manager lists a resource", async () => {
      const { data } = await call(manager, "POST", "/resources", {
        json: listing,
        expect: [201],
      });
      made.resourceId = data._id;
      check(
        data.canManage === true,
        "The new listing isn't manageable by its creator.",
      );
      const audit = await call(
        manager,
        "GET",
        `/audit?entityType=resource&entityId=${data._id}`,
      );
      check(
        audit.data.some((e) => e.action === "resource.created"),
        "No resource.created entry in the audit log.",
      );
      return `"${data.title}" in ${data.orgUnit.name}; resource.created is in the audit log`;
    });

    await step(2, "Student finds it and sees the missing badge", async () => {
      const found = await call(student, "GET", `/resources?q=${tag}`);
      check(
        found.data.some((r) => sameId(r._id, made.resourceId)),
        `Searching for "${tag}" didn't find the new listing.`,
      );
      const { data } = await call(
        student,
        "GET",
        `${resourcePath()}/eligibility`,
      );
      const rule = data.results.find((r) => r.rule === "BADGES");
      check(
        data.eligible === false && rule?.passed === false,
        "The student is already eligible: they must not hold 3D Printing Basics yet. Run npm run seed to reset the demo data.",
      );
      check(
        /Missing badge: 3D Printing Basics/.test(rule.message),
        `The BADGES rule says "${rule.message}", not that the badge is missing. Run npm run seed to reset the demo data.`,
      );
      return `"${rule.message}" → "${rule.fixHint}"`;
    });

    await step(3, "Student requests the badge", async () => {
      const { data } = await call(
        student,
        "POST",
        `/badges/${badge._id}/requests`,
        {
          json: { note: "For the golden-path booking on the DIC's printer." },
          expect: [201],
        },
      );
      check(data.state === "requested", `The request is "${data.state}".`);
      const mine = await call(student, "GET", "/badges/mine");
      const row = mine.data.find((r) => sameId(r.badge._id, badge._id));
      check(row?.state === "requested", "My badges doesn't show the request.");
      return `${badge.name} shows "Requested"`;
    });

    await step(4, "Manager approves the badge request", async () => {
      const queue = await call(
        manager,
        "GET",
        `/badge-requests?status=requested&badgeId=${badge._id}&limit=50`,
      );
      const row = queue.data.find((r) => sameId(r.user._id, student.user._id));
      check(row, "The student's request isn't in the manager's queue.");
      const { data } = await call(
        manager,
        "PATCH",
        `/badge-requests/${row._id}`,
        {
          json: { decision: "approve" },
        },
      );
      check(data.status === "active", `The badge is "${data.status}".`);
      badgeGranted = true;
      const inbox = await call(student, "GET", "/notifications?limit=10");
      check(
        inbox.data.some((n) => n.type === "badge.granted"),
        "The student wasn't notified of the grant.",
      );
      const { data: now } = await call(
        student,
        "GET",
        `${resourcePath()}/eligibility`,
      );
      check(
        now.eligible === true,
        "The checklist didn't turn green after the grant.",
      );
      return "the student is notified and the checklist turns ✓";
    });

    const slot = slotFrom(now());
    const request = {
      resourceId: made.resourceId,
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
    };
    const when = `${formatIstRange(slot.start, slot.end)} IST`;

    await step(5, "Student books a slot", async () => {
      const { data: pre } = await call(student, "POST", "/bookings/check", {
        json: request,
      });
      const failed = pre.results.filter((r) => !r.passed).map((r) => r.rule);
      check(
        pre.outcome === "pending" && !failed.length,
        `The pre-check says ${pre.outcome}${failed.length ? ` (failed: ${failed.join(", ")})` : ""}.`,
      );
      const { data } = await call(student, "POST", "/bookings", {
        json: {
          ...request,
          purpose: "Printing a bracket for the golden-path demo run.",
        },
        expect: [201],
      });
      made.bookingId = data.booking._id;
      check(
        data.booking.status === "pending",
        `The booking is "${data.booking.status}".`,
      );
      return `pre-check all ✓, ${when} is awaiting review`;
    });

    await step(
      6,
      "Student 2 asks for the same slot and joins the waitlist",
      async () => {
        const { data: pre } = await call(student2, "POST", "/bookings/check", {
          json: request,
        });
        check(
          pre.outcome === "slot_taken" && pre.waitlistPosition === 1,
          `The pre-check says ${pre.outcome} (position ${pre.waitlistPosition}).`,
        );
        const body = {
          ...request,
          purpose: "Printing spacers for the golden-path demo run.",
        };
        const taken = await call(student2, "POST", "/bookings", {
          json: body,
          expect: [409],
        });
        check(
          taken.body.error.code === "SLOT_TAKEN" &&
            taken.body.error.details?.waitlistPosition === 1,
          `Booking the taken slot answered ${taken.body.error.code}.`,
        );
        const { data } = await call(student2, "POST", "/bookings", {
          json: { ...body, joinWaitlist: true },
          expect: [201],
        });
        made.waitlistedId = data.booking._id;
        check(
          data.booking.status === "waitlisted" && data.waitlistPosition === 1,
          `Joining the waitlist gave "${data.booking.status}" at #${data.waitlistPosition}.`,
        );
        return `"${taken.body.error.message}" → Waitlisted #1`;
      },
    );

    await step(
      7,
      "Manager approves the student from the conflict group",
      async () => {
        const queue = await call(
          manager,
          "GET",
          `/bookings/manage?status=pending&resourceId=${made.resourceId}`,
        );
        check(
          queue.data.length === 1,
          `The queue has ${queue.data.length} groups for the listing, not 1.`,
        );
        const inGroup = queue.data[0].bookings.map((b) => String(b._id));
        check(
          inGroup.length === 2 &&
            inGroup[0] === String(made.bookingId) &&
            inGroup[1] === String(made.waitlistedId),
          "The group doesn't hold the two requests, oldest first.",
        );
        const { data } = await call(
          manager,
          "POST",
          `${bookingPath()}/approve`,
          {
            json: { note: "Approved for the golden-path run." },
          },
        );
        check(data.status === "approved", `The booking is "${data.status}".`);
        const inbox = await call(student, "GET", "/notifications?limit=10");
        check(
          inbox.data.some(
            (n) => n.type === "booking.approved" && n.link === bookingPath(),
          ),
          "The student wasn't notified of the approval.",
        );
        const { data: other } = await call(
          student2,
          "GET",
          `/bookings/${made.waitlistedId}`,
        );
        check(
          other.status === "waitlisted" && other.waitlistPosition === 1,
          `Student 2's request is "${other.status}" at #${other.waitlistPosition}.`,
        );
        return "Approved (student notified); student 2 stays Waitlisted #1";
      },
    );

    // Uploaded in step 8, so a failed upload is reported there.
    let attached = { list: [], note: "photos off (--no-photos)" };
    const report = (overall, notes, issue) => ({
      items: listing.checklist.map((label) =>
        label === issue?.label
          ? { label, ok: false, note: issue.note }
          : { label, ok: true },
      ),
      overall,
      ...(notes && { notes }),
    });

    await step(8, "Student checks in", async () => {
      if (photos) attached = await uploadPhotos(call, student);
      made.photos = attached.list.length;
      const { data } = await call(
        student,
        "POST",
        `${bookingPath()}/check-in`,
        {
          json: { ...report("good"), photos: attached.list.slice(0, 1) },
        },
      );
      check(data.status === "checked_in", `The booking is "${data.status}".`);
      const timeline = await call(student, "GET", `${bookingPath()}/timeline`);
      check(
        timeline.data.some((e) => e.action === "booking.checked_in") &&
          timeline.data.some(
            (e) => e.kind === "condition_report" && e.phase === "check_in",
          ),
        "The timeline doesn't show the check-in and its report.",
      );
      return `In use; the timeline shows the check-in report (${attached.note})`;
    });

    await step(9, "Student checks out", async () => {
      const { data } = await call(
        student,
        "POST",
        `${bookingPath()}/check-out`,
        {
          json: {
            ...report("minor_issue", "Bed slightly scratched", {
              label: "Build plate undamaged",
              note: "Bed slightly scratched",
            }),
            photos: attached.list.slice(1, 2),
          },
        },
      );
      check(data.status === "checked_out", `The booking is "${data.status}".`);
      return 'Returned, awaiting confirmation ("Bed slightly scratched")';
    });

    await step(10, "Manager confirms the return with an issue", async () => {
      const { data } = await call(
        manager,
        "POST",
        `${bookingPath()}/confirm-return`,
        {
          json: {
            outcome: "issue",
            items: report("minor_issue", null, {
              label: "Build plate undamaged",
              note: "Light scratch across the front edge",
            }).items,
            note: "Scratch on the build plate, as the student reported.",
            incident: {
              type: "damage",
              severity: "low",
              description:
                "A light scratch across the front edge of the build plate after this booking. It still prints flat.",
            },
          },
        },
      );
      check(
        data.booking.status === "flagged",
        `The booking is "${data.booking.status}".`,
      );
      check(
        data.incident?.status === "open",
        "No open incident came with the return.",
      );
      made.incidentId = data.incident._id;
      return "Issue reported; a low-severity damage incident is open";
    });

    await step(11, "Admin resolves the incident with a warning", async () => {
      const { data } = await call(
        admin,
        "POST",
        `/incidents/${made.incidentId}/resolve`,
        {
          json: {
            outcome: "warning",
            rationale:
              "Minor wear; reminded the student to lift prints with the spatula.",
          },
        },
      );
      check(
        data.status === "resolved" && data.resolution?.outcome === "warning",
        `The incident is "${data.status}".`,
      );
      check(data.bookingClosed === true, "Resolving didn't close the booking.");
      const { data: booking } = await call(student, "GET", bookingPath());
      check(
        booking.status === "completed",
        `The booking is "${booking.status}".`,
      );
      for (const [who, session] of [
        ["student", student],
        ["manager", manager],
      ]) {
        const inbox = await call(session, "GET", "/notifications?limit=10");
        check(
          inbox.data.some(
            (n) =>
              n.type === "incident.resolved" &&
              n.link?.endsWith(`/incidents/${made.incidentId}`),
          ),
          `The ${who} wasn't notified of the resolution.`,
        );
      }
      return "Completed; the student and the manager are notified";
    });

    await step(
      12,
      "Student's timeline and the admin's audit log tell the whole story",
      async () => {
        const expected = [
          "booking.requested",
          "booking.approved",
          "booking.checked_in",
          "booking.checked_out",
          "booking.flagged",
          "booking.completed",
        ];
        const timeline = await call(
          student,
          "GET",
          `${bookingPath()}/timeline`,
        );
        const events = timeline.data.filter((e) => e.kind === "event");
        check(
          JSON.stringify(events.map((e) => e.action)) ===
            JSON.stringify(expected),
          `The timeline's events are ${events.map((e) => e.action).join(", ")}.`,
        );
        const phases = timeline.data
          .filter((e) => e.kind === "condition_report")
          .map((e) => e.phase);
        check(
          ["check_in", "check_out", "return_confirmation"].every((p) =>
            phases.includes(p),
          ),
          `The timeline's reports are ${phases.join(", ")}.`,
        );
        const incident = timeline.data
          .filter((e) => e.kind === "incident")
          .map((e) => e.event);
        check(
          incident.includes("opened") && incident.includes("resolved"),
          "The timeline doesn't show the incident opened and resolved.",
        );
        const audit = await call(
          admin,
          "GET",
          `/audit?entityType=booking&entityId=${made.bookingId}&limit=50`,
        );
        const actions = [...audit.data].reverse().map((e) => e.action);
        check(
          JSON.stringify(actions) === JSON.stringify(expected),
          `The audit log has ${actions.join(", ")}.`,
        );
        check(
          audit.data.every((e) => e.at && e.actor?.role),
          "An audit entry has no time or actor.",
        );
        const who = [...audit.data]
          .reverse()
          .map(
            (e) =>
              `${e.action.split(".")[1]} (${e.actor.name ?? e.actor.role})`,
          )
          .join(", ");
        return `${events.length} events, ${phases.length} reports, the incident; audit: ${who}`;
      },
    );
  } catch (err) {
    failure =
      err instanceof GoldenPathError
        ? err
        : new GoldenPathError(String(err?.stack ?? err));
    failure.step ??= current;
  } finally {
    // A clean-up failure is always shown (cleanUp prints it), but the first failure is the one reported.
    await cleanUp(call, as, made, print).catch((err) => {
      failure ??=
        err instanceof GoldenPathError
          ? err
          : new GoldenPathError(String(err?.message ?? err));
    });
    if (badgeGranted) print(RESEED);
  }
  if (failure) throw failure;
  return made;
}

// Up to two photos for the handovers, when the server's uploads work. A 503 (not configured or
// unavailable) or a 429 (the upload tier) means no photos; anything else is a failure.
async function uploadPhotos(call, session) {
  const form = new FormData();
  for (const name of ["check-in.png", "check-out.png"])
    form.append("images", new Blob([PIXEL_PNG], { type: "image/png" }), name);
  const res = await call(session, "POST", "/uploads/images", {
    form,
    expect: [201, 429, 503],
  });
  if (res.status === 201)
    return { list: res.data, note: "a photo on each handover" };
  return {
    list: [],
    note: `no photos: ${res.body?.error?.message ?? `uploads answered ${res.status}`}`,
  };
}

const BY_CLEAN_UP = "Closed by the golden-path script's clean-up.";

// The student's booking, whatever step the run stopped at. npm run seed removes only the bookings it
// made, so a loan left out on the archived listing would turn overdue an hour later, with a delay
// incident and notices in the demo accounts the judges use. → what was done, or null (nothing to do).
async function closeBooking(call, as, bookingId) {
  const path = `/bookings/${bookingId}`;
  const { data } = await call(as.student, "GET", path);
  if (data.status === "pending" || data.status === "approved") {
    await call(as.student, "POST", `${path}/cancel`, {
      json: { reason: BY_CLEAN_UP },
    });
    return "cancelled the student's booking";
  }
  if (data.status === "flagged")
    throw new GoldenPathError(
      `The student's booking is still flagged with an open incident${data.incident?._id ? ` (${data.incident._id})` : ""}: resolve it as the admin.`,
    );
  if (data.status !== "checked_in" && data.status !== "checked_out")
    return null;
  if (data.status === "checked_in")
    await call(as.student, "POST", `${path}/check-out`, {
      json: {
        items: CHECKLIST.map((label) => ({ label, ok: true })),
        overall: "good",
        notes: BY_CLEAN_UP,
      },
    });
  await call(as.manager, "POST", `${path}/confirm-return`, {
    json: { outcome: "ok", note: BY_CLEAN_UP },
  });
  return "returned the student's booking and confirmed it";
}

// Leaves nothing bookable or open behind, after a failure too: student 2's waitlisted request is
// cancelled first (409 if it has expired or gone already), so closing the student's booking doesn't
// promote it; then the student's booking is closed and the listing archived. Each part is tried even
// if one before it failed; what couldn't be done is printed, and the first such error thrown.
async function cleanUp(call, as, made, print) {
  const done = [];
  const errors = [];
  const attempt = async (part) => {
    try {
      const what = await part();
      if (what) done.push(what);
    } catch (err) {
      errors.push(err);
    }
  };
  if (made.waitlistedId && as.student2)
    await attempt(async () => {
      const res = await call(
        as.student2,
        "POST",
        `/bookings/${made.waitlistedId}/cancel`,
        { json: {}, expect: [200, 409] },
      );
      return res.status === 200
        ? "cancelled student 2's waitlisted request"
        : null;
    });
  if (made.bookingId && as.student && as.manager)
    await attempt(() => closeBooking(call, as, made.bookingId));
  if (made.resourceId && as.manager)
    await attempt(async () => {
      await call(as.manager, "PATCH", `/resources/${made.resourceId}/status`, {
        json: {
          status: "archived",
          reason: "Listed by the API golden-path script for one run.",
        },
      });
      return "archived the listing";
    });
  if (done.length) print(`Clean-up: ${done.join("; ")}.`);
  for (const err of errors) print(`Clean-up failed: ${err?.message ?? err}`);
  if (errors.length) throw errors[0];
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `Usage: npm run golden-path -- [base URL] [--no-photos]

Runs the judge script (frontend.md §11, steps 1-12) against a running server.
  base URL     the API server, e.g. http://localhost:5000 (default: GOLDEN_PATH_URL,
               then http://localhost:$PORT). "/api/v1" is added if it's missing.
  --no-photos  don't upload condition photos even if uploads are configured.
Needs DEMO_MODE=true on the server and a fresh npm run seed. SEED_PASSWORD, if set,
is used to sign in when the demo sign-ins are rate limited.`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((a) => a.startsWith("-") && a !== "--no-photos");
  const urls = argv.filter((a) => !a.startsWith("-"));
  if (unknown.length || urls.length > 1) {
    console.error(
      `Unexpected argument ${[...unknown, ...urls.slice(1)].join(" ")}.\n\n${USAGE}`,
    );
    return 1;
  }
  const baseUrl =
    urls[0] ?? env.GOLDEN_PATH_URL ?? `http://localhost:${env.PORT || 5000}`;
  try {
    await runGoldenPath({
      baseUrl,
      password: env.SEED_PASSWORD || undefined,
      photos: !argv.includes("--no-photos"),
    });
    console.log(`Golden path passed: all ${STEPS} steps.`);
    return 0;
  } catch (err) {
    const where = err?.step ? ` at step ${err.step}` : "";
    console.error(`Golden path failed${where}: ${err?.message ?? err}`);
    return 1;
  }
}

// Run as a script, not imported by a test.
function invokedDirectly() {
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // Loaded here, not at the top, so a test importing the runner never reads server/.env.
  await import("dotenv/config");
  process.exitCode = await main();
}
