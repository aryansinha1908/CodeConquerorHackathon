import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  MAX_LIMIT,
  assertValid,
  readFlag,
  readId,
  readInstant,
  readMatch,
  readPaging,
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
