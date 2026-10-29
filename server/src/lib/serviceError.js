// Errors thrown by services. status, code and details follow the error envelope (architecture.md §6),
// so errorHandler can send them as they are, like LockUnavailableError and the AI quota errors.
import mongoose from "mongoose";

export class ServiceError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const notFound = (what) =>
  new ServiceError(404, "NOT_FOUND", `${what} not found.`);

export const forbidden = (message = "You're not allowed to do that.") =>
  new ServiceError(403, "FORBIDDEN", message);

export const invalid = (message, details) =>
  new ServiceError(400, "VALIDATION_ERROR", message, details);

// One bad field, as a form marks it.
export const fieldError = (path, message) =>
  invalid("1 field is invalid.", [{ path, message }]);

// The state changed underneath the request, or doesn't allow it (architecture.md §6 has no other
// 409 code for this). The message says what to do: reload, or that it's already done.
export const conflict = (message) =>
  new ServiceError(409, "INVALID_TRANSITION", message);

// Mongoose's own cast messages name the model and echo the raw value; a form field needs less.
const CAST_MESSAGES = {
  number: "Must be a number.",
  objectid: "Must be a valid id.",
  date: "Must be a valid date.",
  boolean: "Must be true or false.",
  string: "Must be text.",
};

function fieldMessage(error) {
  if (error instanceof mongoose.Error.CastError)
    return (
      CAST_MESSAGES[String(error.kind).toLowerCase()] ?? "Has an invalid value."
    );
  // A validator that threw (maxItems reading .length of null) carries the JavaScript error's text,
  // which means nothing on a form. No model throws on purpose.
  if (error.reason instanceof Error) return "Has an invalid value.";
  return error.message;
}

// A Mongoose ValidationError from save() or validate() → 400 VALIDATION_ERROR with one
// { path, message } per field, sorted by path (architecture.md §12), so a bad listing form gets field
// errors instead of a 500. Anything else comes back unchanged: `throw fromValidationError(err)`.
export function fromValidationError(err) {
  if (!(err instanceof mongoose.Error.ValidationError)) return err;
  // The key, not error.path: inside an array the path is relative ("close", not "availability.weekly.0.close").
  const details = Object.entries(err.errors)
    .map(([path, error]) => ({ path, message: fieldMessage(error) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const n = details.length;
  return invalid(
    n === 1 ? "1 field is invalid." : `${n} fields are invalid.`,
    details,
  );
}
