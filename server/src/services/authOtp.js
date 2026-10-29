// Email one-time codes (architecture.md §8 and §10.1).
//
// A code is 6 random digits. Redis keeps only sha256(code + OTP_PEPPER) at otp:{email} for 10 minutes,
// so a Redis dump doesn't hand out working codes, and counts wrong guesses at otp:tries:{email}. The
// 5th wrong guess deletes the code. A new code resets the count.
//
// Both steps are Lua scripts, so they are atomic: a guess reads the code, counts its try and is
// compared in one step, and concurrent guesses can't slip in between a try and the cleanup.
//
// Redis down is 503 SERVICE_UNAVAILABLE: without it a code can be neither stored nor checked.
import { createHash, randomInt } from "node:crypto";
import { getRedis } from "../config/redis.js";
import { log } from "../lib/log.js";
import { keys, TTL } from "../lib/redisKeys.js";
import { ServiceError } from "../lib/serviceError.js";

export const OTP_MAX_TRIES = 5;

const codeStoreDown = () =>
  new ServiceError(
    503,
    "SERVICE_UNAVAILABLE",
    "We can't send or check codes right now. Try again in a minute.",
  );

const invalidOtp = (message) => new ServiceError(400, "INVALID_OTP", message);

let warnedNoPepper = false;

// Required in production. Locally a missing pepper only weakens the stored hashes, so it's a warning.
function pepper() {
  const value = process.env.OTP_PEPPER;
  if (value) return value;
  if (process.env.NODE_ENV === "production")
    throw new Error("OTP_PEPPER is not set");
  if (!warnedNoPepper) {
    warnedNoPepper = true;
    log.warn("OTP_PEPPER is not set; OTP hashes are unpeppered");
  }
  return "";
}

const hash = (code) =>
  createHash("sha256")
    .update(code + pepper())
    .digest();

// Runs Redis commands; any Redis failure becomes the 503. Hashing happens outside, so a missing
// pepper stays a 500 instead of passing for an outage.
async function withRedis(work) {
  try {
    return await work(getRedis());
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    log.warn({ err }, "OTP store unavailable: Redis is down");
    throw codeStoreDown();
  }
}

// Fails with the 503 when Redis is down. resend-otp calls it for every email, existing or not, so
// a Redis outage doesn't reveal which addresses have accounts.
export const assertCodeStoreUp = (email) =>
  withRedis((redis) => redis.exists(keys.otp(email)));

// KEYS: the code, the tries. ARGV: the digest, the TTL in seconds.
const ISSUE = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("DEL", KEYS[2])
return 1`;

// KEYS: the code, the tries. ARGV: the given digest, OTP_MAX_TRIES, the TTL in seconds.
// → {"none"} with no live code, {"right"}, or {"wrong", tries left}. A plain == is fine: the digests
// are hashes of a peppered code, so how long the comparison takes says nothing about the code.
const CHECK = `
local stored = redis.call("GET", KEYS[1])
if not stored then return {"none"} end
local tries = redis.call("INCR", KEYS[2])
if tries == 1 then redis.call("EXPIRE", KEYS[2], ARGV[3]) end
local left = tonumber(ARGV[2]) - tries
if left >= 0 and stored == ARGV[1] then
  redis.call("DEL", KEYS[1], KEYS[2])
  return {"right"}
end
if left <= 0 then redis.call("DEL", KEYS[1], KEYS[2]) end
return {"wrong", math.max(left, 0)}`;

function scripts(redis) {
  if (!redis.otpIssue) {
    redis.defineCommand("otpIssue", { numberOfKeys: 2, lua: ISSUE });
    redis.defineCommand("otpCheck", { numberOfKeys: 2, lua: CHECK });
  }
  return redis;
}

// → the new code, to be emailed. Replaces any earlier code for the address.
export function issueOtp(email) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const digest = hash(code).toString("hex");
  return withRedis(async (redis) => {
    await scripts(redis).otpIssue(
      keys.otp(email),
      keys.otpTries(email),
      digest,
      TTL.otpSeconds,
    );
    return code;
  });
}

// True when a code went out less than `seconds` ago (its TTL hasn't dropped by that much yet).
export const sentWithin = (email, seconds) =>
  withRedis(
    async (redis) =>
      (await redis.ttl(keys.otp(email))) > TTL.otpSeconds - seconds,
  );

// Resolves when `code` is the address's current code, and uses it up; otherwise throws 400 INVALID_OTP
// saying how many tries are left. The try is counted in the same atomic step as the comparison, so
// concurrent guesses can't get more than OTP_MAX_TRIES comparisons out of one code.
export function checkOtp(email, code) {
  const given = hash(code).toString("hex");
  return withRedis(async (redis) => {
    const [verdict, left] = await scripts(redis).otpCheck(
      keys.otp(email),
      keys.otpTries(email),
      given,
      OTP_MAX_TRIES,
      TTL.otpSeconds,
    );
    if (verdict === "right") return;
    if (verdict === "none")
      throw invalidOtp(
        "This code has expired or was already used. Request a new code.",
      );
    const n = Number(left);
    throw invalidOtp(
      n > 0
        ? `That code is wrong. You have ${n === 1 ? "1 try" : `${n} tries`} left.`
        : "That code is wrong, and it can't be used any more. Request a new code.",
    );
  });
}
