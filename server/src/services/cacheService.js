// Cache-aside on Redis (architecture.md §10.2, backend.md §8.3). Fails open: when Redis is
// unreachable or holds garbage, the loader reads Mongo and the request carries on (logged at warn).
//
// Only shared, slow-changing data belongs here. Per-user data (eligibility, bookings, notifications,
// quotas) and availability are never cached. Values round-trip through JSON, so ObjectIds and
// Dates come back as strings; return lean objects from loaders.
import { createHash } from "node:crypto";
import { getRedis, log } from "../config/redis.js";
import { TTL, keys } from "../lib/redisKeys.js";

async function read(key) {
  try {
    const raw = await getRedis().get(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch (err) {
    log.warn({ err, key }, "Cache read failed; using the database");
    return undefined;
  }
}

async function write(key, ttlSeconds, value) {
  try {
    await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    log.warn({ err, key }, "Cache write failed");
  }
}

// null and undefined aren't cached, so a "not found" can't outlive the thing being created.
export async function getOrSet(key, ttlSeconds, loader) {
  const cached = await read(key);
  if (cached !== undefined) return cached;
  const value = await loader();
  if (value != null) await write(key, ttlSeconds, value);
  return value;
}

export async function del(...cacheKeys) {
  try {
    await getRedis().del(...cacheKeys);
  } catch (err) {
    log.warn(
      { err, keys: cacheKeys },
      "Cache delete failed; entries expire within their TTL",
    );
  }
}

// Resolves undefined when Redis is down, so callers can skip the cache entirely.
async function currentVersion(namespace) {
  try {
    return Number(await getRedis().get(keys.cacheVersion(namespace))) || 0;
  } catch (err) {
    log.warn(
      { err, namespace },
      "Cache version read failed; using the database",
    );
    return undefined;
  }
}

// Makes every list key in the namespace unreachable at once; old keys expire on their own (no SCAN).
export async function bumpVersion(namespace) {
  try {
    await getRedis().incr(keys.cacheVersion(namespace));
  } catch (err) {
    log.warn(
      { err, namespace },
      "Cache version bump failed; lists may be stale until their TTL",
    );
  }
}

const isPlainObject = (v) =>
  v !== null &&
  typeof v === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

// Sorted keys, undefined dropped: the same filters in any order give the same cache key.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => [k, canonical(value[k])]),
  );
}

export const hashQuery = (query) =>
  createHash("sha1")
    .update(JSON.stringify(canonical(query)))
    .digest("hex");

// ── Resources and catalogues ────────────────────────────────────────────────

// `query` is the validated list query (filters + pagination), not the raw req.query.
export async function cachedResourceList(query, loader) {
  const version = await currentVersion("resources");
  if (version === undefined) return loader();
  return getOrSet(
    keys.resourceList(version, hashQuery(query)),
    TTL.resourceListSeconds,
    loader,
  );
}

export const cachedResource = (resourceId, loader) =>
  getOrSet(keys.resourceDetail(resourceId), TTL.resourceDetailSeconds, loader);

// Call after any resource create, update or status change.
export async function invalidateResource(resourceId) {
  await Promise.all([
    bumpVersion("resources"),
    resourceId ? del(keys.resourceDetail(resourceId)) : undefined,
  ]);
}

export const cachedCatalogue = (name, loader) =>
  getOrSet(keys.catalogue(name), TTL.catalogueSeconds, loader);

export const invalidateCatalogue = (name) => del(keys.catalogue(name));
