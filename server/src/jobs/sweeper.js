// Background sweep (architecture.md §14) every 5 minutes with node-cron: start and end reminders,
// no-shows, overdue returns and waitlist expiry. BullMQ delayed jobs can replace it later (C-11).
//
// Each step claims a booking with a conditional update before acting on it, so nothing is sent or
// changed twice, even if two instances sweep at once. The Redis lock only saves duplicate work: when
// Redis is down the sweep runs without it, rather than letting no-shows and late returns pile up.
// The status changes go through bookingService.transition(), so cron gets the same guards, audit
// entries and notifications as a person would, and a no-show still promotes the waitlist.
import { schedule } from "node-cron";
import {
  NO_SHOW_GRACE_MINS,
  OVERDUE_GRACE_MINS,
} from "../engines/stateMachine.js";
import { log } from "../lib/log.js";
import { tryLock } from "../lib/lock.js";
import { TTL, keys } from "../lib/redisKeys.js";
import { MINUTE, formatIstDateTime } from "../lib/time.js";
import { Booking, Incident } from "../models/index.js";
import { SYSTEM_ACTOR, record } from "../services/auditService.js";
import { loadResource } from "../services/bookingContext.js";
import { SYSTEM, transition } from "../services/bookingService.js";
import { notifyBooking } from "../services/bookingTransitions.js";

export const SWEEP_SCHEDULE = "*/5 * * * *";
const START_REMINDER_MINS = 60;
const END_REMINDER_MINS = 15;
// Per step per run; anything left over waits five minutes for the next run.
const BATCH = 200;

const plus = (date, minutes) => new Date(date.getTime() + minutes * MINUTE);

// Runs act() for each booking; one failure is logged and the rest carry on. → how many acted
async function actOnEach(step, bookings, act) {
  let acted = 0;
  for (const booking of bookings) {
    try {
      if (await act(booking)) acted++;
    } catch (err) {
      log.warn(
        { err, step, bookingId: String(booking._id) },
        "Sweep skipped a booking",
      );
    }
  }
  return acted;
}

// The update that sets the flag is the claim: only one sweep can win it.
const claim = (booking, status, flagFilter, set) =>
  Booking.findOneAndUpdate(
    { _id: booking._id, status, ...flagFilter },
    { $set: set },
    { returnDocument: "after" },
  ).lean();

function remindStep({ status, timeField, windowMins, flag, event }) {
  return async (now, resourceOf) => {
    const due = await Booking.find({
      status,
      [timeField]: { $gt: now, $lte: plus(now, windowMins) },
      [flag]: null,
    })
      .limit(BATCH)
      .lean();
    return actOnEach(event, due, async (booking) => {
      const claimed = await claim(
        booking,
        status,
        { [flag]: null },
        { [flag]: now },
      );
      if (!claimed) return false;
      const resource = await resourceOf(booking.resource);
      if (resource)
        await notifyBooking([[[booking.borrower], event]], claimed, resource);
      return true;
    });
  };
}

// A booking someone changed in the meantime (checked in at the last second) is skipped quietly.
function transitionStep(action, query) {
  return async (now) => {
    const due = await Booking.find(query(now))
      .sort({ start: 1 })
      .limit(BATCH)
      .lean();
    return actOnEach(action, due, async (booking) => {
      try {
        await transition(booking._id, action, SYSTEM, {}, { now });
        return true;
      } catch (err) {
        if (err.code === "INVALID_TRANSITION") return false;
        throw err;
      }
    });
  };
}

