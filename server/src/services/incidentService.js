// Incidents (architecture.md §6 Incidents and §7.2, backend.md B-16 and the Incident model in §5,
// frontend.md F-13). An incident is raised by the borrower or the unit's managers here, by a manager
// confirming a return with an issue (bookingService.confirmReturn) or by the sweeper for an overdue
// return. People then talk it through in the thread, and a human resolves it with an outcome and a
// rationale. Controllers pass the Zod-validated input and req.user.id.
//
// Who may do what (the "parties / manager* / admin" of the route table):
//   see, comment   the booking's borrower, the reporter, the unit's managers, admins
//   resolve        the unit's managers for low and medium severity, admins for any; never the
//                  borrower of the booking, unless an admin (as with booking decisions)
//
// Resolving the last open incident of a flagged booking closes the booking (closeFlagged, by the
// system). Incident and booking are separate writes (no transaction): if closing fails, resolving
// again answers 409 but closes the booking first, so a retry finishes the job.
import mongoose from "mongoose";
import { SYSTEM } from "../engines/stateMachine.js";
import {
  conflict,
  fieldError,
  forbidden,
  fromValidationError,
  invalid,
  notFound,
} from "../lib/serviceError.js";
import { DAY } from "../lib/time.js";
import {
  INCIDENT_OUTCOMES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
} from "../models/enums.js";
import { Booking, Incident, User } from "../models/index.js";
import { auditRole, isAdmin, managesUnit } from "./access.js";
import { record } from "./auditService.js";
import { loadResource } from "./bookingContext.js";
import { transition } from "./bookingService.js";
import { send } from "./notifyService.js";
import {
  absent,
  assertValid,
  isId,
  isPlainObject,
  readEnum,
  readEnumList,
  readId,
  readPaging,
  readText,
  requireUser,
  sameId,
} from "./params.js";

// Bookings an incident can be reported on: the borrower has, or is about to have, the resource.
const REPORTABLE = [
  "approved",
  "checked_in",
  "checked_out",
  "completed",
  "flagged",
];
// How long after a booking ends its borrower can still report on it; managers have no limit.
const REPORT_WINDOW_DAYS = 7;
const CREATABLE = [
  "bookingId",
  "resourceId",
  "type",
  "severity",
  "description",
  "photos",
];
const MAX_DESCRIPTION = 2000;
const MIN_DESCRIPTION = 20;
const MAX_COMMENT = 1000;
const MAX_RATIONALE = 1000;
const MAX_PHOTOS = 3;
// A thread is a list inside the incident document, so it is capped.
const MAX_COMMENTS = 200;

// ── Parameter checks ────────────────────────────────────────────────────────

// Mongoose stores null and non-object entries in a list of subdocuments as they are, so each photo
// is checked here; that the URL is one of our own uploads is the validator's job (backend.md §7).
function readPhotos(value, problems) {
  if (absent(value)) return [];
  if (!Array.isArray(value)) {
    problems.push({ path: "photos", message: "Must be a list." });
    return [];
  }
  if (value.length > MAX_PHOTOS)
    problems.push({
      path: "photos",
      message: `At most ${MAX_PHOTOS} photos.`,
    });
  // A counted loop, so holes in a sparse array are checked too.
  for (let i = 0; i < value.length; i++) {
    const photo = value[i];
    if (
      !isPlainObject(photo) ||
      typeof photo.url !== "string" ||
      typeof photo.publicId !== "string"
    )
      problems.push({
        path: `photos.${i}`,
        message: "Must be an uploaded photo's { url, publicId }.",
      });
  }
  return value;
}

// ── Access ──────────────────────────────────────────────────────────────────

// borrower (of the booking) | reporter | staff (a manager of the unit, or an admin) | admin
function relationsOf(viewer, incident, booking) {
  const relations = new Set();
  if (booking && sameId(booking.borrower, viewer._id))
    relations.add("borrower");
  if (sameId(incident.reportedBy, viewer._id)) relations.add("reporter");
  if (managesUnit(viewer, incident.orgUnit)) relations.add("staff");
  if (isAdmin(viewer)) relations.add("admin");
  return relations;
}

