// Input checks shared by the services. Routes validate with Zod first; these keep internal callers
// from turning a bad value into a CastError (a 500) or an unbounded read, and report every problem
// at once as 400 VALIDATION_ERROR with { path, message } details. Each read* function returns the
// clean value, or undefined after pushing a problem.
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

export const isPlainObject = (v) =>
  v !== null &&
  typeof v === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

// Populated documents and raw ids compare the same way; a missing id equals nothing.
export const sameId = (a, b) =>
  a != null && b != null && String(a?._id ?? a) === String(b?._id ?? b);

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

export function readEnum(value, allowed, path, problems, { required } = {}) {
  if (absent(value)) {
    if (required) problems.push({ path, message: "Required." });
    return undefined;
  }
  if (allowed.includes(value)) return value;
  problems.push({ path, message: `Must be one of: ${allowed.join(", ")}.` });
  return undefined;
}

// One value or several, as a list or "a,b" from a query string. → sorted and de-duplicated, so a
// cache key doesn't depend on the order they were sent in.
export function readEnumList(value, allowed, path, problems) {
  if (absent(value)) return undefined;
  const list = typeof value === "string" ? value.split(",") : value;
  const values = Array.isArray(list)
    ? [...new Set(list.map((v) => (typeof v === "string" ? v.trim() : v)))]
    : [];
  if (values.length && values.every((v) => allowed.includes(v)))
    return values.sort();
  problems.push({
    path,
    message: `Must be one or more of: ${allowed.join(", ")}.`,
  });
  return undefined;
}

// Trimmed; blank counts as absent. min and max are in characters; with no max, any length passes.
export function readText(
  value,
  path,
  problems,
  { required, requiredMessage, min = 1, max } = {},
) {
  if (!absent(value) && typeof value !== "string") {
    problems.push({ path, message: "Must be text." });
    return undefined;
  }
  const text = value?.trim();
  if (!text) {
    if (required)
      problems.push({ path, message: requiredMessage ?? "Required." });
    return undefined;
  }
  if (text.length < min)
    problems.push({ path, message: `Must be at least ${min} characters.` });
  else if (max !== undefined && text.length > max)
    problems.push({ path, message: `Can be at most ${max} characters.` });
  return text;
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

export function readInstant(value, path, problems, { required } = {}) {
  if (absent(value)) {
    if (required) problems.push({ path, message: "Required." });
    return undefined;
  }
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
