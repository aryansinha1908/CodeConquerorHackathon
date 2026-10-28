// Resources: browsing, detail, availability, the eligibility checklist and the manager's listing form
// (architecture.md §6 Resources and §10.2, backend.md B-07/B-08 and §5, frontend.md §6). Controllers
// pass the Zod-validated input and req.user.id.
//
// Lists and details are cached for everyone, so they never hold per-user data: eligibleOnly
// filtering and canManage are worked out after the cache. Availability and eligibility aren't cached.
// Every write is audited after it succeeds and invalidates through invalidateResource().
import mongoose from "mongoose";
import { busySegments, openWindows } from "../engines/availability.js";
import { describeOpenHours, evaluateMember } from "../engines/eligibility.js";
import {
  ACTIVE_STATUSES,
  SLOT_HOLDING_STATUSES,
} from "../engines/stateMachine.js";
import {
  conflict,
  fieldError,
  forbidden,
  fromValidationError,
  invalid,
  notFound,
} from "../lib/serviceError.js";
import { DAY, istParts } from "../lib/time.js";
import {
  BOOKING_STATUSES,
  MEMBER_TYPES,
  RESOURCE_CATEGORIES,
  RESOURCE_STATUSES,
} from "../models/enums.js";
import {
  Badge,
  Booking,
  OrgUnit,
  Resource,
  UserBadge,
} from "../models/index.js";
import {
  auditRole,
  isAdmin,
  managesUnit,
  requireUnitManager,
} from "./access.js";
import { record } from "./auditService.js";
import { loadResource, memberContext } from "./bookingContext.js";
import { checkBooking } from "./bookingService.js";
import {
  cachedResource,
  cachedResourceList,
  canonicalJSON,
  invalidateResource,
} from "./cacheService.js";
import {
  absent,
  assertValid,
  isId,
  isPlainObject,
  readEnum,
  readEnumList,
  readFlag,
  readId,
  readInstant,
  readPaging,
  readText,
  requireUser,
} from "./params.js";

const ELIGIBLE_CAP = 200;
const MAX_RANGE_DAYS = 14;
const MAX_QUERY_LENGTH = 100;
const MAX_REASON_LENGTH = 500;

// What the listing form may change (plan "Update rules"). The others belong to someone else:
// orgUnit is fixed for life, status has its own audited action, slug and createdBy are the server's.
const EDITABLE_FIELDS = [
  "title",
  "description",
  "images",
  "category",
  "bookingMode",
  "quantity",
  "riskLevel",
  "location",
  "availability",
  "eligibility",
  "limits",
  "usageRules",
  "checklist",
];
const REFUSED = {
  orgUnit: "A resource can't move to another unit.",
  status: "Change the status with the status action, which asks for a reason.",
};

// Cards need no rules text, checklist or closures; leaving them out keeps the cached lists small.
// createdBy is a user id that members have no use for (architecture.md §16 "Least data"); the audit
// log already says who listed a resource.
const CARD_FIELDS =
  "-__v -usageRules -checklist -availability.blackouts -createdBy";
const DETAIL_FIELDS = "-__v -createdBy";

// What Redis hands back: ids and dates as strings. Loaders return the same, so a cache hit and a
// miss look identical to callers.
const plain = (value) => JSON.parse(JSON.stringify(value));

const withOpenHours = (resource) => ({
  ...resource,
  openHours: describeOpenHours(resource.availability?.weekly ?? []),
});

// Populated the way the cards and the engine's messages need them ("Request it from Design and
// Innovation Centre"). orgUnit.managers stays out: members have no use for the managers' ids.
const withRefs = (query) =>
  query
    .populate("orgUnit", "name code type")
    .populate("eligibility.departments", "code name")
    .populate({
      path: "eligibility.badges",
      select: "name code orgUnit",
      populate: { path: "orgUnit", select: "name" },
    })
    .lean();

async function loadDetail(resourceId) {
  const doc = await withRefs(
    Resource.findById(resourceId).select(DETAIL_FIELDS),
  );
  return doc && plain(withOpenHours(doc));
}

const cachedDetail = (resourceId) =>
  cachedResource(String(resourceId), () => loadDetail(resourceId));

