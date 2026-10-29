// `npm run seed` (backend.md §9 and B-22): the 18 NIT Jamshedpur org units, the badge catalogue,
// sample resources, the demo users the judges log in as, and their bookings in every status. The data
// is in seedData.js; the bookings are told as stories in seedBookings.js.
//
// Idempotent: org units are matched by code, badges by code, users by email and resources by unit
// and title. Each run puts every field seedData.js defines back to its value and leaves everything
// else alone, so a second run writes nothing there, and a run after a demo resets the golden path
// (frontend.md §11): the student lacks 3D Printing Basics again, the printer is active again.
// The demo bookings are the exception: each run removes the ones the last run seeded and makes them
// again from the new now, so "upcoming" stays upcoming (seedBookings.js). Nothing else that isn't
// seed data is deleted. The other delete is a demo user's badge row that the spec doesn't give them
// (the audit log keeps it).
//
// Managers go through setOrgUnitManagers, the only writer of OrgUnit.managers and
// User.managedOrgUnits (progress.md §6.8), so the two stay in sync and a unit's real managers stay.
// The seed's own writes bypass the services, so it audits them as the system and then clears the
// caches they feed (progress.md §6.9): cache:orgunits, cache:badges and the resource caches.
//
// Usage: cd server && npm run seed. Needs MONGODB_URI and SEED_PASSWORD (server/.env). REDIS_URL is
// optional: without Redis the caches simply expire within their TTL (architecture.md §10), but the
// demo bookings are skipped, because creating and approving a booking takes the Redis resource lock.
// Run it while the API is stopped or idle: the bookings' history is written with past timestamps,
// and a sweep running in between could move a booking on before its story does (it is then skipped
// with a warning; run the seed again).
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { connectRedis, disconnectRedis } from "../src/config/redis.js";
import { log as appLog, setLogger } from "../src/lib/log.js";
import { keys } from "../src/lib/redisKeys.js";
import { DAY } from "../src/lib/time.js";
import {
  Badge,
  OrgUnit,
  Resource,
  User,
  UserBadge,
} from "../src/models/index.js";
import { SYSTEM_ACTOR, record } from "../src/services/auditService.js";
import {
  bumpVersion,
  canonicalJSON,
  del,
  invalidateCatalogue,
} from "../src/services/cacheService.js";
import { setOrgUnitManagers } from "../src/services/orgUnitService.js";
import { seedBookings } from "./seedBookings.js";
import {
  BADGES,
  DEMO_USERS,
  ORG_UNITS,
  RESOURCES,
  demoEmail,
} from "./seedData.js";

// architecture.md §7.1: bcrypt with cost 12; passwords of 8–72 characters with a letter and a digit.
export const BCRYPT_COST = 12;

// → why the password can't be used, or null. 72 is bcrypt's limit in bytes, not characters.
export function passwordProblem(password) {
  if (typeof password !== "string" || password === "")
    return "SEED_PASSWORD is not set.";
  if (password.length < 8)
    return "SEED_PASSWORD must be at least 8 characters.";
  if (Buffer.byteLength(password, "utf8") > 72)
    return "SEED_PASSWORD can be at most 72 bytes long (bcrypt's limit).";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    return "SEED_PASSWORD needs at least one letter and one digit.";
  return null;
}

const tally = () => ({ created: 0, updated: 0, unchanged: 0 });
const describeTally = (t) =>
  Object.entries(t)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
const ids = (list) => (list ?? []).map(String);
const sameSet = (a, b) => {
  const left = new Set(ids(a));
  const right = new Set(ids(b));
  return left.size === right.size && [...left].every((id) => right.has(id));
};

// Values compare as canonical JSON, so ObjectIds, Dates and nested objects compare by content and
// a run that would write the same values writes nothing (no new updatedAt either).
const sameValue = (a, b) =>
  canonicalJSON(a ?? null) === canonicalJSON(b ?? null);

