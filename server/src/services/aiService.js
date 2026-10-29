// What the AI features share: whose quota a request spends, and the quota read for the meter.
//
// The quota (aiQuotaService.js) counts per user. A demo account is one user for everyone who clicks its
// role button, so judges would spend each other's daily AI requests. For a demo account the per-user
// counter is therefore kept per account and visitor address (visitorKey(req)), and every demo account
// also draws on one shared daily pool (AI_DEMO_DAILY_LIMIT, below the global cap). A direct caller who
// forges a new address on each request only gets fresh per-visitor counters: the pool still stops
// them before they reach what real members need.
import { aiConfigured } from "../config/gemini.js";
import { getAiQuota } from "./aiQuotaService.js";
import { isDemoAccount } from "./authService.js";
import { requireUser } from "./params.js";

/**
 * Whose quota `user` (with an email) spends, calling from `network` (visitorKey(req), or null):
 * → { userId: the per-user counter's key, pool: "demo" | null }, the arguments withAiQuota() takes.
 */
export function aiQuotaFor(user, network) {
  const id = String(user._id ?? user.id);
  if (!isDemoAccount(user)) return { userId: id, pool: null };
  return { userId: network ? `${id}@${network}` : id, pool: "demo" };
}

// Characters that print nothing or reorder text: control characters, zero-width and bidi controls.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g;

/** Text for a prompt or from a model: invisible characters out, spaces collapsed, cut at `max` with "…". */
export function cleanText(text, max = Infinity) {
  const clean = String(text ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// NIT Jamshedpur roll numbers: 2025ugcs070, 2024PGCS012.
const ROLL_NUMBER = /\b(?:19|20)\d{2}[a-z]{2,6}\d{2,4}\b/gi;
// A run of digits, spaces and dashes (optionally after +) holding 10 to 13 digits: a phone number.
const DIGIT_RUN = /\+?\d[\d\s-]{8,}\d/g;
const digits = (text) => text.replace(/\D/g, "").length;
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|in|io|co|me|app|dev|xyz|info|link|ly|site|online|example)\b/i;

/**
 * Personal details out of text bound for an AI provider (architecture.md §15.3): emails, roll numbers
 * and phone numbers become placeholders. Staff-written resource text and a member's question can both
 * carry them although the page asks not to.
 */
export function redactPersonal(text) {
  return String(text ?? "")
    .replace(EMAIL, "[email]")
    .replace(ROLL_NUMBER, "[roll number]")
    .replace(DIGIT_RUN, (run) => (digits(run) >= 10 && digits(run) <= 13 ? "[phone]" : run));
}

/** Whether model-written text points somewhere (a link, an email, a phone number): never shown as is. */
export function hasContactDetails(text) {
  const value = String(text ?? "");
  return LINK.test(value) || /@[a-z0-9-]+\./i.test(value) || [...value.matchAll(DIGIT_RUN)].some((m) => digits(m[0]) >= 10);
}

/** GET /ai/quota → { used, limit, remaining, resetsAt, configured }. */
export async function myAiQuota(userId, { network = null, now } = {}) {
  const user = await requireUser(userId);
  const { userId: subject, pool } = aiQuotaFor(user, network);
  return { ...(await getAiQuota(subject, now, { pool })), configured: aiConfigured() };
}
