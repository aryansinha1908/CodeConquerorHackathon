// What the AI features share: whose quota a request spends, and the quota read for the meter.
//
// The quota (aiQuotaService.js) counts per user. A demo account is one user for everyone who clicks its
// role button, so judges would spend each other's daily AI requests. For a demo account the quota is
// therefore kept per account and network (the address chain the trusted proxies forwarded, as the
// demo sign-in limits do): one visitor can only use up their own network's share.
import { aiConfigured } from "../config/gemini.js";
import { getAiQuota } from "./aiQuotaService.js";
import { isDemoAccount } from "./authService.js";
import { requireUser } from "./params.js";

/** The quota key for `user` (with an email) calling from `network` (ipKey(req), or null). */
export function aiSubject(user, network) {
  const id = String(user._id ?? user.id);
  return isDemoAccount(user) && network ? `${id}@${network}` : id;
}

/** GET /ai/quota → { used, limit, remaining, resetsAt, configured }. */
export async function myAiQuota(userId, { network = null, now } = {}) {
  const user = await requireUser(userId);
  return { ...(await getAiQuota(aiSubject(user, network), now)), configured: aiConfigured() };
}