// Finds the document by `filter` and makes the fields from fieldsFor(existing) hold. The spec is
// cast through the model first, so "the same value" means the same value as stored. Saving runs
// the model's validators and hooks (a resource's slug is made on its first save).
// → { doc, created, changed: the field names written }.
async function upsert(Model, filter, fieldsFor, { select, counts }) {
  const query = Model.findOne(filter);
  const existing = await (select ? query.select(select) : query);
  const fields = await fieldsFor(existing);
  const candidate = new Model({ ...filter, ...fields });
  if (!existing) {
    await candidate.save();
    counts.created++;
    return { doc: candidate, created: true, changed: Object.keys(fields) };
  }
  const want = candidate.toObject();
  const have = existing.toObject();
  const changed = Object.keys(fields).filter(
    (field) => !sameValue(have[field], want[field]),
  );
  if (!changed.length) {
    counts.unchanged++;
    return { doc: existing, created: false, changed };
  }
  // set() on a nested path replaces it whole, so keys the spec leaves out are cleared too.
  for (const field of changed) existing.set(field, fields[field]);
  await existing.save();
  counts.updated++;
  return { doc: existing, created: false, changed };
}

// One audit entry per document the seed created or changed, as the system (backend.md §8.1). Field
// names only, never values: a user's entry may list passwordHash.
async function audit(entityType, { doc, created, changed }, orgUnit) {
  if (!created && !changed.length) return;
  await record({
    actor: SYSTEM_ACTOR,
    action: `${entityType}.seeded`,
    entity: { type: entityType, id: doc._id },
    orgUnit,
    reason: "npm run seed",
    meta: created ? { created: true } : { created: false, fields: changed },
  });
}

const byCode = (map, code, what) => {
  const doc = map.get(code);
  if (!doc) throw new Error(`seedData.js names an unknown ${what} "${code}".`);
  return doc._id;
};

// ── Org units and badges ────────────────────────────────────────────────────

async function seedOrgUnits(counts) {
  const units = new Map();
  for (const spec of ORG_UNITS) {
    const result = await upsert(
      OrgUnit,
      { code: spec.code },
      () => ({ name: spec.name, type: spec.type, isActive: true }),
      { counts },
    );
    await audit("org_unit", result, result.doc._id);
    units.set(spec.code, result.doc);
  }
  return units;
}

async function seedBadges(units, counts) {
  const badges = new Map();
  for (const spec of BADGES) {
    const issuer = byCode(units, spec.issuer, "org unit");
    const result = await upsert(
      Badge,
      { code: spec.code },
      () => ({
        name: spec.name,
        orgUnit: issuer,
        description: spec.description,
        validityDays: spec.validityDays,
        evidenceRequired: false,
        selfServe: spec.selfServe,
      }),
      { counts },
    );
    await audit("badge", result, issuer);
    badges.set(spec.code, result.doc);
  }
  return badges;
}

// ── Users ───────────────────────────────────────────────────────────────────

// One hash per run, made only if some user needs it: cost 12 takes a few hundred milliseconds.
// A stored hash that already matches the password at cost 12 is kept, so a re-run changes nothing.
function passwordHasher(password) {
  let fresh;
  const checked = new Map();
  return async function hashFor(current) {
    if (typeof current === "string" && current) {
      if (!checked.has(current)) {
        let matches = false;
        try {
          matches =
            bcrypt.getRounds(current) === BCRYPT_COST &&
            (await bcrypt.compare(password, current));
        } catch {
          matches = false; // not a bcrypt hash at all
        }
        checked.set(current, matches);
      }
      if (checked.get(current)) return current;
    }
    fresh ??= bcrypt.hash(password, BCRYPT_COST);
    return fresh;
  };
}

// The pending user keeps the submittedAt of their pending request, so the admin queue's order is
// stable across runs; a user put back to pending gets a new one. No ID-card image: that needs the
// upload service (architecture.md §8).
function verificationFor(spec, existing, now) {
  if (spec.verification !== "pending") return { status: spec.verification };
  const current = existing?.verification;
  return {
    status: "pending",
    submittedAt:
      current?.status === "pending" && current.submittedAt
        ? current.submittedAt
        : now,
  };
}

async function seedUsers(units, password, now, counts) {
  const hashFor = passwordHasher(password);
  const users = new Map();
  for (const spec of DEMO_USERS) {
    const result = await upsert(
      User,
      { email: demoEmail(spec.login) },
      async (existing) => ({
        name: spec.name,
        passwordHash: await hashFor(existing?.passwordHash),
        // The manager role comes with the units; setOrgUnitManagers below adds it if it's missing.
        roles: [...spec.roles],
        memberType: spec.memberType,
        department: spec.department
          ? byCode(units, spec.department, "org unit")
          : undefined,
        emailHints: spec.emailHints ? { ...spec.emailHints } : undefined,
        emailVerified: true,
        verification: verificationFor(spec, existing, now),
        strikes: 0,
        suspendedUntil: null,
        suspensionReason: undefined,
      }),
      { select: "+passwordHash", counts },
    );
    await audit("user", result);
    users.set(spec.login, result.doc);
  }
  return users;
}

