// verifyAuth: the Bearer access token (architecture.md §7.1) → req.user = { id, roles }. Services
// take req.user.id and load what else they need, so a role or unit change shows at once instead of
// after the token's 15 minutes.
//
// Any bad, expired or missing token is 401 UNAUTHENTICATED: the one code the client answers with a
// single refresh and retry (frontend.md §8.1, client/src/lib/http.js). A missing secret is a 500, so a
// broken deployment doesn't look like everyone's session expiring.
import jwt from "jsonwebtoken";
import { ServiceError } from "../lib/serviceError.js";
import { isId } from "../services/params.js";
import { verifyAccessToken } from "../services/authTokens.js";

const BEARER = /^Bearer\s+(\S+)$/i;

const unauthenticated = (message) =>
  new ServiceError(401, "UNAUTHENTICATED", message);

export function verifyAuth(req, _res, next) {
  const match = BEARER.exec(String(req.headers?.authorization ?? "").trim());
  if (!match) return next(unauthenticated("Sign in to continue."));
  let claims;
  try {
    claims = verifyAccessToken(match[1]);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError)
      return next(unauthenticated("Your session has expired. Sign in again."));
    return next(err);
  }
  // Tokens from the old mock auth carry { id, username } and no sub.
  if (!isId(claims.sub))
    return next(unauthenticated("Your session has expired. Sign in again."));
  req.user = {
    id: String(claims.sub),
    roles: Array.isArray(claims.roles) ? claims.roles : [],
  };
  return next();
}
