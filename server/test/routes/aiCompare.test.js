// POST /bookings/:id/ai-compare over HTTP, with a fake Gemini (useAiClient) and a fake photo fetcher
// (usePhotoFetcher): who may ask, which bookings qualify, what reaches the model, the cache, and the
// failure paths. A real MongoDB through fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { useAiClient } from "../../src/config/gemini.js";
import { Booking, ConditionReport, User } from "../../src/models/index.js";
import { checkIn, checkOut, transition } from "../../src/services/bookingService.js";
import { usePhotoFetcher } from "../../src/services/photoCompareService.js";
import { NOW, TUE, bookAs, plus, skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f;
let sent;
let fetched;

const photo = (name) => ({
  publicId: `campuscommons/photos/${name}`,
  url: `https://res.cloudinary.com/campus-test/image/upload/v1730000000/campuscommons/photos/${name}.jpg`,
});
const report = (resource, photos, notes) => ({
  items: resource.checklist.map((label) => ({ label, ok: true, note: "Kabir Singh said it was fine" })),
  photos,
  overall: "good",
  notes,
});

// A checked-out booking of the printer, with `before` photos at pickup and `after` at return.
async function returned({ before = [photo("b1"), photo("b2")], after = [photo("a1")], who = f.student } = {}) {
  const { booking } = await bookAs(who, f.printer, TUE);
  await transition(booking._id, "approve", f.manager._id, {}, { now: NOW });
  await checkIn(booking._id, who._id, report(f.printer, before, "Ananya Rao, 2025ugcs070"), { now: plus(TUE.start, -10) });
  // Straight to the database: check-out refuses a pickup photo, which one test needs to store.
  await checkOut(booking._id, who._id, report(f.printer, [], "returned by Ananya"), { now: TUE.end });
  if (after.length) await ConditionReport.updateOne({ booking: booking._id, phase: "check_out" }, { photos: after });
  return booking;
}

function fakeGemini(answer = { summary: "A new scratch on the plate.", comparable: true, newDamageLikely: true, differences: [{ description: "Scratch", severity: "minor" }] }) {
  sent = [];
  useAiClient({
    generateJson: async (request) => {
      sent.push(request);
      return answer;
    },
  });
}

function fakePhotos(answer = () => new Response(Buffer.from("jpeg-bytes"), { headers: { "content-type": "image/jpeg" } })) {
  fetched = [];
  usePhotoFetcher(async (url, init) => {
    fetched.push({ url, redirect: init?.redirect });
    return answer(url);
  });
}

describe("POST /bookings/:id/ai-compare", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();
  const compare = (booking, user) => api.call("POST", `/bookings/${booking._id ?? booking}/ai-compare`, { user });

  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = "campus-test";
    process.env.AI_USER_DAILY_LIMIT = "5";
    process.env.AI_DEMO_DAILY_LIMIT = "30";
    process.env.AI_USER_BURST_SECONDS = "0";
    process.env.AI_GLOBAL_RPM = "100";
    process.env.AI_GLOBAL_DAILY_LIMIT = "1000";
    fakePhotos();
  });
  afterEach(() => {
    useAiClient(null);
    usePhotoFetcher(null);
  });

  test("the unit's manager gets Gemini's comparison of the pickup and return photos, checked", async () => {
    fakeGemini();
    const booking = await returned();
    const res = await compare(booking, f.manager);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { comparison, photos, cached, quota } = res.body.data;
    assert.deepEqual(comparison, {
      summary: "A new scratch on the plate.",
      comparable: true,
      newDamageLikely: true,
      differences: [{ description: "Scratch", severity: "minor", checklistItem: null }],
    });
    assert.deepEqual(photos, { before: 2, after: 1 });
    assert.equal(cached, false);
    assert.equal(quota.used, 1);
    assert.deepEqual(
      fetched.map((r) => r.url),
      ["b1", "b2", "a1"].map((n) => `https://res.cloudinary.com/campus-test/image/upload/w_768,h_768,c_limit,q_auto:eco,f_jpg/campuscommons/photos/${n}`),
    );
    assert.ok(fetched.every((r) => r.redirect === "error"));
  });

  test("Gemini gets the photos and the checklist labels, and nothing about the people", async () => {
    fakeGemini();
    await compare(await returned(), f.manager);
    const [{ parts, system }] = sent;
    assert.equal(parts.filter((p) => p.image).length, 3);
    assert.ok(parts.every((p) => !p.image || p.image.mimeType === "image/jpeg"));
    const text = [system, ...parts.filter((p) => p.text).map((p) => p.text)].join("\n");
    for (const label of f.printer.checklist) assert.ok(text.includes(label), label);
    for (const secret of ["Ananya", "Kabir", "2025ugcs070", f.student.email, "returned by"]) {
      assert.equal(text.includes(secret), false, `the prompt carries ${secret}`);
    }
  });

  test("the same photos again come from the cache, for any of the unit's staff, and cost nothing", async () => {
    fakeGemini();
    const booking = await returned();
    await compare(booking, f.manager);
    const again = await compare(booking, f.admin);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.cached, true);
    assert.equal(again.body.data.quota.used, 0);
    assert.equal(sent.length, 1);
    assert.equal(fetched.length, 3, "the photos weren't fetched again");
  });

  test("only the unit's managers and admins: another unit's manager and the borrower get 403", async () => {
    fakeGemini();
    const booking = await returned();
    assert.equal((await compare(booking, f.cseManager)).status, 403);
    assert.equal((await compare(booking, f.student)).status, 403);
    assert.equal((await compare(booking, f.admin)).status, 200);
    assert.equal((await compare("64a0000000000000000000ff", f.manager)).status, 404);
    assert.equal((await compare("not-an-id", f.manager)).status, 404);
  });

  test("a suspended manager is refused before anything is spent", async () => {
    fakeGemini();
    const booking = await returned();
    await User.updateOne({ _id: f.manager._id }, { suspendedUntil: plus(new Date(), 60), suspensionReason: "Test" });
    assert.equal((await compare(booking, f.manager)).status, 403);
    assert.equal(sent.length, 0);
  });

  test("409 before the item is back, or without photos at both handovers", async () => {
    fakeGemini();
    const { booking } = await bookAs(f.student2, f.printer, TUE);
    const early = await compare(booking, f.manager);
    assert.equal(early.status, 409);
    assert.match(early.body.error.message, /once the item has been checked out/);
    await transition(booking._id, "cancel", f.student2._id, {}, { now: NOW });
    const noReturnPhotos = await returned({ after: [] });
    const res = await compare(noReturnPhotos, f.manager);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /none at return/);
    assert.equal(sent.length, 0);
  });

  test("a small photo Cloudinary can't make falls back to the original; no photo at all is a refunded 503", async () => {
    fakeGemini();
    const booking = await returned();
    fakePhotos((url) =>
      url.includes("w_768")
        ? new Response("nope", { status: 404, headers: { "content-type": "text/plain" } })
        : new Response(Buffer.from("png"), { headers: { "content-type": "image/png" } }),
    );
    const ok = await compare(booking, f.manager);
    assert.equal(ok.status, 200);
    assert.ok(sent[0].parts.filter((p) => p.image).every((p) => p.image.mimeType === "image/png"));

    const other = await returned({ before: [photo("c1")], after: [photo("c2")] });
    fakePhotos(() => new Response("<html>", { headers: { "content-type": "text/html" } }));
    const res = await compare(other, f.manager);
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "AI_UNAVAILABLE");
    assert.match(res.body.error.message, /photos couldn't be loaded/);
    assert.equal(sent.length, 1, "Gemini wasn't asked");
    const quota = await api.call("GET", "/ai/quota", { user: f.manager });
    assert.equal(quota.body.data.used, 1, "only the first comparison counts");
  });

  test("photos that can't be loaded spend nothing, not even the campus-wide counters", async () => {
    process.env.AI_GLOBAL_DAILY_LIMIT = "2";
    process.env.AI_USER_BURST_SECONDS = "0";
    fakeGemini();
    const broken = await returned();
    fakePhotos(() => new Response("gone", { status: 404, headers: { "content-type": "text/plain" } }));
    for (let i = 0; i < 3; i++) assert.equal((await compare(broken, f.manager)).status, 503);
    assert.equal(sent.length, 0);
    fakePhotos();
    await transition(broken._id, "confirmOk", f.manager._id, { outcome: "ok" }, { now: TUE.end }).catch(() => {});
    const other = await returned({ before: [photo("ok1")], after: [photo("ok2")], who: f.student2 });
    const res = await compare(other, f.admin);
    assert.equal(res.status, 200, "the failures didn't use up the global cap");
  });

  test("return photos that are the pickup photos: 409, and Gemini isn't asked", async () => {
    fakeGemini();
    const same = await returned({ before: [photo("s1"), photo("s2")], after: [photo("s2")] });
    const res = await compare(same, f.manager);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /same files as the pickup photos/);
    assert.equal(sent.length, 0);
  });

  test("only photos the app uploaded are fetched; a stored id with a transformation is left out", async () => {
    fakeGemini();
    const booking = await returned();
    await ConditionReport.updateOne(
      { booking: booking._id, phase: "check_out" },
      { photos: [{ publicId: "l_pristine/fl_layer_apply/campuscommons/photos/a1", url: "https://res.cloudinary.com/campus-test/image/upload/x.jpg" }] },
    );
    const res = await compare(booking, f.manager);
    assert.equal(res.status, 409);
    assert.equal(fetched.length, 0);
  });

  test("the manager's own return photos stand in when the borrower took none at return", async () => {
    fakeGemini();
    const booking = await returned({ after: [] });
    await ConditionReport.create({
      booking: booking._id,
      resource: f.printer._id,
      phase: "return_confirmation",
      items: [],
      photos: [photo("m1")],
      overall: "good",
      submittedBy: f.manager._id,
    });
    await Booking.updateOne({ _id: booking._id }, { status: "completed" });
    const res = await compare(booking, f.manager);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.photos, { before: 2, after: 1 });
    assert.ok(fetched.some((r) => r.url.endsWith("/campuscommons/photos/m1")));
  });

  test("the demo admin can't send a real member's photos to Gemini (404)", async () => {
    fakeGemini();
    const booking = await returned();
    await User.updateOne({ _id: f.student._id }, { email: "2025ugcs001@nitjsr.ac.in" });
    assert.equal((await compare(booking, f.admin)).status, 404);
    assert.equal(sent.length, 0);
  });

  test("without a Cloudinary cloud name: 503 before anything is fetched or spent", async () => {
    fakeGemini();
    const booking = await returned();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    const res = await compare(booking, f.manager);
    assert.equal(res.status, 503);
    assert.equal(fetched.length, 0);
    const quota = await api.call("GET", "/ai/quota", { user: f.manager });
    assert.equal(quota.body.data.used, 0);
  });

  test("Gemini is asked for at most six differences and whether the photos could be compared", async () => {
    fakeGemini({ summary: "The return photo shows a different item.", comparable: false, newDamageLikely: true, differences: [] });
    const res = await compare(await returned(), f.manager);
    assert.equal(sent[0].schema.properties.differences.maxItems, 6);
    assert.ok(sent[0].schema.required.includes("comparable"));
    assert.equal(res.body.data.comparison.comparable, false);
    assert.equal(res.body.data.comparison.newDamageLikely, false, "no verdict on photos that can't be compared");
  });

  test("check-out refuses a photo that was already used at check-in", async () => {
    const { booking } = await bookAs(f.student, f.printer, TUE);
    await transition(booking._id, "approve", f.manager._id, {}, { now: NOW });
    await checkIn(booking._id, f.student._id, report(f.printer, [photo("p1")]), { now: plus(TUE.start, -10) });
    const err = await checkOut(booking._id, f.student._id, report(f.printer, [photo("n1"), photo("p1")]), { now: TUE.end }).catch((e) => e);
    assert.equal(err.status, 400);
    assert.deepEqual(err.details, [{ path: "photos.1", message: "This photo was used at check-in. Take a new one of the item as it is now." }]);
    const ok = await checkOut(booking._id, f.student._id, report(f.printer, [photo("n1")]), { now: TUE.end });
    assert.equal(ok.status, "checked_out");
  });

  test("without a Gemini key: 503 before any photo is fetched or quota spent", async () => {
    useAiClient(null);
    delete process.env.GEMINI_API_KEY;
    const res = await compare(await returned(), f.manager);
    assert.equal(res.status, 503);
    assert.equal(fetched.length, 0);
  });
});
