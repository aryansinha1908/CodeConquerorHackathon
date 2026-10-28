import { test } from "node:test";
import assert from "node:assert/strict";
import { TTL, keys } from "../../src/lib/redisKeys.js";

test("keys follow the catalogue in architecture.md §10.1", () => {
  assert.equal(
    keys.otp(" 2024UGCS999@nitjsr.ac.in "),
    "otp:2024ugcs999@nitjsr.ac.in",
  );
  assert.equal(keys.otpTries("A@B.in"), "otp:tries:a@b.in");
  assert.equal(keys.refreshFamily("u1", "f1"), "auth:refresh:u1:f1");
  assert.equal(keys.rateLimitPrefix("login"), "rl:login:");
  assert.equal(keys.resourceLock("r1"), "lock:resource:r1");
  assert.equal(keys.sweepLock, "lock:cron:sweep");
  assert.equal(keys.cacheVersion("resources"), "cache:resources:ver");
  assert.equal(keys.resourceList(3, "abc"), "cache:resources:v3:abc");
  assert.equal(keys.resourceDetail("r1"), "cache:resource:r1");
  assert.equal(keys.catalogue("orgunits"), "cache:orgunits");
});

test("TTLs match the catalogue", () => {
  assert.equal(TTL.otpSeconds, 600);
  assert.equal(TTL.refreshTokenSeconds, 604800);
  assert.equal(TTL.resourceLockMs, 5000);
  assert.equal(TTL.sweepLockMs, 240000);
  assert.equal(TTL.resourceListSeconds, 60);
  assert.equal(TTL.resourceDetailSeconds, 300);
  assert.equal(TTL.catalogueSeconds, 600);
});