// null when the viewer may resolve the incident, otherwise why not.
function resolveRefusal(relations, incident) {
  if (!relations.has("staff"))
    return "Only this unit's managers or an admin can resolve incidents.";
  if (incident.severity === "high" && !relations.has("admin"))
    return "A high-severity incident is resolved by an admin.";
  if (relations.has("borrower") && !relations.has("admin"))
    return "You can't resolve an incident on your own booking. Another manager of this unit or an admin must.";
  return null;
}

async function loadIncident(incidentId) {
  if (!isId(incidentId)) throw notFound("Incident");
  const incident = await Incident.findById(incidentId).lean();
  if (!incident) throw notFound("Incident");
  const booking = incident.booking
    ? await Booking.findById(incident.booking, {
        borrower: 1,
        status: 1,
      }).lean()
    : null;
  return { incident, booking };
}

function requireParty(viewer, incident, booking) {
  const relations = relationsOf(viewer, incident, booking);
  if (!relations.size) throw forbidden("You can't view this incident.");
  return relations;
}

const staffRole = (actor, incident) => auditRole(actor, incident.orgUnit);

// ── Views ───────────────────────────────────────────────────────────────────

// Borrowers come with name, member type and department, never email or ID card (architecture.md
// §16); everyone else, reporter, commenters and the resolver, with their name only.
const withPeople = (query) =>
  query
    .populate({
      path: "booking",
      select: "status start end borrower",
      populate: {
        path: "borrower",
        select: "name memberType department",
        populate: { path: "department", select: "code name" },
      },
    })
    .populate("resource", "title slug")
    .populate("orgUnit", "name code")
    .populate("reportedBy", "name")
    .populate("resolution.decidedBy", "name");

// The detail page: the thread, the resolution and the buttons to show. The AI summary (C-14) is for
// the resolver only.
async function detailView(incidentId, viewer) {
  const incident = await withPeople(Incident.findById(incidentId))
    .populate("comments.by", "name")
    .lean();
  const relations = relationsOf(viewer, incident, incident.booking);
  const open = incident.status !== "resolved";
  const { aiSummary, __v, ...rest } = incident;
  return {
    ...rest,
    resolution: incident.resolution?.outcome ? incident.resolution : null,
    ...(relations.has("staff") && { aiSummary: aiSummary ?? null }),
    canComment: open,
    canResolve: open && !resolveRefusal(relations, incident),
  };
}

// ── Notifications ───────────────────────────────────────────────────────────

// Everyone involved, each once, with the audience that picks their link: the unit's managers, the
// admins for high severity, then the borrower and a reporter who is neither (member pages).
async function involved(incident, booking, resource) {
  const seen = new Set();
  const take = (ids) => {
    const fresh = [...new Set(ids.map(String))].filter((id) => !seen.has(id));
    fresh.forEach((id) => seen.add(id));
    return fresh;
  };
  const admins =
    incident.severity === "high"
      ? await User.find({ roles: "admin" }, { _id: 1 }).lean()
      : [];
  const managers = take(resource?.orgUnit?.managers ?? []);
  const adminIds = take(admins.map((a) => a._id));
  const members = take(
    [booking?.borrower, incident.reportedBy].filter(Boolean),
  );
  return [
    [managers, "manager"],
    [adminIds, "admin"],
    [members, "member"],
  ];
}

