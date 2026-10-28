// Loads what the eligibility engine needs (the `ctx` in engines/eligibility.js) with indexed queries.
import {
  ACTIVE_STATUSES,
  SLOT_HOLDING_STATUSES,
} from "../engines/stateMachine.js";
import { HOUR, istWeekRange } from "../lib/time.js";
import { Booking, Resource, User, UserBadge } from "../models/index.js";

// Hours that count toward limits.maxHoursPerWeek: held or used, not cancelled, waitlisted or missed.
export const WEEKLY_HOURS_STATUSES = [
  "pending",
  "approved",
  "checked_in",
  "checked_out",
  "completed",
  "flagged",
];

// The most of these intervals that overlap at one moment inside [start, end). Counting overlaps
// instead would block a 5-unit kit when 5 short, separate bookings touch a long request.
export function maxConcurrent(intervals, start, end) {
  const events = [];
  for (const interval of intervals) {
    const s = Math.max(
      new Date(interval.start).getTime(),
      new Date(start).getTime(),
    );
    const e = Math.min(
      new Date(interval.end).getTime(),
      new Date(end).getTime(),
    );
    if (s < e) events.push([s, 1], [e, -1]);
  }
  // At the same instant, an end comes before a start: back-to-back bookings don't overlap.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let max = 0;
  for (const [, delta] of events) {
    current += delta;
    max = Math.max(max, current);
  }
  return max;
}

const overlapping = (resourceId, slot) => ({
  resource: resourceId,
  start: { $lt: slot.end },
  end: { $gt: slot.start },
});
const except = (excludeId) => (excludeId ? { _id: { $ne: excludeId } } : {});

// Units of the resource in use at the busiest moment of the slot.
export async function slotUsage(resourceId, slot, { excludeId } = {}) {
  const holders = await Booking.find(
    {
      ...overlapping(resourceId, slot),
      status: { $in: SLOT_HOLDING_STATUSES },
      ...except(excludeId),
    },
    { start: 1, end: 1 },
  ).lean();
  return maxConcurrent(holders, slot.start, slot.end);
}

// Waitlisted requests for an overlapping slot, optionally only those made before `before`.
export function waitlistAhead(resourceId, slot, { before, excludeId } = {}) {
  return Booking.countDocuments({
    ...overlapping(resourceId, slot),
    status: "waitlisted",
    ...(before && { createdAt: { $lt: before } }),
    ...except(excludeId),
  });
}

// Position is computed on read, never stored (backend.md §6.3).
export async function waitlistPosition(booking) {
  return (
    (await waitlistAhead(booking.resource?._id ?? booking.resource, booking, {
      before: booking.createdAt,
      excludeId: booking._id,
    })) + 1
  );
}

// The member's own side of the ctx: badges, hours held on this resource in `week`, active bookings.
// Shared by both contexts below, so the checklist and the booking check count the same way.
async function memberCounts(user, resource, week, { excludeId } = {}) {
  const mine = {
    resource: resource._id,
    borrower: user._id,
    ...except(excludeId),
  };
  const [userBadges, weekBookings, activeCount] = await Promise.all([
    UserBadge.find(
      { user: user._id },
      { badge: 1, status: 1, expiresAt: 1 },
    ).lean(),
    Booking.find(
      {
        ...mine,
        status: { $in: WEEKLY_HOURS_STATUSES },
        start: { $gte: week.start, $lt: week.end },
      },
      { start: 1, end: 1 },
    ).lean(),
    Booking.countDocuments({ ...mine, status: { $in: ACTIVE_STATUSES } }),
  ]);
  return {
    userBadges,
    hoursThisWeek: weekBookings.reduce(
      (sum, b) => sum + (b.end - b.start) / HOUR,
      0,
    ),
    activeCount,
  };
}

// excludeId: the booking being re-evaluated (waitlist promotion), so it doesn't count against itself.
export async function eligibilityContext(
  user,
  resource,
  slot,
  { now, excludeId } = {},
) {
  const [member, overlapCount, ahead] = await Promise.all([
    memberCounts(user, resource, istWeekRange(slot.start), { excludeId }),
    slotUsage(resource._id, slot, { excludeId }),
    waitlistAhead(resource._id, slot, { excludeId }),
  ]);
  return { now, ...member, overlapCount, waitlistAhead: ahead };
}

// The ctx for evaluateMember when no slot is chosen (GET /resources/:id/eligibility), which also
// feeds the quota meter. With no slot, the week is the IST week (Mon–Sun) containing `now`.
export async function memberContext(user, resource, { now = new Date() } = {}) {
  return {
    now,
    ...(await memberCounts(user, resource, istWeekRange(now))),
  };
}

// Populated the way the engine's messages need ("Request it from Design and Innovation Centre").
export function loadResource(resourceId) {
  return Resource.findById(resourceId)
    .populate("orgUnit", "name code managers")
    .populate("eligibility.departments", "code name")
    .populate({
      path: "eligibility.badges",
      select: "name orgUnit",
      populate: { path: "orgUnit", select: "name" },
    })
    .lean();
}

export const loadUser = (userId) => User.findById(userId).lean();
