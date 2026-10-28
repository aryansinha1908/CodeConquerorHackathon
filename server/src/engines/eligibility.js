// Explainable eligibility engine (docs/backend.md §6.1). Pure: no database, no Redis, no I/O.
//
// One function backs GET /resources/:id/eligibility, POST /bookings/check and POST /bookings,
// so the checklist a member sees is exactly what gets enforced.
//
// Inputs (the service loads these; populated refs give better messages, raw ids also work):
//   user      { memberType, department, verification: { status, reason }, suspendedUntil, suspensionReason }
//   resource  { status, bookingMode, quantity, eligibility, availability, limits }
//             eligibility.departments → OrgUnits ({ _id, code, name }); eligibility.badges → Badges
//             ({ _id, name, orgUnit: { name } })
//   slot      { start, end } (Dates or ISO strings)
//   ctx       {
//     now,            defaults to the current time; tests pass it explicitly
//     userBadges,     the user's UserBadge docs ({ badge, status, expiresAt })
//     hoursThisWeek,  hours the user already holds on this resource in the IST week (Mon–Sun) of slot.start
//     activeCount,    the user's ACTIVE_STATUSES bookings on this resource, excluding the one being evaluated
//     overlapCount,   SLOT_HOLDING_STATUSES bookings overlapping the slot
//     waitlistAhead,  waitlisted bookings overlapping the slot that were requested earlier
//   }

import {
  DAY_NAMES,
  HOUR,
  MINUTE,
  DAY,
  formatDuration,
  formatIstDate,
  formatIstDateTime,
  istParts,
  parseHHmm,
  plural,
} from "../lib/time.js";

const MEMBER_TYPE_LABELS = {
  ug: "UG students",
  pg: "PG students",
  rs: "Research Scholars",
  faculty: "Faculty",
  staff: "Staff",
};
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun

const idOf = (x) => (x == null ? null : String(x._id ?? x));
const listOf = (items) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
const hours = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const ok = (message, meta) => ({
  passed: true,
  message,
  fixHint: null,
  ...(meta && { meta }),
});
const no = (message, fixHint = null, meta) => ({
  passed: false,
  message,
  fixHint,
  ...(meta && { meta }),
});

// ── Who may book (no slot needed) ─────────────────────────────────────────────

function accountVerified(user) {
  const { status, reason } = user.verification ?? {};
  if (status === "approved") return ok("Your ID card is verified.");
  if (status === "pending")
    return no(
      "Your ID card is waiting for admin review.",
      "You'll be notified once it's reviewed.",
    );
  if (status === "rejected") {
    return no(
      sentence(`Your ID card was rejected${reason ? `: ${reason}` : ""}`),
      "Upload a clearer photo of your ID card (Profile → Verification).",
    );
  }
  return no(
    "Your ID card isn't verified yet.",
    "Upload your ID card (Profile → Verification).",
  );
}

function notSuspended(user, _resource, _slot, ctx) {
  if (user.suspendedUntil && new Date(user.suspendedUntil) > ctx.now) {
    const why = user.suspensionReason ? `: ${user.suspensionReason}` : "";
    return no(
      sentence(
        `Booking paused until ${formatIstDate(user.suspendedUntil)}${why}`,
      ),
      "Contact the admin to appeal.",
    );
  }
  return ok("Your account is in good standing.");
}

function resourceActive(_user, resource) {
  if (resource.status === "active")
    return ok("This resource is open for booking.");
  if (resource.status === "maintenance")
    return no("This resource is under maintenance.", "See similar resources.");
  return no("This resource is no longer available.", "See similar resources.");
}

// An empty list means no restriction, as for departments; validators require at least one member type.
function memberType(user, resource) {
  const allowed = resource.eligibility?.memberTypes ?? [];
  if (!allowed.length) return ok("Open to all members.");
  if (allowed.includes(user.memberType))
    return ok(`${MEMBER_TYPE_LABELS[user.memberType]} can book this.`);
  return no(
    `Only ${listOf(allowed.map((t) => MEMBER_TYPE_LABELS[t] ?? t))} can book this.`,
  );
}

