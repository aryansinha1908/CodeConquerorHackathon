import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { setLogger } from "../../src/lib/log.js";
import {
  STEPS,
  SWEEP_SCHEDULE,
  startSweeper,
  stopSweeper,
} from "../../src/jobs/sweeper.js";

setLogger({ info() {}, warn() {}, error() {} });

afterEach(async () => {
  delete process.env.CRON_ENABLED;
  await stopSweeper();
});

describe("startSweeper", () => {
  test("schedules one task every 5 minutes, in IST", () => {
    const task = startSweeper({ runNow: false });
    assert.equal(SWEEP_SCHEDULE, "*/5 * * * *");
    assert.equal(task.getPattern(), SWEEP_SCHEDULE);
    const next = task.getNextRun();
    assert.equal(next.getUTCMinutes() % 5, 0);
    assert.ok(next - Date.now() <= 5 * 60_000);
    assert.equal(
      startSweeper({ runNow: false }),
      task,
      "a second call reuses the task",
    );
  });

  test("CRON_ENABLED=false turns it off", () => {
    process.env.CRON_ENABLED = "false";
    assert.equal(startSweeper({ runNow: false }), null);
  });

  test("stopSweeper destroys the task so a new one can start", async () => {
    const first = startSweeper({ runNow: false });
    await stopSweeper();
    assert.notEqual(startSweeper({ runNow: false }), first);
  });
});

test("no-shows run before expiry, so freed slots are offered first", () => {
  assert.deepEqual(
    STEPS.map(([name]) => name),
    [
      "noShows",
      "expiredRequests",
      "startReminders",
      "endReminders",
      "overdueReturns",
    ],
  );
});
