// Incident service against a real MongoDB; see fixtures.js for how to run it.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { AuditLog, Booking, Incident, User } from "../../src/models/index.js";
import {
  SYSTEM,
  checkIn,
  checkOut,
  confirmReturn,
  getTimeline,
  transition,
} from "../../src/services/bookingService.js";
import {
  addComment,
  createIncident,
  getIncident,
  listIncidents,
  resolveIncident,
} from "../../src/services/incidentService.js";
import {
  NOW,
  TUE,
  bookAs,
  checklistOk,
  failure,
  notificationsFor,
  plus,
  skip,
  useTestDatabase,
} from "./fixtures.js";

let f; // fixtures, rebuilt for every test

const opts = { now: NOW };
const DAMAGE = {
  type: "damage",
  severity: "low",
  description: "Build plate scratched near the front edge.",
};
const audits = (action) => AuditLog.find({ action }).sort({ at: 1 }).lean();
const bookingOf = (b) => Booking.findById(b._id).lean();
const incidentOf = (i) => Incident.findById(i._id).lean();
const latest = async (who) => (await notificationsFor(who)).at(-1);

function assertError(err, status, code) {
  assert.equal(err.status, status, err.message);
  assert.equal(err.code, code);
}

// Runs `change` just before the service's conditional findOneAndUpdate on Incident, i.e. after the
// service has read the incident.
async function racing(change, run) {
  const { exec } = mongoose.Query.prototype;
  mongoose.Query.prototype.exec = async function (...args) {
    if (this.model === Incident && this.op === "findOneAndUpdate") {
      mongoose.Query.prototype.exec = exec;
      await change();
    }
    return exec.apply(this, args);
  };
  try {
    return await run();
  } finally {
    mongoose.Query.prototype.exec = exec;
  }
}