// ── Managers ────────────────────────────────────────────────────────────────

// Who manages a unit in effect: its list plus anyone whose managedOrgUnits names it.
async function managersInEffect(unitId) {
  const [unit, holders] = await Promise.all([
    OrgUnit.findById(unitId, { managers: 1 }).lean(),
    User.find({ managedOrgUnits: unitId }, { _id: 1 }).lean(),
  ]);
  return [...ids(unit?.managers), ...ids(holders.map((u) => u._id))];
}

// Each unit a demo user should manage, and each unit a demo user is listed on or holds, gets its
// list rewritten as: its current managers who aren't demo users, plus the demo users the spec gives
// it. setOrgUnitManagers then syncs User.managedOrgUnits and the manager role, and writes nothing
// (and audits nothing) when they already agree.
async function seedManagers(admin, users, units, counts) {
  const demoIds = new Set([...users.values()].map((u) => String(u._id)));
  const wanted = new Map(); // unit id → demo user ids
  for (const spec of DEMO_USERS) {
    for (const code of spec.manages) {
      const unitId = String(byCode(units, code, "org unit"));
      wanted.set(unitId, [
        ...(wanted.get(unitId) ?? []),
        String(users.get(spec.login)._id),
      ]);
    }
  }
  const held = [...users.values()].flatMap((u) => ids(u.managedOrgUnits));
  const touched = await OrgUnit.find(
    {
      $or: [
        { _id: { $in: [...wanted.keys(), ...held] } },
        { managers: { $in: [...demoIds] } },
      ],
    },
    { managers: 1 },
  )
    .sort({ _id: 1 })
    .lean();

  for (const unit of touched) {
    const managerIds = [
      ...new Set([
        ...ids(unit.managers).filter((id) => !demoIds.has(id)),
        ...(wanted.get(String(unit._id)) ?? []),
      ]),
    ];
    const before = await managersInEffect(unit._id);
    await setOrgUnitManagers(admin._id, unit._id, managerIds);
    const after = await managersInEffect(unit._id);
    if (sameSet(before, after)) counts.unchanged++;
    else counts.changed++;
  }
}

// ── Resources ───────────────────────────────────────────────────────────────

async function seedResources(units, badges, admin, counts) {
  const resources = [];
  for (const spec of RESOURCES) {
    const orgUnit = byCode(units, spec.orgUnit, "org unit");
    const { weekly, slotMinutes } = spec.availability;
    const result = await upsert(
      Resource,
      { orgUnit, title: spec.title },
      (existing) => ({
        description: spec.description,
        category: spec.category,
        bookingMode: spec.bookingMode,
        quantity: spec.quantity,
        riskLevel: spec.riskLevel,
        location: { ...spec.location },
        status: "active",
        availability: {
          weekly: weekly.map((w) => ({ ...w })),
          blackouts: [],
          slotMinutes,
        },
        eligibility: {
          memberTypes: [...spec.eligibility.memberTypes],
          departments: spec.eligibility.departments.map((code) =>
            byCode(units, code, "org unit"),
          ),
          badges: spec.eligibility.badges.map((code) =>
            byCode(badges, code, "badge"),
          ),
          approvalMode: spec.eligibility.approvalMode,
        },
        limits: { ...spec.limits },
        usageRules: spec.usageRules,
        checklist: [...spec.checklist],
        // A listing the seed adopted keeps whoever created it.
        createdBy: existing?.createdBy ?? admin._id,
      }),
      { counts },
    );
    await audit("resource", result, orgUnit);
    resources.push(result.doc);
  }
  return resources;
}

// ── Badge holdings ──────────────────────────────────────────────────────────

// A holding the spec gives is left as it is while it's an active grant that hasn't expired and
// expires as the badge says (backend.md §5: expiresAt from validityDays); otherwise it's granted
// afresh from now, by the admin.
function holdingFor(existing, badge, admin, now) {
  const valid =
    existing?.status === "active" &&
    (badge.validityDays
      ? existing.expiresAt != null && existing.expiresAt > now
      : existing.expiresAt == null);
  if (valid) return { status: "active" };
  return {
    status: "active",
    decidedBy: admin._id,
    decidedAt: now,
    expiresAt: badge.validityDays
      ? new Date(now.getTime() + badge.validityDays * DAY)
      : null,
    requestedAt: undefined,
    note: undefined,
    reason: undefined,
    evidence: undefined,
  };
}

