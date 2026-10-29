// POST /api/v1/uploads/images over HTTP (architecture.md §6 "Audit, uploads", backend.md §8.4): the
// whole app on port 0, a real MongoDB through fixtures.js (skipped without TEST_MONGODB_URI),
// ioredis-mock, and a fake uploader in place of Cloudinary.
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../../src/app.js";
import { useUploader } from "../../src/config/cloudinary.js";
import logger from "../../src/lib/logger.js";
import { keys } from "../../src/lib/redisKeys.js";
import { User } from "../../src/models/index.js";
import { signAccessToken } from "../../src/services/authTokens.js";
import { MAX_FILE_BYTES } from "../../src/services/uploadService.js";
import { redis, skip, useTestDatabase } from "../integration/fixtures.js";

logger.level = "silent";
process.env.ACCESS_TOKEN_SECRET = "test-access-secret";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082",
  "hex",
);
const JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0,
  1, 0, 0,
]);
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const TEXT = Buffer.from("definitely not a photo");

let f;
let server;
let origin;
let fake;

function fakeUploader() {
  const uploader = {
    uploads: [],
    destroyed: [],
    async upload(buffer, options) {
      uploader.uploads.push({ buffer, ...options });
      const publicId = `${options.folder}/${options.publicId}`;
      return {
        publicId,
        url: `https://res.cloudinary.com/test/image/upload/${publicId}.png`,
        format: "png",
      };
    },
    async destroy(publicId, options) {
      uploader.destroyed.push({ publicId, ...options });
      return { deleted: true };
    },
    async signedUrl() {
      return "https://api.cloudinary.com/signed";
    },
  };
  return uploader;
}

// entries: [field, buffer, filename, type?]: the name and type are what the client claims.
function images(entries) {
  const form = new FormData();
  for (const [field, buffer, filename, type = "image/jpeg"] of entries)
    form.append(field, new Blob([buffer], { type }), filename);
  return form;
}

