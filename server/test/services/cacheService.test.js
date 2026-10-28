import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import RedisMock from "ioredis-mock";
import { setRedisLogger, useRedisClient } from "../../src/config/redis.js";
import { keys } from "../../src/lib/redisKeys.js";
import {
  bumpVersion,
  cachedCatalogue,
  cachedResource,
  cachedResourceList,
  del,
  getOrSet,
  hashQuery,
  invalidateCatalogue,
  invalidateResource,
} from "../../src/services/cacheService.js";

const warnings = [];
setRedisLogger({
  info() {},
  warn: (...args) => warnings.push(args),
  error() {},
});

const redis = new RedisMock();

// A loader that counts how often it hit "Mongo".
const loader = (value) => {
  const fn = async () => {
    fn.calls++;
    return value;
  };
  fn.calls = 0;
  return fn;
};

const unreachable = () => {
  const fail = async () => {
    throw new Error(
      "Stream isn't writeable and enableOfflineQueue options is false",
    );
  };
  return { get: fail, set: fail, del: fail, incr: fail };
};

beforeEach(async () => {
  useRedisClient(redis);
  await redis.flushall();
  warnings.length = 0;
});

describe("getOrSet", () => {
  test("loads once, then serves from Redis with the TTL", async () => {
    const load = loader({ title: "Prusa MK4", quantity: 1 });
    assert.deepEqual(await getOrSet("cache:t", 60, load), {
      title: "Prusa MK4",
      quantity: 1,
    });
    assert.deepEqual(await getOrSet("cache:t", 60, load), {
      title: "Prusa MK4",
      quantity: 1,
    });
    assert.equal(load.calls, 1);
    const ttl = await redis.ttl("cache:t");
    assert.ok(ttl > 0 && ttl <= 60, `ttl ${ttl}`);
  });

  test("does not cache null, so a missing resource isn't remembered", async () => {
    const load = loader(null);
    await getOrSet("cache:missing", 60, load);
    await getOrSet("cache:missing", 60, load);
    assert.equal(load.calls, 2);
    assert.equal(await redis.exists("cache:missing"), 0);
  });

  test("treats unreadable entries as a miss and overwrites them", async () => {
    await redis.set("cache:t", "{not json");
    const load = loader({ ok: true });
    assert.deepEqual(await getOrSet("cache:t", 60, load), { ok: true });
    assert.equal(await redis.get("cache:t"), '{"ok":true}');
    assert.equal(warnings.length, 1);
  });

  test("JSON round trip turns Dates into strings", async () => {
    await getOrSet(
      "cache:d",
      60,
      loader({ at: new Date("2026-11-03T04:30:00Z") }),
    );
    assert.deepEqual(await getOrSet("cache:d", 60, loader(null)), {
      at: "2026-11-03T04:30:00.000Z",
    });
  });
});

describe("fails open when Redis is unreachable", () => {
  test("every call still answers from the loader, logging a warning", async () => {
    useRedisClient(unreachable());
    const load = loader({ title: "Prusa MK4" });
    assert.deepEqual(await getOrSet("cache:t", 60, load), {
      title: "Prusa MK4",
    });
    assert.deepEqual(await cachedResourceList({ q: "printer" }, load), {
      title: "Prusa MK4",
    });
    await del("cache:t");
    await bumpVersion("resources");
    await invalidateResource("r1");
    await invalidateCatalogue("badges");
    assert.equal(load.calls, 2);
    assert.ok(warnings.length >= 6);
    assert.ok(warnings.every(([, message]) => typeof message === "string"));
  });

  test("a resource list skips the cache entirely after the version read fails", async () => {
    useRedisClient(unreachable());
    await cachedResourceList({ q: "printer" }, loader([]));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][1], /version read failed/);
  });
});

describe("hashQuery", () => {
  test("ignores key order and undefined values", () => {
    const a = hashQuery({
      q: "printer",
      filters: { category: "equipment", orgUnit: "dic" },
      page: 1,
    });
    const b = hashQuery({
      page: 1,
      filters: { orgUnit: "dic", category: "equipment" },
      q: "printer",
      date: undefined,
    });
    assert.equal(a, b);
    assert.match(a, /^[a-f\d]{40}$/);
  });

  test("different filters, pages or array orders give different keys", () => {
    const base = hashQuery({ q: "printer", page: 1 });
    assert.notEqual(base, hashQuery({ q: "printer", page: 2 }));
    assert.notEqual(base, hashQuery({ q: "laser", page: 1 }));
    assert.notEqual(
      hashQuery({ types: ["ug", "pg"] }),
      hashQuery({ types: ["pg", "ug"] }),
    );
  });
});

describe("resource caching and invalidation", () => {
  test("list results are cached until any resource changes", async () => {
    const query = { category: "equipment", page: 1, limit: 20 };
    const load = loader([{ title: "Prusa MK4" }]);
    await cachedResourceList(query, load);
    await cachedResourceList(
      { limit: 20, page: 1, category: "equipment" },
      load,
    );
    assert.equal(load.calls, 1);
    assert.ok(await redis.exists(keys.resourceList(0, hashQuery(query))));

    await invalidateResource("r1");
    assert.equal(await redis.get(keys.cacheVersion("resources")), "1");
    await cachedResourceList(query, load);
    assert.equal(load.calls, 2, "version bump makes the old list unreachable");
  });

  test("detail is cached per resource and deleted on change", async () => {
    const load = loader({ _id: "r1", title: "Prusa MK4" });
    await cachedResource("r1", load);
    await cachedResource("r1", load);
    assert.equal(load.calls, 1);
    assert.ok((await redis.ttl(keys.resourceDetail("r1"))) <= 300);

    await invalidateResource("r1");
    assert.equal(await redis.exists(keys.resourceDetail("r1")), 0);
    await cachedResource("r1", load);
    assert.equal(load.calls, 2);
  });

  test("catalogues are cached and can be invalidated", async () => {
    const load = loader([{ code: "dic" }]);
    await cachedCatalogue("orgunits", load);
    await cachedCatalogue("orgunits", load);
    assert.equal(load.calls, 1);
    await invalidateCatalogue("orgunits");
    await cachedCatalogue("orgunits", load);
    assert.equal(load.calls, 2);
  });
});
