// Access and refresh tokens (architecture.md §7.1).
//
// - Access token: HS256, 15 minutes, { sub, roles, memberType, managedOrgUnits, verified }. The client
//   keeps it in memory only.
// - Refresh token: HS256, 7 days, { sub, fam, jti }, sent as an httpOnly cookie scoped to /api/v1/auth.
//   Each sign-in starts a family (one session, one device) whose current jti is allow-listed in Redis
//   (auth:refresh:{userId}:{familyId}, §10.1); the jti rotates on every use. A token of the family
//   whose jti isn't current any more has been used before: that is reuse (a stolen cookie, or a
//   replay), so that family is revoked. Only that one: judges share the demo accounts, and a replay
//   by one of them mustn't sign out the rest, nor a stolen laptop cookie the owner's phone.
// - For REUSE_GRACE_SECONDS after a rotation, the token just replaced still gets the current one, so
//   two tabs refreshing with the same cookie at once, or a reload that lost the answer, stay signed in.
//
// Secrets are read when a token is made or checked, not on import, so dotenv and tests can set them.
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getRedis } from "../config/redis.js";
import { log } from "../lib/log.js";
import { keys, TTL } from "../lib/redisKeys.js";
import { ServiceError } from "../lib/serviceError.js";
import { isId } from "./params.js";

const ALGORITHM = "HS256";
const ACCESS_TOKEN_LIFETIME = "15m";

export const REFRESH_COOKIE = "refreshToken";
export const REUSE_GRACE_SECONDS = 30;

// 401 UNAUTHENTICATED is the one code the client refreshes on (frontend.md §8.1), so a failed refresh
// uses it too: the client then gives up and shows the login page.
export const unauthenticated = (
  message = "Your session has ended. Sign in again.",
) => new ServiceError(401, "UNAUTHENTICATED", message);

const sessionStoreDown = () =>
  new ServiceError(
    503,
    "SERVICE_UNAVAILABLE",
    "Sign-in is briefly unavailable. Try again in a minute.",
  );

// A missing secret is a deployment mistake, not a bad token: it must be a loud 500, never a 401 that
// signs everybody out.
function secret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// architecture.md §16: Secure in production (HTTPS on Render and Vercel); plain http on localhost.
export function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    path: "/api/v1/auth",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL.refreshTokenSeconds * 1000,
  };
}

// Express 5 ignores maxAge when clearing; the rest must match, or the browser keeps the cookie.
export function clearRefreshCookieOptions() {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  return options;
}

// The sign-up proof (services/authService.js): the same scope as the refresh cookie, for a day.
export const SIGNUP_COOKIE = "signupProof";
export const signupCookieOptions = () => ({
  ...refreshCookieOptions(),
  maxAge: 24 * 60 * 60 * 1000,
});

// `user` is a User document or lean object.
export function signAccessToken(user) {
  return jwt.sign(
    {
      roles: user.roles ?? [],
      memberType: user.memberType ?? null,
      managedOrgUnits: (user.managedOrgUnits ?? []).map((id) =>
        String(id?._id ?? id),
      ),
      verified: user.verification?.status === "approved",
    },
    secret("ACCESS_TOKEN_SECRET"),
    {
      algorithm: ALGORITHM,
      subject: String(user._id),
      expiresIn: ACCESS_TOKEN_LIFETIME,
    },
  );
}

// Throws jsonwebtoken's errors (JsonWebTokenError and its subclasses) for a bad or expired token, and a
// plain Error when the secret is missing; middleware/auth.js turns only the first kind into a 401.
export function verifyAccessToken(token) {
  return jwt.verify(token, secret("ACCESS_TOKEN_SECRET"), {
    algorithms: [ALGORITHM],
  });
}

// → { sub, fam, jti } when the signature (and, unless ignoreExpiration, the expiry) checks out; else
// null. A missing secret throws: that's a 500, not a sign-out.
export function readRefreshClaims(token, { ignoreExpiration = false } = {}) {
  if (typeof token !== "string" || !token) return null;
  let claims;
  try {
    claims = jwt.verify(token, secret("REFRESH_TOKEN_SECRET"), {
      algorithms: [ALGORITHM],
      ignoreExpiration,
    });
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) return null;
    throw err;
  }
  // The key is built from these, so anything but an ObjectId and uuid-like strings is refused.
  const uuidLike = (value) => /^[\w-]{8,64}$/.test(String(value ?? ""));
  if (!isId(claims.sub) || !uuidLike(claims.fam) || !uuidLike(claims.jti))
    return null;
  return { sub: String(claims.sub), fam: claims.fam, jti: claims.jti };
}