// The unit's managers and admins may act on its resources. Anyone else gets 403, or 404 for an
// archived resource, which stays hidden from them everywhere else too.
function requireManaged(actor, resource, message) {
  if (!resource) throw notFound("Resource");
  if (resource.status === "archived" && !managesUnit(actor, resource.orgUnit))
    throw notFound("Resource");
  requireUnitManager(actor, resource.orgUnit, message);
}

// ── Parameter checks ────────────────────────────────────────────────────────

// "2026-11-03" is a calendar day in IST. A Date (z.coerce.date() gives UTC midnight) counts as the
// IST day it falls on. Only the weekday matters, so it is all that goes into the cache key.
function readWeekday(value, problems) {
  if (absent(value)) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return istParts(value).day;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const noon = new Date(`${value}T12:00:00+05:30`);
    // JS rolls "2026-02-31" over to 3 March; the round trip catches it.
    if (!Number.isNaN(noon.getTime()) && istParts(noon).dateKey === value)
      return istParts(noon).day;
  }
  problems.push({ path: "date", message: "Must be a date as YYYY-MM-DD." });
  return undefined;
}

// ── Browse ──────────────────────────────────────────────────────────────────

// Members only ever see active resources. Once any other status is asked for, a manager sees just
// their own units and an admin every unit; the result is the scope that goes into the cache key.
function listScope(viewer, statuses, orgUnit) {
  if (statuses.every((s) => s === "active")) return undefined;
  if (isAdmin(viewer)) return "all";
  if (!viewer.roles?.includes("manager"))
    throw forbidden("Only managers can list resources that aren't active.");
  const units = (viewer.managedOrgUnits ?? []).map(String).sort();
  if (orgUnit && !units.includes(orgUnit))
    throw forbidden(
      "You can only list your own units' resources that aren't active.",
    );
  return units;
}

function listFilter(
  { status, q, category, orgUnit, memberType, weekday },
  scope,
) {
  return {
    status: Array.isArray(status) ? { $in: status } : status,
    ...(q && { $text: { $search: q } }),
    ...(category && { category }),
    ...(orgUnit
      ? { orgUnit }
      : Array.isArray(scope) && { orgUnit: { $in: scope } }),
    // An empty or missing list means open to every member type, as engines/eligibility.js reads it.
    ...(memberType && {
      $or: [
        { "eligibility.memberTypes": memberType },
        { "eligibility.memberTypes": { $size: 0 } },
        { "eligibility.memberTypes": null },
      ],
    }),
    ...(weekday !== undefined && { "availability.weekly.day": weekday }),
  };
}

// The member rules of the detail checklist, run over the shared list for one viewer: one query for
// their badges and one aggregate for their active bookings per resource.
async function eligibleFor(viewer, resources, now) {
  if (!resources.length) return [];
  const [userBadges, counts] = await Promise.all([
    UserBadge.find(
      { user: viewer._id },
      { badge: 1, status: 1, expiresAt: 1 },
    ).lean(),
    // Aggregations aren't cast, so the cached string ids become ObjectIds here.
    Booking.aggregate([
      {
        $match: {
          borrower: viewer._id,
          resource: {
            $in: resources.map((r) => new mongoose.Types.ObjectId(r._id)),
          },
          status: { $in: ACTIVE_STATUSES },
        },
      },
      { $group: { _id: "$resource", count: { $sum: 1 } } },
    ]),
  ]);
  const active = new Map(counts.map((c) => [String(c._id), c.count]));
  return resources.filter(
    (resource) =>
      evaluateMember(viewer, resource, {
        now,
        userBadges,
        activeCount: active.get(String(resource._id)) ?? 0,
      }).eligible,
  );
}