async function notifyInvolved(
  event,
  { incident, booking, resource, actor, data },
) {
  const common = {
    incidentId: String(incident._id),
    type: incident.type,
    severity: incident.severity,
    resourceTitle: resource?.title ?? "a resource",
    ...data,
  };
  for (const [ids, audience] of await involved(incident, booking, resource)) {
    await send(
      ids.filter((id) => !sameId(id, actor?._id)),
      event,
      { ...common, audience },
    );
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

// POST /incidents. input: { bookingId?, resourceId (unless bookingId), type, severity, description,
// photos? }. With a booking, its borrower (up to 7 days after it ends) or the unit's managers may
// report; without one, only the unit's managers. The booking's status doesn't change: only a manager
// confirming a return with an issue flags it. Everyone involved but the reporter is notified.
// → the incident as getIncident shows it.
export async function createIncident(
  actorId,
  input,
  { requestId, now = new Date() } = {},
) {
  const actor = await requireUser(actorId);
  if (!isPlainObject(input))
    throw invalid("Send the incident's fields as an object.");
  // Other keys are refused, not dropped, so source, status or a resolution can't be sent this way.
  const problems = Object.keys(input)
    .filter((path) => input[path] !== undefined && !CREATABLE.includes(path))
    .sort()
    .map((path) => ({ path, message: "This field can't be set." }));
  const bookingId = readId(input.bookingId, "bookingId", problems);
  const resourceId = readId(input.resourceId, "resourceId", problems);
  if (absent(input.bookingId) && absent(input.resourceId))
    problems.push({
      path: "resourceId",
      message: "Required when there's no booking.",
    });
  const type = readEnum(input.type, INCIDENT_TYPES, "type", problems, {
    required: true,
  });
  const severity = readEnum(
    input.severity,
    INCIDENT_SEVERITIES,
    "severity",
    problems,
    { required: true },
  );
  const description = readText(input.description, "description", problems, {
    required: true,
    min: MIN_DESCRIPTION,
    max: MAX_DESCRIPTION,
  });
  const photos = readPhotos(input.photos, problems);
  assertValid(problems, "field");

  const booking = bookingId
    ? await Booking.findById(bookingId, {
        borrower: 1,
        resource: 1,
        orgUnit: 1,
        status: 1,
        end: 1,
      }).lean()
    : null;
  if (bookingId && !booking) throw notFound("Booking");
  if (booking && resourceId && !sameId(booking.resource, resourceId))
    throw fieldError("resourceId", "Isn't the booking's resource.");
  const resource = await loadResource(booking?.resource ?? resourceId);
  if (!resource) throw notFound("Resource");
  const orgUnit = booking?.orgUnit ?? resource.orgUnit?._id;

  const isBorrower = Boolean(booking && sameId(booking.borrower, actor._id));
  const isStaff = managesUnit(actor, orgUnit);
  if (!isBorrower && !isStaff)
    throw forbidden(
      booking
        ? "Only the borrower or this unit's managers can report an incident on this booking."
        : "Only this unit's managers can report an incident that isn't tied to a booking.",
    );
  if (booking && !REPORTABLE.includes(booking.status))
    throw conflict(
      `Incidents can't be reported on a booking that is ${booking.status.replace("_", " ")}.`,
    );
  if (
    isBorrower &&
    !isStaff &&
    now - new Date(booking.end) > REPORT_WINDOW_DAYS * DAY
  )
    throw conflict(
      `Incidents can be reported up to ${REPORT_WINDOW_DAYS} days after a booking ends. Contact the unit's managers instead.`,
    );

  const incident = await Incident.create({
    booking: booking?._id,
    resource: resource._id,
    orgUnit,
    reportedBy: actor._id,
    source: isBorrower ? "user" : "manager",
    type,
    severity,
    description,
    photos,
  }).catch((err) => {
    throw fromValidationError(err);
  });
  if (booking)
    await Booking.updateOne(
      { _id: booking._id },
      { $push: { incidents: incident._id } },
    );

  await record({
    actor: {
      id: actor._id,
      role: isBorrower ? "member" : staffRole(actor, incident),
    },
    action: "incident.created",
    entity: { type: "incident", id: incident._id },
    orgUnit,
    changes: { status: [null, incident.status] },
    meta: { bookingId: booking?._id ?? null, type, severity },
    requestId,
  });
  await notifyInvolved("incident.created", {
    incident,
    booking,
    resource,
    actor,
  });
  return detailView(incident._id, actor);
}

// ── Read ────────────────────────────────────────────────────────────────────

// The incidents a viewer may see: an admin all; anyone else those they reported or that concern
// their own bookings, plus, for a manager, every incident in their units.
async function listScope(viewer) {
  if (isAdmin(viewer)) return {};
  const bookings = await Booking.find(
    { borrower: viewer._id },
    { _id: 1 },
  ).lean();
  const units = viewer.roles?.includes("manager")
    ? (viewer.managedOrgUnits ?? [])
    : [];
  return {
    $or: [
      { reportedBy: viewer._id },
      { booking: { $in: bookings.map((b) => b._id) } },
      ...(units.length ? [{ orgUnit: { $in: units } }] : []),
    ],
  };
}

// GET /incidents. query: { status (one or a comma list), type, severity, resourceId, page, limit }
// → { items, meta: { page, limit, total } }, newest first. Items leave out the thread and the photos
// (commentCount says how long the thread is).
export async function listIncidents(viewerId, query = {}) {
  const viewer = await requireUser(viewerId);
  const problems = [];
  const status = readEnumList(
    query.status,
    INCIDENT_STATUSES,
    "status",
    problems,
  );
  const type = readEnum(query.type, INCIDENT_TYPES, "type", problems);
  const severity = readEnum(
    query.severity,
    INCIDENT_SEVERITIES,
    "severity",
    problems,
  );
  const resourceId = readId(query.resourceId, "resourceId", problems);
  const { page, limit } = readPaging(query, problems);
  assertValid(problems, "parameter");

  const filter = {
    ...(await listScope(viewer)),
    ...(status && { status: { $in: status } }),
    ...(type && { type }),
    ...(severity && { severity }),
    ...(resourceId && { resource: resourceId }),
  };
  const [rows, total] = await Promise.all([
    withPeople(
      // Comment ids only, to count them.
      Incident.find(filter, {
        photos: 0,
        aiSummary: 0,
        __v: 0,
        "comments.by": 0,
        "comments.text": 0,
        "comments.at": 0,
      })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ).lean(),
    Incident.countDocuments(filter),
  ]);
  const items = rows.map(({ comments, resolution, ...row }) => ({
    ...row,
    resolution: resolution?.outcome ? resolution : null,
    commentCount: comments?.length ?? 0,
  }));
  return { items, meta: { page, limit, total } };
}

// GET /incidents/:id → the incident with its thread, resolution, canComment and canResolve.
export async function getIncident(viewerId, incidentId) {
  const [viewer, { incident, booking }] = await Promise.all([
    requireUser(viewerId),
    loadIncident(incidentId),
  ]);
  requireParty(viewer, incident, booking);
  return detailView(incident._id, viewer);
}

// ── Thread ──────────────────────────────────────────────────────────────────

// POST /incidents/:id/comments. input: { text } (1–1000 characters). The first comment by a manager
// or admin moves an open incident to in_review: someone is looking at it. A resolved incident's
// thread is closed (409). Everyone else involved is notified. → the incident as getIncident shows it.
export async function addComment(
  actorId,
  incidentId,
  input = {},
  { requestId, now = new Date() } = {},
) {
  const [actor, { incident, booking }] = await Promise.all([
    requireUser(actorId),
    loadIncident(incidentId),
  ]);
  const relations = requireParty(actor, incident, booking);
  if (!isPlainObject(input)) throw invalid("Send the comment as an object.");
  const problems = [];
  const text = readText(input.text, "text", problems, {
    required: true,
    max: MAX_COMMENT,
  });
  assertValid(problems, "field");
  if (incident.status === "resolved")
    throw conflict("This incident is resolved, so its thread is closed.");

  const comment = {
    _id: new mongoose.Types.ObjectId(),
    by: actor._id,
    text,
    at: now,
  };
  const updated = await Incident.findOneAndUpdate(
    {
      _id: incident._id,
      status: { $ne: "resolved" },
      [`comments.${MAX_COMMENTS - 1}`]: { $exists: false },
    },
    { $push: { comments: comment } },
    { returnDocument: "after", projection: { status: 1, comments: 1 } },
  ).lean();
  if (!updated) {
    const current = await Incident.findById(incident._id, {
      status: 1,
    }).lean();
    throw conflict(
      current?.status === "resolved"
        ? "This incident was resolved just now, so its thread is closed."
        : `This thread has reached ${MAX_COMMENTS} comments.`,
    );
  }
  const reviewing =
    relations.has("staff") &&
    updated.status === "open" &&
    Boolean(
      await Incident.findOneAndUpdate(
        { _id: incident._id, status: "open" },
        { $set: { status: "in_review" } },
        { projection: { _id: 1 } },
      ).lean(),
    );

  const asStaff = relations.has("staff") && !relations.has("borrower");
  await record({
    actor: {
      id: actor._id,
      role: asStaff ? staffRole(actor, incident) : "member",
    },
    action: "incident.commented",
    entity: { type: "incident", id: incident._id },
    orgUnit: incident.orgUnit,
    ...(reviewing && { changes: { status: ["open", "in_review"] } }),
    meta: { commentId: comment._id },
    requestId,
  });
  const resource = await loadResource(incident.resource);
  await notifyInvolved("incident.commented", {
    incident,
    booking,
    resource,
    actor,
    data: { authorName: actor.name },
  });
  return detailView(incident._id, actor);
}

// ── Resolve ─────────────────────────────────────────────────────────────────

// Closes a flagged booking once none of its incidents is unresolved. → true if this call closed it.
// Two resolutions finishing at once may both try; the loser's 409 means the booking is closed.
async function settleBooking(bookingId, { now, requestId }) {
  if (!bookingId) return false;
  const booking = await Booking.findById(bookingId, { status: 1 }).lean();
  if (booking?.status !== "flagged") return false;
  const unresolved = await Incident.countDocuments({
    booking: bookingId,
    status: { $ne: "resolved" },
  });
  if (unresolved) return false;
  try {
    await transition(bookingId, "closeFlagged", SYSTEM, {}, { now, requestId });
    return true;
  } catch (err) {
    if (err?.code === "INVALID_TRANSITION") return false;
    throw err;
  }
}

// POST /incidents/:id/resolve. input: { outcome: no_action | warning | repair_required | strike,
// rationale } (both required; a strike needs a booking, whose borrower it counts against). Throws 400,
// 403 (see resolveRefusal), 404, or 409 INVALID_TRANSITION once resolved. A strike adds one to the
// borrower's strikes, which only ever suggest a suspension to an admin (C-09). Everyone involved
// but the resolver is notified. → the incident as getIncident shows it, plus bookingClosed.
export async function resolveIncident(
  actorId,
  incidentId,
  input = {},
  { requestId, now = new Date() } = {},
) {
  const [actor, { incident, booking }] = await Promise.all([
    requireUser(actorId),
    loadIncident(incidentId),
  ]);
  const refusal = resolveRefusal(
    relationsOf(actor, incident, booking),
    incident,
  );
  if (refusal) throw forbidden(refusal);

  if (!isPlainObject(input)) throw invalid("Send the resolution as an object.");
  const problems = [];
  const outcome = readEnum(
    input.outcome,
    INCIDENT_OUTCOMES,
    "outcome",
    problems,
    { required: true },
  );
  const rationale = readText(input.rationale, "rationale", problems, {
    required: true,
    max: MAX_RATIONALE,
  });
  if (outcome === "strike" && !booking)
    problems.push({
      path: "outcome",
      message:
        "A strike counts against a borrower, and this incident isn't tied to a booking.",
    });
  assertValid(problems, "field");

  if (incident.status === "resolved") {
    // A retry after the booking failed to close: finish that, then say it was already resolved.
    await settleBooking(incident.booking, { now, requestId });
    throw conflict("This incident is already resolved.");
  }

  // "before", so the audit entry says what was actually replaced (open or in_review).
  const before = await Incident.findOneAndUpdate(
    { _id: incident._id, status: { $ne: "resolved" } },
    {
      $set: {
        status: "resolved",
        resolution: { outcome, rationale, decidedBy: actor._id, at: now },
      },
    },
    { returnDocument: "before", projection: { status: 1 } },
  ).lean();
  if (!before) throw conflict("Someone else resolved this incident just now.");

  const struck =
    outcome === "strike"
      ? await User.findOneAndUpdate(
          { _id: booking.borrower },
          { $inc: { strikes: 1 } },
          { returnDocument: "after", projection: { strikes: 1 } },
        ).lean()
      : null;

  await record({
    actor: { id: actor._id, role: staffRole(actor, incident) },
    action: "incident.resolved",
    entity: { type: "incident", id: incident._id },
    orgUnit: incident.orgUnit,
    reason: rationale,
    changes: { status: [before.status, "resolved"] },
    meta: {
      outcome,
      bookingId: incident.booking ?? null,
      ...(struck && { borrowerStrikes: struck.strikes }),
    },
    requestId,
  });
  const bookingClosed = await settleBooking(incident.booking, {
    now,
    requestId,
  });
  const resource = await loadResource(incident.resource);
  await notifyInvolved("incident.resolved", {
    incident,
    booking,
    resource,
    actor,
    data: { outcome, bookingClosed },
  });
  return { ...(await detailView(incident._id, actor)), bookingClosed };
}
