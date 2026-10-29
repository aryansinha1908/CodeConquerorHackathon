// Google Gemini over its REST API (architecture.md §15), with Node's own fetch: no SDK. Every call goes
// through services/aiQuotaService.js withAiQuota(), which caps usage, caches answers and opens a circuit
// on a Gemini 429. This module only talks to Google and turns its failures into the API's errors.
//
// GEMINI_API_KEY and GEMINI_MODEL are read on each call, after dotenv has run. Without a key, AI routes
// answer 503 AI_UNAVAILABLE and nothing is reserved from the quota. Tests swap in a fake with
// useAiClient({ generateJson }), as useUploader() and useMailTransport() do.
import { log } from "../lib/log.js";
import { AiUnavailableError } from "../services/aiQuotaService.js";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// architecture.md §15.1 asks for 8 s; image comparisons pass their own, longer timeout.
const DEFAULT_TIMEOUT_MS = 12_000;
// Each feature's answer is a few hundred tokens; the cap stops a question that asks for an essay.
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

let override = null;

export function useAiClient(next) {
  override = next;
}

const apiKey = () => (process.env.GEMINI_API_KEY ?? "").trim();

export const aiConfigured = () => Boolean(override || apiKey());

// "models/gemini-2.5-flash" (as AI Studio sometimes shows it) and "gemini-2.5-flash" both work.
export const geminiModel = () =>
  (process.env.GEMINI_MODEL ?? "").trim().replace(/^models\//, "") || DEFAULT_GEMINI_MODEL;

// Throws before any quota is spent when there is nothing to call.
export function requireAiConfigured() {
  if (!aiConfigured()) {
    throw new AiUnavailableError("AI isn't set up on this server yet. Regular search still works.");
  }
}

// { text } stays as it is; { image: { mimeType, data } } (data in base64) becomes inline data.
function toPart(part) {
  if (part.image) return { inlineData: { mimeType: part.image.mimeType, data: part.image.data } };
  return { text: String(part.text ?? "") };
}

// A Gemini 429 keeps its status, so withAiQuota() refunds the user and opens the circuit; always call
// this through withAiQuota(), which turns that 429 into a 503 too. Anything else (timeouts, 5xx, a
// refusal, JSON that doesn't parse) is a 503 the member can act on. Only the HTTP status and Google's
// error status are logged: an error body can quote the prompt, which may hold a member's question.
//
// `reachedAi` says whether Google worked on the request (a timeout, a 5xx, a blocked, empty or broken
// answer). withAiQuota() charges those: refunding them would let anyone who can make Gemini fail (a
// question asking for a very long answer, say) retry for free until the campus-wide cap is gone. A
// request Google never processed (no connection, a 4xx other than 429, a 503 "overloaded") is refunded.
function unavailable(reason, err, { reachedAi }) {
  log.warn({ reason, status: err?.status, googleStatus: err?.googleStatus }, "Gemini call failed");
  const failure = new AiUnavailableError("AI couldn't answer just now. Regular search still works.", err ? { cause: err } : undefined);
  failure.reachedAi = reachedAi;
  return failure;
}

/**
 * One Gemini request that must answer JSON matching `schema` (Gemini's OpenAPI subset: OBJECT, ARRAY,
 * STRING, INTEGER, BOOLEAN). parts: [{ text } | { image: { mimeType, data } }]. → the parsed object.
 * An answer cut off at maxOutputTokens doesn't parse, so it is a 503 too.
 */
export async function generateJson({
  system,
  parts,
  schema,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
}) {
  if (override) return override.generateJson({ system, parts, schema, temperature });
  requireAiConfigured();

  const model = geminiModel();
  const body = {
    contents: [{ role: "user", parts: parts.map(toPart) }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature,
      maxOutputTokens,
      // Flash models think before answering unless told not to; these tasks don't need it, and the
      // thinking would eat the timeout. Other models keep their default.
      ...(/flash/.test(model) && { thinkingConfig: { thinkingBudget: 0 } }),
    },
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
  };

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timeout = err?.name === "TimeoutError";
    throw unavailable(timeout ? "timeout" : "network", err, { reachedAi: timeout });
  }

  if (!res.ok) {
    // Google's error status ("INVALID_ARGUMENT", "NOT_FOUND" for a wrong model name) says what to fix.
    const googleStatus = await res
      .json()
      .then((b) => b?.error?.status ?? null)
      .catch(() => null);
    const err = Object.assign(new Error(`Gemini answered HTTP ${res.status}`), { status: res.status, googleStatus });
    if (res.status === 429) throw err;
    // 503 UNAVAILABLE is Google's "overloaded": nothing was processed, and no one can cause it, so
    // it is refunded. Any other 5xx (500, a 504 deadline) may have done the work, so it is charged.
    throw unavailable(`http_${res.status}`, err, { reachedAi: res.status >= 500 && res.status !== 503 });
  }

  const answer = await res.json().catch(() => null);
  const candidate = answer?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    const why = candidate?.finishReason ?? answer?.promptFeedback?.blockReason ?? "none";
    throw unavailable(`empty:${why}`, null, { reachedAi: true });
  }
  try {
    return JSON.parse(text);
  } catch {
    // No cause: a SyntaxError's message quotes the start of the model's text.
    throw unavailable("bad_json", null, { reachedAi: true });
  }
}
