// The audit log query against a real MongoDB; see fixtures.js for how to run it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { AuditLog, User } from "../../src/models/index.js";
import {
  SYSTEM_ACTOR,
  listAudit,
  record,
} from "../../src/services/auditService.js";
import { transition } from "../../src/services/bookingService.js";
import {
  NOW,
  TUE,
  bookAs,
  failure,
  plus,
  skip,
  useTestDatabase,
} from "./fixtures.js";

let f; // fixtures, rebuilt for every test

function assertError(err, status, code) {
  assert.equal(err.status, status, err.message);
  assert.equal(err.code, code);
}

const actions = (result) => result.items.map((e) => e.action);

describe("listAudit", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  // Oldest first: a DIC booking requested and approved, a CSE resource edit, a user event with no unit.
  const history = async () => {
    const { booking } = await bookAs(f.student, f.printer, TUE);
    await transition(booking._id, "approve", f.manager._id, {}, { now: NOW });
    await record({
      actor: { id: f.cseManager._id, role: "manager" },
      action: "resource.updated",
      entity: { type: "resource", id: new mongoose.Types.ObjectId() },
      orgUnit: f.cse._id,
      changes: { title: ["Old", "New"] },
    });
    // Written directly, with the hash-chain fields C-02 will fill in, which the query leaves out.
    await AuditLog.create({
      actor: { id: f.admin._id, role: "admin" },
      action: "user.suspended",
      entity: { type: "user", id: f.student3._id },
      reason: "Repeated no-shows",
      prevHash: "0".repeat(64),
      hash: "f".repeat(64),
    });
    await record({
      actor: SYSTEM_ACTOR,
      action: "booking.overdue",
      entity: { type: "booking", id: booking._id },
      orgUnit: f.dic._id,
    });
    // A minute apart from NOW, so time filters don't depend on the clock. Raw driver writes: the
    // model refuses updates by design.
    const entries = await AuditLog.find({}, { _id: 1 }).sort({ _id: 1 }).lean();
    for (const [i, entry] of entries.entries())
      await AuditLog.collection.updateOne(
        { _id: entry._id },
        { $set: { at: plus(NOW, i) } },
      );
    return booking;
  };

  test("an admin reads everything, newest first, with actor names and no hash fields", async () => {
    await history();
    const result = await listAudit(f.admin._id);
    assert.deepEqual(actions(result), [
      "booking.overdue",
      "user.suspended",
      "resource.updated",
      "booking.approved",
      "booking.requested",
    ]);
    assert.deepEqual(result.meta, { page: 1, limit: 20, total: 5 });

    const approved = result.items[3];
    assert.deepEqual(approved.actor, {
      id: f.manager._id,
      role: "manager",
      name: "Meera Iyer",
    });
    assert.deepEqual(approved.changes.status, ["pending", "approved"]);
    assert.equal(approved.orgUnit.code, "dic");
    assert.deepEqual(result.items[0].actor, {
      id: null,
      role: "system",
      name: null,
    });
    for (const entry of result.items) {
      assert.equal("hash" in entry, false);
      assert.equal("prevHash" in entry, false);
      assert.equal(JSON.stringify(entry).includes("@"), false, "no emails");
    }
  });

  test("a manager reads only their units' entries; unit-less ones are admin-only", async () => {
    await history();
    assert.deepEqual(actions(await listAudit(f.manager._id)), [
      "booking.overdue",
      "booking.approved",
      "booking.requested",
    ]);
    assert.deepEqual(actions(await listAudit(f.cseManager._id)), [
      "resource.updated",
    ]);
    assert.deepEqual(
      actions(await listAudit(f.manager._id, { orgUnit: f.dic._id })).length,
      3,
    );
    assert.deepEqual(
      actions(await listAudit(f.admin._id, { orgUnit: f.cse._id })),
      ["resource.updated"],
    );

    const other = await failure(
      listAudit(f.manager._id, { orgUnit: f.cse._id }),
    );
    assertError(other, 403, "FORBIDDEN");
    for (const who of [f.student, f.student2]) {
      const err = await failure(listAudit(who._id));
      assertError(err, 403, "FORBIDDEN");
      assert.match(err.message, /timeline/);
    }
    // A managedOrgUnits entry outliving the manager role grants nothing.
    await User.updateOne({ _id: f.manager._id }, { roles: ["member"] });
    assertError(await failure(listAudit(f.manager._id)), 403, "FORBIDDEN");
  });

  test("filters by entity, actor, action and time; pages", async () => {
    const booking = await history();
    assert.deepEqual(
      actions(
        await listAudit(f.admin._id, {
          entityType: "booking",
          entityId: booking._id,
        }),
      ),
      ["booking.overdue", "booking.approved", "booking.requested"],
    );
    assert.deepEqual(
      actions(await listAudit(f.admin._id, { actorId: f.student._id })),
      ["booking.requested"],
    );
    assert.deepEqual(
      actions(await listAudit(f.manager._id, { action: "booking.approved" })),
      ["booking.approved"],
    );

    // booking.approved is at NOW + 1 min; from is inclusive, to exclusive.
    const since = await listAudit(f.admin._id, { from: plus(NOW, 1) });
    assert.equal(since.items.at(-1).action, "booking.approved");
    assert.equal(since.meta.total, 4);
    const until = await listAudit(f.admin._id, {
      to: plus(NOW, 1).toISOString(),
    });
    assert.deepEqual(actions(until), ["booking.requested"]);

    const page = await listAudit(f.admin._id, { page: 2, limit: 2 });
    assert.deepEqual(actions(page), ["resource.updated", "booking.approved"]);
    assert.equal(page.meta.total, 5);
  });

  test("bad filters are 400, all at once; an unknown viewer is 404", async () => {
    const err = await failure(
      listAudit(f.admin._id, {
        entityType: "Booking!",
        entityId: "nope",
        action: "approved",
        from: "2026-11-03",
        to: "2026-11-02",
        actorId: { $ne: null },
      }),
    );
    assertError(err, 400, "VALIDATION_ERROR");
    assert.deepEqual(
      err.details.map((d) => d.path),
      ["entityType", "entityId", "actorId", "action", "to"],
    );
    assertError(await failure(listAudit("demo-user-id-001")), 404, "NOT_FOUND");
  });
});
