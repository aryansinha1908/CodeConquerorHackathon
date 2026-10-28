import { randomUUID } from "node:crypto";

export function requestIdMiddleware(req, res, next) {
  const incomingId = req.headers["x-request-id"];

  // Accept only simple, bounded request IDs.
  const validId =
    typeof incomingId === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(incomingId);

  const requestId = validId ? incomingId : randomUUID();

  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
}
