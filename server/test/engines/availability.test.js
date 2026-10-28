import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { busySegments, openWindows } from "../../src/engines/availability.js";

const ist = (s) => new Date(`${s}:00+05:30`);
const span = (start, end) => ({ start: ist(start), end: ist(end) });
const monToSat = [1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: "09:00",
  close: "17:00",
}));

describe("openWindows", () => {
  test("walks several IST days and skips a closed day", () => {
    // Sat 7 Nov to Tue 10 Nov 00:00: Sunday is closed and the range stops before Tuesday opens.
    const windows = openWindows(
      monToSat,
      [],
      ist("2026-11-07T00:00"),
      ist("2026-11-10T00:00"),
    );
    assert.deepEqual(windows, [
      span("2026-11-07T09:00", "2026-11-07T17:00"),
      span("2026-11-09T09:00", "2026-11-09T17:00"),
    ]);
    assert.equal(windows[0].start.toISOString(), "2026-11-07T03:30:00.000Z");
  });

  test("uses the IST weekday, not the UTC one", () => {
    // Tue 00:30 IST is still Monday in UTC.
    const windows = openWindows(
      [{ day: 2, open: "00:30", close: "02:00" }],
      [],
      new Date("2026-11-02T00:00:00Z"),
      new Date("2026-11-03T00:00:00Z"),
    );
    assert.deepEqual(windows, [span("2026-11-03T00:30", "2026-11-03T02:00")]);
    assert.equal(windows[0].start.toISOString(), "2026-11-02T19:00:00.000Z");
  });

  test("sorts split windows and merges only the ones that overlap", () => {
    const weekly = [
      { day: 1, open: "14:00", close: "18:00" },
      { day: 1, open: "09:00", close: "12:30" },
      { day: 2, open: "09:00", close: "13:00" },
      { day: 2, open: "12:00", close: "17:00" },
      { day: 2, open: "10:00", close: "11:00" },
      { day: 3, open: "09:00", close: "13:00" },
      { day: 3, open: "13:00", close: "17:00" },
    ];
    assert.deepEqual(
      openWindows(weekly, [], ist("2026-11-02T00:00"), ist("2026-11-05T00:00")),
      [
        span("2026-11-02T09:00", "2026-11-02T12:30"),
        span("2026-11-02T14:00", "2026-11-02T18:00"),
        span("2026-11-03T09:00", "2026-11-03T17:00"),
        // Touching windows stay apart: a slot booking must fit inside one of them.
        span("2026-11-04T09:00", "2026-11-04T13:00"),
        span("2026-11-04T13:00", "2026-11-04T17:00"),
      ],
    );
  });

  test("cuts blackouts out, clipping the ones that overhang a window or the range", () => {
    const blackouts = [
      // Starts before the range and ends mid-morning on Monday.
      span("2026-10-30T12:00", "2026-11-02T11:00"),
      // Inside Tuesday's window: splits it in two.
      { ...span("2026-11-03T12:00", "2026-11-03T13:00"), reason: "Lunch" },
      // Overhangs Wednesday's close and Thursday's open.
      span("2026-11-04T16:00", "2026-11-05T10:00"),
      // All of Friday.
      span("2026-11-06T00:00", "2026-11-07T00:00"),
      // After the range: no effect.
      span("2026-11-20T09:00", "2026-11-20T17:00"),
    ];
    assert.deepEqual(
      openWindows(
        monToSat,
        blackouts,
        ist("2026-11-02T00:00"),
        ist("2026-11-07T00:00"),
      ),
      [
        span("2026-11-02T11:00", "2026-11-02T17:00"),
        span("2026-11-03T09:00", "2026-11-03T12:00"),
        span("2026-11-03T13:00", "2026-11-03T17:00"),
        span("2026-11-04T09:00", "2026-11-04T16:00"),
        span("2026-11-05T10:00", "2026-11-05T17:00"),
      ],
    );
  });

  test("clips windows to range edges in the middle of a day", () => {
    assert.deepEqual(
      openWindows(
        monToSat,
        [],
        ist("2026-11-02T10:30"),
        ist("2026-11-03T12:00"),
      ),
      [
        span("2026-11-02T10:30", "2026-11-02T17:00"),
        span("2026-11-03T09:00", "2026-11-03T12:00"),
      ],
    );
  });

  test("accepts ISO strings and returns Dates", () => {
    const [window] = openWindows(
      monToSat,
      [],
      "2026-11-02T03:30:00.000Z",
      "2026-11-02T12:00:00.000Z",
    );
    assert.ok(window.start instanceof Date);
    assert.deepEqual(window, span("2026-11-02T09:00", "2026-11-02T17:00"));
  });

  test("is empty for a closed stretch, an empty or reversed range, or no opening hours", () => {
    const from = ist("2026-11-02T00:00");
    const to = ist("2026-11-03T00:00");
    assert.deepEqual(
      openWindows(
        monToSat,
        [],
        ist("2026-11-02T17:00"),
        ist("2026-11-03T09:00"),
      ),
      [],
    );
    assert.deepEqual(openWindows(monToSat, [], from, from), []);
    assert.deepEqual(openWindows(monToSat, [], to, from), []);
    assert.deepEqual(openWindows(monToSat, [], "not a date", to), []);
    assert.deepEqual(openWindows([], [], from, to), []);
    assert.deepEqual(openWindows(undefined, undefined, from, to), []);
  });
});

