// blockSuspended (architecture.md §7.1): reads pass, writes by a suspended user are 403 with the end
// date (IST) and reason. User.findById is stubbed, so no database is needed.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { blockSuspended } from "../../src/middleware/blockSuspended.js";
import { User } from "../../src/models/index.js";

const USER_ID = "64b7f0c2a1b2c3d4e5f60718";
const HOUR = 3_600_000;

let stored; // what the stubbed findById finds
let lookups;
beforeEach((t) => {
  stored = null;
  lookups = [];
  t.mock.method(User, "findById", (id) => {
    lookups.push(String(id));
    const query = {
      select: () => query,
      lean: async () => stored,
    };
    return query;
  });
});

// → the argument blockSuspended passed to next().
function run(method, user = { id: USER_ID }) {
  return new Promise((resolve) => {
    blockSuspended({ method, user }, {}, (err) => resolve(err));
  });
}

test("GET, HEAD and OPTIONS pass without a lookup, even while suspended", async () => {
  stored = { suspendedUntil: new Date(Date.now() + HOUR) };
  for (const method of ["GET", "HEAD", "OPTIONS"])
    assert.equal(await run(method), undefined, method);
  assert.equal(lookups.length, 0);
});

test("a write by a suspended user is 403 FORBIDDEN naming the end date in IST and the reason", async (t) => {
  stored = {
    suspendedUntil: new Date("2026-11-05T09:00:00Z"),
    suspensionReason: "Returned the drone damaged twice",
  };
  t.mock.method(Date, "now", () => Date.parse("2026-11-01T00:00:00Z"));
  let err;
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    err = await run(method);
    assert.equal(err?.status, 403, method);
  }
  assert.equal(err.code, "FORBIDDEN");
  assert.equal(
    err.message,
    "Your account is suspended until 5 Nov 2026, 14:30 IST: Returned the drone damaged twice",
  );
  assert.deepEqual(err.details, {
    suspendedUntil: "2026-11-05T09:00:00.000Z",
    reason: "Returned the drone damaged twice",
  });
  assert.deepEqual(lookups, [USER_ID, USER_ID, USER_ID, USER_ID]);
});

test("without a reason the message still ends cleanly", async () => {
  stored = { suspendedUntil: new Date(Date.now() + 2 * HOUR) };
  const err = await run("POST");
  assert.equal(err.status, 403);
  assert.match(err.message, /^Your account is suspended until .+ IST\.$/);
  assert.equal(err.details.reason, null);
});

test("an ended, cleared or absent suspension lets the write through", async (t) => {
  const end = Date.parse("2026-11-05T09:00:00Z");
  t.mock.method(Date, "now", () => end + 1000); // a second after it ended
  for (const user of [
    { suspendedUntil: new Date(end), suspensionReason: "Old" },
    { suspendedUntil: null },
    {},
  ]) {
    stored = user;
    assert.equal(await run("POST"), undefined);
  }
});

test("an unknown user passes, so the service answers 404 as it does everywhere", async () => {
  stored = null;
  assert.equal(await run("POST"), undefined);
  assert.equal(await run("POST", { id: "demo-user-id-001" }), undefined);
  assert.deepEqual(lookups, [USER_ID], "a malformed id is never queried");
});

test("mounted before verifyAuth, it fails loudly instead of letting everyone through", async () => {
  const err = await run("POST", null);
  assert.match(err.message, /mount it after verifyAuth/);
  assert.equal(err.status, undefined);
});

test("a database error goes to the error handler", async (t) => {
  t.mock.method(User, "findById", () => ({
    select() {
      return this;
    },
    lean: async () => {
      throw new Error("connection lost");
    },
  }));
  const err = await run("POST");
  assert.equal(err.message, "connection lost");
});