async function overdueReturns(now, resourceOf) {
  const due = await Booking.find({
    status: "checked_in",
    end: { $lt: plus(now, -OVERDUE_GRACE_MINS) },
    "flags.overdue": { $ne: true },
  })
    .limit(BATCH)
    .lean();

  return actOnEach("overdue", due, async (booking) => {
    const claimed = await claim(
      booking,
      "checked_in",
      { "flags.overdue": { $ne: true } },
      { "flags.overdue": true, "flags.overdueAt": now },
    );
    if (!claimed) return false;

    await record({
      actor: SYSTEM_ACTOR,
      action: "booking.overdue",
      entity: { type: "booking", id: booking._id },
      orgUnit: booking.orgUnit,
      changes: { "flags.overdue": [false, true] },
    });
    // A delay incident a person reviews (architecture.md §14). Overdue is a flag, not a status, so
    // the booking still ends with the normal check-out and return confirmation.
    const incident = await Incident.create({
      booking: booking._id,
      resource: booking.resource,
      orgUnit: booking.orgUnit,
      reportedBy: null,
      source: "system",
      type: "delay",
      severity: "low",
      description: `Not returned on time: the booking ended at ${formatIstDateTime(booking.end)} and the item hadn't been returned by ${formatIstDateTime(now)}.`,
    });
    await Booking.updateOne(
      { _id: booking._id },
      { $push: { incidents: incident._id } },
    );
    await record({
      actor: SYSTEM_ACTOR,
      action: "incident.created",
      entity: { type: "incident", id: incident._id },
      orgUnit: booking.orgUnit,
      changes: { status: [null, incident.status] },
      meta: {
        bookingId: booking._id,
        type: incident.type,
        severity: incident.severity,
      },
    });

    const resource = await resourceOf(booking.resource);
    if (resource) {
      await notifyBooking(
        [
          [[booking.borrower], "booking.overdue"],
          [resource.orgUnit?.managers ?? [], "booking.overdue", "manager"],
        ],
        claimed,
        resource,
      );
    }
    return true;
  });
}

// No-shows first: they free slots and promote the waitlist before expiry looks at it.
export const STEPS = [
  [
    "noShows",
    transitionStep("markNoShow", (now) => ({
      status: "approved",
      start: { $lt: plus(now, -NO_SHOW_GRACE_MINS) },
    })),
  ],
  [
    "expiredRequests",
    transitionStep("expire", (now) => ({
      status: { $in: ["waitlisted", "pending"] },
      start: { $lt: now },
    })),
  ],
  [
    "startReminders",
    remindStep({
      status: "approved",
      timeField: "start",
      windowMins: START_REMINDER_MINS,
      flag: "flags.startReminderAt",
      event: "booking.reminder_start",
    }),
  ],
  [
    "endReminders",
    remindStep({
      status: "checked_in",
      timeField: "end",
      windowMins: END_REMINDER_MINS,
      flag: "flags.endReminderAt",
      event: "booking.reminder_end",
    }),
  ],
  ["overdueReturns", overdueReturns],
];

// Each resource is loaded once per sweep, however many of its bookings are due.
function resourceLoader() {
  const cache = new Map();
  return (id) => {
    const key = String(id);
    if (!cache.has(key)) cache.set(key, loadResource(id));
    return cache.get(key);
  };
}

// → { skipped: true } when another instance is sweeping, else { skipped: false, counts }.
// A step that fails is logged and reported as null; the other steps still run.
export async function runSweep({ now = new Date() } = {}) {
  let release = null;
  try {
    release = await tryLock(keys.sweepLock, TTL.sweepLockMs);
    if (!release) return { skipped: true };
  } catch (err) {
    log.warn({ err }, "Sweep lock unavailable; sweeping without it");
  }

  const resourceOf = resourceLoader();
  const counts = {};
  try {
    for (const [name, step] of STEPS) {
      try {
        counts[name] = await step(now, resourceOf);
      } catch (err) {
        log.error({ err, step: name }, "Sweep step failed");
        counts[name] = null;
      }
    }
  } finally {
    await release?.().catch((err) =>
      log.warn({ err }, "Sweep lock release failed"),
    );
  }
  if (Object.values(counts).some((n) => n !== 0))
    log.info({ counts }, "Sweep finished");
  return { skipped: false, counts };
}

let task = null;

// Call once at boot, after connectRedis(). CRON_ENABLED=false turns it off (tests, extra instances).
// runNow sweeps straight away: a free Render instance that slept has missed its runs (§14).
export function startSweeper({ runNow = true } = {}) {
  if (process.env.CRON_ENABLED === "false") {
    log.info("Sweeper disabled (CRON_ENABLED=false)");
    return null;
  }
  if (task) return task;
  const sweep = () =>
    runSweep().catch((err) => log.error({ err }, "Sweep failed"));
  task = schedule(SWEEP_SCHEDULE, sweep, {
    name: "sweep",
    timezone: "Asia/Kolkata",
    noOverlap: true,
  });
  if (runNow) void sweep();
  log.info({ nextRun: task.getNextRun() }, "Sweeper started");
  return task;
}

// For graceful shutdown (SIGTERM) and tests.
export async function stopSweeper() {
  if (!task) return;
  const stopping = task;
  task = null;
  await stopping.destroy();
}