async function seedHoldings(users, badges, admin, now, counts) {
  const kept = [];
  for (const spec of DEMO_USERS) {
    const user = users.get(spec.login);
    for (const code of spec.badges) {
      byCode(badges, code, "badge");
      const badge = badges.get(code);
      const result = await upsert(
        UserBadge,
        { user: user._id, badge: badge._id },
        (existing) => holdingFor(existing, badge, admin, now),
        { counts },
      );
      await audit("user_badge", result, badge.orgUnit);
      kept.push(result.doc._id);
    }
  }

  // Any other row of a demo user is demo data from an earlier session: a request, a grant, a
  // rejection. Removing it puts the badge back to "never requested".
  const stale = await UserBadge.find(
    {
      user: { $in: [...users.values()].map((u) => u._id) },
      _id: { $nin: kept },
    },
    { user: 1, badge: 1 },
  )
    .populate("badge", "orgUnit")
    .lean();
  if (!stale.length) return;
  await UserBadge.deleteMany({ _id: { $in: stale.map((row) => row._id) } });
  counts.removed += stale.length;
  for (const row of stale) {
    await record({
      actor: SYSTEM_ACTOR,
      action: "user_badge.removed",
      entity: { type: "user_badge", id: row._id },
      orgUnit: row.badge?.orgUnit,
      reason: "npm run seed",
      meta: { user: row.user, badge: row.badge?._id ?? null },
    });
  }
}

// ── Caches ──────────────────────────────────────────────────────────────────

// The catalogues, every resource list (one version bump) and the cached detail of every resource
// that shows a seeded unit or badge (refreshResourceCaches in orgUnitService does the same for one
// unit). Each step fails open with a warning when Redis is down.
async function refreshCaches(units, badges) {
  const unitIds = [...units.values()].map((u) => u._id);
  const badgeIds = [...badges.values()].map((b) => b._id);
  const shown = await Resource.find(
    {
      $or: [
        { orgUnit: { $in: unitIds } },
        { "eligibility.departments": { $in: unitIds } },
        { "eligibility.badges": { $in: badgeIds } },
      ],
    },
    { _id: 1 },
  ).lean();
  await Promise.all([
    invalidateCatalogue("orgunits"),
    invalidateCatalogue("badges"),
    bumpVersion("resources"),
    shown.length
      ? del(...shown.map((r) => keys.resourceDetail(r._id)))
      : undefined,
  ]);
}

// ── Entry point ─────────────────────────────────────────────────────────────

// Expects MongoDB (and, if it's to clear caches, Redis) to be connected already. `now` is for tests.
// bookings: false leaves the demo bookings as they are (the CLI passes it when Redis is down, since
// booking needs the lock).
// → per collection, how many documents were created, updated or left unchanged; for bookings, how
// many earlier seeded ones were removed and how many were made (or skipped, with a warning).
export async function seed({
  password,
  log = appLog,
  now = new Date(),
  bookings = true,
} = {}) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const counts = {
    orgUnits: tally(),
    badges: tally(),
    users: tally(),
    managedUnits: { changed: 0, unchanged: 0 },
    resources: tally(),
    userBadges: { ...tally(), removed: 0 },
    ...(bookings && { bookings: { removed: 0, created: 0, skipped: 0 } }),
  };

  const units = await seedOrgUnits(counts.orgUnits);
  log.info(`Org units: ${describeTally(counts.orgUnits)}`);
  const badges = await seedBadges(units, counts.badges);
  log.info(`Badges: ${describeTally(counts.badges)}`);
  const users = await seedUsers(units, password, now, counts.users);
  log.info(`Demo users: ${describeTally(counts.users)}`);
  const admin = users.get("admin");
  await seedManagers(admin, users, units, counts.managedUnits);
  log.info(`Unit managers: ${describeTally(counts.managedUnits)}`);
  await seedResources(units, badges, admin, counts.resources);
  log.info(`Resources: ${describeTally(counts.resources)}`);
  await seedHoldings(users, badges, admin, now, counts.userBadges);
  log.info(`Badge holdings: ${describeTally(counts.userBadges)}`);
  await refreshCaches(units, badges);
  // Last: the stories need the units' managers, the resources and the borrowers' badges in place.
  if (bookings) {
    counts.bookings = await seedBookings({ now, log });
    log.info(`Demo bookings: ${describeTally(counts.bookings)}`);
  }
  return counts;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

