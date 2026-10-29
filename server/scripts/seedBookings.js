// The demo bookings of `npm run seed` (backend.md §9 "Bookings"): sixteen bookings in every status,
// borrowed by the demo users, so every list and timeline screen has data on first load, including the
// judge script's seeded extras (frontend.md §11): a no-show, an overdue loan with its delay incident
// and a rejected request with its reason.
//
// Made through the real flows, never inserted: each booking is requested with createBooking and moved
// on with transition, checkIn, checkOut, confirmReturn and the sweeper's overdue step, each at the
// moment its story says it happened (the services' `now` option). For every step Mongoose's own clock
// (mongoose.now, which stamps createdAt, updatedAt and the audit log's `at`) is set to that moment
// too, so the audit entries, notifications, condition reports and incidents carry the time they
// claim and every timeline reads in order. The eligibility engine and the state machine check each
// step as they would for a member, so a story that breaks a rule fails here instead of going in.
// The clock is process-wide: never run this beside request handling in the same process.
//
// Times are relative to the seed's `now`, in IST, on the open days (Mon–Sat) of the seeded resources:
// history on the open days before today, upcoming bookings from the second open day ahead, which is
// never tomorrow; only the loan that is out right now may run through tomorrow. Tomorrow 10:00–12:00
// on the printer is the judge script's slot (frontend.md §11 step 5), so the printer is free then,
// and student 2, who joins its waitlist in step 6, holds no active printer booking (its cap is 1)
// and at most 3 of its 6 weekly hours in any week.
//
// Idempotent: each run removes the bookings an earlier run seeded and makes them again from the new
// `now`, so upcoming stays upcoming. Seeded bookings are found by their booking.requested audit entry,
// which carries requestId "seed:demo-bookings" and a demo user as its actor. No HTTP request can
// produce that id (requestLogger accepts only A–Z a–z 0–9 _ -), so nobody's real booking matches.
// Each goes with its condition reports, incidents, audit entries and notifications
// (removeSeededBookings). Nothing else is deleted. A seeded booking that still held a slot frees it as
// a cancel would: whoever waited behind it (a member, or a judge's demo session) is promoted.
import mongoose from "mongoose";
import { SLOT_HOLDING_STATUSES } from "../src/engines/stateMachine.js";
import { STEPS } from "../src/jobs/sweeper.js";
import { DAY, HOUR, MINUTE, istParts, parseHHmm } from "../src/lib/time.js";
import {
  AuditLog,
  Booking,
  ConditionReport,
  Incident,
  Notification,
  OrgUnit,
  Resource,
  User,
} from "../src/models/index.js";
import { loadResource } from "../src/services/bookingContext.js";
import {
  SYSTEM,
  checkIn,
  checkOut,
  confirmReturn,
  createBooking,
  transition,
} from "../src/services/bookingService.js";
import { promoteFreedSlot } from "../src/services/waitlistService.js";
import { DEMO_USERS, RESOURCES, demoEmail } from "./seedData.js";

export const SEED_REQUEST_ID = "seed:demo-bookings";

// ── IST days ────────────────────────────────────────────────────────────────

// Every resource the stories use opens Mon–Sat (seedData.js); 0 is Sunday.
const isOpenDay = (day) => istParts(day).day !== 0;
// 00:00 IST of the day containing `t`. IST has no daylight saving, so days are exactly DAY apart.
const dayOf = (t) => new Date(`${istParts(t).dateKey}T00:00:00+05:30`);
const atClock = (day, hhmm) =>
  new Date(day.getTime() + parseHHmm(hhmm) * MINUTE);
const shift = (t, ms) => new Date(new Date(t).getTime() + ms);

// The k-th open day before (k < 0) or after (k > 0) today, as its 00:00 IST.
export function openDay(now, k) {
  let day = dayOf(now);
  for (let left = Math.abs(k); left > 0;) {
    day = shift(day, Math.sign(k) * DAY);
    if (isOpenDay(day)) left--;
  }
  return day;
}

// A slot on the k-th open day from today, from and to IST wall-clock times.
const onOpenDay = (now, k, from, to) => {
  const day = openDay(now, k);
  return { start: atClock(day, from), end: atClock(day, to) };
};

