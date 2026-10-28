import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDuration,
  formatHHmm,
  formatIstDate,
  formatIstDateTime,
  istParts,
  istWeekRange,
  istWeekStart,
  parseHHmm,
} from "../../src/lib/time.js";

const ist = (s) => new Date(`${s}:00+05:30`);

describe("istParts", () => {
  test("reads the IST wall clock, which can be a different day from UTC", () => {
    assert.deepEqual(istParts(new Date("2026-11-01T20:00:00Z")), {
      day: 1,
      minutes: 90,
      dateKey: "2026-11-02",
    });
  });
});

describe("IST weeks (Mon–Sun)", () => {
  test("Sunday night still belongs to the week that started on Monday", () => {
    assert.equal(
      istWeekStart(ist("2026-11-08T23:30")).getTime(),
      ist("2026-11-02T00:00").getTime(),
    );
  });

  test("Monday just after midnight starts a new week", () => {
    assert.equal(
      istWeekStart(ist("2026-11-09T00:10")).getTime(),
      ist("2026-11-09T00:00").getTime(),
    );
  });

  test("week start is Sunday 18:30 UTC, and the range is 7 days", () => {
    const { start, end } = istWeekRange(ist("2026-11-04T12:00"));
    assert.equal(start.toISOString(), "2026-11-01T18:30:00.000Z");
    assert.equal(end.toISOString(), "2026-11-08T18:30:00.000Z");
  });
});

describe("formatting", () => {
  test("HH:mm round-trips", () => {
    assert.equal(parseHHmm("09:30"), 570);
    assert.equal(formatHHmm(570), "09:30");
    assert.equal(formatHHmm(parseHHmm("17:05")), "17:05");
  });

  test("IST dates for messages", () => {
    assert.equal(formatIstDate(ist("2026-11-05T14:30")), "5 Nov");
    assert.equal(formatIstDateTime(ist("2026-11-05T14:30")), "5 Nov, 14:30");
  });

  test("durations", () => {
    const cases = [
      [1, "1 minute"],
      [30, "30 minutes"],
      [60, "1 hour"],
      [240, "4 hours"],
      [90, "1 h 30 min"],
      [1440, "1 day"],
      [4320, "3 days"],
    ];
    for (const [mins, text] of cases) assert.equal(formatDuration(mins), text);
  });
});
