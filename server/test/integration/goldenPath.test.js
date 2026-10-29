// The API golden-path script (scripts/golden-path.mjs, frontend.md §11) against the real app on port
// 0, on a scratch database filled by the real seed. See fixtures.js for how to run it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
// Imported first for its environment defaults (DEMO_MODE, token secrets) before the app loads.
import { useApi } from "../routes/http.js";
import app from "../../src/app.js";
import logger from "../../src/lib/logger.js";
import {
  AuditLog,
  Badge,
  Booking,
  Incident,
  Notification,
  Resource,
  User,
  UserBadge,
} from "../../src/models/index.js";
import {
  GoldenPathError,
  apiBase,
  runGoldenPath,
  signIn,
  slotFrom,
} from "../../scripts/golden-path.mjs";
import { seed } from "../../scripts/seed.js";
import { redis, skip, useTestDatabase } from "./fixtures.js";

// The app's request log would fill the test output, as in the route tests.
logger.level = "silent";

const PASSWORD = "Judge-demo-2026";
const SCRIPT = fileURLToPath(
  new URL("../../scripts/golden-path.mjs", import.meta.url),
);
const quiet = { info() {}, warn() {}, error() {} };
const userBy = (login) =>
  User.findOne({ email: `${login}@demo.campuscommons.test` }).lean();

// The fixtures' users share the demo emails, so start from nothing and seed as `npm run seed` would.
async function freshSeed() {
  for (const collection of await mongoose.connection.db.collections())
    await collection.deleteMany({});
  await redis.flushall();
  const counts = await seed({ password: PASSWORD, log: quiet });
  assert.equal(counts.bookings.skipped, 0);
}