function department(user, resource) {
  const allowed = resource.eligibility?.departments ?? [];
  if (!allowed.length) return ok("Open to all departments.");
  if (allowed.some((d) => idOf(d) === idOf(user.department)))
    return ok("Your department can book this.");
  const names = allowed
    .map((d) => (d?.code ? d.code.toUpperCase() : d?.name))
    .filter(Boolean);
  return no(
    names.length === allowed.length
      ? `Restricted to members of ${listOf(names)}.`
      : "Restricted to certain departments.",
  );
}

function badgeIssue(userBadge, now) {
  if (
    !userBadge ||
    userBadge.status === "rejected" ||
    userBadge.status === "revoked"
  )
    return "missing";
  if (userBadge.status === "requested") return "requested";
  if (userBadge.expiresAt && new Date(userBadge.expiresAt) <= now)
    return "expired";
  return null;
}

function badges(_user, resource, _slot, ctx) {
  const required = resource.eligibility?.badges ?? [];
  if (!required.length) return ok("No badges needed.");

  const held = new Map(
    (ctx.userBadges ?? []).map((ub) => [idOf(ub.badge), ub]),
  );
  const issues = required
    .map((badge) => {
      const userBadge = held.get(idOf(badge));
      return { badge, userBadge, issue: badgeIssue(userBadge, ctx.now) };
    })
    .filter((b) => b.issue);
  if (!issues.length)
    return ok(
      `You hold ${listOf(required.map((b) => b?.name ?? "the required badge"))}.`,
    );

  const messages = [];
  const fixes = [];
  for (const { badge, userBadge, issue } of issues) {
    const name = badge?.name ?? "a required badge";
    const issuer = badge?.orgUnit?.name;
    if (issue === "missing") {
      messages.push(`Missing badge: ${name}.`);
      fixes.push(
        issuer
          ? `Request it from ${issuer}.`
          : "Request it on the Badges page.",
      );
    } else if (issue === "expired") {
      messages.push(
        `Your ${name} badge expired on ${formatIstDate(userBadge.expiresAt)}.`,
      );
      fixes.push(
        issuer ? `Renew it from ${issuer}.` : "Renew it on the Badges page.",
      );
    } else {
      messages.push(`Your ${name} badge request is awaiting review.`);
      fixes.push(
        issuer
          ? `${issuer} will review it.`
          : "You'll be notified once it's reviewed.",
      );
    }
  }
  return no(messages.join(" "), [...new Set(fixes)].join(" "), {
    badges: issues.map(({ badge, issue }) => ({
      id: idOf(badge),
      name: badge?.name ?? null,
      issue,
    })),
  });
}

function activeBookings(_user, resource, _slot, ctx) {
  const max = resource.limits?.maxActiveBookings;
  const used = ctx.activeCount ?? 0;
  if (!max) return ok("No limit on active bookings.");
  const meta = { used, limit: max };
  if (used < max)
    return ok(`You hold ${used} of ${max} active bookings allowed here.`, meta);
  return no(
    `You already have ${plural(used, "active booking")} for this resource.`,
    "Finish or cancel one before booking again.",
    meta,
  );
}

// ── When (slot needed) ────────────────────────────────────────────────────────

// "Mon–Fri 09:00–17:00; Sat 09:00–13:00"
export function describeOpenHours(weekly = []) {
  const byDay = new Map();
  for (const w of [...weekly].sort(
    (a, b) => parseHHmm(a.open) - parseHHmm(b.open),
  )) {
    byDay.set(w.day, [...(byDay.get(w.day) ?? []), `${w.open}–${w.close}`]);
  }
  const runs = [];
  WEEK_ORDER.forEach((day, i) => {
    const text = byDay.get(day)?.join(", ");
    if (!text) return;
    const last = runs.at(-1);
    if (last && last.text === text && last.lastIndex === i - 1) {
      last.to = day;
      last.lastIndex = i;
    } else {
      runs.push({ from: day, to: day, text, lastIndex: i });
    }
  });
  if (!runs.length) return "closed all week";
  return runs
    .map(
      (r) =>
        `${r.from === r.to ? DAY_NAMES[r.from] : `${DAY_NAMES[r.from]}–${DAY_NAMES[r.to]}`} ${r.text}`,
    )
    .join("; ");
}