// A loan that is out right now: picked up at 10:00 on the latest open day at least an hour ago, due
// back at 16:00 on the first open day at least two hours ahead. At most 54 hours (Saturday to Monday),
// inside the IoT kit's 3 days, with pickup and return in opening hours.
function loanOutNow(now) {
  let pickup = dayOf(now);
  while (!(isOpenDay(pickup) && atClock(pickup, "10:00") <= shift(now, -HOUR)))
    pickup = shift(pickup, -DAY);
  let due = dayOf(now);
  while (!(isOpenDay(due) && atClock(due, "16:00") >= shift(now, 2 * HOUR)))
    due = shift(due, DAY);
  return { start: atClock(pickup, "10:00"), end: atClock(due, "16:00") };
}

// ── The stories ─────────────────────────────────────────────────────────────

// Each story: who borrows which seeded resource, when, and what happens to it, in order. Every step
// names its moment; none may be later than `now`. status is where the story must end.
// Who decides: the demo manager for the DIC and the Central Workshop; the admin elsewhere, since the
// seed gives the other units no manager. Fictional people and purposes (architecture.md §1.2).
export const STORIES = [
  {
    key: "printer-completed",
    status: "completed",
    borrower: "student2",
    resource: "FDM 3D Printer",
    slot: (now) => onOpenDay(now, -6, "10:00", "12:00"),
    purpose: "Printing gear housings for the robotics club's line-follower.",
    async story(b) {
      await b.request(shift(b.start, -DAY));
      await b.decide("approve", "manager", shift(b.start, -DAY + HOUR), {
        note: "Approved. Bring your model already sliced.",
      });
      await b.checkIn(shift(b.start, 3 * MINUTE));
      await b.checkOut(shift(b.end, -5 * MINUTE), {
        notes: "Print finished; sheet cleaned and back on the bed.",
      });
      await b.confirm("manager", shift(b.end, 25 * MINUTE), {
        outcome: "ok",
        note: "Checked the printer after the slot: all fine.",
      });
    },
  },
  {
    key: "oscilloscope-completed",
    status: "completed",
    borrower: "student",
    resource: "Digital Storage Oscilloscope",
    slot: (now) => onOpenDay(now, -4, "10:00", "12:00"),
    purpose:
      "Measuring the PWM output of a motor driver for the EC lab project.",
    async story(b) {
      await b.request(shift(b.start, -DAY)); // auto-approved
      await b.checkIn(shift(b.start, 4 * MINUTE));
      await b.checkOut(shift(b.end, -6 * MINUTE));
      await b.confirm("admin", shift(b.end, 40 * MINUTE), { outcome: "ok" });
    },
  },
  {
    key: "printer-flagged",
    status: "flagged",
    borrower: "student2",
    resource: "FDM 3D Printer",
    slot: (now) => onOpenDay(now, -3, "14:00", "15:30"),
    purpose: "Printing a replacement bracket for the club's drone frame.",
    async story(b) {
      await b.request(shift(b.start, -DAY));
      await b.decide("approve", "manager", shift(b.start, -DAY + HOUR));
      await b.checkIn(shift(b.start, 2 * MINUTE));
      await b.checkOut(shift(b.end, -4 * MINUTE), {
        overall: "minor_issue",
        issues: { "Nozzle clean": "Filament residue around the nozzle" },
        notes: "The nozzle started skipping near the end of the print.",
      });
      await b.confirm("manager", shift(b.end, 30 * MINUTE), {
        outcome: "issue",
        issues: { "Nozzle clean": "Partly clogged" },
        note: "Nozzle partly clogged after this print.",
        incident: {
          type: "damage",
          severity: "medium",
          description:
            "The nozzle was partly clogged after this booking and had to be cleared before the next print. Checking whether a filament other than PLA or PETG was used.",
        },
      });
    },
  },
  {
    key: "room-completed",
    status: "completed",
    borrower: "manager",
    resource: "Discussion Room A",
    slot: (now) => onOpenDay(now, -3, "10:00", "11:00"),
    purpose: "Planning the DIC open house with the student volunteers.",
    async story(b) {
      await b.request(shift(b.start, -DAY)); // auto-approved
      await b.checkIn(shift(b.start, 2 * MINUTE));
      await b.checkOut(shift(b.end, -2 * MINUTE));
      await b.confirm("admin", shift(b.end, 15 * MINUTE), { outcome: "ok" });
    },
  },
  {
    key: "room-no-show",
    status: "no_show",
    borrower: "student",
    resource: "Discussion Room A",
    slot: (now) => onOpenDay(now, -2, "15:00", "16:00"),
    purpose: "Group study for the data structures mid-semester exam.",
    async story(b) {
      await b.request(shift(b.start, -DAY)); // auto-approved
      // The sweeper's no-show step: transition("markNoShow") as the system, after the grace period.
      await b.system("markNoShow", shift(b.start, 20 * MINUTE));
    },
  },
  {
    key: "microscope-expired",
    status: "expired",
    borrower: "faculty",
    resource: "Optical Microscope",
    slot: (now) => onOpenDay(now, -2, "10:00", "11:00"),
    purpose: "Grain-size measurements on annealed copper samples for a thesis.",
    async story(b) {
      await b.request(shift(b.start, -2 * DAY)); // nobody decided before the start
      // The sweeper's expiry step: transition("expire") as the system, once the start has passed.
      await b.system("expire", shift(b.start, 3 * MINUTE));
    },
  },
  {
    key: "printer-returned",
    status: "checked_out",
    borrower: "student2",
    resource: "FDM 3D Printer",
    slot: (now) => onOpenDay(now, -1, "11:00", "12:30"),
    purpose: "Printing enclosure parts for a hostel weather station.",
    async story(b) {
      await b.request(shift(b.start, -DAY));
      await b.decide("approve", "manager", shift(b.start, -DAY + HOUR));
      await b.checkIn(shift(b.start, MINUTE));
      await b.checkOut(shift(b.end, -3 * MINUTE), {
        notes: "Left the print sheet on the rack to cool.",
      });
      // Awaiting the manager's return confirmation (Manage → Handovers).
    },
  },
  {
    key: "camera-overdue",
    status: "checked_in",
    overdue: true,
    borrower: "faculty",
    resource: "DSLR Camera Kit",
    slot: (now) => onOpenDay(now, -1, "10:00", "16:00"),
    purpose: "Photographing the ECE department seminar for the newsletter.",
    async story(b) {
      await b.request(shift(b.start, -DAY));
      await b.decide("approve", "admin", shift(b.start, -DAY + 3 * HOUR), {
        note: "Approved for the seminar.",
      });
      await b.checkIn(shift(b.start, 5 * MINUTE));
      // Not returned: the sweeper flags it overdue and opens the delay incident.
      await b.sweep("overdueReturns", shift(b.end, 20 * MINUTE));
    },
  },
  {
    key: "kit-in-use",
    status: "checked_in",
    borrower: "student2",
    resource: "IoT Starter Kit",
    slot: loanOutNow,
    purpose: "Prototyping a soil-moisture sensor for the hostel garden.",
    async story(b) {
      await b.request(shift(b.start, -DAY)); // auto-approved
      await b.checkIn(shift(b.start, 5 * MINUTE));
    },
  },
  {
    key: "oscilloscope-cancelled",
    status: "cancelled",
    borrower: "student",
    resource: "Digital Storage Oscilloscope",
    slot: (now) => onOpenDay(now, 2, "14:00", "15:00"),
    purpose: "Checking the filter response for the signals lab assignment.",
    async story(b) {
      await b.request(shift(b.now, -DAY)); // auto-approved
      await b.decide("cancel", "student", shift(b.now, -2 * HOUR), {
        reason: "Our lab session moved to next week.",
      });
    },
  },
  {
    key: "printer-rejected",
    status: "rejected",
    borrower: "student2",
    resource: "FDM 3D Printer",
    slot: (now) => onOpenDay(now, 3, "14:00", "16:00"),
    purpose: "Printing chess pieces for the hostel games night.",
    async story(b) {
      await b.request(shift(b.now, -6 * HOUR));
      await b.decide("reject", "manager", shift(b.now, -3 * HOUR), {
        reason:
          "The printer is reserved for the DIC open house that afternoon. Any morning that week is free.",
      });
    },
  },
  {
    key: "camera-pending",
    status: "pending",
    borrower: "student",
    resource: "DSLR Camera Kit",
    slot: (now) => onOpenDay(now, 2, "10:00", "16:00"),
    purpose:
      "Covering the inter-hostel football final for the student newsletter.",
    async story(b) {
      await b.request(shift(b.now, -4 * HOUR));
    },
  },
  {
    key: "meeting-pending",
    status: "pending",
    borrower: "faculty",
    resource: "Meeting Room",
    slot: (now) => onOpenDay(now, 3, "14:00", "15:30"),
    purpose:
      "Mentor meeting with a student startup team about their prototype.",
    async story(b) {
      await b.request(shift(b.now, -DAY));
    },
  },
  {
    key: "meeting-waitlisted",
    status: "waitlisted",
    borrower: "student",
    resource: "Meeting Room",
    // The slot the faculty member's pending request holds, so the two form one conflict group.
    slot: (now) => onOpenDay(now, 3, "14:00", "15:30"),
    purpose: "Pitch practice for the CIIC startup challenge with my team.",
    async story(b) {
      await b.request(shift(b.now, -5 * HOUR), { joinWaitlist: true });
    },
  },
  {
    key: "room-approved",
    status: "approved",
    borrower: "student",
    resource: "Discussion Room A",
    slot: (now) => onOpenDay(now, 2, "16:00", "17:30"),
    purpose: "Revision session for the operating systems quiz.",
    async story(b) {
      await b.request(shift(b.now, -3 * HOUR)); // auto-approved
    },
  },
  {
    key: "microscope-approved",
    status: "approved",
    borrower: "faculty",
    resource: "Optical Microscope",
    slot: (now) => onOpenDay(now, 4, "14:00", "16:00"),
    purpose: "Imaging etched steel samples for the materials lab report.",
    async story(b) {
      await b.request(shift(b.now, -DAY));
      await b.decide("approve", "admin", shift(b.now, -20 * HOUR), {
        note: "Approved. Please bring the samples polished and dry.",
      });
    },
  },
];

