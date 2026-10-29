// The Gemini REST client (src/config/gemini.js): the request it sends, and how each kind of failure
// comes back (a 429 keeps its status for the circuit breaker; everything else is a 503 to act on).
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { setLogger } from "../../src/lib/log.js";
import {
  DEFAULT_GEMINI_MODEL,
  aiConfigured,
  generateJson,
  requireAiConfigured,
  useAiClient,
} from "../../src/config/gemini.js";

setLogger({ info() {}, warn() {}, error() {} });

const realFetch = globalThis.fetch;
let calls;

function answer(status, body) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

const ok = (json) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP" }] });
const SCHEMA = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } };

beforeEach(() => {
  calls = [];
  useAiClient(null);
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.GEMINI_MODEL;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
  useAiClient(null);
});

describe("generateJson", () => {
  test("posts the parts, schema and system text to the model, with the key in a header, and parses the JSON", async () => {
    answer(200, ok({ ok: true }));
    const result = await generateJson({
      system: "Be brief.",
      parts: [{ text: "Hello" }, { image: { mimeType: "image/jpeg", data: "AAAA" } }],
      schema: SCHEMA,
    });
    assert.deepEqual(result, { ok: true });
    const [{ url, init, body }] = calls;
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    assert.equal(init.headers["x-goog-api-key"], "test-gemini-key");
    assert.doesNotMatch(url, /test-gemini-key/, "the key never goes in the URL, where logs would keep it");
    assert.deepEqual(body.contents[0].parts, [{ text: "Hello" }, { inlineData: { mimeType: "image/jpeg", data: "AAAA" } }]);
    assert.deepEqual(body.generationConfig.responseSchema, SCHEMA);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.systemInstruction, { parts: [{ text: "Be brief." }] });
    assert.ok(init.signal instanceof AbortSignal, "every call has a timeout");
    // A Flash model is told not to spend its time thinking.
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  });

  test("no system text means no systemInstruction; a non-Flash model keeps its default thinking", async () => {
    process.env.GEMINI_MODEL = "gemini-2.5-pro";
    answer(200, ok({ ok: true }));
    await generateJson({ parts: [{ text: "x" }], schema: SCHEMA });
    assert.equal("systemInstruction" in calls[0].body, false);
    assert.equal("thinkingConfig" in calls[0].body.generationConfig, false);
  });

  test("the key and model are trimmed, and a leading models/ is dropped", async () => {
    process.env.GEMINI_API_KEY = "  test-gemini-key  ";
    process.env.GEMINI_MODEL = " models/gemini-test-model ";
    answer(200, ok({ ok: true }));
    await generateJson({ parts: [{ text: "x" }], schema: SCHEMA });
    assert.match(calls[0].url, /\/models\/gemini-test-model:generateContent$/);
    assert.equal(calls[0].init.headers["x-goog-api-key"], "test-gemini-key");
    process.env.GEMINI_API_KEY = "   ";
    assert.equal(aiConfigured(), false, "a key of spaces isn't a key");
  });

  test("GEMINI_MODEL picks the model", async () => {
    process.env.GEMINI_MODEL = "gemini-test-model";
    answer(200, ok({ ok: true }));
    await generateJson({ parts: [{ text: "x" }], schema: SCHEMA });
    assert.match(calls[0].url, /\/models\/gemini-test-model:generateContent$/);
  });

  test("a Gemini 429 keeps its status, so the quota opens the circuit", async () => {
    answer(429, { error: { message: "Resource exhausted" } });
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), (err) => err.status === 429);
  });

  test("other failures are a 503 AI_UNAVAILABLE: an HTTP error, an empty answer, JSON that doesn't parse", async () => {
    const isUnavailable = (err) => err.status === 503 && err.code === "AI_UNAVAILABLE";
    answer(500, "oops");
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), isUnavailable);
    answer(200, { candidates: [{ finishReason: "SAFETY" }] });
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), isUnavailable);
    answer(200, { candidates: [{ content: { parts: [{ text: "not json" }] } }] });
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), isUnavailable);
    globalThis.fetch = async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), isUnavailable);
  });

  test("a failure Google worked on is marked reachedAi (charged); one it never processed isn't (refunded)", async () => {
    const reached = (expected) => (err) => err.status === 503 && err.reachedAi === expected;
    for (const [status, body] of [[500, "oops"], [200, { candidates: [{ finishReason: "SAFETY" }] }], [200, { candidates: [{ content: { parts: [{ text: "not json" }] } }] }]]) {
      answer(status, body);
      await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), reached(true));
    }
    globalThis.fetch = async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), reached(true));
    answer(400, { error: { status: "INVALID_ARGUMENT" } });
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), reached(false));
    answer(503, { error: { status: "UNAVAILABLE", message: "The model is overloaded." } });
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), reached(false), "Google's overload is refunded");
    answer(504, { error: { status: "DEADLINE_EXCEEDED" } });
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), reached(true));
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), reached(false));
  });

  test("the answer's length is capped, and broken JSON's error doesn't carry the model's text", async () => {
    answer(200, ok({ ok: true }));
    await generateJson({ parts: [{ text: "x" }], schema: SCHEMA, maxOutputTokens: 300 });
    assert.equal(calls[0].body.generationConfig.maxOutputTokens, 300);
    calls = [];
    await generateJson({ parts: [{ text: "x" }], schema: SCHEMA });
    assert.ok(calls[0].body.generationConfig.maxOutputTokens > 0, "a default cap");
    answer(200, { candidates: [{ content: { parts: [{ text: "Here is the secret plan" }] } }] });
    const err = await generateJson({ parts: [{ text: "x" }], schema: SCHEMA }).catch((e) => e);
    assert.equal(JSON.stringify({ message: err.message, cause: String(err.cause ?? "") }).includes("Here is"), false);
  });

  test("without a key nothing is sent, and the answer is 503", async () => {
    delete process.env.GEMINI_API_KEY;
    answer(200, ok({ ok: true }));
    assert.equal(aiConfigured(), false);
    assert.throws(() => requireAiConfigured(), (err) => err.status === 503);
    await assert.rejects(generateJson({ parts: [{ text: "x" }], schema: SCHEMA }), (err) => err.status === 503);
    assert.equal(calls.length, 0);
  });

  test("useAiClient swaps in a fake for the tests", async () => {
    delete process.env.GEMINI_API_KEY;
    useAiClient({ generateJson: async ({ parts }) => ({ echoed: parts[0].text }) });
    assert.equal(aiConfigured(), true);
    assert.deepEqual(await generateJson({ parts: [{ text: "hi" }], schema: SCHEMA }), { echoed: "hi" });
  });
});