// GET /resources. query: { q, category, orgUnit, memberType, date, status, page, limit, eligibleOnly }
// → { items, meta: { page, limit, total } }; with eligibleOnly, meta.capped says whether the shared
// list hit its 200-resource cap before filtering. status may list several (see readStatuses).
export async function listResources(
  viewerId,
  query = {},
  { now = new Date() } = {},
) {
  const viewer = await requireUser(viewerId);
  const problems = [];
  const statuses = readEnumList(
    query.status,
    RESOURCE_STATUSES,
    "status",
    problems,
  ) ?? ["active"];
  const filters = {
    // A single status stays a string, so its filter and cache key are as before.
    status: statuses.length === 1 ? statuses[0] : statuses,
    q: readText(query.q, "q", problems, { max: MAX_QUERY_LENGTH }),
    category: readEnum(
      query.category,
      RESOURCE_CATEGORIES,
      "category",
      problems,
    ),
    orgUnit: readId(query.orgUnit, "orgUnit", problems),
    memberType: readEnum(
      query.memberType,
      MEMBER_TYPES,
      "memberType",
      problems,
    ),
    weekday: readWeekday(query.date, problems),
  };
  const { page, limit } = readPaging(query, problems);
  const eligibleOnly = readFlag(query.eligibleOnly, "eligibleOnly", problems);
  assertValid(problems);

  // The scope is part of every key: two managers asking for "maintenance" each get their own units.
  const scope = listScope(viewer, statuses, filters.orgUnit);
  const filter = listFilter(filters, scope);
  const find = () =>
    withRefs(
      Resource.find(filter)
        .select(CARD_FIELDS)
        .sort(
          filters.q
            ? { score: { $meta: "textScore" }, title: 1, _id: 1 }
            : { title: 1, _id: 1 },
        ),
    );

  if (!eligibleOnly) {
    const { items, total } = await cachedResourceList(
      { ...filters, scope, page, limit },
      async () => {
        const [docs, count] = await Promise.all([
          find()
            .skip((page - 1) * limit)
            .limit(limit),
          Resource.countDocuments(filter),
        ]);
        return plain({ items: docs.map(withOpenHours), total: count });
      },
    );
    return { items, meta: { page, limit, total } };
  }

  // The same list for everyone who asks with these filters, then narrowed for this viewer.
  const base = await cachedResourceList(
    { ...filters, scope, eligibleOnly: true, cap: ELIGIBLE_CAP },
    async () => {
      const [docs, count] = await Promise.all([
        find().limit(ELIGIBLE_CAP),
        Resource.countDocuments(filter),
      ]);
      return plain({
        items: docs.map(withOpenHours),
        capped: count > ELIGIBLE_CAP,
      });
    },
  );
  const eligible = await eligibleFor(viewer, base.items, now);
  return {
    items: eligible.slice((page - 1) * limit, page * limit),
    meta: { page, limit, total: eligible.length, capped: base.capped },
  };
}

// GET /resources/:id → the populated resource plus openHours and the viewer's canManage.
// Archived resources are 404 to everyone but the unit's managers, who may restore them.
export async function getResource(viewerId, resourceId) {
  if (!isId(resourceId)) throw notFound("Resource");
  const [viewer, resource] = await Promise.all([
    requireUser(viewerId),
    cachedDetail(resourceId),
  ]);
  if (!resource) throw notFound("Resource");
  const canManage = managesUnit(viewer, resource.orgUnit);
  if (resource.status === "archived" && !canManage) throw notFound("Resource");
  return { ...resource, canManage };
}

// GET /resources/:id/availability → { quantity, openWindows, busy } for [from, to), at most 14 days.
// busy says how many units are held, never by whom (architecture.md §16 "Least data").
// No viewer here, so archived resources are 404 for everyone; managers have the bookings list.
export async function getAvailability(resourceId, { from, to } = {}) {
  if (!isId(resourceId)) throw notFound("Resource");
  const problems = [];
  const start = readInstant(from, "from", problems, { required: true });
  const end = readInstant(to, "to", problems, { required: true });
  if (start && end && !(start < end))
    problems.push({ path: "to", message: "Must be after from." });
  else if (start && end && end - start > MAX_RANGE_DAYS * DAY)
    problems.push({
      path: "to",
      message: `The range can be at most ${MAX_RANGE_DAYS} days.`,
    });
  assertValid(problems);

  const resource = await Resource.findById(resourceId, {
    status: 1,
    quantity: 1,
    availability: 1,
  }).lean();
  if (!resource || resource.status === "archived") throw notFound("Resource");
  const holders = await Booking.find(
    {
      resource: resource._id,
      status: { $in: SLOT_HOLDING_STATUSES },
      start: { $lt: end },
      end: { $gt: start },
    },
    { _id: 0, start: 1, end: 1 },
  ).lean();
  const quantity = resource.quantity ?? 1;
  return {
    quantity,
    openWindows: openWindows(
      resource.availability?.weekly,
      resource.availability?.blackouts,
      start,
      end,
    ),
    busy: busySegments(holders, start, end, quantity),
  };
}