// ── Running a story ─────────────────────────────────────────────────────────

// Runs fn as if it were `moment`: the services get it as `now`, Mongoose stamps it on every document
// written, and the audit entries carry the seed's request id.
async function atMoment(moment, now, fn) {
  const at = new Date(moment);
  if (!(at <= now))
    throw new Error(
      `A step would happen after the seed's now (${at.toISOString()}).`,
    );
  const own = Object.hasOwn(mongoose, "now");
  const previous = mongoose.now;
  mongoose.now = () => new Date(at);
  try {
    return await fn({ now: at, requestId: SEED_REQUEST_ID });
  } finally {
    if (own) mongoose.now = previous;
    else delete mongoose.now;
  }
}

// A condition report over the resource's whole checklist: every item fine unless `issues` names it.
function reportFor(resource, { overall = "good", issues = {}, notes } = {}) {
  const unknown = Object.keys(issues).filter(
    (label) => !resource.checklist.includes(label),
  );
  if (unknown.length)
    throw new Error(
      `${resource.title} has no checklist item ${unknown.join(", ")}.`,
    );
  return {
    items: resource.checklist.map((label) =>
      label in issues
        ? { label, ok: false, note: issues[label] }
        : { label, ok: true },
    ),
    photos: [],
    overall,
    ...(notes && { notes }),
  };
}

