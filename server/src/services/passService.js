// The QR booking pass (backend.md C-04): the borrower shows a short-lived pass at pickup or return,
// the unit's manager scans it, and the server confirms it's a live pass for a booking of one of that
// manager's units, at the right time, records it, and says what to do next. Check-in, check-out and
// the return confirmation stay their own steps (verify, then open the step). A pass is a bearer token:
// it proves someone holds the borrower's signed-in session right now, not who is standing there, so
// the scan page asks the manager to check the borrower's college ID against the name shown.
//
// The pass is "cc1.<bookingId>.<expiry seconds>.<tag>", the tag the first 128 bits of an HMAC under a
// key derived only for passes, HMAC(ACCESS_TOKEN_SECRET, "booking-pass:v1"): the shape and the key
// differ from an access token, so a pass can never sign anyone in, and an access token is never a
// pass. The tag is compared as its canonical base64url text, so each pass has exactly one spelling.
// It lasts PASS_TTL_SECONDS; the borrower's page fetches a fresh one every minute. Each pass also gets
// a 6-character code kept in Redis for as long, used up by its first scan, for a manager who can't use
// the camera. Without Redis the QR still works and the code is null.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getRedis, log } from "../config/redis.js";
import { CHECK_IN_OPENS_MINS, allowedActions, isOverdue, relationsOf } from "../engines/stateMachine.js";
import { MINUTE, formatIstDateTime } from "../lib/time.js";
import { ServiceError, conflict, forbidden, invalid, notFound } from "../lib/serviceError.js";
import { AuditLog, Booking } from "../models/index.js";
import { auditRole } from "./access.js";
import { record } from "./auditService.js";
import { isId, requireUser } from "./params.js";

export const PASS_TTL_SECONDS = 120;
// 16 bytes in base64url are 22 characters whose last one carries 2 bits: only A, Q, g or w can end a
// canonical tag. The final comparison is on the canonical text anyway.
const TOKEN = /^cc1\.([0-9a-f]{24})\.(\d{10})\.([A-Za-z0-9_-]{21}[AQgw])$/;
// No 0/O, 1/I/L: the code is read off a phone screen and typed.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const codeKey = (code) => `pass:code:${code}`;
// One audit entry per pass: repeated scans of the same pass within its lifetime are answered, not
// recorded again.
const seenKey = (bookingId, exp) => `pass:seen:${bookingId}:${exp}`;

// The booking status a pass is shown for, and what the scan is for.
const PHASE = { approved: "pickup", checked_in: "return", checked_out: "return" };
// The manager's next step, from the actions they may take on the booking now (stateMachine.js), so an
// admin who doesn't manage the unit (who can't check in or out) isn't sent to a step they can't do.
const NEXT_ACTION = [
  ["checkIn", "check_in"],
  ["checkOut", "check_out"],
  ["confirmOk", "confirm_return"],
];

const NOT_A_PASS = "That isn't a valid CampusCommons booking pass.";
const UNKNOWN_CODE = "That code isn't valid, or it has expired. Ask the borrower for the code on their pass now.";

function passKey() {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error("ACCESS_TOKEN_SECRET is not set");
  return createHmac("sha256", secret).update("booking-pass:v1").digest();
}

const tagOf = (payload) =>
  createHmac("sha256", passKey()).update(payload).digest().subarray(0, 16).toString("base64url");

/** → { token, expiresAt } for `bookingId`, valid PASS_TTL_SECONDS from `now`. */
export function signPass(bookingId, now = new Date()) {
  const exp = Math.floor(now.getTime() / 1000) + PASS_TTL_SECONDS;
  const payload = `cc1.${bookingId}.${exp}`;
  return { token: `${payload}.${tagOf(payload)}`, expiresAt: new Date(exp * 1000) };
}

/**
 * A pass → { bookingId, exp, expiresAt }. 400 VALIDATION_ERROR when forged or garbled (on `field`),
 * 400 PASS_EXPIRED when old.
 */