describe("golden-path script", { skip }, () => {
  useTestDatabase(() => {});
  const api = useApi();
  let server;
  let origin;
  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await once(server, "close");
  });

  test("walks the judge script's 12 steps over HTTP, one line each, and archives its listing", async () => {
    await freshSeed();
    const lines = [];
    const made = await runGoldenPath({
      baseUrl: origin,
      print: (line) => lines.push(line),
    });

    const steps = lines.filter((l) => /^(PASS|FAIL) /.test(l));
    assert.equal(steps.length, 12, lines.join("\n"));
    steps.forEach((line, i) =>
      assert.match(line, new RegExp(`^PASS +${i + 1}/12 `), line),
    );
    assert.match(
      lines.join("\n"),
      /Signed in as manager, student, student2, admin \(demo-login\)/,
    );
    assert.match(steps[1], /Missing badge: 3D Printing Basics/);
    // Uploads aren't configured here, so the handovers go without photos, and say so.
    assert.match(steps[7], /no photos: Uploads aren't configured/);
    assert.equal(made.photos, 0);
    assert.match(
      lines.at(-2),
      /^Clean-up: cancelled student 2's waitlisted request; archived the listing\.$/,
    );
    // The badge it granted stays: the run says to reseed before the judges try it.
    assert.equal(
      lines.at(-1),
      "Reset needed: the demo student now holds 3D Printing Basics, so steps 2-4 of the judge script won't work until you run npm run seed.",
    );

    // What the run left in the database is the judge script's ending.
    const [student, student2, manager] = await Promise.all(
      ["student", "student2", "manager"].map(userBy),
    );
    const booking = await Booking.findById(made.bookingId).lean();
    assert.equal(booking.status, "completed");
    assert.equal(String(booking.borrower), String(student._id));
    assert.equal(booking.returnConfirmation.outcome, "issue");
    const incident = await Incident.findById(made.incidentId).lean();
    assert.deepEqual(
      [
        incident.type,
        incident.severity,
        incident.status,
        incident.resolution.outcome,
      ],
      ["damage", "low", "resolved", "warning"],
    );
    const waitlisted = await Booking.findById(made.waitlistedId).lean();
    assert.equal(String(waitlisted.borrower), String(student2._id));
    assert.equal(waitlisted.status, "cancelled");
    const resource = await Resource.findById(made.resourceId).lean();
    assert.equal(resource.status, "archived");
    assert.match(
      resource.title,
      /^FDM 3D Printer #2 \(golden path gp[0-9a-f]{8}\)$/,
    );
    // The student now holds the badge, granted by the manager through the request queue.
    const badge = await Badge.findOne({ code: "3d-printing-basics" }).lean();
    const holding = await UserBadge.findOne({
      user: student._id,
      badge: badge._id,
    }).lean();
    assert.equal(holding.status, "active");
    assert.equal(String(holding.decidedBy), String(manager._id));
    // Every step went through the services: one audit entry per booking change, each with an actor.
    const trail = await AuditLog.find({ "entity.id": booking._id })
      .sort({ at: 1 })
      .lean();
    assert.deepEqual(
      trail.map((e) => [e.action, e.actor.role]),
      [
        ["booking.requested", "member"],
        ["booking.approved", "manager"],
        ["booking.checked_in", "member"],
        ["booking.checked_out", "member"],
        ["booking.flagged", "manager"],
        ["booking.completed", "system"],
      ],
    );
    assert.ok(
      await Notification.exists({
        user: student._id,
        type: "incident.resolved",
      }),
    );
    // Archived, the listing is gone for members.
    const asMember = await api.call("GET", `/resources/${made.resourceId}`, {
      user: student,
    });
    assert.equal(asMember.status, 404);
  });

  test("stops at the first unexpected answer, names the step, and still archives its listing", async () => {
    await freshSeed();
    await runGoldenPath({ baseUrl: origin, print() {} });
    // A second run without a fresh seed: the student already holds 3D Printing Basics.
    const lines = [];
    const err = await runGoldenPath({
      baseUrl: `${origin}/api/v1/`,
      print: (line) => lines.push(line),
    }).then(
      () => assert.fail("expected the run to fail"),
      (e) => e,
    );
    assert.ok(err instanceof GoldenPathError);
    assert.equal(err.step, 2);
    assert.match(err.message, /Run npm run seed to reset the demo data/);
    assert.match(lines.at(-2), /^FAIL  2\/12  Student finds it/);
    assert.equal(lines.filter((l) => l.startsWith("PASS")).length, 1);
    // Nothing was booked; the run's listing is archived like the first one.
    assert.equal(lines.at(-1), "Clean-up: archived the listing.");
    assert.equal(
      await Resource.countDocuments({
        title: /golden path/,
        status: { $ne: "archived" },
      }),
      0,
    );
    assert.equal(await Resource.countDocuments({ title: /golden path/ }), 2);
  });

  // A fetch that answers `status` the first time `method path` matches, and passes the rest through.
  const failingOnce = (method, pattern, status, message) => {
    let failed = false;
    return async (url, init = {}) => {
      if (!failed && (init.method ?? "GET") === method && pattern.test(url)) {
        failed = true;
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "TEST_FAILURE", message },
            requestId: "req-test",
          }),
          { status, headers: { "content-type": "application/json" } },
        );
      }
      return globalThis.fetch(url, init);
    };
  };
  const failedRun = (fetch, lines) =>
    runGoldenPath({
      baseUrl: origin,
      print: (line) => lines.push(line),
      fetch,
    }).then(
      () => assert.fail("expected the run to fail"),
      (e) => e,
    );
  const RESEED =
    "Reset needed: the demo student now holds 3D Printing Basics, so steps 2-4 of the judge script won't work until you run npm run seed.";

  test("a photo upload that fails is step 8's failure, with its own FAIL line", async () => {
    await freshSeed();
    const lines = [];
    const err = await failedRun(
      failingOnce(
        "POST",
        /\/uploads\/images$/,
        400,
        "This file couldn't be read. Is it damaged?",
      ),
      lines,
    );
    assert.equal(err.step, 8);
    assert.equal(lines.filter((l) => l.startsWith("PASS")).length, 7);
    assert.ok(
      lines.some((l) =>
        /^FAIL  8\/12  Student checks in: POST \/uploads\/images answered 400/.test(
          l,
        ),
      ),
      lines.join("\n"),
    );
  });

  test("after a failure the student's booking is closed too, so no loan is left out to turn overdue", async () => {
    // The student's booking of the run (each run starts from a fresh seed).
    const studentsBooking = () =>
      Booking.findOne({ purpose: /^Printing a bracket/ }).lean();
    // Stopped before check-in: the approved booking is cancelled.
    await freshSeed();
    let lines = [];
    let err = await failedRun(
      failingOnce("POST", /\/uploads\/images$/, 400, "Unreadable."),
      lines,
    );
    assert.equal(err.step, 8);
    let booking = await studentsBooking();
    assert.equal(booking.status, "cancelled");
    assert.match(
      lines.join("\n"),
      /^Clean-up: cancelled student 2's waitlisted request; cancelled the student's booking; archived the listing\.$/m,
    );
    assert.equal(lines.at(-1), RESEED);

    // Stopped at check-out: the run returns it and the manager confirms it, so nothing waits in
    // Manage → Handovers and the sweeper has no loan to flag.
    await freshSeed();
    lines = [];
    err = await failedRun(
      failingOnce("POST", /\/check-out$/, 502, "Bad gateway."),
      lines,
    );
    assert.equal(err.step, 9);
    booking = await studentsBooking();
    assert.equal(booking.status, "completed");
    assert.equal(booking.returnConfirmation.outcome, "ok");
    assert.match(
      lines.join("\n"),
      /^Clean-up: cancelled student 2's waitlisted request; returned the student's booking and confirmed it; archived the listing\.$/m,
    );
    assert.equal(lines.at(-1), RESEED);
  });

  test("names the HTTP answer it didn't expect, with the request id", async () => {
    await freshSeed();
    // Demo mode off: demo-login answers 404, and the run stops before step 1.
    const demoMode = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "false";
    try {
      const err = await runGoldenPath({ baseUrl: origin, print() {} }).then(
        () => assert.fail("expected the run to fail"),
        (e) => e,
      );
      assert.ok(err instanceof GoldenPathError);
      assert.equal(err.step, null);
      assert.match(err.message, /demo-login answered 404.*Turn DEMO_MODE on/);
    } finally {
      process.env.DEMO_MODE = demoMode;
    }
  });
});