// GET /resources/:id/eligibility. With a slot it is POST /bookings/check (the same 12 rules); without
// one, the member rules plus quota { hoursThisWeek, maxHoursPerWeek, activeCount, maxActiveBookings }
// for the quota meter, counted over the IST week containing `now`.
export async function getEligibility(
  viewerId,
  resourceId,
  { start, end } = {},
  { now } = {},
) {
  if (!isId(resourceId)) throw notFound("Resource");
  const problems = [];
  const hasSlot = !absent(start) || !absent(end);
  const slot = hasSlot && {
    start: readInstant(start, "start", problems, { required: true }),
    end: readInstant(end, "end", problems, { required: true }),
  };
  assertValid(problems);

  const [viewer, resource] = await Promise.all([
    requireUser(viewerId),
    loadResource(resourceId),
  ]);
  if (
    !resource ||
    (resource.status === "archived" && !managesUnit(viewer, resource.orgUnit))
  )
    throw notFound("Resource");
  if (slot)
    return checkBooking(
      viewer._id,
      { resourceId: resource._id, ...slot },
      { now },
    );

  const ctx = await memberContext(viewer, resource, { now });
  return {
    ...evaluateMember(viewer, resource, ctx),
    quota: {
      hoursThisWeek: ctx.hoursThisWeek,
      maxHoursPerWeek: resource.limits?.maxHoursPerWeek ?? null,
      activeCount: ctx.activeCount,
      maxActiveBookings: resource.limits?.maxActiveBookings ?? null,
    },
  };
}

// ── Listing form ────────────────────────────────────────────────────────────

// A list entry Mongoose would store as it is: it saves null and non-object entries in a list of
// subdocuments, and null in a list of strings, and every later describeOpenHours() or openWindows()
// over them throws. Ids are left to checkRefs, which names each bad one.
function listEntryProblem(schemaType, entry) {
  if (schemaType.$isMongooseDocumentArray)
    return entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? undefined
      : "Must be an object.";
  if (schemaType.embeddedSchemaType?.instance === "String")
    return typeof entry === "string" ? undefined : "Must be text.";
  return undefined;
}

// null clears a list to [], the schema's own "none": stored as null it would trip maxItems and the
// member-type filter. Otherwise a list must be an array of well-formed entries.
function checkLists(paths, problems) {
  for (const [path, value] of Object.entries(paths)) {
    const schemaType = Resource.schema.path(path);
    if (schemaType?.instance !== "Array") continue;
    if (value === null) {
      paths[path] = [];
    } else if (!Array.isArray(value)) {
      problems.push({ path, message: "Must be a list." });
    } else {
      // A counted loop, so holes in a sparse array are checked too.
      for (let i = 0; i < value.length; i++) {
        const message = listEntryProblem(schemaType, value[i]);
        if (message) problems.push({ path: `${path}.${i}`, message });
      }
    }
  }
}

// The form's fields as schema paths. A nested object sets only the keys it names
// ("limits.maxHoursPerWeek"), so a partial PATCH doesn't wipe the rest of that section; arrays are
// replaced whole. Anything outside the whitelist is refused rather than dropped, so a client can't
// set status, slug or createdBy this way and learns why.
function formPaths(input, { creating }) {
  if (!isPlainObject(input))
    throw invalid("Send the resource's fields as an object.");
  const problems = [];
  const paths = {};
  for (const [field, value] of Object.entries(input)) {
    if (field === "orgUnit" && creating) {
      paths.orgUnit = value;
    } else if (!EDITABLE_FIELDS.includes(field)) {
      problems.push({
        path: field,
        message: REFUSED[field] ?? "This field can't be set.",
      });
    } else if (Resource.schema.pathType(field) !== "nested") {
      paths[field] = value;
    } else if (!isPlainObject(value)) {
      problems.push({ path: field, message: "Must be an object." });
    } else {
      for (const [key, inner] of Object.entries(value)) {
        const path = `${field}.${key}`;
        // Only the section's own keys. "weekly.0" or "badges.$" are real paths too, but they reach
        // inside a list, past checkLists and checkRefs.
        if (!key.includes(".") && Resource.schema.pathType(path) === "real")
          paths[path] = inner;
        else problems.push({ path, message: "This field can't be set." });
      }
    }
  }
  checkLists(paths, problems);
  assertValid(problems, "field");
  return paths;
}

