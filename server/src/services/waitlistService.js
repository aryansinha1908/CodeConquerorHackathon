// FIFO waitlist promotion (backend.md §6.3). Runs after a transition frees a slot (reject, cancel or
// no-show of a slot holder), under the resource lock so capacity can't change while it counts.
import { evaluate } from "../engines/eligibility.js";
import { SYSTEM, canTransition } from "../engines/stateMachine.js";
import { log } from "../lib/log.js";
import { withLock } from "../lib/lock.js";
import { keys } from "../lib/redisKeys.js";
import { Booking, User } from "../models/index.js";
import { applyTransition } from "./bookingTransitions.js";
import { eligibilityContext } from "./bookingContext.js";

// Rules re-checked on promotion: the person may have been suspended or hit a cap since joining.
// BOOKING_WINDOW is not: the request was on time when it was made, and lead time can't apply now.
const blocksPromotion = (result) =>
  !result.passed && result.rule !== "BOOKING_WINDOW";

export const snapshot = (evaluation) =>
  evaluation.results.map(({ rule, passed, message }) => ({
    rule,
    passed,
    message,
  }));

// Promotes, oldest first, every waitlisted request overlapping the freed slot that now fits.
// Call with the resource lock held. → the promoted bookings
export async function promoteWaitlist(
  resource,
  freed,
  { now = new Date(), requestId } = {},
) {
  const candidates = await Booking.find({
    resource: resource._id,
    status: "waitlisted",
    start: { $lt: freed.end, $gt: now },
    end: { $gt: freed.start },
  })
    .sort({ createdAt: 1 })
    .lean();

  const promoted = [];
  for (const candidate of candidates) {
    const borrower = await User.findById(candidate.borrower).lean();
    if (!borrower) continue;
    const slot = { start: candidate.start, end: candidate.end };
    const ctx = await eligibilityContext(borrower, resource, slot, {
      now,
      excludeId: candidate._id,
    });
    const evaluation = evaluate(borrower, resource, slot, ctx);
    if (evaluation.results.some(blocksPromotion)) continue;

    const check = canTransition({
      booking: candidate,
      action: "promote",
      actor: SYSTEM,
      payload: { autoApprove: resource.eligibility?.approvalMode === "auto" },
      now,
    });
    if (!check.ok) continue;
    promoted.push(
      await applyTransition({
        booking: candidate,
        resource,
        check,
        actor: SYSTEM,
        set: { eligibilitySnapshot: snapshot(evaluation) },
        requestId,
      }),
    );
  }
  return promoted;
}

// For callers that have already committed their own change: a failed promotion is logged, not
// thrown, so it doesn't turn a successful cancel into an error. The next freed slot retries.
export async function promoteFreedSlot(resource, freed, options) {
  try {
    return await withLock(keys.resourceLock(resource._id), () =>
      promoteWaitlist(resource, freed, options),
    );
  } catch (err) {
    log.warn(
      { err, resourceId: String(resource._id) },
      "Waitlist promotion skipped",
    );
    return [];
  }
}