const signRefreshToken = ({ sub, fam, jti }) =>
  jwt.sign({ fam, jti }, secret("REFRESH_TOKEN_SECRET"), {
    algorithm: ALGORITHM,
    subject: sub,
    expiresIn: TTL.refreshTokenSeconds,
  });

// → a refresh token starting a new family, listed in Redis, or null when Redis can't store it. The
// caller then signs the user in without a cookie (one 15-minute session) rather than not at all.
export async function issueRefreshToken(userId) {
  const claims = { sub: String(userId), fam: randomUUID(), jti: randomUUID() };
  const token = signRefreshToken(claims);
  try {
    await getRedis().set(
      keys.refreshFamily(claims.sub, claims.fam),
      claims.jti,
      "EX",
      TTL.refreshTokenSeconds,
    );
  } catch (err) {
    log.warn(
      { err, userId: claims.sub },
      "Couldn't store the refresh token in Redis; signing in without the refresh cookie",
    );
    return null;
  }
  return token;
}

// KEYS: the family. ARGV: the presented jti, the next jti, the TTL in seconds, now (ms), the grace (ms).
// The value is "<current>" or, after a rotation, "<current> <previous> <rotated at, ms>".
// → {1} rotated to the next jti; {2, current} the previous jti within the grace window; {3} reuse,
// and the family is deleted; {0} no such family (logged out, revoked or expired).
const ROTATE = `
local state = redis.call("GET", KEYS[1])
if not state then return {0} end
local current, previous, at = string.match(state, "^(%S+) (%S+) (%d+)$")
if not current then current = state end
if current == ARGV[1] then
  local rotated = ARGV[2] .. " " .. ARGV[1] .. " " .. ARGV[4]
  redis.call("SET", KEYS[1], rotated, "EX", ARGV[3])
  return {1}
end
local now, grace = tonumber(ARGV[4]), tonumber(ARGV[5])
if previous == ARGV[1] and now - tonumber(at) <= grace then
  return {2, current}
end
redis.call("DEL", KEYS[1])
return {3}`;

function scripts(redis) {
  if (!redis.refreshRotate)
    redis.defineCommand("refreshRotate", { numberOfKeys: 1, lua: ROTATE });
  return redis;
}

// Uses up the refresh token with these claims (from readRefreshClaims): → the family's next token.
// The check and the rotation are one atomic step, so two requests can't both rotate one jti. Reused
// and unknown tokens are 401. If Redis is down the token can't be checked, so the answer is 503 and
// the route keeps the cookie for a retry.
export async function rotateRefreshToken(claims, { now = Date.now() } = {}) {
  const next = { ...claims, jti: randomUUID() };
  const token = signRefreshToken(next);
  let reply;
  try {
    reply = await scripts(getRedis()).refreshRotate(
      keys.refreshFamily(claims.sub, claims.fam),
      claims.jti,
      next.jti,
      TTL.refreshTokenSeconds,
      now,
      REUSE_GRACE_SECONDS * 1000,
    );
  } catch (err) {
    log.warn({ err }, "Couldn't check a refresh token: Redis is unavailable");
    throw sessionStoreDown();
  }
  const [outcome, current] = reply;
  if (Number(outcome) === 1) return token;
  if (Number(outcome) === 2)
    return signRefreshToken({ ...claims, jti: current });
  if (Number(outcome) === 3) {
    // If it was stolen, the thief or the owner holds a newer token of this family: both are now dead.
    log.warn(
      {
        event: "auth.refresh.reuse_detected",
        userId: claims.sub,
        familyId: claims.fam,
      },
      "Refresh token reuse detected; ended that session",
    );
    throw unauthenticated(
      "Your session was ended for your security. Sign in again.",
    );
  }
  throw unauthenticated();
}

// Every session of the user, found with SCAN (never KEYS) on auth:refresh:{userId}:*.
export async function revokeAllRefreshTokens(userId) {
  const redis = getRedis();
  const pattern = keys.refreshFamily(String(userId), "*");
  let cursor = "0";
  let revoked = 0;
  do {
    const [next, found] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    if (found.length) revoked += await redis.del(...found);
    cursor = String(next);
  } while (cursor !== "0");
  return revoked;
}

// Logout: end the session (family) this token belongs to, if it has one. Never throws; an expired
// token still ends its session.
export async function revokeRefreshToken(token) {
  let claims;
  try {
    claims = readRefreshClaims(token, { ignoreExpiration: true });
  } catch (err) {
    log.warn({ err }, "Couldn't read the refresh token at logout");
    return;
  }
  if (!claims) return;
  try {
    await getRedis().del(keys.refreshFamily(claims.sub, claims.fam));
  } catch (err) {
    log.warn(
      { err, userId: claims.sub },
      "Couldn't delete the refresh token at logout: Redis is unavailable",
    );
  }
}