// Each listed id must name a document. Per-index paths let the form mark the exact entry.
async function missingRefs(Model, value, path, message) {
  if (value === undefined) return [];
  const ids = Array.isArray(value) ? value : value === null ? [] : [value];
  const found = new Set(
    (
      await Model.find({ _id: { $in: ids.filter(isId) } }, { _id: 1 }).lean()
    ).map((doc) => String(doc._id)),
  );
  // Array.from turns holes into undefined, so a sparse list is checked entry by entry too.
  return Array.from(ids).flatMap((id, i) => {
    if (!isId(id))
      return [{ path: `${path}.${i}`, message: "Must be a valid id." }];
    return found.has(String(id).toLowerCase())
      ? []
      : [{ path: `${path}.${i}`, message }];
  });
}

async function checkRefs(paths) {
  const lists = await Promise.all([
    missingRefs(
      OrgUnit,
      paths["eligibility.departments"],
      "eligibility.departments",
      "No such department.",
    ),
    missingRefs(
      Badge,
      paths["eligibility.badges"],
      "eligibility.badges",
      "No such badge.",
    ),
  ]);
  assertValid(lists.flat(), "field");
}

const saveOrExplain = (doc) =>
  doc.save().catch((err) => {
    throw fromValidationError(err);
  });

// POST /resources (a manager of input.orgUnit, or an admin). input: the listing form plus orgUnit.
// → the new resource as getResource returns it.
export async function createResource(actorId, input, { requestId } = {}) {
  const actor = await requireUser(actorId);
  const paths = formPaths(input, { creating: true });
  const unitId = paths.orgUnit;
  if (!isId(unitId)) {
    throw fieldError(
      "orgUnit",
      absent(unitId) ? "Required." : "Must be a valid id.",
    );
  }
  // Scope before existence, so a manager learns nothing about units they don't run.
  requireUnitManager(
    actor,
    unitId,
    "Only this unit's managers can list resources for it.",
  );
  const unit = await OrgUnit.findById(unitId, { isActive: 1 }).lean();
  if (!unit || unit.isActive === false) {
    throw fieldError(
      "orgUnit",
      unit ? "This unit is inactive." : "No such unit.",
    );
  }
  await checkRefs(paths);

  const doc = new Resource({ createdBy: actor._id });
  for (const [path, value] of Object.entries(paths)) doc.set(path, value);
  await saveOrExplain(doc);

  await invalidateResource(doc._id);
  await record({
    actor: { id: actor._id, role: auditRole(actor, doc.orgUnit) },
    action: "resource.created",
    entity: { type: "resource", id: doc._id },
    orgUnit: doc.orgUnit,
    changes: { title: [null, doc.title], status: [null, doc.status] },
    requestId,
  });
  return { ...(await loadDetail(doc._id)), canManage: true };
}

// The value at a top-level field as it would be stored, for the audit diff. Closures get a new _id
// whenever the form resends them, so their _ids are left out: only what they say counts as a change.
const fieldValue = (doc, field) => {
  const value = doc.get(field);
  if (value === undefined) return null;
  const json = plain(value);
  if (field === "availability" && Array.isArray(json?.blackouts))
    json.blackouts = json.blackouts.map(({ _id, ...closure }) => closure);
  return json;
};

// PATCH /resources/:id (manager*). doc.set() + save(), so every model validator runs and a bad form
// gets 400 field errors. changes are per top-level field, nested sections whole: { limits: [before,
// after] }. A patch that changes nothing is validated but writes nothing and isn't audited.
export async function updateResource(
  actorId,
  resourceId,
  patch,
  { requestId } = {},
) {
  if (!isId(resourceId)) throw notFound("Resource");
  const [actor, doc] = await Promise.all([
    requireUser(actorId),
    Resource.findById(resourceId),
  ]);
  requireManaged(actor, doc, "Only this unit's managers can edit it.");
  const paths = formPaths(patch, { creating: false });
  await checkRefs(paths);

  const fields = [...new Set(Object.keys(paths).map((p) => p.split(".")[0]))];
  const before = fields.map((field) => fieldValue(doc, field));
  for (const [path, value] of Object.entries(paths)) doc.set(path, value);
  const changes = {};
  fields.forEach((field, i) => {
    const after = fieldValue(doc, field);
    if (canonicalJSON(after) !== canonicalJSON(before[i]))
      changes[field] = [before[i], after];
  });

  // Validated even when nothing looks changed: a value that fails to cast leaves the old one in place,
  // so only validation reveals it. Saved only on a change, so resent closures keep their _ids.
  if (!Object.keys(changes).length) {
    await doc.validate().catch((err) => {
      throw fromValidationError(err);
    });
    return { ...(await loadDetail(doc._id)), canManage: true };
  }
  await saveOrExplain(doc);
  await invalidateResource(doc._id);
  await record({
    actor: { id: actor._id, role: auditRole(actor, doc.orgUnit) },
    action: "resource.updated",
    entity: { type: "resource", id: doc._id },
    orgUnit: doc.orgUnit,
    changes,
    requestId,
  });
  return { ...(await loadDetail(doc._id)), canManage: true };
}

