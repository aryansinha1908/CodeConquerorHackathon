import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  ServiceError,
  fromValidationError,
  invalid,
} from "../../src/lib/serviceError.js";
import { Resource } from "../../src/models/index.js";

// validate() runs the model's validators without a database connection.
const validationErrorFor = (fields) =>
  new Resource(fields).validate().then(
    () => assert.fail("expected the document to be invalid"),
    (err) => err,
  );

const validListing = {
  orgUnit: new mongoose.Types.ObjectId(),
  title: "Prusa MK4 3D Printer",
  category: "equipment",
};

describe("fromValidationError", () => {
  test("turns a ValidationError into 400 VALIDATION_ERROR with field details sorted by path", async () => {
    const err = await validationErrorFor({
      title: "Prusa MK4 3D Printer",
      category: "drone",
      quantity: 0,
      availability: {
        weekly: [{ day: 1, open: "17:00", close: "09:00" }],
        blackouts: [{ start: new Date(2), end: new Date(1) }],
      },
      limits: { minDurationMins: 120, maxDurationMins: 30 },
    });
    assert.ok(err instanceof mongoose.Error.ValidationError);

    const result = fromValidationError(err);
    assert.ok(result instanceof ServiceError);
    assert.equal(result.status, 400);
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.equal(result.message, "6 fields are invalid.");
    assert.deepEqual(result.details, [
      {
        path: "availability.blackouts.0.end",
        message: "end must be after start",
      },
      // The full path from the parent, not the subdocument's own "close".
      {
        path: "availability.weekly.0.close",
        message: "close must be after open",
      },
      {
        path: "category",
        message: "`drone` is not a valid enum value for path `category`.",
      },
      {
        path: "limits.minDurationMins",
        message: "Minimum duration can't exceed the maximum",
      },
      {
        path: "orgUnit",
        message: "Path `orgUnit` is required.",
      },
      {
        path: "quantity",
        message: "Path `quantity` (0) is less than minimum allowed value (1).",
      },
    ]);
  });

  test("replaces cast messages, which name the model and echo the value", async () => {
    const err = await validationErrorFor({
      ...validListing,
      orgUnit: "demo-user-id-001",
      quantity: "lots",
      availability: { blackouts: [{ start: "soon", end: new Date() }] },
    });
    const { message, details } = fromValidationError(err);
    assert.equal(message, "3 fields are invalid.");
    assert.deepEqual(details, [
      {
        path: "availability.blackouts.0.start",
        message: "Must be a valid date.",
      },
      { path: "orgUnit", message: "Must be a valid id." },
      { path: "quantity", message: "Must be a number." },
    ]);
  });

  test("a validator that crashes gives a plain message, not the JavaScript error's text", async () => {
    // maxItems reads list.length, so a null list makes the validator throw a TypeError.
    const err = await validationErrorFor({ ...validListing, checklist: null });
    assert.deepEqual(fromValidationError(err).details, [
      { path: "checklist", message: "Has an invalid value." },
    ]);
  });

  test("one bad field reads in the singular", async () => {
    const err = await validationErrorFor({ ...validListing, title: "ab" });
    const result = fromValidationError(err);
    assert.equal(result.message, "1 field is invalid.");
    assert.deepEqual(
      result.details.map((d) => d.path),
      ["title"],
    );
  });

  test("returns anything else unchanged", () => {
    const plain = new Error("boom");
    const service = invalid("Already a service error.");
    const cast = new mongoose.Error.CastError("ObjectId", "nope", "_id");
    assert.equal(fromValidationError(plain), plain);
    assert.equal(fromValidationError(service), service);
    assert.equal(fromValidationError(cast), cast);
    assert.equal(fromValidationError(undefined), undefined);
  });
});
