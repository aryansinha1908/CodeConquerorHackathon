// The photo comparison's pure parts (src/services/photoCompareService.js): the photo URLs it fetches
// and how the model's answer is checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { originalPhotoUrl, readComparison, smallPhotoUrl } from "../../src/services/photoCompareService.js";

test("photo URLs: our cloud, the stored public id (each part encoded), Cloudinary's resize and nothing else", () => {
  assert.equal(
    smallPhotoUrl("campuscommons/photos/abc 1", "campus-test"),
    "https://res.cloudinary.com/campus-test/image/upload/w_768,h_768,c_limit,q_auto:eco,f_jpg/campuscommons/photos/abc%201",
  );
  assert.equal(originalPhotoUrl("a/b?c#d", "campus-test"), "https://res.cloudinary.com/campus-test/image/upload/a/b%3Fc%23d");
});

test("readComparison: known severities and checklist labels only, at most six, contact details withheld", () => {
  const labels = ["Nozzle clean", "Build plate intact"];
  const out = readComparison(
    {
      summary: "  The build plate\nhas a new scratch. ",
      comparable: true,
      newDamageLikely: true,
      differences: [
        { description: "Scratch on the plate", severity: "major", checklistItem: "build plate INTACT" },
        { description: "Dust", severity: "catastrophic", checklistItem: "Something else" },
        { description: "", severity: "minor" },
        { description: "Visit https://evil.example to claim", severity: "none" },
        ...Array.from({ length: 6 }, (_, i) => ({ description: `extra ${i}`, severity: "minor" })),
      ],
    },
    labels,
  );
  assert.equal(out.summary, "The build plate has a new scratch.");
  assert.equal(out.newDamageLikely, true);
  assert.equal(out.differences.length, 6);
  assert.deepEqual(out.differences[0], { description: "Scratch on the plate", severity: "major", checklistItem: "Build plate intact" });
  assert.deepEqual(out.differences[1], { description: "Dust", severity: "minor", checklistItem: null });
  assert.match(out.differences[2].description, /withheld because it contained contact details/);
  assert.equal(readComparison({ comparable: true, newDamageLikely: "yes" }).newDamageLikely, false, "only a real true counts");
  assert.equal(readComparison({ comparable: false, newDamageLikely: true }).newDamageLikely, false, "no verdict without a comparison");
  assert.equal(readComparison({ newDamageLikely: true }).comparable, false);
  assert.match(readComparison({ summary: "Call 9876543210 now" }).summary, /withheld/);
  assert.equal(readComparison(null).summary, "No summary was given.");
});