// PATCH /resources/:id/status (manager*). A reason is required to take a resource out of service.
// Nothing is cancelled: affectedBookings (slot-holding bookings that haven't ended) lets the manager
// UI warn, and the managers decide what happens to them. → { resource, affectedBookings }
export async function setResourceStatus(
  actorId,
  resourceId,
  { status, reason } = {},
  { requestId, now = new Date() } = {},
) {
  if (!isId(resourceId)) throw notFound("Resource");
  const [actor, current] = await Promise.all([
    requireUser(actorId),
    Resource.findById(resourceId, { status: 1, orgUnit: 1 }).lean(),
  ]);
  requireManaged(
    actor,
    current,
    "Only this unit's managers can change its status.",
  );

  const problems = [];
  const next = readEnum(status, RESOURCE_STATUSES, "status", problems);
  if (absent(status)) problems.push({ path: "status", message: "Required." });
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!absent(reason) && typeof reason !== "string")
    problems.push({ path: "reason", message: "Must be text." });
  else if (next && next !== "active" && !why)
    problems.push({
      path: "reason",
      message: "Say why, so members and the audit log know.",
    });
  else if (why.length > MAX_REASON_LENGTH)
    problems.push({
      path: "reason",
      message: `Can be at most ${MAX_REASON_LENGTH} characters.`,
    });
  assertValid(problems);

  const changed = next !== current.status;
  if (changed) {
    // Conditional on the status read, so the audit entry's "before" is the one that was replaced.
    const updated = await Resource.findOneAndUpdate(
      { _id: current._id, status: current.status },
      { $set: { status: next } },
      { returnDocument: "after", projection: { _id: 1 } },
    ).lean();
    if (!updated) {
      throw conflict(
        "The status changed while you were saving. Reload and try again.",
      );
    }
  }
  const affectedBookings = await Booking.countDocuments({
    resource: current._id,
    status: { $in: SLOT_HOLDING_STATUSES },
    end: { $gt: now },
  });
  if (changed) {
    await invalidateResource(current._id);
    await record({
      actor: { id: actor._id, role: auditRole(actor, current.orgUnit) },
      action: "resource.status_changed",
      entity: { type: "resource", id: current._id },
      orgUnit: current.orgUnit,
      reason: why || undefined,
      changes: { status: [current.status, next] },
      meta: { affectedBookings },
      requestId,
    });
  }
  return {
    resource: { ...(await loadDetail(current._id)), canManage: true },
    affectedBookings,
  };
}

// GET /resources/:id/bookings (manager*). query: { status, from, to, page, limit }; from/to select
// bookings overlapping the range, so a loan that began earlier still shows. Borrowers come with name,
// member type and department, never email (architecture.md §16).
export async function listResourceBookings(managerId, resourceId, query = {}) {
  if (!isId(resourceId)) throw notFound("Resource");
  const [manager, resource] = await Promise.all([
    requireUser(managerId),
    Resource.findById(resourceId, { status: 1, orgUnit: 1 }).lean(),
  ]);
  requireManaged(
    manager,
    resource,
    "Only this unit's managers can see its bookings.",
  );

  const problems = [];
  const status = readEnum(query.status, BOOKING_STATUSES, "status", problems);
  const from = readInstant(query.from, "from", problems);
  const to = readInstant(query.to, "to", problems);
  if (from && to && !(from < to))
    problems.push({ path: "to", message: "Must be after from." });
  const { page, limit } = readPaging(query, problems);
  assertValid(problems);

  const filter = {
    resource: resource._id,
    ...(status && { status }),
    ...(to && { start: { $lt: to } }),
    ...(from && { end: { $gt: from } }),
  };
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ start: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: "borrower",
        select: "name memberType department",
        populate: { path: "department", select: "code name" },
      })
      .lean(),
    Booking.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total } };
}
