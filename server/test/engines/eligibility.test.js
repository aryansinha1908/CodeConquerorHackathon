import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  RULES,
  describeOpenHours,
  evaluate,
  evaluateMember,
  requestStatus,
} from "../../src/engines/eligibility.js";

const ist = (s) => new Date(`${s}:00+05:30`);
const NOW = ist("2026-11-02T10:00"); // Monday

const dic = {
  _id: "ou-dic",
  code: "dic",
  name: "Design and Innovation Centre",
};
const ece = {
  _id: "ou-ece",
  code: "ece",
  name: "Electronics and Communication Engineering",
};
const ee = { _id: "ou-ee", code: "ee", name: "Electrical Engineering" };
const printingBadge = {
  _id: "badge-3dp",
  name: "3D Printing Basics",
  orgUnit: dic,
};
const monToSat = [1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: "09:00",
  close: "17:00",
}));

const printer = () => ({
  status: "active",
  bookingMode: "slot",
  quantity: 1,
  eligibility: {
    memberTypes: ["ug", "pg", "rs", "faculty"],
    departments: [],
    badges: [printingBadge],
    approvalMode: "manual",
  },
  availability: { weekly: monToSat, blackouts: [], slotMinutes: 30 },
  limits: {
    minDurationMins: 30,
    maxDurationMins: 240,
    maxHoursPerWeek: 6,
    maxActiveBookings: 1,
    leadTimeMins: 120,
    maxAdvanceDays: 14,
  },
});
const student = () => ({
  _id: "user-1",
  memberType: "ug",
  department: "ou-cse",
  verification: { status: "approved" },
  suspendedUntil: null,
});
const context = () => ({
  now: NOW,
  userBadges: [{ badge: "badge-3dp", status: "active", expiresAt: null }],
  hoursThisWeek: 0,
  activeCount: 0,
  overlapCount: 0,
  waitlistAhead: 0,
});
const slotOn = (start, end) => ({ start: ist(start), end: ist(end) });
const TUESDAY_10_TO_12 = slotOn("2026-11-03T10:00", "2026-11-03T12:00");

const failures = (result) =>
  result.results.filter((r) => !r.passed).map((r) => r.rule);
const ruleOf = (result, id) => result.results.find((r) => r.rule === id);

// Start from a fully eligible request, apply `change`, and assert that exactly `ruleId` fails.
function onlyFailure(ruleId, change) {
  const input = {
    user: student(),
    resource: printer(),
    slot: TUESDAY_10_TO_12,
    ctx: context(),
  };
  change(input);
  const result = evaluate(input.user, input.resource, input.slot, input.ctx);
  assert.deepEqual(failures(result), [ruleId]);
  return { result, failure: ruleOf(result, ruleId) };
}

describe("evaluate: eligible request", () => {
  test("passes all 12 rules in documented order and waits for a manager", () => {
    const result = evaluate(student(), printer(), TUESDAY_10_TO_12, context());
    assert.equal(result.eligible, true);
    assert.equal(result.outcome, "pending");
    assert.deepEqual(
      result.results.map((r) => r.rule),
      RULES.map((r) => r.id),
    );
    assert.equal(result.results.length, 12);
    assert.ok(
      result.results.every((r) => r.passed && r.fixHint === null && r.message),
    );
  });

  test("auto-approval resources skip the manager", () => {
    const resource = printer();
    resource.eligibility.approvalMode = "auto";
    assert.equal(
      evaluate(student(), resource, TUESDAY_10_TO_12, context()).outcome,
      "approved",
    );
  });

  test("accepts ISO strings for the slot", () => {
    const slot = {
      start: TUESDAY_10_TO_12.start.toISOString(),
      end: TUESDAY_10_TO_12.end.toISOString(),
    };
    assert.equal(
      evaluate(student(), printer(), slot, context()).eligible,
      true,
    );
  });
});

