import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUSES,
  SYSTEM,
  TERMINAL_STATUSES,
  TRANSITIONS,
  allowedActions,
  canTransition,
  isOverdue,
  relationsOf,
} from "../../src/engines/stateMachine.js";

const ist = (s) => new Date(`${s}:00+05:30`);
const START = ist("2026-11-03T10:00");
const END = ist("2026-11-03T12:00");
const BEFORE = ist("2026-11-02T10:00");
const minutesFrom = (date, mins) => new Date(date.getTime() + mins * 60_000);

const booking = (status, extra = {}) => ({
  _id: "bk-1",
  status,
  borrower: "user-1",
  orgUnit: "ou-dic",
  start: START,
  end: END,
  ...extra,
});

const borrower = { id: "user-1", roles: ["member"] };
const manager = {
  id: "user-2",
  roles: ["member", "manager"],
  managedOrgUnits: ["ou-dic"],
};
const otherUnitManager = {
  id: "user-3",
  roles: ["member", "manager"],
  managedOrgUnits: ["ou-ece"],
};
const admin = { id: "user-4", roles: ["admin"] };
const stranger = { id: "user-5", roles: ["member"] };
const managerWhoBorrowed = {
  id: "user-1",
  roles: ["member", "manager"],
  managedOrgUnits: ["ou-dic"],
};
const adminWhoBorrowed = { id: "user-1", roles: ["member", "admin"] };

const attempt = (status, action, actor, payload = {}, now = BEFORE) =>
  canTransition({ booking: booking(status), action, actor, payload, now });

describe("TRANSITIONS map", () => {
  test("only uses known statuses", () => {
    for (const def of Object.values(TRANSITIONS)) {
      assert.ok(STATUSES.includes(def.to));
      def.from.forEach((s) => assert.ok(STATUSES.includes(s)));
    }
  });

  test("terminal statuses have no way out, and every other status has one", () => {
    const exits = new Set(Object.values(TRANSITIONS).flatMap((d) => d.from));
    for (const status of STATUSES)
      assert.equal(
        exits.has(status),
        !TERMINAL_STATUSES.includes(status),
        status,
      );
  });
});

describe("allowed transitions", () => {
  const cases = [
    ["approve", "pending", manager, {}, BEFORE, "approved", "booking.approved"],
    ["approve", "pending", admin, {}, BEFORE, "approved", "booking.approved"],
    [
      "reject",
      "pending",
      manager,
      { reason: "Reserved for the M.Des jury" },
      BEFORE,
      "rejected",
      "booking.rejected",
    ],
    [
      "waitlist",
      "pending",
      manager,
      { reason: "Earlier request has priority" },
      BEFORE,
      "waitlisted",
      "booking.waitlisted",
    ],
    [
      "cancel",
      "approved",
      borrower,
      {},
      BEFORE,
      "cancelled",
      "booking.cancelled",
    ],
    [
      "promote",
      "waitlisted",
      SYSTEM,
      {},
      BEFORE,
      "pending",
      "booking.promoted",
    ],
    [
      "expire",
      "waitlisted",
      SYSTEM,
      {},
      minutesFrom(START, 1),
      "expired",
      "booking.expired",
    ],
    [
      "expire",
      "pending",
      SYSTEM,
      {},
      minutesFrom(START, 1),
      "expired",
      "booking.expired",
    ],
    [
      "checkIn",
      "approved",
      borrower,
      { report: {} },
      minutesFrom(START, -10),
      "checked_in",
      "booking.checked_in",
    ],
    [
      "checkIn",
      "approved",
      manager,
      { report: {} },
      START,
      "checked_in",
      "booking.checked_in",
    ],
    [
      "markNoShow",
      "approved",
      SYSTEM,
      {},
      minutesFrom(START, 16),
      "no_show",
      "booking.no_show",
    ],
    [
      "checkOut",
      "checked_in",
      borrower,
      { report: {} },
      END,
      "checked_out",
      "booking.checked_out",
    ],
    [
      "confirmOk",
      "checked_out",
      manager,
      {},
      END,
      "completed",
      "booking.completed",
    ],
    [
      "confirmIssue",
      "checked_out",
      manager,
      { incident: { type: "damage" } },
      END,
      "flagged",
      "booking.flagged",
    ],
    [
      "closeFlagged",
      "flagged",
      SYSTEM,
      {},
      END,
      "completed",
      "booking.completed",
    ],
  ];
  for (const [action, from, actor, payload, now, to, audit] of cases) {
    test(`${action}: ${from} → ${to}`, () => {
      const result = attempt(from, action, actor, payload, now);
      assert.equal(result.ok, true, result.message);
      assert.equal(result.from, from);
      assert.equal(result.to, to);
      assert.equal(result.audit, audit);
    });
  }

  test("promotion goes straight to approved on auto-approval resources", () => {
    assert.equal(
      attempt("waitlisted", "promote", SYSTEM, { autoApprove: true }).to,
      "approved",
    );
  });

  test("works with populated refs and Mongoose-style _id", () => {
    const populated = booking("pending", {
      borrower: { _id: "user-1", name: "A. Student" },
      orgUnit: { _id: "ou-dic" },
    });
    const actor = {
      _id: "user-2",
      roles: ["manager"],
      managedOrgUnits: [{ _id: "ou-dic" }],
    };
    assert.equal(
      canTransition({
        booking: populated,
        action: "approve",
        actor,
        now: BEFORE,
      }).ok,
      true,
    );
  });
});

