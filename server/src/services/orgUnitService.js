// Org units (architecture.md §6 OrgUnits table, backend.md B-07 and the OrgUnit model in §5). Anyone
// signed in reads the catalogue; only admins create, edit or staff a unit, and every change is
// audited (backend.md §8.1). Controllers pass req.user.id as actorId.
//
// The catalogue is one shared cache entry, cache:orgunits (architecture.md §10). It holds every unit,
// active or not, with its managers, so includeInactive and includeManagers filter in memory and
// every view shares the entry.
import { keys } from "../lib/redisKeys.js";
import {
  conflict,
  fromValidationError,
  invalid,
  notFound,
} from "../lib/serviceError.js";
import { Badge, OrgUnit, Resource, User } from "../models/index.js";
import { requireAdmin } from "./access.js";
import { record } from "./auditService.js";
import {
  bumpVersion,
  cachedCatalogue,
  canonicalJSON,
  del,
  invalidateCatalogue,
} from "./cacheService.js";
import { isId, requireUser } from "./params.js";

const CATALOGUE = "orgunits";
const CATALOGUE_FIELDS = {
  name: 1,
  code: 1,
  type: 1,
  location: 1,
  managers: 1,
  isActive: 1,
};
// code is set once: messages, timelines and links name the unit by it ("Manager (DIC)").
const EDITABLE = ["name", "type", "location", "isActive"];
const CREATABLE = ["name", "code", ...EDITABLE];
const MAX_MANAGERS = 50;
// Rounds of "sync the users, re-read the unit" before giving up while other admins keep changing it.
const MAX_SYNC_ROUNDS = 3;

const LOCKED = {
  code: "An org unit's code can't change.",
  managers: "Managers are assigned separately.",
};

const changedMeanwhile = () =>
  conflict("Someone else changed this unit's managers. Reload and try again.");

const requireAdminActor = async (actorId) =>
  requireAdmin(
    await requireUser(actorId),
    "Only an admin can manage org units.",
  );

async function findUnit(orgUnitId, { lean = true } = {}) {
  if (!isId(orgUnitId)) throw notFound("Org unit");
  const query = OrgUnit.findById(orgUnitId);
  const unit = await (lean ? query.lean() : query);
  if (!unit) throw notFound("Org unit");
  return unit;
}

// undefined means "not sent": unit.set({ name: undefined }) would otherwise clear the field.
function definedFields(input) {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw invalid("Expected an object of org unit fields.");
  }
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

const sameCode = (sent, code) =>
  typeof sent === "string" && sent.trim().toLowerCase() === code;