const sweeperStep = (name) => {
  const step = STEPS.find(([stepName]) => stepName === name)?.[1];
  if (!step) throw new Error(`The sweeper has no step "${name}".`);
  return step;
};

// The verbs a story uses. Each takes its moment first; the borrower checks in and out themselves.
function narrator({ now, users, resource, story, slot }) {
  const borrower = users.get(story.borrower);
  const userId = (login) => users.get(login)._id;
  const step = (moment, fn) => atMoment(moment, now, fn);
  const b = {
    ...slot,
    now,
    bookingId: null,
    request: (moment, extra = {}) =>
      step(moment, async (options) => {
        const { booking } = await createBooking(
          borrower._id,
          {
            resourceId: resource._id,
            ...slot,
            purpose: story.purpose,
            ...extra,
          },
          options,
        );
        b.bookingId = booking._id;
      }),
    decide: (action, login, moment, payload = {}) =>
      step(moment, (options) =>
        transition(b.bookingId, action, userId(login), payload, options),
      ),
    system: (action, moment) =>
      step(moment, (options) =>
        transition(b.bookingId, action, SYSTEM, {}, options),
      ),
    checkIn: (moment, report) =>
      step(moment, (options) =>
        checkIn(
          b.bookingId,
          borrower._id,
          reportFor(resource, report),
          options,
        ),
      ),
    checkOut: (moment, report) =>
      step(moment, (options) =>
        checkOut(
          b.bookingId,
          borrower._id,
          reportFor(resource, report),
          options,
        ),
      ),
    confirm: (login, moment, { issues, ...input }) =>
      step(moment, (options) =>
        confirmReturn(
          b.bookingId,
          userId(login),
          { ...input, items: reportFor(resource, { issues }).items },
          options,
        ),
      ),
    // A whole sweeper step at that moment. It looks at every booking, as the cron run would; at a
    // past moment the only ones it can catch are those it would already have caught then.
    sweep: (name, moment) =>
      step(moment, (options) => sweeperStep(name)(options.now, loadResource)),
  };
  return b;
}

