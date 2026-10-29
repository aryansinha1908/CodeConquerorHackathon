// The QR booking pass over HTTP (POST /bookings/:id/pass, POST /bookings/scan): who may show and scan
// it, the pickup window, the typed code, the audit entry and the timeline line. A real MongoDB through
// fixtures.js (skipped without TEST_MONGODB_URI) and ioredis-mock.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import logger from "../../src/lib/logger.js";
import { AuditLog, Booking } from "../../src/models/index.js";
import { checkIn, transition } from "../../src/services/bookingService.js";
import { signPass } from "../../src/services/passService.js";
import { TUE, bookAs, checklistOk, plus, skip, useTestDatabase } from "../integration/fixtures.js";
import { useApi } from "./http.js";

logger.level = "silent";

let f;

// An approved booking on the DIC printer whose slot starts `minutes` from now (real time: the routes
// use the clock).
async function approvedStartingIn(minutes, who = () => f.student) {
  const { booking } = await bookAs(who(), f.printer, TUE);
  await transition(booking._id, "approve", f.manager._id, {}, { now: new Date("2026-11-02T04:30:00Z") });
  const start = plus(new Date(), minutes);
  await Booking.updateOne({ _id: booking._id }, { start, end: plus(start, 60) });
  return Booking.findById(booking._id).lean();
}