const inWindow = (w, day, minutes) =>
  w.day === day &&
  parseHHmm(w.open) <= minutes &&
  minutes <= parseHHmm(w.close);

function instantIsOpen(weekly, instant) {
  const { day, minutes } = istParts(instant);
  return weekly.some((w) => inWindow(w, day, minutes));
}

// Slot mode: the whole interval sits inside one opening window on one IST day.
function intervalIsOpen(weekly, start, end) {
  const s = istParts(start);
  const e = istParts(end);
  return (
    s.dateKey === e.dateKey &&
    weekly.some(
      (w) => inWindow(w, s.day, s.minutes) && inWindow(w, s.day, e.minutes),
    )
  );
}

function openHours(_user, resource, slot) {
  const weekly = resource.availability?.weekly ?? [];
  if (!weekly.length)
    return no(
      "No opening hours are set for this resource.",
      "Contact the managing unit.",
    );
  const schedule = describeOpenHours(weekly);
  const isLoan = resource.bookingMode === "loan";

  if (isLoan) {
    if (!instantIsOpen(weekly, slot.start)) {
      return no(
        `Pickup at ${formatIstDateTime(slot.start)} is outside opening hours (${schedule}).`,
        "Pick up during opening hours.",
      );
    }
    if (!instantIsOpen(weekly, slot.end)) {
      return no(
        `Return at ${formatIstDateTime(slot.end)} is outside opening hours (${schedule}).`,
        "Return during opening hours.",
      );
    }
  } else if (!intervalIsOpen(weekly, slot.start, slot.end)) {
    return no(
      `This slot is outside opening hours (${schedule}).`,
      "Choose a slot that starts and ends within one opening window.",
    );
  }

  // Slot mode: the interval must not touch a closure. Loan mode: only pickup and return must avoid one.
  const blackout = (resource.availability?.blackouts ?? []).find((b) => {
    const bStart = new Date(b.start);
    const bEnd = new Date(b.end);
    if (isLoan)
      return [slot.start, slot.end].some((t) => t >= bStart && t < bEnd);
    return slot.start < bEnd && bStart < slot.end;
  });
  if (blackout) {
    const why = blackout.reason ? `: ${blackout.reason}` : "";
    return no(
      sentence(
        `Closed ${formatIstDateTime(blackout.start)} – ${formatIstDateTime(blackout.end)}${why}`,
      ),
      "Pick a time outside the closure.",
    );
  }
  return ok(
    isLoan
      ? `Pickup and return are within opening hours (${schedule}).`
      : `Within opening hours (${schedule}).`,
  );
}

function duration(_user, resource, slot) {
  const mins = (slot.end - slot.start) / MINUTE;
  const { minDurationMins: min, maxDurationMins: max } = resource.limits ?? {};
  if (!(mins > 0))
    return no(
      "The end time must be after the start time.",
      "Pick a later end time.",
    );
  if (min && mins < min)
    return no(
      `Minimum booking length is ${formatDuration(min)}.`,
      "Pick a longer slot.",
    );
  if (max && mins > max)
    return no(
      `Maximum booking length is ${formatDuration(max)}.`,
      "Pick a shorter slot.",
    );
  return ok(`${formatDuration(mins)} is within the allowed length.`);
}

function bookingWindow(_user, resource, slot, ctx) {
  const lead = resource.limits?.leadTimeMins ?? 0;
  const maxDays = resource.limits?.maxAdvanceDays;
  const rules = [
    lead && `at least ${formatDuration(lead)} ahead`,
    maxDays && `at most ${plural(maxDays, "day")} ahead`,
  ].filter(Boolean);
  const policy = rules.length ? `Book ${rules.join(" and ")}.` : null;

  if (slot.start <= ctx.now)
    return no("This slot has already started.", "Pick a future time.");
  if (slot.start - ctx.now < lead * MINUTE)
    return no("This slot starts too soon.", policy);
  if (maxDays && slot.start - ctx.now > maxDays * DAY)
    return no("This slot is too far ahead.", policy);
  return ok("The start time is within the booking window.");
}

