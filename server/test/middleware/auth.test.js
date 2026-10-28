import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { verifyAuth } from "../../src/middleware/auth.js";
import { signAccessToken } from "../../src/services/authTokens.js";

process.env.ACCESS_TOKEN_SECRET = "test-access-secret";

const USER_ID = "64b7f0c2a1b2c3d4e5f60718";
const user = {
  _id: USER_ID,
  roles: ["member", "manager"],
  memberType: "faculty",
  managedOrgUnits: ["64b7f0c2a1b2c3d4e5f60719"],
  verification: { status: "approved" },
};

// → what verifyAuth passed to next(), and the request it saw.
function run(authorization) {
  const req = { headers: authorization ? { authorization } : {} };
  return new Promise((resolve) => {
    verifyAuth(req, {}, (err) => resolve({ err, req }));
  });
}

test("a valid Bearer token sets req.user to { id, roles }", async () => {
  const { err, req } = await run(`Bearer ${signAccessToken(user)}`);
  assert.equal(err, undefined);
  assert.deepEqual(req.user, { id: USER_ID, roles: ["member", "manager"] });
});

test("the access token carries the architecture.md §7.1 claims and lasts 15 minutes", () => {
  const claims = jwt.verify(
    signAccessToken(user),
    process.env.ACCESS_TOKEN_SECRET,
  );
  assert.equal(claims.sub, USER_ID);
  assert.deepEqual(claims.roles, ["member", "manager"]);
  assert.equal(claims.memberType, "faculty");
  assert.deepEqual(claims.managedOrgUnits, ["64b7f0c2a1b2c3d4e5f60719"]);
  assert.equal(claims.verified, true);
  assert.equal(claims.exp - claims.iat, 15 * 60);
  assert.equal(
    jwt.decode(signAccessToken(user), { complete: true }).header.alg,
    "HS256",
  );
  const pending = jwt.decode(
    signAccessToken({ ...user, verification: { status: "pending" } }),
  );
  assert.equal(pending.verified, false);
});

test("a missing, malformed, expired, forged or old-mock token is 401 UNAUTHENTICATED, which the client refreshes on", async () => {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const expired = jwt.sign(
    { roles: [], exp: Math.floor(Date.now() / 1000) - 60 },
    secret,
    { subject: USER_ID },
  );
  const forged = jwt.sign({ roles: ["admin"] }, "someone-elses-secret", {
    subject: USER_ID,
  });
  const unsigned = jwt.sign({ roles: ["admin"] }, null, {
    algorithm: "none",
    subject: USER_ID,
  });
  const oldMock = jwt.sign(
    { id: "demo-user-id-001", username: "demo_guest", role: "demo" },
    secret,
  );
  for (const header of [
    undefined,
    "Bearer",
    "Basic abc",
    `Token ${signAccessToken(user)}`,
    `Bearer ${expired}`,
    `Bearer ${forged}`,
    `Bearer ${unsigned}`,
    `Bearer ${oldMock}`,
  ]) {
    const { err, req } = await run(header);
    assert.equal(err?.status, 401, String(header));
    assert.equal(err.code, "UNAUTHENTICATED");
    assert.equal(req.user, undefined);
  }
});

test("a missing secret is a 500, not a 401 that signs everybody out", async (t) => {
  const token = signAccessToken(user);
  const saved = process.env.ACCESS_TOKEN_SECRET;
  delete process.env.ACCESS_TOKEN_SECRET;
  t.after(() => {
    process.env.ACCESS_TOKEN_SECRET = saved;
  });
  const { err } = await run(`Bearer ${token}`);
  assert.equal(err?.status, undefined);
  assert.match(err.message, /ACCESS_TOKEN_SECRET is not set/);
});