// ── Finding and removing seeded bookings ────────────────────────────────────

async function demoUsers() {
  const users = await User.find(
    { email: { $in: DEMO_USERS.map((u) => demoEmail(u.login)) } },
    { email: 1, roles: 1 },
  ).lean();
  return new Map(users.map((u) => [u.email.split("@")[0], u]));
}

// The bookings a seed run requested: their first audit entry carries the seed's request id and was
// made by a demo user. Read from the audit log rather than the bookings, so a run that stopped part
// way is still cleaned up: the audit entries are the last thing removeSeededBookings deletes.
export async function findSeededBookings(demoIds) {
  const entries = await AuditLog.find(
    {
      action: "booking.requested",
      requestId: SEED_REQUEST_ID,
      "actor.id": { $in: demoIds },
    },
    { entity: 1 },
  ).lean();
  const ids = new Map(entries.map((e) => [String(e.entity.id), e.entity.id]));
  return [...ids.values()];
}

// A seeded notification was stamped with its step's moment, while its _id holds the real time it was
// written. Real notifications have both within a second, so a gap of a minute or more singles out
// the seed's own: a real notification that happened to share a seeded moment is never touched.
const SHIFTED_MS = 60_000;
const timeShifted = {
  $gt: [
    { $abs: { $subtract: ["$createdAt", { $toDate: "$_id" }] } },
    SHIFTED_MS,
  ],
};

// The in-app links notifyService puts on a booking's or an incident's notifications.
const bookingLinks = (id) => [
  `/bookings/${id}`,
  `/bookings/${id}/check-in`,
  `/bookings/${id}/check-out`,
  `/manage/returns/${id}`,
];
const incidentLinks = (id) => [`/incidents/${id}`, `/manage/incidents/${id}`];

// Deletes the bookings with everything their flows wrote: condition reports, incidents, the audit
// entries about the bookings and the incidents (including anything a demo session did to them), and
// the notifications they sent. A notification is matched by its link to the booking or incident, or,
// for links shared by many (/manage/requests), by being stamped at a seeded moment (timeShifted).
// The audit log refuses deletes through its model by design; these entries describe fiction that is
// being remade, so they go through the driver. They go last, so the search above still finds what a
// run that failed part way left behind.
//
// Deleting skips the state machine, so the slots the bookings still held (from `now` on) are then
// handed to their waitlists as a cancel would (promoteFreedSlot): otherwise a request waiting behind
// a seeded booking would sit on a free slot until the sweeper expired it. The promotion's own audit
// entry and notice are about the waiting request, so they stay. → how many bookings were deleted
export async function removeSeededBookings(
  bookingIds,
  { now = new Date() } = {},
) {
  if (!bookingIds.length) return 0;
  const holding = await Booking.find(
    {
      _id: { $in: bookingIds },
      status: { $in: SLOT_HOLDING_STATUSES },
      end: { $gt: now },
    },
    { resource: 1, start: 1, end: 1 },
  ).lean();
  const [incidentDocs, incidentEntries] = await Promise.all([
    Incident.find({ booking: { $in: bookingIds } }, { _id: 1 }).lean(),
    AuditLog.find(
      { action: "incident.created", "meta.bookingId": { $in: bookingIds } },
      { entity: 1 },
    ).lean(),
  ]);
  const incidentIds = [
    ...new Map(
      [
        ...incidentDocs.map((i) => i._id),
        ...incidentEntries.map((e) => e.entity.id),
      ].map((id) => [String(id), id]),
    ).values(),
  ];
  const trail = {
    $or: [
      { "entity.type": "booking", "entity.id": { $in: bookingIds } },
      { "entity.type": "incident", "entity.id": { $in: incidentIds } },
    ],
  };
  const moments = await AuditLog.distinct("at", trail);

  await Notification.deleteMany({
    $or: [
      {
        link: {
          $in: [
            ...bookingIds.flatMap(bookingLinks),
            ...incidentIds.flatMap(incidentLinks),
          ],
        },
      },
      { createdAt: { $in: moments }, $expr: timeShifted },
    ],
  });
  const [, , { deletedCount }] = await Promise.all([
    ConditionReport.deleteMany({ booking: { $in: bookingIds } }),
    Incident.deleteMany({ _id: { $in: incidentIds } }),
    Booking.deleteMany({ _id: { $in: bookingIds } }),
  ]);
  await AuditLog.collection.deleteMany(trail);
  for (const freed of holding) {
    const resource = await loadResource(freed.resource);
    if (resource) await promoteFreedSlot(resource, freed, { now });
  }
  return deletedCount;
}