describe("freesSlot (triggers waitlist promotion)", () => {
  test("set when a slot-holding booking ends early", () => {
    assert.equal(
      attempt("pending", "reject", manager, {
        reason: "Clashes with a lab session",
      }).freesSlot,
      true,
    );
    assert.equal(attempt("approved", "cancel", borrower).freesSlot, true);
    assert.equal(
      attempt("approved", "markNoShow", SYSTEM, {}, minutesFrom(START, 20))
        .freesSlot,
      true,
    );
  });

  test("set when a manager moves a pending request to the waitlist", () => {
    assert.equal(
      attempt("pending", "waitlist", manager, {
        reason: "Earlier request has priority",
      }).freesSlot,
      true,
    );
  });

  test("not set when the booking never held the slot, or keeps it", () => {
    assert.equal(attempt("waitlisted", "cancel", borrower).freesSlot, false);
    assert.equal(attempt("pending", "approve", manager).freesSlot, false);
  });
});

describe("rejected transitions", () => {
  test("wrong starting state → 409 INVALID_TRANSITION with a readable message", () => {
    const result = attempt("cancelled", "approve", manager);
    assert.deepEqual(
      [result.ok, result.status, result.code],
      [false, 409, "INVALID_TRANSITION"],
    );
    assert.equal(result.message, "Can't approve a booking that is cancelled.");
    assert.equal(
      attempt("checked_out", "checkIn", borrower, { report: {} }).message,
      "Can't check in a booking that is checked out.",
    );
  });

  test("unknown action → 400", () => {
    assert.equal(
      attempt("pending", "teleport", admin).code,
      "VALIDATION_ERROR",
    );
  });

  test("actors without the right relation → 403 FORBIDDEN", () => {
    for (const [action, status, actor] of [
      ["approve", "pending", stranger],
      ["approve", "pending", otherUnitManager],
      ["approve", "pending", borrower],
      ["approve", "pending", SYSTEM],
      ["markNoShow", "approved", borrower],
      ["promote", "waitlisted", manager],
      ["checkOut", "checked_in", stranger],
    ]) {
      const result = attempt(
        status,
        action,
        actor,
        { report: {} },
        minutesFrom(START, 30),
      );
      assert.equal(
        result.code,
        "FORBIDDEN",
        `${action} by ${actor.id ?? "system"}`,
      );
      assert.equal(result.status, 403);
    }
  });

  test("a manager cannot decide on their own booking; an admin can", () => {
    const own = attempt("pending", "approve", managerWhoBorrowed);
    assert.equal(own.code, "FORBIDDEN");
    assert.match(own.message, /your own booking/);
    assert.equal(
      attempt("checked_out", "confirmOk", managerWhoBorrowed, {}, END).code,
      "FORBIDDEN",
    );
    assert.equal(attempt("pending", "approve", adminWhoBorrowed).ok, true);
  });

  test("a manager can still cancel their own booking without a reason", () => {
    assert.equal(attempt("approved", "cancel", managerWhoBorrowed).ok, true);
  });
});