describe("each hard rule explains its failure", () => {
  test("ACCOUNT_VERIFIED: no ID card yet", () => {
    const { result, failure } = onlyFailure("ACCOUNT_VERIFIED", ({ user }) => {
      user.verification = { status: "unsubmitted" };
    });
    assert.equal(result.outcome, "ineligible");
    assert.equal(failure.message, "Your ID card isn't verified yet.");
    assert.equal(
      failure.fixHint,
      "Upload your ID card (Profile → Verification).",
    );
  });

  test("ACCOUNT_VERIFIED: waiting for review", () => {
    const { failure } = onlyFailure("ACCOUNT_VERIFIED", ({ user }) => {
      user.verification = { status: "pending" };
    });
    assert.equal(failure.message, "Your ID card is waiting for admin review.");
  });

  test("ACCOUNT_VERIFIED: rejected, with the admin reason and no doubled full stop", () => {
    const { failure } = onlyFailure("ACCOUNT_VERIFIED", ({ user }) => {
      user.verification = { status: "rejected", reason: "Photo is blurry." };
    });
    assert.equal(
      failure.message,
      "Your ID card was rejected: Photo is blurry.",
    );
  });

  test("NOT_SUSPENDED: shows the end date in IST and the reason", () => {
    const { failure } = onlyFailure("NOT_SUSPENDED", ({ user }) => {
      user.suspendedUntil = ist("2026-11-05T00:00");
      user.suspensionReason = "repeated no-shows";
    });
    assert.equal(
      failure.message,
      "Booking paused until 5 Nov: repeated no-shows.",
    );
    assert.equal(failure.fixHint, "Contact the admin to appeal.");
  });

  test("NOT_SUSPENDED: a suspension that has ended no longer blocks", () => {
    const user = { ...student(), suspendedUntil: ist("2026-11-01T00:00") };
    assert.equal(
      ruleOf(
        evaluate(user, printer(), TUESDAY_10_TO_12, context()),
        "NOT_SUSPENDED",
      ).passed,
      true,
    );
  });

  test("RESOURCE_ACTIVE", () => {
    const { failure } = onlyFailure("RESOURCE_ACTIVE", ({ resource }) => {
      resource.status = "maintenance";
    });
    assert.equal(failure.message, "This resource is under maintenance.");
  });

  test("MEMBER_TYPE", () => {
    const { failure } = onlyFailure("MEMBER_TYPE", ({ resource }) => {
      resource.eligibility.memberTypes = ["pg", "rs", "faculty"];
    });
    assert.equal(
      failure.message,
      "Only PG students, Research Scholars and Faculty can book this.",
    );
  });

  test("DEPARTMENT: names the allowed departments", () => {
    const { failure } = onlyFailure("DEPARTMENT", ({ resource }) => {
      resource.eligibility.departments = [ece, ee];
    });
    assert.equal(failure.message, "Restricted to members of ECE and EE.");
  });

  test("DEPARTMENT: compares ObjectId-like values by string", () => {
    const resource = printer();
    resource.eligibility.departments = [ece, ee];
    const user = { ...student(), department: { toString: () => "ou-ece" } };
    assert.equal(
      ruleOf(
        evaluate(user, resource, TUESDAY_10_TO_12, context()),
        "DEPARTMENT",
      ).passed,
      true,
    );
  });

  test("BADGES: missing badge points to the issuing unit", () => {
    const { failure } = onlyFailure("BADGES", ({ ctx }) => {
      ctx.userBadges = [];
    });
    assert.equal(failure.message, "Missing badge: 3D Printing Basics.");
    assert.equal(
      failure.fixHint,
      "Request it from Design and Innovation Centre.",
    );
    assert.deepEqual(failure.meta.badges, [
      { id: "badge-3dp", name: "3D Printing Basics", issue: "missing" },
    ]);
  });

  test("BADGES: expired badge", () => {
    const { failure } = onlyFailure("BADGES", ({ ctx }) => {
      ctx.userBadges[0].expiresAt = ist("2026-11-01T09:00");
    });
    assert.equal(
      failure.message,
      "Your 3D Printing Basics badge expired on 1 Nov.",
    );
    assert.equal(
      failure.fixHint,
      "Renew it from Design and Innovation Centre.",
    );
  });

  test("BADGES: requested but not yet granted", () => {
    const { failure } = onlyFailure("BADGES", ({ ctx }) => {
      ctx.userBadges[0].status = "requested";
    });
    assert.equal(
      failure.message,
      "Your 3D Printing Basics badge request is awaiting review.",
    );
  });

  test("OPEN_HOURS: closed day", () => {
    const { failure } = onlyFailure("OPEN_HOURS", (input) => {
      input.slot = slotOn("2026-11-08T10:00", "2026-11-08T12:00");
    });
    assert.equal(
      failure.message,
      "This slot is outside opening hours (Mon–Sat 09:00–17:00).",
    );
  });

  test("OPEN_HOURS: runs past closing time", () => {
    onlyFailure("OPEN_HOURS", (input) => {
      input.slot = slotOn("2026-11-03T16:00", "2026-11-03T18:00");
    });
  });

  test("OPEN_HOURS: overlaps a blackout", () => {
    const { failure } = onlyFailure("OPEN_HOURS", ({ resource }) => {
      resource.availability.blackouts = [
        {
          start: ist("2026-11-03T11:00"),
          end: ist("2026-11-03T13:00"),
          reason: "Nozzle replacement",
        },
      ];
    });
    assert.equal(
      failure.message,
      "Closed 3 Nov, 11:00 – 3 Nov, 13:00: Nozzle replacement.",
    );
  });

  test("OPEN_HOURS: a blackout that ends as the slot starts does not block", () => {
    const resource = printer();
    resource.availability.blackouts = [
      { start: ist("2026-11-03T08:00"), end: ist("2026-11-03T10:00") },
    ];
    assert.equal(
      evaluate(student(), resource, TUESDAY_10_TO_12, context()).eligible,
      true,
    );
  });

  test("DURATION: too short", () => {
    const { failure } = onlyFailure("DURATION", (input) => {
      input.slot = slotOn("2026-11-03T10:00", "2026-11-03T10:15");
    });
    assert.equal(failure.message, "Minimum booking length is 30 minutes.");
  });

  test("DURATION: too long", () => {
    const { failure } = onlyFailure("DURATION", (input) => {
      input.slot = slotOn("2026-11-03T10:00", "2026-11-03T15:00");
    });
    assert.equal(failure.message, "Maximum booking length is 4 hours.");
  });

  test("BOOKING_WINDOW: inside the lead time", () => {
    const { failure } = onlyFailure("BOOKING_WINDOW", (input) => {
      input.slot = slotOn("2026-11-02T11:00", "2026-11-02T12:00");
    });
    assert.equal(failure.message, "This slot starts too soon.");
    assert.equal(
      failure.fixHint,
      "Book at least 2 hours ahead and at most 14 days ahead.",
    );
  });

  test("BOOKING_WINDOW: too far ahead", () => {
    const { failure } = onlyFailure("BOOKING_WINDOW", (input) => {
      input.slot = slotOn("2026-11-24T10:00", "2026-11-24T12:00");
    });
    assert.equal(failure.message, "This slot is too far ahead.");
  });

  test("BOOKING_WINDOW: already started", () => {
    const { failure } = onlyFailure("BOOKING_WINDOW", (input) => {
      input.slot = slotOn("2026-11-02T09:00", "2026-11-02T09:30");
    });
    assert.equal(failure.message, "This slot has already started.");
  });

  test("WEEKLY_HOURS: says how much is left", () => {
    const { failure } = onlyFailure("WEEKLY_HOURS", ({ ctx }) => {
      ctx.hoursThisWeek = 5;
    });
    assert.equal(
      failure.message,
      "You've used 5 of 6 hours this week on this resource.",
    );
    assert.equal(failure.fixHint, "Try next week or a slot of up to 1 hour.");
    assert.deepEqual(failure.meta, { used: 5, requested: 2, limit: 6 });
  });

  test("WEEKLY_HOURS: exactly reaching the cap is allowed", () => {
    const ctx = { ...context(), hoursThisWeek: 4 };
    assert.equal(
      ruleOf(
        evaluate(student(), printer(), TUESDAY_10_TO_12, ctx),
        "WEEKLY_HOURS",
      ).passed,
      true,
    );
  });

  test("ACTIVE_BOOKINGS", () => {
    const { failure } = onlyFailure("ACTIVE_BOOKINGS", ({ ctx }) => {
      ctx.activeCount = 1;
    });
    assert.equal(
      failure.message,
      "You already have 1 active booking for this resource.",
    );
  });
});