export function readPass(token, now = new Date(), { field = "token", message = NOT_A_PASS } = {}) {
  const refuse = () => invalid(message, [{ path: field, message }]);
  const match = typeof token === "string" ? TOKEN.exec(token.trim()) : null;
  if (!match) throw refuse();
  const [, bookingId, exp, given] = match;
  const expected = Buffer.from(tagOf(`cc1.${bookingId}.${exp}`));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw refuse();
  const expiresAt = new Date(Number(exp) * 1000);
  if (expiresAt <= now) {
    throw new ServiceError(
      400,
      "PASS_EXPIRED",
      "This pass has expired. Ask the borrower to open it again: it refreshes every minute.",
    );
  }
  return { bookingId, exp, expiresAt };
}

function newCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// A fresh code pointing at the token, or null when Redis can't keep one (the QR still works).
async function storeCode(token) {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newCode();
      if ((await getRedis().set(codeKey(code), token, "EX", PASS_TTL_SECONDS, "NX")) === "OK") return code;
    }
  } catch (err) {
    log.warn({ err }, "Couldn't store a pass code; the QR still works");
  }
  return null;
}

// "abc-23d", "ABC 23D" → "ABC23D"; anything else → null.
function readCode(value) {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

// The token a code points at, used up by this read (GETDEL): a code read aloud or overheard works once.
async function takeCode(value) {
  const code = readCode(value);
  if (!code) throw invalid(UNKNOWN_CODE, [{ path: "code", message: UNKNOWN_CODE }]);
  let token;
  try {
    token = await getRedis().getdel(codeKey(code));
  } catch (err) {
    log.warn({ err }, "Couldn't read a pass code");
    throw new ServiceError(503, "SERVICE_UNAVAILABLE", "Codes can't be checked right now. Scan the QR instead.");
  }
  if (!token) throw invalid(UNKNOWN_CODE, [{ path: "code", message: UNKNOWN_CODE }]);
  return token;
}

// When this booking's pass was last verified for `phase`, or null (the borrower's card polls this).
async function lastVerifiedAt(bookingId, phase) {
  const entry = await AuditLog.findOne(
    { "entity.type": "booking", "entity.id": bookingId, action: "booking.pass_verified", "meta.phase": phase },
    { at: 1 },
  )
    .sort({ at: -1 })
    .lean();
  return entry?.at ?? null;
}

async function borrowersBooking(bookingId, userId) {
  const [booking, user] = await Promise.all([
    isId(bookingId) ? Booking.findById(bookingId).lean() : null,
    requireUser(userId),
  ]);
  if (!booking) throw notFound("Booking");
  if (!relationsOf(user, booking).has("borrower")) throw forbidden("Only the borrower can show this booking's pass.");
  return booking;
}

/**
 * POST /bookings/:id/pass (the borrower) → { token, code, expiresAt, issuedAt, phase, verifiedAt }.
 * Shown for an approved booking that hasn't ended (pickup) and for an item that's out or awaiting
 * return confirmation (return). issuedAt is the server's clock, so a phone whose clock is off still
 * counts the pass down correctly.
 */
export async function issuePass(bookingId, userId, { now = new Date() } = {}) {
  const booking = await borrowersBooking(bookingId, userId);
  const phase = PHASE[booking.status];
  if (!phase) throw conflict("A pass is shown for an approved booking, or for an item you have out.");
  if (phase === "pickup" && now > new Date(booking.end)) throw conflict("This booking has already ended.");
  const { token, expiresAt } = signPass(String(booking._id), now);
  const [code, verifiedAt] = await Promise.all([storeCode(token), lastVerifiedAt(booking._id, phase)]);
  return { token, code, expiresAt, issuedAt: now, phase, verifiedAt };
}

/** GET /bookings/:id/pass (the borrower) → { phase, verifiedAt }: the light read the open card polls. */
export async function passStatus(bookingId, userId) {
  const booking = await borrowersBooking(bookingId, userId);
  const phase = PHASE[booking.status] ?? null;
  return { phase, verifiedAt: phase ? await lastVerifiedAt(booking._id, phase) : null };
}

/**
 * POST /bookings/scan { token } or { code } (a manager of the booking's unit, or an admin; never the
 * borrower) → { booking, phase, next, isOverdue, verifiedAt, recorded }, and a booking.pass_verified
 * audit entry the first time each pass is scanned.
 */
export async function scanPass(input, actorId, { now = new Date(), requestId } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const hasToken = typeof body.token === "string" && body.token.trim() !== "";
  const hasCode = typeof body.code === "string" && body.code.trim() !== "";
  if (!hasToken && !hasCode) {
    throw invalid("Scan the pass, or type its code.", [
      { path: "token", message: "Required." },
      { path: "code", message: "Required." },
    ]);
  }
  if (hasToken && hasCode) {
    const message = "Send either the scanned pass or its code, not both.";
    throw invalid(message, [{ path: "code", message }]);
  }
  const token = hasToken ? body.token : await takeCode(body.code);
  const { bookingId, exp } = readPass(token, now);

  const [booking, actor] = await Promise.all([
    Booking.findById(bookingId)
      .populate("resource", "title location")
      .populate({ path: "borrower", select: "name memberType department", populate: { path: "department", select: "code name" } })
      .populate("orgUnit", "name code")
      .lean(),
    requireUser(actorId),
  ]);
  if (!booking) throw notFound("Booking");
  const relations = relationsOf(actor, booking);
  if (relations.has("borrower")) {
    throw forbidden("You can't verify your own pass. Another manager of the unit, or an admin, must.");
  }
  if (!relations.has("unitManager") && !relations.has("admin")) {
    // A typed code for another unit's booking reads like an unknown one: no hint that it's live.
    if (hasCode) throw invalid(UNKNOWN_CODE, [{ path: "code", message: UNKNOWN_CODE }]);
    throw forbidden("Only the managers of this resource's unit can verify its pass.");
  }

  const phase = PHASE[booking.status];
  if (!phase) throw conflict("This booking has nothing to hand over or return now.");
  if (phase === "pickup") {
    const opens = new Date(new Date(booking.start).getTime() - CHECK_IN_OPENS_MINS * MINUTE);
    if (now < opens) {
      throw conflict(`Too early: pickup opens at ${formatIstDateTime(opens)} IST, ${CHECK_IN_OPENS_MINS} minutes before the start.`);
    }
    if (now > new Date(booking.end)) throw conflict("This booking has already ended.");
  }

  // First scan of this pass: record it. Without Redis every scan is recorded (better twice than never).
  let recorded = true;
  try {
    recorded = (await getRedis().set(seenKey(bookingId, exp), "1", "EX", PASS_TTL_SECONDS, "NX")) === "OK";
  } catch (err) {
    log.warn({ err }, "Couldn't check for a repeated pass scan; recording it");
  }
  if (recorded) {
    await record({
      actor: { id: actor._id, role: auditRole(actor, booking.orgUnit?._id) },
      action: "booking.pass_verified",
      entity: { type: "booking", id: booking._id },
      orgUnit: booking.orgUnit?._id,
      meta: { phase, status: booking.status },
      requestId,
    });
  }

  const allowed = allowedActions(booking, actor, now);
  return {
    booking: {
      _id: booking._id,
      status: booking.status,
      start: booking.start,
      end: booking.end,
      resource: booking.resource,
      borrower: booking.borrower,
      orgUnit: booking.orgUnit,
    },
    phase,
    next: NEXT_ACTION.find(([action]) => allowed.includes(action))?.[1] ?? null,
    isOverdue: isOverdue(booking, now),
    verifiedAt: now,
    recorded,
  };
}