// Other keys are refused, not dropped, so managers can't be set without the user sync below and a
// mistyped field doesn't look saved. Resending the unit's current code is allowed, for edit forms.
function assertFields(fields, allowed, current) {
  const details = Object.keys(fields)
    .filter((path) => !allowed.includes(path))
    .filter(
      (path) =>
        !(path === "code" && current && sameCode(fields.code, current.code)),
    )
    .map((path) => ({
      path,
      message: LOCKED[path] ?? "This field can't be set.",
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (details.length) {
    throw invalid(
      details.length === 1
        ? "1 field can't be set here."
        : `${details.length} fields can't be set here.`,
      details,
    );
  }
  // Mongoose silently ignores a string or list assigned to a nested path, which would pass as saved.
  const { location } = fields;
  if (
    location !== undefined &&
    location !== null &&
    (typeof location !== "object" || Array.isArray(location))
  ) {
    throw invalid("1 field is invalid.", [
      { path: "location", message: "Must be an object." },
    ]);
  }
}

// E11000 can only come from the unique code index; checking it there means two admins racing to
// create the same code can't both succeed. A 400 on the code field, so the form marks it (§8.3).
function saveError(err, code) {
  if (err?.code !== 11000) return fromValidationError(err);
  return invalid(`An org unit with the code "${code}" already exists.`, [
    { path: "code", message: "Already used by another org unit." },
  ]);
}

const editable = (unit) => {
  const plain = unit.toObject();
  return Object.fromEntries(EDITABLE.map((f) => [f, plain[f] ?? null]));
};

// Resource lists and cached details show a unit's name three ways: as the owner (with its code and
// type), as a department in the eligibility rules, and as the issuer of a required badge. A rename,
// a new type, a deactivation or a new set of managers must not wait out their TTLs.
async function refreshResourceCaches(orgUnitId) {
  const badges = await Badge.find({ orgUnit: orgUnitId }, { _id: 1 }).lean();
  const resources = await Resource.find(
    {
      $or: [
        { orgUnit: orgUnitId },
        { "eligibility.departments": orgUnitId },
        { "eligibility.badges": { $in: badges.map((b) => b._id) } },
      ],
    },
    { _id: 1 },
  ).lean();
  await Promise.all([
    bumpVersion("resources"),
    resources.length &&
      del(...resources.map((r) => keys.resourceDetail(r._id))),
  ]);
}

const adminActor = (actor) => ({ id: actor._id, role: "admin" });

// ── Catalogue ───────────────────────────────────────────────────────────────

// GET /org-units → units sorted by name. Both options are for admin screens and count only as a
// literal true, so an unparsed "false" from a query string can't turn them on: includeInactive adds
// deactivated units, includeManagers keeps each unit's manager ids, which members have no use for
// (architecture.md §16 "Least data").
export async function listOrgUnits({
  includeInactive = false,
  includeManagers = false,
} = {}) {
  const units = await cachedCatalogue(CATALOGUE, () =>
    OrgUnit.find({}, CATALOGUE_FIELDS).sort({ name: 1 }).lean(),
  );
  const shown =
    includeInactive === true
      ? units
      : units.filter((unit) => unit.isActive !== false);
  if (includeManagers === true) return shown;
  return shown.map(({ managers, ...unit }) => unit);
}

// ── Admin changes ───────────────────────────────────────────────────────────

// POST /org-units. input: { name, code, type, location?, isActive? }; managers come from
// setOrgUnitManagers. Throws 400 VALIDATION_ERROR (including a code already in use) or 403.
export async function createOrgUnit(actorId, input, { requestId } = {}) {
  const actor = await requireAdminActor(actorId);
  const fields = definedFields(input);
  assertFields(fields, CREATABLE);

  const unit = new OrgUnit(fields);
  await unit.save().catch((err) => {
    throw saveError(err, unit.code);
  });
  const created = unit.toObject();

  await invalidateCatalogue(CATALOGUE);
  await record({
    actor: adminActor(actor),
    action: "org_unit.created",
    entity: { type: "org_unit", id: created._id },
    orgUnit: created._id,
    changes: Object.fromEntries(
      CREATABLE.filter((f) => created[f] !== undefined).map((f) => [
        f,
        [null, created[f]],
      ]),
    ),
    requestId,
  });
  return created;
}

// PATCH /org-units/:id. patch: any of name, type, location (replaced as a whole), isActive.
// Throws 400 VALIDATION_ERROR (including any attempt to change code or managers), 403 or 404.
export async function updateOrgUnit(
  actorId,
  orgUnitId,
  patch,
  { requestId } = {},
) {
  const actor = await requireAdminActor(actorId);
  const unit = await findUnit(orgUnitId, { lean: false });
  const fields = definedFields(patch);
  assertFields(fields, EDITABLE, unit);
  delete fields.code; // the current code, which assertFields allowed through

  const before = editable(unit);
  unit.set(fields);
  // Validate before comparing: a value Mongoose can't cast leaves the field as it was, so a bad
  // isActive would otherwise look like "nothing changed" and succeed.
  await unit.validate().catch((err) => {
    throw fromValidationError(err);
  });
  const after = editable(unit);
  const changes = Object.fromEntries(
    EDITABLE.filter(
      (f) => canonicalJSON(before[f]) !== canonicalJSON(after[f]),
    ).map((f) => [f, [before[f], after[f]]]),
  );
  if (!Object.keys(changes).length) return unit.toObject();

  await unit.save().catch((err) => {
    throw fromValidationError(err);
  });
  const updated = unit.toObject();

  await Promise.all([
    invalidateCatalogue(CATALOGUE),
    (changes.name || changes.type || changes.isActive) &&
      refreshResourceCaches(unit._id),
  ]);
  await record({
    actor: adminActor(actor),
    action: "org_unit.updated",
    entity: { type: "org_unit", id: unit._id },
    orgUnit: unit._id,
    changes,
    requestId,
  });
  return updated;
}

// → the ids as lower-case hex strings, de-duplicated, in the order given. Each must be an existing
// user; otherwise 400 with one detail per bad entry, at its index in managerIds.
async function resolveManagers(managerIds) {
  if (!Array.isArray(managerIds)) {
    throw invalid("managerIds must be a list of user ids.", [
      { path: "managerIds", message: "Must be a list of user ids." },
    ]);
  }
  const firstIndex = new Map();
  const bad = [];
  managerIds.forEach((raw, index) => {
    if (!isId(raw)) {
      bad.push({ index, message: "Must be a valid id." });
      return;
    }
    const id = String(raw._id ?? raw).toLowerCase();
    if (!firstIndex.has(id)) firstIndex.set(id, index);
  });
  if (firstIndex.size > MAX_MANAGERS) {
    throw invalid(`A unit can have at most ${MAX_MANAGERS} managers.`, [
      { path: "managerIds", message: `At most ${MAX_MANAGERS} managers.` },
    ]);
  }

  const ids = [...firstIndex.keys()];
  const users = await User.find({ _id: { $in: ids } }, { _id: 1 }).lean();
  const found = new Set(users.map((u) => String(u._id)));
  for (const id of ids) {
    if (!found.has(id)) {
      bad.push({
        index: firstIndex.get(id),
        message: `No user has the id ${id}.`,
      });
    }
  }
  if (bad.length) {
    throw invalid(
      bad.length === 1
        ? "1 manager id isn't a user."
        : `${bad.length} manager ids aren't users.`,
      bad
        .sort((a, b) => a.index - b.index)
        .map(({ index, message }) => ({
          path: `managerIds.${index}`,
          message,
        })),
    );
  }
  return ids;
}

const sameIds = (a, b) => {
  const left = new Set(a.map(String));
  const right = new Set(b.map(String));
  return left.size === right.size && [...left].every((id) => right.has(id));
};

const listedManagers = async (orgUnitId) =>
  (
    (await OrgUnit.findById(orgUnitId, { managers: 1 }).lean())?.managers ?? []
  ).map(String);

// Brings the users in line with `managers`, the unit's list as stored: each of them holds the unit
// and the manager role, and nobody else holds the unit. Worked out from the database, not from a
// diff, so running it again repairs whatever a failed run left behind. `formerly` are users who may
// have lost the unit already but not yet the role.
//
// The manager role goes only once a user manages no unit at all, and no other role is touched, so
// an admin stays an admin. A user whose only role was manager falls back to the schema's default,
// because a user needs at least one role. → how many users changed.
async function syncUsers(orgUnitId, managers, formerly) {
  const holders = await User.find(
    { managedOrgUnits: orgUnitId, _id: { $nin: managers } },
    { _id: 1 },
  ).lean();
  const removed = [
    ...new Set([
      ...holders.map((u) => String(u._id)),
      ...formerly.filter((id) => !managers.includes(id)),
    ]),
  ];
  // Each filter matches only users the update would change: timestamps adds updatedAt to every
  // update, so modifiedCount would otherwise count users who were already in step.
  const add = () =>
    User.updateMany(
      {
        _id: { $in: managers },
        $or: [
          { managedOrgUnits: { $ne: orgUnitId } },
          { roles: { $ne: "manager" } },
        ],
      },
      { $addToSet: { managedOrgUnits: orgUnitId, roles: "manager" } },
    );
  const remove = async () => [
    await User.updateMany(
      { _id: { $in: removed }, managedOrgUnits: orgUnitId },
      { $pull: { managedOrgUnits: orgUnitId } },
    ),
    await User.updateMany(
      {
        _id: { $in: removed },
        managedOrgUnits: { $size: 0 },
        roles: "manager",
      },
      { $pull: { roles: "manager" } },
    ),
    await User.updateMany(
      { _id: { $in: removed }, roles: { $size: 0 } },
      { $set: { roles: ["member"] } },
    ),
  ];
  // Both finish before a failure is reported, so nothing is still writing when the caller retries.
  const settled = await Promise.allSettled([
    managers.length ? add() : null,
    removed.length ? remove() : [],
  ]);
  const failed = settled.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  return settled
    .flatMap((r) => r.value ?? [])
    .reduce((n, result) => n + (result?.modifiedCount ?? 0), 0);
}

// Syncs to the unit's list, then reads it again. If another admin replaced it meanwhile, this run's
// writes may have landed after theirs, so it syncs to their list too: whoever finishes last leaves
// the users agreeing with the unit. → how many users changed.
async function reconcileUsers(orgUnitId, formerly) {
  let managers = await listedManagers(orgUnitId);
  let changed = 0;
  for (let round = 1; ; round++) {
    changed += await syncUsers(orgUnitId, managers, formerly);
    const latest = await listedManagers(orgUnitId);
    if (sameIds(latest, managers)) return changed;
    if (round === MAX_SYNC_ROUNDS) throw changedMeanwhile();
    managers = latest;
  }
}

// PUT /org-units/:id/managers. Makes managerIds the unit's managers, and User.managedOrgUnits and the
// manager role agree with it. Throws 400 VALIDATION_ERROR, 403, 404, or 409 INVALID_TRANSITION if
// another admin changed the list since it was read. New roles reach a user's access token on its
// next refresh.
//
// The unit and its users are separate writes (no transaction), so the user sync is idempotent and
// runs on every call: if it fails part-way, calling again with the same list finishes it.
export async function setOrgUnitManagers(
  actorId,
  orgUnitId,
  managerIds,
  { requestId } = {},
) {
  const actor = await requireAdminActor(actorId);
  const unit = await findUnit(orgUnitId);
  const wanted = await resolveManagers(managerIds);
  const listed = (unit.managers ?? []).map(String);
  // Who manages the unit in effect: its list, plus anyone whose managedOrgUnits still names it. The
  // audit's "before" is this, so access that outlived the list shows when it is taken away.
  const holders = await User.find(
    { managedOrgUnits: unit._id },
    { _id: 1 },
  ).lean();
  const before = [
    ...new Set([...listed, ...holders.map((u) => String(u._id))]),
  ];
  const recordChange = async () => {
    await Promise.all([
      invalidateCatalogue(CATALOGUE),
      refreshResourceCaches(unit._id),
    ]);
    await record({
      actor: adminActor(actor),
      action: "org_unit.managers_changed",
      entity: { type: "org_unit", id: unit._id },
      orgUnit: unit._id,
      changes: { managers: [before, wanted] },
      requestId,
    });
  };

  if (sameIds(listed, wanted)) {
    // Nothing to write on the unit, but a call that failed part-way may have left users behind.
    if (await reconcileUsers(unit._id, before)) await recordChange();
    return unit;
  }

  // Conditional on the list that was read, so an admin working from a stale list gets a 409 instead
  // of replacing someone else's change unseen.
  const updated = await OrgUnit.findOneAndUpdate(
    { _id: unit._id, managers: unit.managers ?? null },
    { $set: { managers: wanted } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw changedMeanwhile();
  // Recorded once the unit's list, which is the change, is written; the user sync after it repairs
  // itself on a retry.
  await recordChange();
  await reconcileUsers(unit._id, before);
  return updated;
}