describe("AVAILABILITY is soft", () => {
  test("a taken slot keeps the member eligible and offers the waitlist position", () => {
    const { result, failure } = onlyFailure("AVAILABILITY", ({ ctx }) => {
      ctx.overlapCount = 1;
      ctx.waitlistAhead = 1;
    });
    assert.equal(result.eligible, true);
    assert.equal(result.outcome, "slot_taken");
    assert.equal(failure.hard, false);
    assert.equal(failure.fixHint, "Join the waitlist as #2?");
    assert.equal(failure.meta.waitlistPosition, 2);
  });

  test("quantity allows parallel bookings", () => {
    const resource = { ...printer(), quantity: 2 };
    const result = evaluate(student(), resource, TUESDAY_10_TO_12, {
      ...context(),
      overlapCount: 1,
    });
    assert.equal(result.outcome, "pending");
    assert.equal(
      ruleOf(result, "AVAILABILITY").message,
      "1 of 2 units free for this slot.",
    );
  });
});

describe("loan mode", () => {
  const camera = () => ({
    ...printer(),
    bookingMode: "loan",
    eligibility: {
      memberTypes: [],
      departments: [],
      badges: [],
      approvalMode: "manual",
    },
    limits: {
      maxDurationMins: 7 * 1440,
      maxActiveBookings: 1,
      leadTimeMins: 60,
      maxAdvanceDays: 14,
    },
  });

  test("only pickup and return need to be within opening hours", () => {
    const slot = slotOn("2026-11-03T16:00", "2026-11-05T10:00");
    assert.equal(
      evaluate(student(), camera(), slot, { now: NOW }).eligible,
      true,
    );
  });

  test("return on a closed day fails", () => {
    const result = evaluate(
      student(),
      camera(),
      slotOn("2026-11-03T16:00", "2026-11-08T10:00"),
      { now: NOW },
    );
    assert.deepEqual(failures(result), ["OPEN_HOURS"]);
    assert.match(
      ruleOf(result, "OPEN_HOURS").message,
      /^Return at 8 Nov, 10:00 is outside opening hours/,
    );
  });

  test("pickup before opening fails", () => {
    const result = evaluate(
      student(),
      camera(),
      slotOn("2026-11-03T08:00", "2026-11-04T10:00"),
      { now: NOW },
    );
    assert.match(
      ruleOf(result, "OPEN_HOURS").message,
      /^Pickup at 3 Nov, 08:00/,
    );
  });
});