describe("busySegments", () => {
  const from = ist("2026-11-03T00:00");
  const to = ist("2026-11-04T00:00");

  test("joins back-to-back bookings into one run, since they don't overlap", () => {
    const busy = busySegments(
      [
        span("2026-11-03T14:00", "2026-11-03T15:00"),
        span("2026-11-03T11:00", "2026-11-03T12:00"),
        span("2026-11-03T10:00", "2026-11-03T11:00"),
      ],
      from,
      to,
      1,
    );
    assert.deepEqual(busy, [
      { ...span("2026-11-03T10:00", "2026-11-03T12:00"), inUse: 1, full: true },
      { ...span("2026-11-03T14:00", "2026-11-03T15:00"), inUse: 1, full: true },
    ]);
  });

  test("with quantity 2, only the overlap is full", () => {
    const busy = busySegments(
      [
        span("2026-11-03T10:00", "2026-11-03T12:00"),
        span("2026-11-03T11:00", "2026-11-03T13:00"),
        // Starts as the first ends, so two stay in use until 13:00.
        span("2026-11-03T12:00", "2026-11-03T14:00"),
      ],
      from,
      to,
      2,
    );
    assert.deepEqual(busy, [
      {
        ...span("2026-11-03T10:00", "2026-11-03T11:00"),
        inUse: 1,
        full: false,
      },
      { ...span("2026-11-03T11:00", "2026-11-03T13:00"), inUse: 2, full: true },
      {
        ...span("2026-11-03T13:00", "2026-11-03T14:00"),
        inUse: 1,
        full: false,
      },
    ]);
  });

  test("clips to the range and ignores intervals outside it or with no length", () => {
    const busy = busySegments(
      [
        span("2026-11-02T20:00", "2026-11-03T09:00"),
        span("2026-11-03T22:00", "2026-11-04T10:00"),
        span("2026-11-05T10:00", "2026-11-05T12:00"),
        span("2026-11-03T12:00", "2026-11-03T12:00"),
        span("2026-11-03T15:00", "2026-11-03T14:00"),
      ],
      from,
      to,
      1,
    );
    assert.deepEqual(busy, [
      { ...span("2026-11-03T00:00", "2026-11-03T09:00"), inUse: 1, full: true },
      { ...span("2026-11-03T22:00", "2026-11-04T00:00"), inUse: 1, full: true },
    ]);
  });

  test("reveals nothing but times and counts", () => {
    const booking = {
      _id: "booking-1",
      borrower: { _id: "user-1", name: "Ananya Rao" },
      purpose: "Printing parts for the robotics club",
      status: "approved",
      ...span("2026-11-03T10:00", "2026-11-03T12:00"),
    };
    const [segment] = busySegments([booking], from, to, 3);
    assert.deepEqual(Object.keys(segment).sort(), [
      "end",
      "full",
      "inUse",
      "start",
    ]);
    assert.equal(segment.full, false);
    assert.doesNotMatch(JSON.stringify(segment), /Ananya|user-1|booking-1/);
  });

  test("is empty with no intervals or an empty range", () => {
    assert.deepEqual(busySegments([], from, to, 1), []);
    assert.deepEqual(
      busySegments([span("2026-11-03T10:00", "2026-11-03T12:00")], to, from, 1),
      [],
    );
  });
});