// ── Entry point ─────────────────────────────────────────────────────────────

// The seeded resources by title, as the eligibility engine and the reports need them.
async function seededResources() {
  const units = new Map(
    (
      await OrgUnit.find(
        { code: { $in: [...new Set(RESOURCES.map((r) => r.orgUnit))] } },
        { code: 1 },
      ).lean()
    ).map((u) => [u.code, u._id]),
  );
  const resources = new Map();
  for (const spec of RESOURCES) {
    const doc = await Resource.findOne(
      { orgUnit: units.get(spec.orgUnit), title: spec.title },
      { title: 1, checklist: 1 },
    ).lean();
    if (doc) resources.set(spec.title, doc);
  }
  return resources;
}

// Expects the rest of the seed in place (units, resources, demo users, their badges and managers)
// and MongoDB and Redis connected: creating and approving bookings take the resource lock.
// A story that can't be told (someone else booked its slot in the meantime) is skipped with a
// warning and its partial booking removed; the others go on.
// → { removed, created, skipped }
export async function seedBookings({ now = new Date(), log } = {}) {
  const at = new Date(now);
  const users = await demoUsers();
  const resources = await seededResources();
  const missing = [
    ...DEMO_USERS.filter((u) => !users.has(u.login)).map((u) => u.login),
    ...STORIES.map((s) => s.resource).filter((t) => !resources.has(t)),
  ];
  if (missing.length)
    throw new Error(
      `Seed the demo users and resources before their bookings (missing: ${[...new Set(missing)].join(", ")}).`,
    );

  const counts = {
    removed: await removeSeededBookings(
      await findSeededBookings([...users.values()].map((u) => u._id)),
      { now: at },
    ),
    created: 0,
    skipped: 0,
  };

  // The overdue story runs the sweeper's overdue step at a past moment, and that step looks at every
  // booking. Running it at `now` first, as the API's own sweeper would have (unless the API was
  // stopped), flags anyone else's overdue loan with the real time, so the past-moment run can only
  // catch the seeded one: never someone else's, with a backdated stamp and notifications the next run
  // would take for the seed's.
  const caughtUp = await sweeperStep("overdueReturns")(at, loadResource);
  if (caughtUp)
    log?.info(
      `Flagged ${caughtUp} overdue return${caughtUp === 1 ? "" : "s"} the sweeper hadn't caught yet.`,
    );

  for (const story of STORIES) {
    const resource = resources.get(story.resource);
    const b = narrator({
      now: at,
      users,
      resource,
      story,
      slot: story.slot(at),
    });
    try {
      await story.story(b);
      const booking = await Booking.findById(b.bookingId, {
        status: 1,
        "flags.overdue": 1,
      }).lean();
      if (
        booking?.status !== story.status ||
        Boolean(booking.flags?.overdue) !== Boolean(story.overdue)
      ) {
        throw new Error(
          `it ended ${booking?.status ?? "missing"}${booking?.flags?.overdue ? " (overdue)" : ""}, not ${story.status}${story.overdue ? " (overdue)" : ""}`,
        );
      }
      counts.created++;
    } catch (err) {
      counts.skipped++;
      log?.warn(`Demo booking "${story.key}" skipped: ${err?.message ?? err}`);
      if (b.bookingId)
        await removeSeededBookings([b.bookingId], { now: at }).catch(() => {});
    }
  }
  return counts;
}