function weeklyHours(_user, resource, slot, ctx) {
  const max = resource.limits?.maxHoursPerWeek;
  const used = ctx.hoursThisWeek ?? 0;
  const requested = (slot.end - slot.start) / HOUR;
  const meta = { used, requested, limit: max ?? null };
  if (!max) return ok("No weekly hour limit.", meta);
  if (used + requested <= max) {
    return ok(
      `${hours(used)} of ${hours(max)} hours used this week; this booking adds ${hours(requested)}.`,
      meta,
    );
  }
  const left = Math.max(0, max - used);
  return no(
    `You've used ${hours(used)} of ${hours(max)} hours this week on this resource.`,
    left > 0
      ? `Try next week or a slot of up to ${formatDuration(left * 60)}.`
      : "Try next week.",
    meta,
  );
}

// Soft rule: a taken slot doesn't make the member ineligible, it offers the waitlist instead.
function availability(_user, resource, _slot, ctx) {
  const quantity = resource.quantity ?? 1;
  const taken = ctx.overlapCount ?? 0;
  if (taken < quantity) {
    return ok(
      quantity > 1
        ? `${quantity - taken} of ${quantity} units free for this slot.`
        : "This slot is free.",
      { taken, quantity },
    );
  }
  const position = (ctx.waitlistAhead ?? 0) + 1;
  return no(
    "This slot is held by an earlier request.",
    `Join the waitlist as #${position}?`,
    { taken, quantity, waitlistPosition: position },
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

// Order matches docs/backend.md §6.1, so the checklist reads the same everywhere.
export const RULES = [
  { id: "ACCOUNT_VERIFIED", check: accountVerified },
  { id: "NOT_SUSPENDED", check: notSuspended },
  { id: "RESOURCE_ACTIVE", check: resourceActive },
  { id: "MEMBER_TYPE", check: memberType },
  { id: "DEPARTMENT", check: department },
  { id: "BADGES", check: badges },
  { id: "OPEN_HOURS", needsSlot: true, check: openHours },
  { id: "DURATION", needsSlot: true, check: duration },
  { id: "BOOKING_WINDOW", needsSlot: true, check: bookingWindow },
  { id: "WEEKLY_HOURS", needsSlot: true, check: weeklyHours },
  { id: "ACTIVE_BOOKINGS", check: activeBookings },
  { id: "AVAILABILITY", needsSlot: true, hard: false, check: availability },
];

function run(rules, user, resource, slot, ctx) {
  const context = { ...ctx, now: new Date(ctx.now ?? Date.now()) };
  return rules.map(({ id, hard = true, check }) => ({
    rule: id,
    hard,
    ...check(user, resource, slot, context),
  }));
}

const allHardPass = (results) => results.every((r) => r.passed || !r.hard);

// Checklist for the resource detail page, before a slot is chosen.
export function evaluateMember(user, resource, ctx = {}) {
  const results = run(
    RULES.filter((r) => !r.needsSlot),
    user,
    resource,
    null,
    ctx,
  );
  return { eligible: allHardPass(results), results };
}

// Full check for a requested slot. Every rule runs, so the member sees all problems at once.
// outcome: 'ineligible' | 'slot_taken' | 'pending' | 'approved'
export function evaluate(user, resource, slot, ctx = {}) {
  const interval = { start: new Date(slot.start), end: new Date(slot.end) };
  const results = run(RULES, user, resource, interval, ctx);
  const eligible = allHardPass(results);
  const slotFree = results.find((r) => r.rule === "AVAILABILITY").passed;

  let outcome = "pending";
  if (!eligible) outcome = "ineligible";
  else if (!slotFree) outcome = "slot_taken";
  else if (resource.eligibility?.approvalMode === "auto") outcome = "approved";
  return { eligible, outcome, results };
}

// The status a new booking starts in, or the error POST /bookings returns (backend.md §6.1 "Outcome").
export function requestStatus({ outcome }, { joinWaitlist = false } = {}) {
  if (outcome === "ineligible") return { error: "INELIGIBLE" };
  if (outcome === "slot_taken")
    return joinWaitlist ? { status: "waitlisted" } : { error: "SLOT_TAKEN" };
  return { status: outcome };
}