async function upload(user, body) {
  const headers = user
    ? { authorization: `Bearer ${signAccessToken(user)}` }
    : {};
  const res = await fetch(`${origin}/api/v1/uploads/images`, {
    method: "POST",
    headers,
    body,
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// The user's hits in the upload tier this hour (null: never counted).
const uploadHits = (user) =>
  redis.get(`${keys.rateLimitPrefix("upload")}${user._id}`);

function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, code);
  assert.ok(res.body.requestId);
}

describe("/api/v1/uploads/images", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.close();
    await once(server, "close");
  });

  beforeEach(() => {
    fake = fakeUploader();
    useUploader(fake);
  });

  afterEach(() => useUploader(null));

  test("a verified member uploads 1–3 photos → 201 [{ url, publicId }], public and resized", async () => {
    const res = await upload(
      f.student,
      images([
        ["images", PNG, "bench.png", "image/png"],
        ["images", JPG, "plate.jpg"],
      ]),
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.requestId, res.headers.get("x-request-id"));
    assert.equal(res.body.data.length, 2);
    for (const [i, item] of res.body.data.entries()) {
      const sent = fake.uploads[i];
      assert.deepEqual(item, {
        url: `https://res.cloudinary.com/test/image/upload/campuscommons/photos/${sent.publicId}.png`,
        publicId: `campuscommons/photos/${sent.publicId}`,
      });
      assert.equal(sent.type, "upload");
      assert.equal(sent.folder, "campuscommons/photos");
      assert.deepEqual(sent.transformation, [{ width: 1600, crop: "limit" }]);
    }
  });

  test("the type is decided by the bytes: a PNG named .pdf passes, a text file named .jpg doesn't", async () => {
    const renamed = await upload(
      f.student,
      images([["images", PNG, "scan.pdf", "application/pdf"]]),
    );
    assert.equal(renamed.status, 201, JSON.stringify(renamed.body));
    assert.equal(fake.uploads.length, 1);

    const text = await upload(
      f.student,
      images([
        ["images", PNG, "ok.png", "image/png"],
        ["images", TEXT, "photo.jpg", "image/jpeg"],
      ]),
    );
    assertError(text, 400, "VALIDATION_ERROR");
    assert.deepEqual(text.body.error.details, [
      { path: "images.1", message: "Must be a JPG, PNG or WebP file." },
    ]);
    // A real PDF isn't a photo either.
    const pdf = await upload(
      f.student,
      images([["images", PDF, "photo.pdf", "application/pdf"]]),
    );
    assertError(pdf, 400, "VALIDATION_ERROR");
    assert.equal(fake.uploads.length, 1, "nothing more reached Cloudinary");
  });

  test("too big, too many, none at all: 400 VALIDATION_ERROR with details", async () => {
    const big = await upload(
      f.student,
      images([["images", Buffer.alloc(MAX_FILE_BYTES + 1), "big.jpg"]]),
    );
    assertError(big, 400, "VALIDATION_ERROR");
    assert.deepEqual(big.body.error.details, [
      { path: "images", message: "Each file can be at most 5 MB." },
    ]);

    const many = await upload(
      f.student,
      images([1, 2, 3, 4].map((n) => ["images", PNG, `${n}.png`])),
    );
    assertError(many, 400, "VALIDATION_ERROR");
    assert.deepEqual(many.body.error.details, [
      { path: "images", message: "Attach at most 3 files." },
    ]);

    const none = await upload(f.student, new FormData());
    assertError(none, 400, "VALIDATION_ERROR");
    assert.deepEqual(none.body.error.details, [
      { path: "images", message: "Attach 1 to 3 photos." },
    ]);
    assert.equal(fake.uploads.length, 0);
  });

  test("only verified members: pending, rejected and unsubmitted are 403 before the body is read, and the upload tier doesn't count them", async () => {
    // A file multer refuses (400) once it reads the body: 403 means the check ran first.
    const tooBig = () =>
      images([["images", Buffer.alloc(MAX_FILE_BYTES + 1), "big.jpg"]]);
    for (const status of ["pending", "rejected", "unsubmitted"]) {
      await User.updateOne(
        { _id: f.student2._id },
        { "verification.status": status },
      );
      const res = await upload(f.student2, tooBig());
      assertError(res, 403, "FORBIDDEN");
      assert.match(res.body.error.message, /ID card must be verified/);
    }
    assert.equal(fake.uploads.length, 0);
    assert.equal(await uploadHits(f.student2), null, "never counted");
    // The counter that stayed empty is the one a verified upload moves.
    const ok = await upload(f.student, images([["images", PNG, "a.png"]]));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(Number(await uploadHits(f.student)), 1);
  });

  test("signed out is 401; suspended is 403", async () => {
    assertError(
      await upload(null, images([["images", PNG, "a.png"]])),
      401,
      "UNAUTHENTICATED",
    );
    await User.updateOne(
      { _id: f.student._id },
      {
        suspendedUntil: new Date(Date.now() + 86_400_000),
        suspensionReason: "Repeated no-shows",
      },
    );
    const suspended = await upload(
      f.student,
      images([["images", PNG, "a.png"]]),
    );
    assertError(suspended, 403, "FORBIDDEN");
    assert.match(suspended.body.error.message, /suspended/);
    assert.equal(fake.uploads.length, 0);
  });

  test("without Cloudinary settings every upload is 503 SERVICE_UNAVAILABLE", async () => {
    useUploader(null);
    const saved = process.env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_API_SECRET;
    try {
      const res = await upload(f.student, images([["images", PNG, "a.png"]]));
      assertError(res, 503, "SERVICE_UNAVAILABLE");
      assert.equal(res.body.error.message, "Uploads aren't configured.");
    } finally {
      if (saved !== undefined) process.env.CLOUDINARY_API_SECRET = saved;
    }
  });
});
