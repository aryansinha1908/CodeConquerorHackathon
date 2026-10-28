import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { photoProblems } from "../../src/services/uploadService.js";

const photo = (publicId, cloud = "campus") => ({
  publicId,
  url: `https://res.cloudinary.com/${cloud}/image/upload/v1730000000/${publicId}.jpg`,
});

describe("photoProblems", () => {
  test("accepts our own photos, refuses anything hosted elsewhere", (t) => {
    const saved = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = "campus";
    t.after(() => {
      if (saved === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
      else process.env.CLOUDINARY_CLOUD_NAME = saved;
    });

    assert.deepEqual(photoProblems(undefined), []);
    assert.deepEqual(photoProblems([]), []);
    // Fixed-folder mode keeps the folder in the public id; dynamic-folder mode doesn't.
    assert.deepEqual(
      photoProblems([photo("campuscommons/photos/a1"), photo("b2")]),
      [],
    );
    assert.deepEqual(photoProblems("x"), [
      { path: "photos", message: "Must be a list." },
    ]);
    const bad = [
      photo("c3", "someone-else"), // another Cloudinary account
      { publicId: "d4", url: "https://evil.example/d4.jpg" },
      { publicId: "e5", url: photo("other").url }, // URL names a different asset
      { publicId: "", url: photo("f6").url },
      null,
      { url: photo("g7").url },
    ];
    assert.deepEqual(
      photoProblems(bad, "items").map((p) => p.path),
      ["items.0", "items.1", "items.2", "items.3", "items.4", "items.5"],
    );
  });

  test("refuses URLs that only look like ours: dot segments, encodings, extra parts, a loose public id", (t) => {
    const saved = process.env.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_CLOUD_NAME = "campus";
    t.after(() => {
      if (saved === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
      else process.env.CLOUDINARY_CLOUD_NAME = saved;
    });
    const base = "https://res.cloudinary.com/campus/image/upload";
    const bad = [
      // A browser resolves these to another account's asset.
      `${base}/../../../evilcloud/image/upload/v1/x.jpg`,
      `${base}/%2e%2e/%2e%2e/%2e%2e/evilcloud/image/upload/v1/x.jpg`,
      `${base}/v1/./x.jpg`,
      "https:\\\\res.cloudinary.com\\campus\\image\\upload\\v1\\x.jpg",
      // Not the delivery URL /uploads/images hands out.
      `${base}/v1/x.jpg?ref=1`,
      `${base}/v1/x.jpg#top`,
      "https://user@res.cloudinary.com/campus/image/upload/v1/x.jpg",
      "https://res.cloudinary.com:8443/campus/image/upload/v1/x.jpg",
      "http://res.cloudinary.com/campus/image/upload/v1/x.jpg",
      "HTTPS://RES.CLOUDINARY.COM/campus/image/upload/v1/x.jpg",
      // A transformation could overlay or fetch an image from elsewhere.
      `${base}/l_fetch:aHR0cHM6Ly9ldmlsLmV4YW1wbGUveC5qcGc=/v1/x.jpg`,
      // The public id must be the whole last part, not a prefix of it or a folder on the way.
      `${base}/v1/xylophone.jpg`,
      `${base}/v1/x/other.jpg`,
      "not a url",
    ].map((url) => ({ publicId: "x", url }));
    assert.deepEqual(
      photoProblems(bad).map((p) => p.path),
      bad.map((_, i) => `photos.${i}`),
    );
    // A public id that would itself climb out of the account is refused too.
    assert.equal(
      photoProblems([
        {
          publicId: "../../evilcloud/image/upload/x",
          url: `${base}/v1/../../evilcloud/image/upload/x.jpg`,
        },
      ]).length,
      1,
    );
    // Without a version, or without an extension, is still the same asset of ours.
    assert.deepEqual(
      photoProblems([
        { publicId: "x", url: `${base}/x.jpg` },
        { publicId: "x", url: `${base}/v1/x` },
      ]),
      [],
    );
  });

  test("without a Cloudinary account nothing can have been uploaded", (t) => {
    const saved = process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    t.after(() => {
      if (saved !== undefined) process.env.CLOUDINARY_CLOUD_NAME = saved;
    });
    assert.equal(photoProblems([photo("a1")]).length, 1);
    assert.deepEqual(photoProblems([]), []);
  });
});