describe("golden-path helpers", () => {
  const ist = (s) => new Date(`${s}:00+05:30`);
  const istClock = (d) =>
    d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });

  test("the slot starts two minutes ahead, within one IST day, for at most an hour", () => {
    const afternoon = slotFrom(ist("2026-11-03T14:20"));
    assert.deepEqual(
      [afternoon.start, afternoon.end],
      [ist("2026-11-03T14:22"), ist("2026-11-03T15:22")],
    );
    // Close to midnight it ends at 23:59, the listing's closing time...
    const late = slotFrom(ist("2026-11-03T23:30"));
    assert.deepEqual(
      [late.start, late.end],
      [ist("2026-11-03T23:32"), ist("2026-11-03T23:59")],
    );
    // ...and in the last minutes it starts at midnight, which check-in (15 minutes ahead) still covers.
    for (const [t, starts] of [
      ["23:53", "00:00"],
      ["23:57", "00:00"],
      ["23:59", "00:01"],
    ]) {
      const now = ist(`2026-11-03T${t}`);
      const { start, end } = slotFrom(now);
      assert.equal(istClock(start), `04/11/2026, ${starts}:00`, t);
      assert.ok(start - now <= 15 * 60_000 && start > now, t);
      assert.equal(end - start, 60 * 60_000, t);
    }
    // Seconds are rounded up to the next minute, never into the past.
    const { start } = slotFrom(
      new Date(ist("2026-11-03T10:00").getTime() + 30_000),
    );
    assert.deepEqual(start, ist("2026-11-03T10:03"));
  });

  test("the base URL gets /api/v1 once", () => {
    assert.equal(
      apiBase("http://localhost:5000"),
      "http://localhost:5000/api/v1",
    );
    assert.equal(
      apiBase("http://localhost:5000/"),
      "http://localhost:5000/api/v1",
    );
    assert.equal(
      apiBase("https://api.example.test/api/v1/"),
      "https://api.example.test/api/v1",
    );
    assert.throws(() => apiBase("localhost"), GoldenPathError);
  });

  test("signs in with SEED_PASSWORD only when the demo sign-ins are rate limited", async () => {
    const calls = [];
    const fake =
      (status) =>
      async (_session, method, path, { json, expect = [200] } = {}) => {
        calls.push([method, path, json]);
        const answer =
          path === "/auth/demo-login"
            ? {
                status,
                data: { accessToken: "demo", user: {} },
                body: {
                  error: { message: "There's nothing at this address." },
                },
              }
            : { status: 200, data: { accessToken: "password", user: {} } };
        if (!expect.includes(answer.status))
          throw new GoldenPathError(`unexpected ${answer.status}`);
        return answer;
      };
    assert.equal(
      (await signIn(fake(200), "student", PASSWORD)).via,
      "demo-login",
    );
    assert.equal(calls.length, 1);

    calls.length = 0;
    const session = await signIn(fake(429), "student", PASSWORD);
    assert.deepEqual(
      [session.accessToken, session.via],
      ["password", "password"],
    );
    assert.deepEqual(calls[1], [
      "POST",
      "/auth/login",
      { email: "student@demo.campuscommons.test", password: PASSWORD },
    ]);
    // Without the password, the 429 is the answer; a 404 (demo mode off) never tries a password.
    await assert.rejects(
      signIn(fake(429), "student"),
      /used up.*SEED_PASSWORD/,
    );
    calls.length = 0;
    await assert.rejects(
      signIn(fake(404), "student", PASSWORD),
      /Turn DEMO_MODE on/,
    );
    assert.equal(calls.length, 1);
  });
});