// Connection strings carry credentials, and driver errors can quote them: every line the CLI
// prints goes through this. The database name is fine to show.
function redactor(env) {
  const secrets = [env.SEED_PASSWORD];
  for (const url of [env.MONGODB_URI, env.REDIS_URL]) {
    const userinfo = /^[a-z][a-z0-9+.-]*:\/\/([^@/?#]*)@/i.exec(url ?? "")?.[1];
    if (userinfo) {
      secrets.push(userinfo, ...userinfo.split(":"));
      for (const part of userinfo.split(":")) {
        try {
          secrets.push(decodeURIComponent(part));
        } catch {
          // not percent-encoded
        }
      }
    }
  }
  const literal = [
    ...new Set(secrets.filter((s) => typeof s === "string" && s.length >= 3)),
  ].sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text).replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^@/\s?#]*@/gi,
      "$1<credentials>@",
    );
    for (const secret of literal) out = out.split(secret).join("<redacted>");
    return out;
  };
}

// The domain modules log pino-style, log.warn({ err, ...context }, "message"); the CLI prints one
// readable line per call: the message, the context's plain values, then the error's message.
// Once Redis is known to be down, muteCacheWarnings() hides the "Cache … failed" warning every
// cache call would add, since the CLI has already said so once.
function cliLogger(redact) {
  let cacheMuted = false;
  const line = (args) => {
    const [first, ...rest] = args;
    if (typeof first !== "object" || first === null)
      return redact(args.join(" "));
    const { err, ...context } = first;
    const extras = Object.entries(context)
      .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
      .map(([k, v]) => `${k}=${v}`);
    return redact(
      `${rest.join(" ")}${extras.length ? ` (${extras.join(", ")})` : ""}` +
        (err ? `: ${err.message ?? err}` : ""),
    );
  };
  return {
    info: (...args) => console.log(line(args)),
    warn: (...args) => {
      const text = line(args);
      if (!(cacheMuted && text.startsWith("Cache ")))
        console.warn(`Warning: ${text}`);
    },
    error: (...args) => console.error(`Error: ${line(args)}`),
    muteCacheWarnings: () => {
      cacheMuted = true;
    },
  };
}

async function main() {
  // Loaded here, not at the top, so a test importing seed() never reads server/.env.
  await import("dotenv/config");
  const env = process.env;
  const redact = redactor(env);
  const cliLog = cliLogger(redact);

  const missing = ["MONGODB_URI", "SEED_PASSWORD"].filter((name) => !env[name]);
  if (missing.length) {
    console.error(
      `Seed aborted: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. ` +
        `Add ${missing.length > 1 ? "them" : "it"} to server/.env (see .env.example).`,
    );
    return 1;
  }
  const problem = passwordProblem(env.SEED_PASSWORD);
  if (problem) {
    console.error(`Seed aborted: ${problem}`);
    return 1;
  }

  setLogger(cliLog);
  try {
    const connection = await connectDb();
    console.log(`Seeding the "${connection.name}" database.`);
    const redisUp = await connectRedis();
    if (!redisUp) {
      cliLog.warn(
        "Caches can't be cleared without Redis; cached lists and catalogues expire within 10 minutes.",
      );
      cliLog.warn(
        "Demo bookings skipped: booking takes the Redis resource lock. Set REDIS_URL and run the seed again.",
      );
      cliLog.muteCacheWarnings();
    }
    await seed({
      password: env.SEED_PASSWORD,
      log: cliLog,
      bookings: redisUp,
    });
    console.log(
      `Done. Demo logins: ${DEMO_USERS.map((u) => demoEmail(u.login)).join(", ")} (password: SEED_PASSWORD).`,
    );
    return 0;
  } catch (err) {
    console.error(redact(`Seed failed: ${err?.message ?? err}`));
    return 1;
  } finally {
    await Promise.allSettled([disconnectRedis(), disconnectDb()]);
  }
}

// Run as a script (node scripts/seed.js), not imported by a test.
function invokedDirectly() {
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false; // no script path, e.g. node -e
  }
}

if (invokedDirectly()) {
  process.exitCode = await main();
}
