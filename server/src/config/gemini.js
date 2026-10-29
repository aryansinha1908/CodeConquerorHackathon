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
const DEFAULT_TIMEOUT_MS = 25_000;

let override = null;

export function useAiClient(next) {
  override = next;
}

export const aiConfigured = () => Boolean(override || process.env.GEMINI_API_KEY);

export const geminiModel = () => process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

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

// A Gemini 429 keeps its status, so withAiQuota() refunds the user and opens the circuit. Anything else
// (timeouts, 5xx, a refusal, JSON that doesn't parse) is a 503 the member can act on.
function unavailable(reason, err) {
  log.warn({ err, reason }, "Gemini call failed");
  return new AiUnavailableError("AI couldn't answer just now. Regular search still works.", { cause: err });
}

/**
 * One Gemini request that must answer JSON matching `schema` (Gemini's OpenAPI subset: OBJECT, ARRAY,
 * STRING, INTEGER, BOOLEAN). parts: [{ text } | { image: { mimeType, data } }]. → the parsed object.
 */
export async function generateJson({ system, parts, schema, temperature = 0.2, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (override) return override.generateJson({ system, parts, schema, temperature });
  requireAiConfigured();

  const body = {
    contents: [{ role: "user", parts: parts.map(toPart) }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature },
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
  };

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(geminiModel())}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw unavailable(err?.name === "TimeoutError" ? "timeout" : "network", err);
  }

  if (!res.ok) {
    // The body explains a 400 (bad model name, bad schema); it never carries the key.
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    const err = Object.assign(new Error(`Gemini answered HTTP ${res.status}`), { status: res.status, detail });
    if (res.status === 429) throw err;
    throw unavailable(`http_${res.status}`, err);
  }

  const answer = await res.json().catch(() => null);
  const candidate = answer?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw unavailable(`empty:${candidate?.finishReason ?? answer?.promptFeedback?.blockReason ?? "none"}`);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw unavailable("bad_json", err);
  }
}
