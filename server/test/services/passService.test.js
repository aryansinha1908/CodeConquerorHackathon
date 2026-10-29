// The QR pass token (src/services/passService.js): signed with a key derived only for passes, short-
// lived, and never interchangeable with an access token in either direction.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PASS_TTL_SECONDS, readPass, signPass } from "../../src/services/passService.js";
import { signAccessToken, verifyAccessToken } from "../../src/services/authTokens.js";

process.env.ACCESS_TOKEN_SECRET ??= "test-access-secret";

const BOOKING = "64a0000000000000000000b1";
const NOW = new Date("2026-11-02T04:30:00.000Z");

describe("pass tokens", () => {
  test("a pass reads back as its booking until it expires, PASS_TTL_SECONDS later", () => {
    const { token, expiresAt } = signPass(BOOKING, NOW);
    assert.match(token, /^cc1\.[0-9a-f]{24}\.\d{10}\.[A-Za-z0-9_-]{22}$/);
    assert.equal(expiresAt.getTime(), NOW.getTime() + PASS_TTL_SECONDS * 1000);
    assert.deepEqual(readPass(token, NOW), { bookingId: BOOKING, exp: token.split(".")[2], expiresAt });
    assert.deepEqual(readPass(` ${token} `, new Date(expiresAt.getTime() - 1)).bookingId, BOOKING);
    assert.throws(() => readPass(token, expiresAt), (err) => err.status === 400 && err.code === "PASS_EXPIRED");
  });

  test("a changed booking id, expiry or tag, or a garbled string, is refused as not a pass", () => {
    const { token } = signPass(BOOKING, NOW);
    const [prefix, id, exp, tag] = token.split(".");
    const flip = (c) => (c === "x" ? "y" : "x");
    const forgeries = [
      [prefix, "64a0000000000000000000b2", exp, tag].join("."),
      [prefix, id, String(Number(exp) + 3600), tag].join("."),
      // A changed character in the middle of the tag.
      [prefix, id, exp, `${tag.slice(0, 10)}${flip(tag[10])}${tag.slice(11)}`].join("."),
      "not a pass",
      "",
      null,
    ];
    for (const forged of forgeries) {
      assert.throws(
        () => readPass(forged, NOW),
        (err) => err.status === 400 && err.code === "VALIDATION_ERROR",
        String(forged),
      );
    }
  });

  test("each pass has one spelling: the 15 other last characters that decode to the same bytes are refused", () => {
    // The 22nd base64url character carries 2 bits of the tag; its other 4 bits are padding.
    for (let i = 0; i < 20; i++) {
      const { token } = signPass(BOOKING, new Date(NOW.getTime() + i * 1000));
      const last = token.at(-1);
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      const sameBits = [...alphabet].filter((c) => c !== last && alphabet.indexOf(c) >> 4 === alphabet.indexOf(last) >> 4);
      assert.equal(sameBits.length, 15);
      for (const c of sameBits) {
        assert.throws(() => readPass(token.slice(0, -1) + c, NOW), (err) => err.code === "VALIDATION_ERROR", `${last} → ${c}`);
      }
    }
  });

  test("a pass is never an access token, and an access token is never a pass", () => {
    const { token } = signPass(BOOKING, NOW);
    assert.throws(() => verifyAccessToken(token));
    const access = signAccessToken({ _id: BOOKING, roles: ["member"], memberType: "ug", managedOrgUnits: [] });
    assert.throws(() => readPass(access, NOW), (err) => err.code === "VALIDATION_ERROR");
  });

  test("the pass key depends on ACCESS_TOKEN_SECRET: rotating it voids every pass", () => {
    const { token } = signPass(BOOKING, NOW);
    const saved = process.env.ACCESS_TOKEN_SECRET;
    process.env.ACCESS_TOKEN_SECRET = "a-rotated-secret";
    try {
      assert.throws(() => readPass(token, NOW), (err) => err.code === "VALIDATION_ERROR");
    } finally {
      process.env.ACCESS_TOKEN_SECRET = saved;
    }
  });
});
