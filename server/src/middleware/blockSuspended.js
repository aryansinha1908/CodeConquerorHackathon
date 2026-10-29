// blockSuspended (architecture.md §7.1 "Suspension"): a suspended user can still sign in and read, but
// every mutating request is 403 FORBIDDEN with the end date and reason. Mount it after verifyAuth on
// the routers that change things. The suspension is read from MongoDB on every request, not from the
// token, so an admin's suspension (or its end) takes effect at once.
import { ServiceError } from "../lib/serviceError.js";
import { User } from "../models/index.js";
import { isId } from "../services/params.js";
import { formatHHmm, formatIstFullDate, istParts } from "../lib/time.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// "5 Nov 2026, 14:30 IST": a suspension can run past the end of the year.
const istStamp = (date) =>
  `${formatIstFullDate(date)}, ${formatHHmm(istParts(date).minutes)} IST`;

export function suspendedError(user) {
  const until = new Date(user.suspendedUntil);
  const reason = user.suspensionReason ?? null;
  return new ServiceError(
    403,
    "FORBIDDEN",
    `Your account is suspended until ${istStamp(until)}${reason ? `: ${reason}` : "."}`,
    { suspendedUntil: until.toISOString(), reason },
  );
}

export async function blockSuspended(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const id = req.user?.id;
  // Like the rate limiters: mounted before verifyAuth is a mistake, and should fail loudly.
  if (!id)
    return next(
      new Error("blockSuspended needs req.user: mount it after verifyAuth"),
    );
  // An unknown or malformed id passes: the service answers for it (404, like everywhere else).
  if (!isId(id)) return next();
  let user;
  try {
    user = await User.findById(id)
      .select("suspendedUntil suspensionReason")
      .lean();
  } catch (err) {
    return next(err);
  }
  if (user?.suspendedUntil && new Date(user.suspendedUntil) > Date.now())
    return next(suspendedError(user));
  return next();
}