describe("incidentService", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  // The printer (DIC, manual approval) on Tuesday, approved by the DIC manager.
  const approved = async (who = f.student) => {
    const { booking } = await bookAs(who, f.printer, TUE);
    return transition(booking._id, "approve", f.manager._id, {}, opts);
  };
  const checkedIn = async (who = f.student) => {
    const booking = await approved(who);
    await checkIn(booking._id, who._id, checklistOk(f.printer), {
      now: plus(TUE.start, -10),
    });
    return booking;
  };
  const returned = async (who = f.student) => {
    const booking = await checkedIn(who);
    await checkOut(booking._id, who._id, checklistOk(f.printer), {
      now: TUE.end,
    });
    return booking;
  };
  // A return confirmed with an issue: the booking is flagged with one open incident.
  const flagged = async (severity = "low", { by = f.manager } = {}) => {
    const booking = await returned();
    const { incident } = await confirmReturn(
      booking._id,
      by._id,
      { outcome: "issue", incident: { ...DAMAGE, severity } },
      { now: TUE.end },
    );
    return { booking, incident };
  };
  const report = (who, input, now = TUE.end) =>
    createIncident(who._id, input, { now });
  const resolve = (who, incident, input, now = plus(TUE.end, 60)) =>
    resolveIncident(who._id, incident._id, input, { now });
  const WARNING = {
    outcome: "warning",
    rationale: "Minor scratch; the borrower was reminded to use the scraper.",
  };

  describe("createIncident", () => {
    test("the borrower reports during use: the booking keeps its status, managers are told", async () => {
      const booking = await checkedIn();
      const incident = await report(
        f.student,
        {
          bookingId: booking._id,
          ...DAMAGE,
          description:
            "  The nozzle is clogged and the first layer won't stick.  ",
          photos: [
            {
              url: "https://res.cloudinary.com/demo/i/nozzle.jpg",
              publicId: "campuscommons/incidents/nozzle",
            },
          ],
        },
        plus(TUE.start, 30),
      );
      assert.deepEqual(
        [incident.status, incident.source, incident.severity],
        ["open", "user", "low"],
      );
      assert.equal(
        incident.description,
        "The nozzle is clogged and the first layer won't stick.",
      );
      assert.equal(incident.reportedBy.name, "Ananya Rao");
      assert.equal(incident.resource.title, "Prusa MK4 3D Printer");
      assert.equal(incident.booking.borrower.name, "Ananya Rao");
      assert.equal("email" in incident.booking.borrower, false);
      assert.equal(incident.photos.length, 1);
      assert.equal(incident.resolution, null);
      assert.equal(incident.canResolve, false);
      assert.equal("aiSummary" in incident, false);

      const stored = await bookingOf(booking);
      assert.equal(stored.status, "checked_in");
      assert.deepEqual(stored.incidents.map(String), [String(incident._id)]);

      const [entry] = await audits("incident.created");
      assert.equal(entry.actor.role, "member");
      assert.equal(entry.meta.severity, "low");

      const note = await latest(f.manager);
      assert.deepEqual(
        [note.type, note.link],
        ["incident.created", `/manage/incidents/${incident._id}`],
      );
      // The reporter isn't told about their own report, and low severity doesn't reach admins.
      assert.equal(
        (await notificationsFor(f.student)).some(
          (n) => n.type === "incident.created",
        ),
        false,
      );
      assert.equal((await notificationsFor(f.admin)).length, 0);
    });

    test("a manager reports on a resource without a booking; high severity reaches admins", async () => {
      const incident = await report(f.manager, {
        resourceId: f.printer._id,
        type: "safety",
        severity: "high",
        description: "The enclosure door no longer latches shut.",
      });
      assert.deepEqual(
        [incident.source, incident.booking ?? null, incident.canResolve],
        ["manager", null, false],
      );
      assert.equal((await audits("incident.created"))[0].actor.role, "manager");
      const note = await latest(f.admin);
      assert.deepEqual(
        [note.type, note.link],
        ["incident.created", "/admin/incidents"],
      );
    });

    test("only the borrower or the unit's staff may report", async () => {
      const booking = await checkedIn();
      for (const who of [f.student2, f.cseManager]) {
        assertError(
          await failure(report(who, { bookingId: booking._id, ...DAMAGE })),
          403,
          "FORBIDDEN",
        );
      }
      const noBooking = await failure(
        report(f.student, { resourceId: f.printer._id, ...DAMAGE }),
      );
      assertError(noBooking, 403, "FORBIDDEN");
      assert.match(noBooking.message, /isn't tied to a booking/);
      // An admin may, for any unit.
      await report(f.admin, { bookingId: booking._id, ...DAMAGE });
      assert.equal(await Incident.countDocuments(), 1);
    });

    test("not on a booking that hasn't been approved; the borrower only within 7 days of the end", async () => {
      const { booking } = await bookAs(f.student, f.printer, TUE);
      assertError(
        await failure(report(f.student, { bookingId: booking._id, ...DAMAGE })),
        409,
        "INVALID_TRANSITION",
      );

      await Booking.deleteMany({});
      const done = await returned();
      const late = plus(TUE.end, 7 * 24 * 60 + 1);
      const err = await failure(
        report(f.student, { bookingId: done._id, ...DAMAGE }, late),
      );
      assertError(err, 409, "INVALID_TRANSITION");
      assert.match(err.message, /7 days/);
      await report(
        f.student,
        { bookingId: done._id, ...DAMAGE },
        plus(late, -2),
      );
      await report(
        f.manager,
        { bookingId: done._id, ...DAMAGE },
        plus(TUE.end, 30 * 24 * 60),
      );
      assert.equal(await Incident.countDocuments(), 2);
    });

    test("field errors, all at once; unknown booking or resource is 404", async () => {
      const booking = await checkedIn();
      const err = await failure(
        report(f.student, {
          bookingId: booking._id,
          type: "fire",
          description: "Too short",
          photos: [null, { url: "https://res.cloudinary.com/x.jpg" }],
          source: "system",
          status: "resolved",
        }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        err.details.map((d) => d.path),
        [
          "source",
          "status",
          "type",
          "severity",
          "description",
          "photos.0",
          "photos.1",
        ],
      );
      assert.deepEqual((await failure(report(f.student, DAMAGE))).details, [
        { path: "resourceId", message: "Required when there's no booking." },
      ]);
      const mismatch = await failure(
        report(f.student, {
          bookingId: booking._id,
          resourceId: f.kits._id,
          ...DAMAGE,
        }),
      );
      assert.deepEqual(
        mismatch.details.map((d) => d.path),
        ["resourceId"],
      );
      for (const input of [
        { bookingId: new mongoose.Types.ObjectId(), ...DAMAGE },
        { resourceId: new mongoose.Types.ObjectId(), ...DAMAGE },
      ]) {
        assertError(await failure(report(f.manager, input)), 404, "NOT_FOUND");
      }
      assert.equal(await Incident.countDocuments(), 0);
    });
  });

  describe("listIncidents and getIncident", () => {
    // The student's flagged printer booking, and an admin's report on the DIC kits with no booking.
    const scene = async () => {
      const { booking, incident } = await flagged();
      // Reported by an admin, so the DIC manager sees it only because it's their unit's.
      const unitOnly = await report(f.admin, {
        resourceId: f.kits._id,
        type: "misuse",
        severity: "medium",
        description: "Sensors from kit 2 were found in the scrap bin.",
      });
      return { booking, incident, unitOnly };
    };

    test("members see their own, managers their units', admins everything", async () => {
      const { incident, unitOnly } = await scene();
      const ids = async (who, query) =>
        (await listIncidents(who._id, query)).items.map((i) => String(i._id));

      assert.deepEqual(await ids(f.student), [String(incident._id)]);
      assert.deepEqual(await ids(f.student2), []);
      assert.deepEqual(await ids(f.manager), [
        String(unitOnly._id),
        String(incident._id),
      ]);
      assert.deepEqual(await ids(f.cseManager), []);
      assert.equal((await listIncidents(f.admin._id)).meta.total, 2);

      assert.deepEqual(await ids(f.manager, { severity: "medium" }), [
        String(unitOnly._id),
      ]);
      assert.deepEqual(await ids(f.manager, { type: "damage" }), [
        String(incident._id),
      ]);
      assert.deepEqual(await ids(f.manager, { resourceId: f.kits._id }), [
        String(unitOnly._id),
      ]);
      await addComment(f.manager._id, incident._id, { text: "Looking at it" });
      assert.deepEqual(await ids(f.manager, { status: "open,in_review" }), [
        String(unitOnly._id),
        String(incident._id),
      ]);
      assert.deepEqual(await ids(f.manager, { status: ["in_review"] }), [
        String(incident._id),
      ]);

      const page = await listIncidents(f.admin._id, { limit: 1, page: 2 });
      assert.deepEqual([page.items.length, page.meta.total], [1, 2]);
      const bad = await failure(
        listIncidents(f.manager._id, { status: "closed", severity: "huge" }),
      );
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["status", "severity"],
      );
    });

    test("list items count the thread instead of carrying it", async () => {
      const { incident } = await scene();
      await addComment(f.manager._id, incident._id, { text: "Looking at it" });
      await addComment(f.student._id, incident._id, {
        text: "It was like that",
      });
      const [item] = (await listIncidents(f.student._id)).items;
      assert.equal(item.commentCount, 2);
      assert.equal("comments" in item, false);
      assert.equal("photos" in item, false);
      assert.equal(item.booking.borrower.name, "Ananya Rao");
      assert.equal("email" in item.booking.borrower, false);
    });

    test("detail for the parties and staff; strangers get 403", async () => {
      const { incident } = await scene();
      await Incident.updateOne(
        { _id: incident._id },
        { aiSummary: { text: "Summary", generatedAt: NOW } },
      );
      const mine = await getIncident(f.student._id, incident._id);
      assert.deepEqual([mine.canComment, mine.canResolve], [true, false]);
      assert.equal("aiSummary" in mine, false);

      const staff = await getIncident(f.manager._id, incident._id);
      assert.deepEqual([staff.canComment, staff.canResolve], [true, true]);
      assert.equal(staff.aiSummary.text, "Summary");

      for (const who of [f.student2, f.cseManager]) {
        assertError(
          await failure(getIncident(who._id, incident._id)),
          403,
          "FORBIDDEN",
        );
      }
      for (const id of ["nope", new mongoose.Types.ObjectId()]) {
        assertError(
          await failure(getIncident(f.admin._id, id)),
          404,
          "NOT_FOUND",
        );
      }
    });
  });

  describe("addComment", () => {
    test("a borrower's comment keeps it open; a manager's moves it to in_review", async () => {
      const { incident } = await flagged();
      const afterStudent = await addComment(
        f.student._id,
        incident._id,
        { text: "  The scratch was there when I picked it up.  " },
        { now: plus(TUE.end, 5) },
      );
      assert.equal(afterStudent.status, "open");
      assert.equal(
        afterStudent.comments[0].text,
        "The scratch was there when I picked it up.",
      );
      assert.equal(afterStudent.comments[0].by.name, "Ananya Rao");
      const told = await latest(f.manager);
      assert.deepEqual(
        [told.type, told.body],
        [
          "incident.commented",
          "Ananya Rao commented on the damage incident for Prusa MK4 3D Printer.",
        ],
      );

      const afterManager = await addComment(
        f.manager._id,
        incident._id,
        { text: "Checking the check-in photos." },
        { now: plus(TUE.end, 10) },
      );
      assert.equal(afterManager.status, "in_review");
      const entries = await audits("incident.commented");
      assert.deepEqual(
        entries.map((e) => [e.actor.role, e.changes?.status ?? null]),
        [
          ["member", null],
          ["manager", ["open", "in_review"]],
        ],
      );
      const studentNote = await latest(f.student);
      assert.deepEqual(
        [studentNote.type, studentNote.link],
        ["incident.commented", `/incidents/${incident._id}`],
      );
    });

    test("strangers 403, empty text 400, a resolved thread or a full one 409", async () => {
      const { incident } = await flagged();
      assertError(
        await failure(addComment(f.student2._id, incident._id, { text: "Hi" })),
        403,
        "FORBIDDEN",
      );
      for (const text of [undefined, "   ", 5, "x".repeat(1001)]) {
        assertError(
          await failure(addComment(f.student._id, incident._id, { text })),
          400,
          "VALIDATION_ERROR",
        );
      }

      const filler = Array.from({ length: 200 }, () => ({
        by: f.manager._id,
        text: "…",
        at: NOW,
      }));
      await Incident.updateOne({ _id: incident._id }, { comments: filler });
      const full = await failure(
        addComment(f.student._id, incident._id, { text: "One more" }),
      );
      assertError(full, 409, "INVALID_TRANSITION");
      assert.match(full.message, /200 comments/);

      await Incident.updateOne({ _id: incident._id }, { comments: [] });
      await resolve(f.manager, incident, WARNING);
      const closed = await failure(
        addComment(f.student._id, incident._id, { text: "But…" }),
      );
      assertError(closed, 409, "INVALID_TRANSITION");
      assert.equal(
        closed.message,
        "This incident is resolved, so its thread is closed.",
      );
      assert.equal((await incidentOf(incident)).comments.length, 0);
    });

    test("a comment racing a resolution is refused, not added to the closed thread", async () => {
      const { incident } = await flagged();
      const err = await failure(
        racing(
          () =>
            Incident.collection.updateOne(
              { _id: incident._id },
              { $set: { status: "resolved" } },
            ),
          () => addComment(f.student._id, incident._id, { text: "Wait" }),
        ),
      );
      assertError(err, 409, "INVALID_TRANSITION");
      assert.match(err.message, /resolved just now/);
      assert.equal((await incidentOf(incident)).comments.length, 0);
    });
  });

  describe("resolveIncident", () => {
    test("golden path: the manager resolves; the flagged booking closes and the borrower is told once", async () => {
      const { booking, incident } = await flagged();
      const before = (await notificationsFor(f.student)).length;
      const resolved = await resolveIncident(
        f.manager._id,
        incident._id,
        WARNING,
        { now: plus(TUE.end, 60), requestId: "req-7" },
      );
      assert.equal(resolved.status, "resolved");
      assert.equal(resolved.bookingClosed, true);
      assert.equal(resolved.resolution.outcome, "warning");
      assert.equal(resolved.resolution.decidedBy.name, "Meera Iyer");
      assert.deepEqual(
        [resolved.canComment, resolved.canResolve],
        [false, false],
      );
      assert.equal((await bookingOf(booking)).status, "completed");

      const [entry] = await audits("incident.resolved");
      assert.deepEqual(
        [entry.actor.role, entry.reason, entry.changes.status, entry.requestId],
        ["manager", WARNING.rationale, ["open", "resolved"], "req-7"],
      );
      const closed = (await audits("booking.completed")).at(-1);
      assert.deepEqual(
        [closed.actor.role, closed.changes.status],
        ["system", ["flagged", "completed"]],
      );

      const notes = (await notificationsFor(f.student)).slice(before);
      assert.deepEqual(
        notes.map((n) => [n.type, n.body]),
        [
          [
            "incident.resolved",
            "The damage incident for Prusa MK4 3D Printer was resolved. Outcome: Warning. The booking is now closed.",
          ],
        ],
      );

      const timeline = await getTimeline(booking._id, f.student._id);
      const texts = timeline.map((t) => t.text);
      assert.ok(texts.includes("Incident opened: low-severity damage"));
      assert.ok(texts.includes("Incident resolved. Outcome: Warning"));
      assert.ok(
        texts.some((t) =>
          /closed the booking after the incident was resolved/.test(t),
        ),
      );
    });

    test("high severity is for an admin; nobody but an admin resolves on their own booking", async () => {
      const { incident } = await flagged("high");
      const err = await failure(resolve(f.manager, incident, WARNING));
      assertError(err, 403, "FORBIDDEN");
      assert.match(err.message, /admin/);
      assert.equal(
        (await getIncident(f.manager._id, incident._id)).canResolve,
        false,
      );
      await resolve(f.admin, incident, WARNING);
      assert.equal((await audits("incident.resolved"))[0].actor.role, "admin");

      for (const who of [f.student, f.cseManager]) {
        assertError(
          await failure(resolve(who, incident, WARNING)),
          403,
          "FORBIDDEN",
        );
      }

      // The DIC manager borrows a DIC kit (auto-approved); an admin confirms the return.
      const { booking } = await bookAs(f.manager, f.kits, TUE);
      await checkIn(booking._id, f.manager._id, checklistOk(f.kits), {
        now: plus(TUE.start, -10),
      });
      await checkOut(booking._id, f.manager._id, checklistOk(f.kits), {
        now: TUE.end,
      });
      const { incident: own } = await confirmReturn(
        booking._id,
        f.admin._id,
        { outcome: "issue", incident: DAMAGE },
        { now: TUE.end },
      );
      const self = await failure(resolve(f.manager, own, WARNING));
      assertError(self, 403, "FORBIDDEN");
      assert.match(self.message, /your own booking/);
      await resolve(f.admin, own, WARNING);
      assert.equal((await bookingOf(booking)).status, "completed");
    });

    test("only the unit's staff resolve, even a low-severity incident", async () => {
      const { incident } = await flagged();
      for (const who of [f.student2, f.cseManager]) {
        const err = await failure(resolve(who, incident, WARNING));
        assertError(err, 403, "FORBIDDEN");
        assert.equal(
          err.message,
          "Only this unit's managers or an admin can resolve incidents.",
        );
      }
      assert.equal((await incidentOf(incident)).status, "open");
    });

    test("outcome and rationale are required; a strike needs a booking and counts against its borrower", async () => {
      const { incident } = await flagged();
      const err = await failure(
        resolve(f.manager, incident, { outcome: "ban" }),
      );
      assertError(err, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        err.details.map((d) => d.path),
        ["outcome", "rationale"],
      );

      const loose = await report(f.manager, {
        resourceId: f.kits._id,
        ...DAMAGE,
      });
      const strikeless = await failure(
        resolve(f.manager, loose, { ...WARNING, outcome: "strike" }),
      );
      assert.deepEqual(
        strikeless.details.map((d) => d.path),
        ["outcome"],
      );

      await resolve(f.manager, incident, { ...WARNING, outcome: "strike" });
      assert.equal((await User.findById(f.student._id).lean()).strikes, 1);
      const [entry] = await audits("incident.resolved");
      assert.equal(entry.meta.borrowerStrikes, 1);
      assert.equal((await incidentOf(loose)).status, "open");
    });

    test("a flagged booking closes only once all its incidents are resolved", async () => {
      const { booking, incident } = await flagged();
      const second = await report(f.student, {
        bookingId: booking._id,
        type: "conflict",
        severity: "low",
        description: "Someone else was using the printer at my start time.",
      });
      const first = await resolve(f.manager, incident, WARNING);
      assert.equal(first.bookingClosed, false);
      assert.equal((await bookingOf(booking)).status, "flagged");
      const last = await resolve(f.manager, second, {
        outcome: "no_action",
        rationale: "The previous user overran by five minutes.",
      });
      assert.equal(last.bookingClosed, true);
      assert.equal((await bookingOf(booking)).status, "completed");
    });

    test("an incident on a booking that isn't flagged leaves the booking alone", async () => {
      const booking = await checkedIn();
      const incident = await report(
        f.student,
        { bookingId: booking._id, ...DAMAGE },
        plus(TUE.start, 30),
      );
      const resolved = await resolve(f.manager, incident, WARNING);
      assert.equal(resolved.bookingClosed, false);
      assert.equal((await bookingOf(booking)).status, "checked_in");
    });

    test("resolving twice is 409, and a retry closes a booking a failed run left flagged", async () => {
      const { booking, incident } = await flagged();
      // As if the incident was resolved but closing the booking failed.
      await Incident.updateOne(
        { _id: incident._id },
        {
          status: "resolved",
          resolution: { ...WARNING, decidedBy: f.manager._id, at: TUE.end },
        },
      );
      assert.equal((await bookingOf(booking)).status, "flagged");
      const again = await failure(resolve(f.manager, incident, WARNING));
      assertError(again, 409, "INVALID_TRANSITION");
      assert.equal(again.message, "This incident is already resolved.");
      assert.equal((await bookingOf(booking)).status, "completed");
    });

    test("two resolvers at once: exactly one wins", async () => {
      const { booking, incident } = await flagged();
      const results = await Promise.allSettled([
        resolve(f.manager, incident, WARNING),
        resolve(f.admin, incident, { ...WARNING, outcome: "no_action" }),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      assert.equal(won.length, 1);
      assert.equal(lost[0].reason.code, "INVALID_TRANSITION");
      assert.equal((await audits("incident.resolved")).length, 1);
      assert.equal((await bookingOf(booking)).status, "completed");
    });

    test("the sweeper's overdue delay incident is resolved like any other", async () => {
      const booking = await checkedIn();
      const system = await Incident.create({
        booking: booking._id,
        resource: f.printer._id,
        orgUnit: f.dic._id,
        source: "system",
        type: "delay",
        severity: "low",
        description: "Not returned on time: the booking ended at 12:00.",
      });
      // System incidents have no reporter; the borrower is still a party.
      const seen = await getIncident(f.student._id, system._id);
      assert.equal(seen.reportedBy, null);
      await resolve(f.manager, system, {
        outcome: "no_action",
        rationale: "Returned 20 minutes late with notice.",
      });
      assert.equal((await latest(f.student)).type, "incident.resolved");
    });
  });

  test("an unknown actor is 404, not a CastError", async () => {
    const { incident } = await flagged();
    for (const attempt of [
      () => listIncidents("demo-user-id-001"),
      () => getIncident("demo-user-id-001", incident._id),
      () => resolveIncident("demo-user-id-001", incident._id, WARNING),
      () => createIncident("demo-user-id-001", DAMAGE),
    ]) {
      assertError(await failure(attempt()), 404, "NOT_FOUND");
    }
    // SYSTEM is the sweeper's actor for bookings, never a person here.
    assertError(await failure(listIncidents(SYSTEM)), 404, "NOT_FOUND");
  });
});
