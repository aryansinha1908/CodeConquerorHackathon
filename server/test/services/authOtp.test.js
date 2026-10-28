// Email one-time codes (services/authOtp.js) on ioredis-mock, without MongoDB.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import RedisMock from "ioredis-mock";
import { setRedisLogger, useRedisClient } from "../../src/config/redis.js";
import { keys } from "../../src/lib/redisKeys.js";
import {
  OTP_MAX_TRIES,
  checkOtp,
  issueOtp,
} from "../../src/services/authOtp.js";

setRedisLogger({ info() {}, warn() {}, error() {} });
process.env.OTP_PEPPER = "test-pepper";

const EMAIL = "2024ugcs999@nitjsr.ac.in";
const redis = new RedisMock();

const wrongCode = (code) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, "0");
const outcome = (promise) =>
  promise.then(
    () => "accepted",
    (err) => err.message,
  );

// Requests that read the code before the 5th wrong try cleaned up, but count their try after it:
// every INCR but the first waits for the first DEL.
function cleanupFirst(target) {
  let release;
  const cleanedUp = new Promise((resolve) => {
    release = resolve;
  });
  let incrs = 0;
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "incr")
        return async (...args) => {
          if (incrs++ > 0) await cleanedUp;
          return t.incr(...args);
        };
      if (prop === "del")
        return async (...args) => {
          const deleted = await t.del(...args);
          release();
          return deleted;
        };
      const value = t[prop];
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

describe("authOtp", () => {
  beforeEach(async () => {
    useRedisClient(redis);
    await redis.flushall();
  });

  test("concurrent guesses get no more than OTP_MAX_TRIES comparisons out of one code", async () => {
    const code = await issueOtp(EMAIL);
    for (let i = 0; i < OTP_MAX_TRIES - 1; i++)
      await outcome(checkOtp(EMAIL, wrongCode(code)));

    useRedisClient(cleanupFirst(redis));
    const results = await Promise.all([
      outcome(checkOtp(EMAIL, wrongCode(code))), // the 5th wrong try
      outcome(checkOtp(EMAIL, code)),
      outcome(checkOtp(EMAIL, wrongCode(code))),
    ]);
    assert.deepEqual(results, [
      "That code is wrong, and it can't be used any more. Request a new code.",
      "This code has expired or was already used. Request a new code.",
      "This code has expired or was already used. Request a new code.",
    ]);
    useRedisClient(redis);
    assert.equal(await redis.exists(keys.otp(EMAIL)), 0);
  });

  test("the right code is used up once; tries count down to the 5th", async () => {
    const code = await issueOtp(EMAIL);
    assert.equal(
      await outcome(checkOtp(EMAIL, wrongCode(code))),
      "That code is wrong. You have 4 tries left.",
    );
    assert.equal(await outcome(checkOtp(EMAIL, code)), "accepted");
    assert.equal(await redis.exists(keys.otp(EMAIL)), 0);
    assert.equal(await redis.exists(keys.otpTries(EMAIL)), 0);
    assert.match(await outcome(checkOtp(EMAIL, code)), /already used/);
  });

  test("a new code resets the tries", async () => {
    const first = await issueOtp(EMAIL);
    for (let i = 0; i < 3; i++)
      await outcome(checkOtp(EMAIL, wrongCode(first)));
    const second = await issueOtp(EMAIL);
    assert.equal(
      await outcome(checkOtp(EMAIL, wrongCode(second))),
      "That code is wrong. You have 4 tries left.",
    );
  });
});