describe("required reasons and payloads", () => {
  test("reject and waitlist need a non-blank reason", () => {
    for (const payload of [{}, { reason: "   " }, { reason: 42 }]) {
      const result = attempt("pending", "reject", manager, payload);
      assert.equal(result.code, "VALIDATION_ERROR");
      assert.deepEqual(result.details, [
        { path: "reason", message: "Required" },
      ]);
    }
    assert.equal(
      attempt("pending", "waitlist", manager).code,
      "VALIDATION_ERROR",
    );
  });

  test("cancel needs a reason unless the borrower cancels", () => {
    assert.equal(attempt("approved", "cancel", borrower).ok, true);
    assert.equal(
      attempt("approved", "cancel", manager).code,
      "VALIDATION_ERROR",
    );
    assert.equal(attempt("approved", "cancel", admin).code, "VALIDATION_ERROR");
    assert.equal(
      attempt("approved", "cancel", manager, {
        reason: "Machine needs urgent repair",
      }).ok,
      true,
    );
  });

  test("check-in and check-out need a condition report; reporting an issue needs incident details", () => {
    assert.equal(
      attempt("approved", "checkIn", borrower, {}, START).details[0].path,
      "report",
    );
    assert.equal(
      attempt("checked_in", "checkOut", borrower, {}, END).details[0].path,
      "report",
    );
    assert.equal(
      attempt("checked_out", "confirmIssue", manager, {}, END).details[0].path,
      "incident",
    );
  });
});

describe("time guards", () => {
  test("check-in opens 15 minutes before the start and closes at the end", () => {
    const early = attempt(
      "approved",
      "checkIn",
      borrower,
      { report: {} },
      minutesFrom(START, -20),
    );
    assert.equal(early.code, "INVALID_TRANSITION");
    assert.equal(
      early.message,
      "Check-in opens 15 minutes before the start time (3 Nov, 09:45).",
    );
    assert.equal(
      attempt(
        "approved",
        "checkIn",
        borrower,
        { report: {} },
        minutesFrom(START, -15),
      ).ok,
      true,
    );
    assert.equal(
      attempt(
        "approved",
        "checkIn",
        borrower,
        { report: {} },
        minutesFrom(END, 1),
      ).message,
      "This booking has already ended.",
    );
  });

  test("no-show only after the 15-minute grace period", () => {
    assert.equal(
      attempt("approved", "markNoShow", SYSTEM, {}, minutesFrom(START, 15))
        .code,
      "INVALID_TRANSITION",
    );
    assert.equal(
      attempt("approved", "markNoShow", SYSTEM, {}, minutesFrom(START, 16)).ok,
      true,
    );
  });

  test("a waitlisted or pending request expires only once its slot has started", () => {
    for (const status of ["waitlisted", "pending"]) {
      assert.equal(
        attempt(status, "expire", SYSTEM, {}, BEFORE).code,
        "INVALID_TRANSITION",
      );
    }
  });

  test("an expiring pending request frees its slot; a waitlisted one never held it", () => {
    const after = minutesFrom(START, 1);
    assert.equal(
      attempt("pending", "expire", SYSTEM, {}, after).freesSlot,
      true,
    );
    assert.equal(
      attempt("waitlisted", "expire", SYSTEM, {}, after).freesSlot,
      false,
    );
  });
});

describe("relationsOf", () => {
  test("one person can hold several relations", () => {
    assert.deepEqual(
      [...relationsOf(managerWhoBorrowed, booking("pending"))],
      ["borrower", "unitManager"],
    );
  });

  test("a missing id never matches a missing borrower", () => {
    assert.equal(relationsOf({ roles: [] }, { status: "pending" }).size, 0);
  });
});

describe("allowedActions (UI buttons)", () => {
  test("borrower near the start of an approved booking can cancel or check in", () => {
    assert.deepEqual(
      allowedActions(booking("approved"), borrower, minutesFrom(START, -5)),
      ["cancel", "checkIn"],
    );
  });

  test("manager of the unit sees the review actions on a pending request", () => {
    assert.deepEqual(allowedActions(booking("pending"), manager, BEFORE), [
      "approve",
      "reject",
      "waitlist",
      "cancel",
    ]);
  });

  test("others see nothing", () => {
    assert.deepEqual(allowedActions(booking("pending"), stranger, BEFORE), []);
    assert.deepEqual(allowedActions(booking("approved"), borrower, BEFORE), [
      "cancel",
    ]);
  });
});

describe("isOverdue", () => {
  test("a checked-in booking is overdue 15 minutes after its end", () => {
    assert.equal(isOverdue(booking("checked_in"), minutesFrom(END, 10)), false);
    assert.equal(isOverdue(booking("checked_in"), minutesFrom(END, 16)), true);
    assert.equal(
      isOverdue(booking("checked_out"), minutesFrom(END, 60)),
      false,
    );
  });
});
