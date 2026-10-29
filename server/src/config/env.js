// Start-up checks on the environment (architecture.md §16 "Secrets", §18). server.js runs reportEnv()
// (checkEnv, logged) before connecting anything, and checkDemoMode() once MongoDB is up.
//
// - In production, a missing required setting or a secret shorter than MIN_SECRET_LENGTH stops the
//   boot: better a failed deploy on Render than an API that 500s on every sign-in, or one whose
//   tokens can be forged from a short secret. Outside production the same problems only warn, so a
//   laptop runs with a partial .env.
// - Optional services (Cloudinary, SMTP) only ever warn: the API runs without them, minus uploads or
//   emailed codes.
// Messages name settings, never their values.
import { User } from "../models/index.js";
import { DEMO_EMAIL, demoMode } from "../services/authService.js";

export const REQUIRED_IN_PRODUCTION = [
  "MONGODB_URI",
  "REDIS_URL",
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
  "OTP_PEPPER",
  "CLIENT_URL",
];
export const SECRETS = [
  "ACCESS_TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
  "OTP_PEPPER",
];
export const MIN_SECRET_LENGTH = 32;

const CLOUDINARY = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

// Render's proxy is one hop in front of the app. TRUST_PROXY_HOPS overrides that for a deployment with
// more proxies, such as Vercel's rewrite in front of Render (2, in render.yaml; architecture.md §11).
export const DEFAULT_TRUST_PROXY_HOPS = 1;
const MAX_TRUST_PROXY_HOPS = 10;

const isSet = (value) => typeof value === "string" && value.trim() !== "";

const readHops = (raw) =>
  /^\d+$/.test(String(raw).trim()) && Number(raw) <= MAX_TRUST_PROXY_HOPS
    ? Number(raw)
    : null;

// For app.set("trust proxy", …): always a hop count, never true, which would let any client choose
// its own req.ip with X-Forwarded-For. A bad value falls back to the default (checkEnv warns).
export function trustProxyHops(env = process.env) {
  if (!isSet(env.TRUST_PROXY_HOPS)) return DEFAULT_TRUST_PROXY_HOPS;
  return readHops(env.TRUST_PROXY_HOPS) ?? DEFAULT_TRUST_PROXY_HOPS;
}

// → { production, errors, warnings }: lists of messages. errors is empty outside production, where
// the same problems are warnings.
export function checkEnv(env = process.env) {
  const production = env.NODE_ENV === "production";
  const problems = [];
  const warnings = [];

  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !isSet(env[name]));
  for (const name of missing) problems.push(`${name} is not set.`);
  for (const name of SECRETS)
    if (isSet(env[name]) && env[name].length < MIN_SECRET_LENGTH)
      problems.push(
        `${name} is shorter than ${MIN_SECRET_LENGTH} characters. Generate one with: node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))'`,
      );

  if (
    isSet(env.ACCESS_TOKEN_SECRET) &&
    env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET
  )
    warnings.push(
      "ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET are the same. Use two different values.",
    );

  if (isSet(env.TRUST_PROXY_HOPS) && readHops(env.TRUST_PROXY_HOPS) === null)
    warnings.push(
      `TRUST_PROXY_HOPS must be a whole number from 0 to ${MAX_TRUST_PROXY_HOPS}; using ${DEFAULT_TRUST_PROXY_HOPS}.`,
    );

  const cloudinaryMissing = CLOUDINARY.filter((name) => !isSet(env[name]));
  if (cloudinaryMissing.length)
    warnings.push(
      `Cloudinary isn't configured (${cloudinaryMissing.join(", ")} not set): ID-card, photo and evidence uploads answer 503.`,
    );

  if (!isSet(env.SMTP_HOST))
    warnings.push(
      production
        ? "SMTP_HOST is not set: no email is sent, so new members never get their sign-up codes."
        : "SMTP_HOST is not set: emails, sign-up codes included, are written to the log instead of sent.",
    );
  else {
    if (isSet(env.SMTP_USER) !== isSet(env.SMTP_PASS))
      warnings.push(
        "Only one of SMTP_USER and SMTP_PASS is set. Brevo and Gmail need both.",
      );
    if (!isSet(env.MAIL_FROM))
      warnings.push(
        "MAIL_FROM is not set: mail goes out from a placeholder address that SMTP providers refuse or mark as spam. Use the sender your SMTP account has verified.",
      );
  }

  return production
    ? { production, errors: problems, warnings }
    : { production, errors: [], warnings: [...problems, ...warnings] };
}

const countRealAccounts = () =>
  User.countDocuments({ email: { $not: DEMO_EMAIL } });

// After MongoDB connects: a warning (or null) when DEMO_MODE is on while accounts outside the demo
// domain exist. Anyone can then sign in as the demo admin or manager with one click, and outside the
// ID-verification queue and badge grants those accounts act as real staff on real members' data.
// Never fails the boot: a failed count is a warning too.
export async function checkDemoMode({
  on = demoMode(),
  count = countRealAccounts,
} = {}) {
  if (!on) return null;
  let realAccounts;
  try {
    realAccounts = await count();
  } catch {
    return "DEMO_MODE is true, and the users couldn't be counted to check for real accounts.";
  }
  if (!realAccounts) return null;
  const accounts =
    realAccounts === 1
      ? "1 account outside the demo domain exists"
      : `${realAccounts} accounts outside the demo domain exist`;
  return `DEMO_MODE is true, but ${accounts}. Anyone can sign in as the demo admin or manager with one click, and outside the ID-verification queue and badge grants those act as real staff on real members' bookings, incidents and names. Keep this deployment demo-only, or set DEMO_MODE=false.`;
}

// Logs every warning and error through `logger`. → false when the server must not start.
export function reportEnv(logger, env = process.env) {
  const { production, errors, warnings } = checkEnv(env);
  for (const message of warnings) logger.warn(message);
  for (const message of errors) logger.fatal(message);
  if (errors.length)
    logger.fatal(
      `Refusing to start in production with ${errors.length === 1 ? "this problem" : "these problems"}. Set the variables on the host (server/.env.example lists them).`,
    );
  return !(production && errors.length);
}
