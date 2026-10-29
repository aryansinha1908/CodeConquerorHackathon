import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  MAX_LIMIT,
  assertValid,
  isPlainObject,
  readEnum,
  readEnumList,
  readFlag,
  readId,
  readInstant,
  readMatch,
  readPaging,
  readText,
  sameId,
} from "../../src/services/params.js";

const read = (fn) => {
  const problems = [];
  return { value: fn(problems), problems };
};

describe("params", () => {
  test("readId lower-cases ids and refuses anything else, operators included", () => {
    const id = new mongoose.Types.ObjectId().toHexString();
    assert.equal(read((p) => readId(id.toUpperCase(), "id", p)).value, id);
    assert.equal(read((p) => readId("", "id", p)).value, undefined);
    for (const bad of ["demo-user-id-001", { $ne: null }, 42]) {
      assert.deepEqual(read((p) => readId(bad, "id", p)).problems, [
        { path: "id", message: "Must be a valid id." },
      ]);
    }
  });

  test("readFlag counts only a literal true", () => {
    for (const [input, expected] of [
      [true, true],
      ["true", true],
      ["false", false],
      [undefined, false],
    ])
      assert.equal(read((p) => readFlag(input, "f", p)).value, expected);
    assert.equal(read((p) => readFlag("yes", "f", p)).problems.length, 1);
  });

  test("readMatch, readInstant and readPaging", () => {
    assert.equal(
      read((p) => readMatch("booking.approved", /^[a-z.]+$/, "a", p, "No"))
        .value,
      "booking.approved",
    );
    assert.deepEqual(
      read((p) => readMatch(["x"], /^[a-z]+$/, "a", p, "No")).problems,
      [{ path: "a", message: "No" }],
    );
    assert.equal(
      read((p) =>
        readInstant("2026-11-02T10:00:00+05:30", "at", p),
      ).value.toISOString(),
      "2026-11-02T04:30:00.000Z",
    );
    assert.equal(read((p) => readInstant("soon", "at", p)).problems.length, 1);

    assert.deepEqual(read((p) => readPaging({}, p)).value, {
      page: 1,
      limit: 20,
    });
    assert.deepEqual(
      read((p) => readPaging({ page: "2", limit: "500" }, p)).value,
      {
        page: 2,
        limit: MAX_LIMIT,
      },
    );
    assert.deepEqual(
      read((p) => readPaging({ page: 0, limit: 1.5 }, p)).problems.map(
        (x) => x.path,
      ),
      ["page", "limit"],
    );
  });

  test("readEnum and readEnumList; required values", () => {
    const allowed = ["open", "in_review", "resolved"];
    assert.equal(read((p) => readEnum("open", allowed, "s", p)).value, "open");
    assert.deepEqual(
      read((p) => readEnum("", allowed, "s", p)),
      {
        value: undefined,
        problems: [],
      },
    );
    assert.deepEqual(
      read((p) => readEnum(undefined, allowed, "s", p, { required: true }))
        .problems,
      [{ path: "s", message: "Required." }],
    );
    assert.match(
      read((p) => readEnum("closed", allowed, "s", p)).problems[0].message,
      /one of: open, in_review, resolved/,
    );

    // Sorted and de-duplicated, from a list or a comma string.
    assert.deepEqual(
      read((p) => readEnumList(" resolved,open,open", allowed, "s", p)).value,
      ["open", "resolved"],
    );
    assert.deepEqual(
      read((p) => readEnumList(["in_review"], allowed, "s", p)).value,
      ["in_review"],
    );
    for (const bad of ["open,closed", [], { $in: ["open"] }, ","])
      assert.equal(
        read((p) => readEnumList(bad, allowed, "s", p)).problems.length,
        1,
        JSON.stringify(bad),
      );

    assert.deepEqual(
      read((p) => readInstant(null, "at", p, { required: true })).problems,
      [{ path: "at", message: "Required." }],
    );
  });

  test("readText trims, treats blank as absent and checks length", () => {
    assert.equal(read((p) => readText("  hi  ", "t", p)).value, "hi");
    assert.deepEqual(
      read((p) => readText("   ", "t", p)),
      {
        value: undefined,
        problems: [],
      },
    );
    assert.deepEqual(
      read((p) =>
        readText(" ", "t", p, { required: true, requiredMessage: "Say why." }),
      ).problems,
      [{ path: "t", message: "Say why." }],
    );
    assert.deepEqual(read((p) => readText(5, "t", p)).problems, [
      { path: "t", message: "Must be text." },
    ]);
    assert.deepEqual(
      read((p) => readText("short", "t", p, { min: 20 })).problems,
      [{ path: "t", message: "Must be at least 20 characters." }],
    );
    assert.deepEqual(
      read((p) => readText("x".repeat(6), "t", p, { max: 5 })).problems,
      [{ path: "t", message: "Can be at most 5 characters." }],
    );
    // No max: any length.
    assert.equal(
      read((p) => readText("x".repeat(5000), "t", p)).problems.length,
      0,
    );
  });

  test("sameId and isPlainObject", () => {
    const id = new mongoose.Types.ObjectId();
    assert.equal(sameId(id, String(id)), true);
    assert.equal(sameId({ _id: id }, id), true);
    assert.equal(sameId(id, new mongoose.Types.ObjectId()), false);
    // A missing id never matches, not even another missing one.
    assert.equal(sameId(undefined, undefined), false);
    assert.equal(sameId(null, id), false);

    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject(Object.create(null)), true);
    for (const v of [null, [], new Date(), "x", new mongoose.Types.ObjectId()])
      assert.equal(isPlainObject(v), false);
  });

  test("assertValid throws one 400 with every problem", () => {
    assert.doesNotThrow(() => assertValid([]));
    assert.throws(
      () => assertValid([{ path: "a" }, { path: "b" }], "field"),
      (err) =>
        err.status === 400 &&
        err.code === "VALIDATION_ERROR" &&
        err.message === "2 fields are invalid." &&
        err.details.length === 2,
    );
  });
});
