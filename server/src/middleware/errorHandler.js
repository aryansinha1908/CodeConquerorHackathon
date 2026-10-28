// The error half of the response envelope (architecture.md §6):
//   { success: false, error: { code, message, details? }, requestId }
//
// Services throw errors that carry status, code, message and sometimes details and headers
// (lib/serviceError.js, LockUnavailableError, the AI quota errors). Those are written for the user
// and sent as they are, Retry-After included. Mongoose, Zod, duplicate-key and body-parser errors
// are mapped to the same shape. Anything else is a 500 whose message says nothing about the cause;
// the stack goes to the log under the request id.
import mongoose from "mongoose";
import logger from "../lib/logger.js";
import { fromValidationError } from "../lib/serviceError.js";

const CODE_FOR_STATUS = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};
const PARSER_MESSAGES = {
  "entity.parse.failed": "The request body isn't valid JSON.",
  "entity.too.large": "The request body is too large.",
};
const INTERNAL = {
  status: 500,
  code: "INTERNAL",
  message: "Something went wrong.",
};

const isStatus = (n) => Number.isInteger(n) && n >= 400 && n < 600;

// Ours: a status plus an envelope code such as "SLOT_TAKEN". System errors have codes too
// ("ECONNREFUSED", Mongo's numbers) but no status.
const isOurs = (err) =>
  isStatus(err?.status) &&
  typeof err.code === "string" &&
  /^[A-Z][A-Z_]*$/.test(err.code);

const fieldError = (details) => ({
  status: 400,
  code: "VALIDATION_ERROR",
  message:
    details.length === 1
      ? "1 field is invalid."
      : `${details.length} fields are invalid.`,
  details,
});

// → { status, code, message, details?, headers? }
function toEnvelope(err) {
  if (isOurs(err)) {
    const { status, code, message, details, headers } = err;
    return { status, code, message, details, headers };
  }
  if (err instanceof mongoose.Error.ValidationError)
    return fieldError(fromValidationError(err).details);
  if (err instanceof mongoose.Error.CastError)
    return fieldError([
      {
        path: err.path,
        message:
          err.kind === "ObjectId"
            ? "Must be a valid id."
            : "Has an invalid value.",
      },
    ]);
  if (err?.name === "ZodError" && Array.isArray(err.issues))
    return fieldError(
      err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  if (err?.code === 11000)
    return {
      status: 409,
      code: "CONFLICT",
      message: "This conflicts with an existing record.",
    };
  // http-errors from Express and body-parser: bad JSON, a body too large, and the like.
  const status = err?.status ?? err?.statusCode;
  if (isStatus(status) && status < 500)
    return {
      status,
      code: CODE_FOR_STATUS[status] ?? "VALIDATION_ERROR",
      message:
        PARSER_MESSAGES[err.type] ??
        (err.expose ? err.message : "The request couldn't be processed."),
    };
  return INTERNAL;
}

export function sendError(
  req,
  res,
  { status, code, message, details, headers },
) {
  if (headers) res.set(headers);
  return res.status(status).json({
    success: false,
    error: { code, message, ...(details !== undefined && { details }) },
    requestId: req.id,
  });
}

export function notFoundHandler(req, res) {
  // The path isn't echoed back: it can hold personal data.
  return sendError(req, res, {
    status: 404,
    code: "NOT_FOUND",
    message: "There's nothing at this address.",
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const envelope = toEnvelope(err);
  const requestLogger = req.log || logger;
  if (envelope === INTERNAL)
    requestLogger.error({ err, requestId: req.id }, "Request failed");
  else if (envelope.status >= 500)
    requestLogger.warn({ err, requestId: req.id }, envelope.message);
  return sendError(req, res, envelope);
}