// ── The CLI (npm run golden-path) ───────────────────────────────────────────

// Runs the script with exactly `env`, from an empty directory, so dotenv finds no .env.
async function runCli(args, env = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "golden-path-cli-"));
  try {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    return { code, output };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("npm run golden-path", () => {
  test("exits 1 and says why when the server can't be reached", async () => {
    const { code, output } = await runCli([], {
      GOLDEN_PATH_URL: "http://127.0.0.1:1",
      SEED_PASSWORD: "Secret-pass-123",
    });
    assert.equal(code, 1, output);
    assert.match(
      output,
      /Golden path against http:\/\/127\.0\.0\.1:1\/api\/v1/,
    );
    assert.match(
      output,
      /Golden path failed: POST \/auth\/demo-login didn't reach .*Is the server running\?/,
    );
    assert.doesNotMatch(output, /Secret-pass-123/);
  });

  test("takes the URL from its argument first, and explains its usage", async () => {
    const { code, output } = await runCli(["http://127.0.0.1:2"], {
      GOLDEN_PATH_URL: "http://127.0.0.1:1",
    });
    assert.equal(code, 1);
    assert.match(output, /against http:\/\/127\.0\.0\.1:2\/api\/v1/);

    const help = await runCli(["--help"]);
    assert.equal(help.code, 0);
    assert.match(
      help.output,
      /Usage: npm run golden-path -- \[base URL\] \[--no-photos\]/,
    );
    const wrong = await runCli(["--photos"]);
    assert.equal(wrong.code, 1);
    assert.match(wrong.output, /Unexpected argument --photos/);
  });
});
