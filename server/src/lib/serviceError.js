// Errors thrown by services. status, code and details follow the error envelope (architecture.md §6),
// so errorHandler can send them as they are, like LockUnavailableError and the AI quota errors.
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
