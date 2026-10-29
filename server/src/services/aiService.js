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

/** GET /ai/quota → { used, limit, remaining, resetsAt, configured }. */
export async function myAiQuota(userId, { network = null, now } = {}) {
  const user = await requireUser(userId);
  const { userId: subject, pool } = aiQuotaFor(user, network);
  return { ...(await getAiQuota(subject, now, { pool })), configured: aiConfigured() };
}