describe("several problems at once", () => {
  test("every failing rule is reported, not just the first", () => {
    const user = { ...student(), verification: { status: "pending" } };
    const result = evaluate(
      user,
      printer(),
      slotOn("2026-11-03T10:00", "2026-11-03T15:00"),
      { ...context(), userBadges: [] },
    );
    assert.deepEqual(failures(result), [
      "ACCOUNT_VERIFIED",
      "BADGES",
      "DURATION",
    ]);
    assert.equal(result.outcome, "ineligible");
  });
});

describe("evaluateMember (resource detail page, no slot yet)", () => {
  test("runs only the rules that do not need a slot", () => {
    const result = evaluateMember(student(), printer(), {
      ...context(),
      userBadges: [],
    });
    assert.deepEqual(
      result.results.map((r) => r.rule),
      [
        "ACCOUNT_VERIFIED",
        "NOT_SUSPENDED",
        "RESOURCE_ACTIVE",
        "MEMBER_TYPE",
        "DEPARTMENT",
        "BADGES",
        "ACTIVE_BOOKINGS",
      ],
    );
    assert.equal(result.eligible, false);
  });
});

describe("requestStatus", () => {
  test("maps outcomes to a starting status or an error code", () => {
    assert.deepEqual(
      requestStatus({ outcome: "ineligible" }, { joinWaitlist: true }),
      { error: "INELIGIBLE" },
    );
    assert.deepEqual(requestStatus({ outcome: "slot_taken" }), {
      error: "SLOT_TAKEN",
    });
    assert.deepEqual(
      requestStatus({ outcome: "slot_taken" }, { joinWaitlist: true }),
      { status: "waitlisted" },
    );
    assert.deepEqual(requestStatus({ outcome: "pending" }), {
      status: "pending",
    });
    assert.deepEqual(requestStatus({ outcome: "approved" }), {
      status: "approved",
    });
  });
});

describe("describeOpenHours", () => {
  test("groups consecutive days with the same hours", () => {
    assert.equal(describeOpenHours(monToSat), "Mon–Sat 09:00–17:00");
    const weekdaysAndShortSaturday = [
      ...[1, 2, 3, 4, 5].map((day) => ({ day, open: "09:00", close: "17:00" })),
      { day: 6, open: "09:00", close: "13:00" },
    ];
    assert.equal(
      describeOpenHours(weekdaysAndShortSaturday),
      "Mon–Fri 09:00–17:00; Sat 09:00–13:00",
    );
  });

  test("sorts split windows and does not merge non-consecutive days", () => {
    const weekly = [
      { day: 1, open: "14:00", close: "17:00" },
      { day: 1, open: "09:00", close: "12:00" },
      { day: 3, open: "09:00", close: "12:00" },
      { day: 3, open: "14:00", close: "17:00" },
    ];
    assert.equal(
      describeOpenHours(weekly),
      "Mon 09:00–12:00, 14:00–17:00; Wed 09:00–12:00, 14:00–17:00",
    );
  });

  test("Sunday comes last and an empty schedule says so", () => {
    assert.equal(
      describeOpenHours(
        [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          day,
          open: "08:00",
          close: "22:00",
        })),
      ),
      "Mon–Sun 08:00–22:00",
    );
    assert.equal(describeOpenHours([]), "closed all week");
  });
});
