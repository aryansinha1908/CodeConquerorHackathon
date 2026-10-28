// Input checks shared by the read services. Routes validate with Zod first; these keep internal
// callers from turning a bad value into a CastError (a 500) or an unbounded read, and report every
// problem at once as 400 VALIDATION_ERROR with { path, message } details.
//
// resourceService, badgeService and incidentService still carry their own copies of most of these;
// moving them over is mechanical.
import mongoose from "mongoose";
import { invalid, notFound } from "../lib/serviceError.js";
import { User } from "../models/index.js";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
const MAX_PAGE = 10_000;

// Mongoose 9 accepts only ObjectIds and 24-hex strings, so the mock auth's "demo-user-id-001" and
// operator objects such as { $ne: null } are turned away before they reach a query.
export const isId = (value) => mongoose.isValidObjectId(value);

export const absent = (value) =>
  value === undefined || value === null || value === "";

export function assertValid(problems, noun = "parameter") {
  const n = problems.length;
  if (!n) return;
  throw invalid(
    n === 1 ? `1 ${noun} is invalid.` : `${n} ${noun}s are invalid.`,
    problems,
  );
}

// Lower-cased, so "6A1F…" matches the stored id.
export function readId(value, path, problems) {
  if (absent(value)) return undefined;
  if (isId(value)) return String(value).toLowerCase();
  problems.push({ path, message: "Must be a valid id." });
  return undefined;
}

// Only a literal true or "true" counts, so an unparsed "false" from a query string isn't true.
export function readFlag(value, path, problems) {
  if (absent(value) || value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  problems.push({ path, message: "Must be true or false." });
  return false;
}

// A string that must match `pattern` (an action name, an entity type).
export function readMatch(value, pattern, path, problems, message) {
  if (absent(value)) return undefined;
  if (typeof value === "string" && pattern.test(value)) return value;
  problems.push({ path, message });
  return undefined;
}

export function readInstant(value, path, problems) {
  if (absent(value)) return undefined;
  const date = ["string", "number"].includes(typeof value)
    ? new Date(value)
    : value instanceof Date
      ? new Date(value.getTime())
      : new Date(NaN);
  if (!Number.isNaN(date.getTime())) return date;
  problems.push({ path, message: "Must be a valid date." });
  return undefined;
}

// limit is capped rather than refused, so an over-eager client still gets a page.
export function readPaging({ page, limit }, problems) {
  const p = absent(page) ? 1 : Number(page);
  const l = absent(limit) ? DEFAULT_LIMIT : Number(limit);
  if (!Number.isInteger(p) || p < 1 || p > MAX_PAGE)
    problems.push({
      path: "page",
      message: `Must be a whole number from 1 to ${MAX_PAGE}.`,
    });
  if (!Number.isInteger(l) || l < 1)
    problems.push({
      path: "limit",
      message: "Must be a whole number above 0.",
    });
  return { page: p, limit: Math.min(l, MAX_LIMIT) };
}

// The signed-in user from req.user.id; an id with no user is 404, the same as everywhere else.
export async function requireUser(userId) {
  const user = isId(userId) ? await User.findById(userId).lean() : null;
  if (!user) throw notFound("User");
  return user;
}