describe("QR booking pass", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });
  const api = useApi();

  test("the borrower gets a pass with a typed code; nobody else does; a pending request has none", async () => {
    const booking = await approvedStartingIn(5);
    const mine = await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.match(mine.body.data.token, /^cc1\./);
    assert.match(mine.body.data.code, /^[A-HJ-KM-NP-Z2-9]{6}$/);
    assert.equal(mine.body.data.phase, "pickup");
    assert.ok(Date.parse(mine.body.data.expiresAt) > Date.now());

    const someoneElse = await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student2 });
    assert.equal(someoneElse.status, 403);
    const manager = await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.manager });
    assert.equal(manager.status, 403, "the pass is the borrower's to show");

    const { booking: pending } = await bookAs(f.student2, f.printer, TUE);
    const none = await api.call("POST", `/bookings/${pending._id}/pass`, { user: f.student2 });
    assert.equal(none.status, 409);
  });

  test("the unit's manager scans it at pickup: verified, audited, on the timeline, next is check-in", async () => {
    const booking = await approvedStartingIn(5);
    const pass = (await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student })).body.data;
    const scan = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: pass.token } });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.equal(scan.body.data.phase, "pickup");
    assert.equal(scan.body.data.next, "check_in");
    assert.equal(scan.body.data.booking.borrower.name, f.student.name);
    assert.equal(scan.body.data.booking.resource.title, f.printer.title);
    assert.equal(scan.body.data.booking.borrower.email, undefined, "managers never see borrower emails");

    const [entry] = await AuditLog.find({ action: "booking.pass_verified" }).lean();
    assert.equal(String(entry.entity.id), String(booking._id));
    assert.equal(String(entry.actor.id), String(f.manager._id));
    assert.equal(entry.actor.role, "manager");
    assert.deepEqual(entry.meta, { phase: "pickup", status: "approved" });

    const timeline = await api.call("GET", `/bookings/${booking._id}/timeline`, { user: f.student });
    assert.ok(
      timeline.body.data.some((item) => /verified the borrower's pass at pickup/.test(item.text ?? "")),
      JSON.stringify(timeline.body.data.map((i) => i.text)),
    );
  });

  test("the typed code works like the QR, in any case and with a dash", async () => {
    const booking = await approvedStartingIn(5);
    const { code } = (await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student })).body.data;
    const typed = `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}`;
    const scan = await api.call("POST", "/bookings/scan", { user: f.manager, json: { code: typed } });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    const wrong = await api.call("POST", "/bookings/scan", { user: f.manager, json: { code: "ZZZZZZ" } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.details[0].path, "code");
  });

  test("only the unit's managers or an admin may scan, and never the borrower", async () => {
    const booking = await approvedStartingIn(5);
    const { token } = signPass(String(booking._id));
    assert.equal((await api.call("POST", "/bookings/scan", { user: f.student, json: { token } })).status, 403);
    assert.equal((await api.call("POST", "/bookings/scan", { user: f.student2, json: { token } })).status, 403);
    assert.equal((await api.call("POST", "/bookings/scan", { user: f.cseManager, json: { token } })).status, 403);
    const admin = await api.call("POST", "/bookings/scan", { user: f.admin, json: { token } });
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    const [entry] = await AuditLog.find({ action: "booking.pass_verified" }).lean();
    assert.equal(entry.actor.role, "admin");
  });

  test("too early for pickup is 409 with the time; a forged or expired pass is 400; one input only", async () => {
    const early = await approvedStartingIn(120);
    const tooEarly = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: signPass(String(early._id)).token } });
    assert.equal(tooEarly.status, 409);
    assert.match(tooEarly.body.error.message, /Too early: pickup opens at/);

    // Another borrower: the printer allows one active booking per member.
    const booking = await approvedStartingIn(5, () => f.student2);
    const { token } = signPass(String(booking._id));
    // A changed character in the middle of the tag (the last one is constrained to A, Q, g or w).
    const tagStart = token.lastIndexOf(".") + 1;
    const forged = `${token.slice(0, tagStart + 5)}${token[tagStart + 5] === "x" ? "y" : "x"}${token.slice(tagStart + 6)}`;
    const bad = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: forged } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "VALIDATION_ERROR");

    const old = signPass(String(booking._id), new Date(Date.now() - 10 * 60_000)).token;
    const expired = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: old } });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error.code, "PASS_EXPIRED");

    const both = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token, code: "ABCDEF" } });
    assert.equal(both.status, 400);
    assert.equal(both.body.error.details[0].path, "code");
    const neither = await api.call("POST", "/bookings/scan", { user: f.manager, json: {} });
    assert.deepEqual(neither.body.error.details.map((d) => d.path), ["token", "code"]);
    assert.equal(await AuditLog.countDocuments({ action: "booking.pass_verified" }), 0);
  });

  test("a manager can't verify their own booking's pass", async () => {
    const booking = await approvedStartingIn(5);
    await Booking.updateOne({ _id: booking._id }, { borrower: f.manager._id });
    const mine = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: signPass(String(booking._id)).token } });
    assert.equal(mine.status, 403);
    assert.match(mine.body.error.message, /can't verify your own pass/);
  });

  test("one audit entry per pass, the code works once, and the card's status read sees the check", async () => {
    const booking = await approvedStartingIn(5);
    const before = await api.call("GET", `/bookings/${booking._id}/pass`, { user: f.student });
    assert.deepEqual(before.body.data, { phase: "pickup", verifiedAt: null });

    const pass = (await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student })).body.data;
    assert.ok(Date.parse(pass.issuedAt), "the server's clock, for the countdown");
    const first = await api.call("POST", "/bookings/scan", { user: f.manager, json: { code: pass.code } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.recorded, true);
    const again = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: pass.token } });
    assert.equal(again.body.data.recorded, false, "the same pass scanned again isn't recorded twice");
    assert.equal(await AuditLog.countDocuments({ action: "booking.pass_verified" }), 1);
    const reused = await api.call("POST", "/bookings/scan", { user: f.manager, json: { code: pass.code } });
    assert.equal(reused.status, 400, "a typed code is used up by its first scan");

    const after = await api.call("GET", `/bookings/${booking._id}/pass`, { user: f.student });
    assert.ok(Date.parse(after.body.data.verifiedAt));
    const fresh = await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student });
    assert.ok(Date.parse(fresh.body.data.verifiedAt), "a new pass says it has been verified already");
    const stranger = await api.call("GET", `/bookings/${booking._id}/pass`, { user: f.student2 });
    assert.equal(stranger.status, 403);
  });

  test("another unit's manager with a typed code gets the same answer as for a dead code", async () => {
    const booking = await approvedStartingIn(5);
    const { code } = (await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student })).body.data;
    const other = await api.call("POST", "/bookings/scan", { user: f.cseManager, json: { code } });
    assert.equal(other.status, 400);
    assert.equal(other.body.error.details[0].path, "code");
  });

  test("an admin who doesn't manage the unit verifies the pickup, but isn't sent to a check-in they can't do", async () => {
    const booking = await approvedStartingIn(5);
    const scan = await api.call("POST", "/bookings/scan", { user: f.admin, json: { token: signPass(String(booking._id)).token } });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.equal(scan.body.data.next, null);
  });

  test("an ended booking has no pickup pass, and a cancelled one can't be scanned", async () => {
    const ended = await approvedStartingIn(-120);
    const none = await api.call("POST", `/bookings/${ended._id}/pass`, { user: f.student });
    assert.equal(none.status, 409);
    const late = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: signPass(String(ended._id)).token } });
    assert.equal(late.status, 409);

    const booking = await approvedStartingIn(5, () => f.student2);
    const { token } = (await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student2 })).body.data;
    await Booking.updateOne({ _id: booking._id }, { status: "cancelled" });
    const cancelled = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token } });
    assert.equal(cancelled.status, 409);
  });

  test("returned, awaiting confirmation: next is the return confirmation, and the timeline says 'at return'", async () => {
    const booking = await approvedStartingIn(5);
    await checkIn(booking._id, f.student._id, checklistOk(f.printer));
    await Booking.updateOne({ _id: booking._id }, { status: "checked_out" });
    const pass = (await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student })).body.data;
    assert.equal(pass.phase, "return");
    const scan = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: pass.token } });
    assert.equal(scan.body.data.next, "confirm_return");
    const timeline = await api.call("GET", `/bookings/${booking._id}/timeline`, { user: f.student });
    assert.ok(timeline.body.data.some((item) => /verified the borrower's pass at return/.test(item.text ?? "")));
  });

  test("an item that's out: the pass is for the return, and next is check-out", async () => {
    const booking = await approvedStartingIn(5);
    await checkIn(booking._id, f.student._id, checklistOk(f.printer));
    const pass = (await api.call("POST", `/bookings/${booking._id}/pass`, { user: f.student })).body.data;
    assert.equal(pass.phase, "return");
    const scan = await api.call("POST", "/bookings/scan", { user: f.manager, json: { token: pass.token } });
    assert.equal(scan.status, 200, JSON.stringify(scan.body));
    assert.equal(scan.body.data.next, "check_out");
  });
});
