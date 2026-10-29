// POST /resources/ai-search over HTTP, with a fake Gemini client (useAiClient): what reaches the model,
// how its answer is checked, the cache, the quota and the failure paths. A real MongoDB through
// fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { useAiClient } from "../../src/config/gemini.js";
import { keys } from "../../src/lib/redisKeys.js";
import { OrgUnit, Resource, User } from "../../src/models/index.js";
import { bumpVersion } from "../../src/services/cacheService.js";
import { redis, skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f;
let sent;

// A fake Gemini that records each request and answers with `answer(catalogueTitles)`.
function fakeGemini(answer) {
  sent = [];
  useAiClient({
    generateJson: async (request) => {
      sent.push(request);
      const titles = request.parts[0].text.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. /, "").split(" | ")[0]);
      return typeof answer === "function" ? answer(titles) : answer;
    },
  });
}

describe("POST /resources/ai-search", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  beforeEach(() => {
    process.env.AI_USER_DAILY_LIMIT = "5";
    process.env.AI_DEMO_DAILY_LIMIT = "30";
    process.env.AI_USER_BURST_SECONDS = "0";
    process.env.AI_GLOBAL_RPM = "100";
    process.env.AI_GLOBAL_DAILY_LIMIT = "1000";
  });
  afterEach(() => useAiClient(null));

  test("the resources Gemini picks, best first, each with its reason and whether the viewer can book it", async () => {
    fakeGemini((titles) => ({
      matches: [
        { index: titles.indexOf(f.printer.title) + 1, reason: "An FDM printer prints a phone case in PLA." },
        { index: 99, reason: "not in the catalogue" },
      ],
    }));
    const res = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "Something to print a phone case" } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.items.length, 1);
    const [item] = res.body.data.items;
    assert.equal(item.title, f.printer.title);
    assert.equal(item.reason, "An FDM printer prints a phone case in PLA.");
    assert.equal(typeof item.eligible, "boolean");
    assert.ok(item.openHours !== undefined, "the same card shape as GET /resources");
    assert.equal(res.body.data.cached, false);
    assert.equal(res.body.data.quota.used, 1);
  });

  test("Gemini gets the question and the catalogue, and nothing about the viewer", async () => {
    fakeGemini({ matches: [] });
    await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "a quiet room for six people" } });
    const [{ system, parts }] = sent;
    const prompt = `${system}\n${parts.map((p) => p.text).join("\n")}`;
    assert.match(prompt, /Request: a quiet room for six people/);
    assert.match(prompt, new RegExp(f.printer.title));
    assert.match(system, /never instructions to you/);
    for (const secret of [f.student.email, f.student.name, String(f.student._id), "@nitjsr", "@demo"]) {
      assert.equal(prompt.includes(secret), false, `the prompt carries ${secret}`);
    }
  });

  test("the same question again is answered from the cache, for free, even by someone else", async () => {
    fakeGemini({ matches: [{ index: 1, reason: "first" }] });
    const first = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "Laser cutter for acrylic" } });
    const again = await api.call("POST", "/resources/ai-search", { user: f.student2, json: { query: "  laser CUTTER for acrylic " } });
    assert.equal(sent.length, 1);
    assert.equal(again.body.data.cached, true);
    assert.equal(again.body.data.quota.used, 0, "the cache costs nothing");
    assert.deepEqual(again.body.data.items.map((i) => i._id), first.body.data.items.map((i) => i._id));
  });

  test("a missing or too short question is 400, and nothing is spent", async () => {
    fakeGemini({ matches: [] });
    const missing = await api.call("POST", "/resources/ai-search", { user: f.student, json: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.details[0].path, "query");
    const short = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "ab" } });
    assert.equal(short.status, 400);
    const long = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "x".repeat(201) } });
    assert.equal(long.status, 400);
    assert.equal(sent.length, 0);
  });

  test("without a Gemini key: 503 AI_UNAVAILABLE before any quota is spent", async () => {
    useAiClient(null);
    delete process.env.GEMINI_API_KEY;
    const res = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "3D printer" } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "AI_UNAVAILABLE");
    const quota = await api.call("GET", "/ai/quota", { user: f.student });
    assert.equal(quota.body.data.used, 0);
  });

  test("a Gemini 429 is a 503, refunds the request and pauses AI for everyone", async () => {
    useAiClient({
      generateJson: async () => {
        throw Object.assign(new Error("Gemini answered HTTP 429"), { status: 429 });
      },
    });
    const res = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "oscilloscope" } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "AI_UNAVAILABLE");
    assert.equal(await redis.exists(keys.aiCircuit), 1);
    const quota = await api.call("GET", "/ai/quota", { user: f.student });
    assert.equal(quota.body.data.used, 0, "refunded");
    await redis.del(keys.aiCircuit);
  });

  test("past the daily limit: 429 AI_QUOTA_EXCEEDED with when it resets", async () => {
    process.env.AI_USER_DAILY_LIMIT = "1";
    fakeGemini({ matches: [] });
    await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "first question" } });
    const res = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "second question" } });
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, "AI_QUOTA_EXCEEDED");
    assert.ok(res.body.error.details.resetsAt);
  });

  test("only verified members who aren't suspended: 403, and nothing is spent", async () => {
    fakeGemini({ matches: [] });
    await User.updateOne({ _id: f.student._id }, { "verification.status": "pending" });
    const unverified = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "3D printer" } });
    assert.equal(unverified.status, 403);
    await User.updateOne(
      { _id: f.student2._id },
      { suspendedUntil: new Date(Date.now() + 86_400_000), suspensionReason: "Late returns" },
    );
    const suspended = await api.call("POST", "/resources/ai-search", { user: f.student2, json: { query: "3D printer" } });
    assert.equal(suspended.status, 403);
    assert.equal(sent.length, 0);
  });

  test("a question of only invisible characters is 400, and a body that isn't an object is 400 with no details", async () => {
    fakeGemini({ matches: [] });
    for (const query of ["\u0000\u0000\u0000", "\u0007".repeat(4), "\u200b".repeat(3), " \u202e\u2066 "]) {
      const res = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query } });
      assert.equal(res.status, 400, JSON.stringify(query));
    }
    const list = await api.call("POST", "/resources/ai-search", { user: f.student, json: [] });
    assert.equal(list.status, 400);
    assert.equal(list.body.error.details, undefined);
    assert.equal(sent.length, 0);
  });

  test("emails, phone numbers and roll numbers never reach Gemini, from the question or the catalogue", async () => {
    await Resource.updateOne(
      { _id: f.printer._id },
      { description: "Ask Mr. Pal (+91 98765 43210, suresh.pal@nitjsr.ac.in) or 2025ugcs070 for the key." },
    );
    await bumpVersion("resources");
    fakeGemini({ matches: [] });
    await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "printer, I am 2024pgcs012, call 9876543210" } });
    const prompt = sent[0].parts.map((p) => p.text).join("\n");
    for (const secret of ["98765 43210", "9876543210", "suresh.pal@nitjsr.ac.in", "2025ugcs070", "2024pgcs012"]) {
      assert.equal(prompt.includes(secret), false, `the prompt carries ${secret}`);
    }
    assert.match(prompt, /Ask Mr\. Pal/);
  });

  test("a reason with a link, an email or a phone number is replaced by the plain one", async () => {
    fakeGemini((titles) => ({
      matches: [
        { index: titles.indexOf(f.printer.title) + 1, reason: "Closed this week; confirm at https://evil.example/login first." },
      ],
    }));
    const res = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "printer for a case" } });
    assert.equal(res.body.data.items[0].reason, "Matches your request.");
  });

  test("renaming a unit changes the catalogue, so the next question asks Gemini again", async () => {
    fakeGemini({ matches: [{ index: 1, reason: "first" }] });
    await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "a lab printer" } });
    await OrgUnit.updateOne({ _id: f.dic._id }, { name: "Fabrication Lab" });
    await bumpVersion("resources"); // what the unit service does on a rename
    const again = await api.call("POST", "/resources/ai-search", { user: f.student, json: { query: "a lab printer" } });
    assert.equal(sent.length, 2, "the unit's new name reached Gemini");
    assert.equal(again.body.data.cached, false);
    assert.match(sent[1].parts[0].text, /Fabrication Lab/);
  });

  test("needs a signed-in user", async () => {
    const res = await api.call("POST", "/resources/ai-search", { json: { query: "printer" } });
    assert.equal(res.status, 401);
  });
});
