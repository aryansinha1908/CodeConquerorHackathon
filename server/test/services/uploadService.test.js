// The upload service without a database (backend.md §8.4, architecture.md §16 "Uploads"): multer's
// limits through a small app on port 0, the byte-level type check, what reaches the uploader, and the
// Cloudinary seam. Cloudinary itself is never called: a fake uploader stands in.
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
import { Writable } from "node:stream";
import { v2 as cloudinary } from "cloudinary";
import express from "express";
import {
  downloadUrl,
  getUploader,
  useUploader,
} from "../../src/config/cloudinary.js";
import { setLogger } from "../../src/lib/log.js";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import {
  KINDS,
  MAX_FILE_BYTES,
  SIGNED_URL_SECONDS,
  checkFiles,
  discardAsset,
  receiveFiles,
  signedUrl,
  storeFiles,
} from "../../src/services/uploadService.js";

const logged = [];
setLogger({
  info() {},
  warn: (...args) => logged.push(["warn", ...args]),
  error: (...args) => logged.push(["error", ...args]),
});

// Real magic bytes; the rest of each file is padding, which file-type doesn't need.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c00000000049454e44ae426082",
  "hex",
);
const JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0,
  1, 0, 0,
]);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
);
const TEXT = Buffer.from("just some notes, not an image at all");

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Records every call; failOn makes the nth upload (0-based) fail with the given error.
function fakeUploader({ failOn = {} } = {}) {
  const fake = {
    uploads: [],
    destroyed: [],
    signed: [],
    async upload(buffer, options) {
      const n = fake.uploads.length;
      fake.uploads.push({ buffer, ...options });
      if (failOn[n]) throw failOn[n];
      const publicId = `${options.folder}/${options.publicId}`;
      return {
        publicId,
        url: `https://res.cloudinary.com/test/image/${options.type}/${publicId}`,
        format: "png",
      };
    },
    async destroy(publicId, options) {
      fake.destroyed.push({ publicId, ...options });
      return { deleted: true };
    },
    async signedUrl(publicId, options) {
      fake.signed.push({ publicId, ...options });
      return `https://api.cloudinary.com/v1_1/test/image/download?public_id=${publicId}`;
    },
  };
  return fake;
}

const file = (
  buffer,
  originalname = "upload.bin",
  mimetype = "image/jpeg",
) => ({
  buffer,
  originalname,
  mimetype,
  size: buffer.length,
});

async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("expected a refusal");
}

const CLOUDINARY_ENV = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];
const savedEnv = {};

beforeEach(() => {
  logged.length = 0;
  for (const name of CLOUDINARY_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  useUploader(null);
  for (const name of CLOUDINARY_ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe("the Cloudinary seam", () => {
  test("without CLOUDINARY_* every upload is 503 SERVICE_UNAVAILABLE", async () => {
    const err = await refusal(Promise.resolve().then(() => getUploader()));
    assert.equal(err.status, 503);
    assert.equal(err.code, "SERVICE_UNAVAILABLE");
    assert.equal(err.message, "Uploads aren't configured.");
    // Partly configured is still unconfigured.
    process.env.CLOUDINARY_CLOUD_NAME = "campus";
    assert.equal(
      (await refusal(storeFiles([file(PNG)], "photos", { field: "images" })))
        .status,
      503,
    );
  });

  test("a fake replaces Cloudinary, and null brings it back", () => {
    const fake = fakeUploader();
    useUploader(fake);
    assert.equal(getUploader(), fake);
    useUploader(null);
    assert.throws(() => getUploader(), { status: 503 });
  });

  test("downloadUrl is a signed Download API link that expires (architecture.md §8)", () => {
    process.env.CLOUDINARY_CLOUD_NAME = "campus";
    process.env.CLOUDINARY_API_KEY = "key123";
    process.env.CLOUDINARY_API_SECRET = "secret456";
    const expiresAt = new Date("2026-11-02T04:35:00.000Z");
    const url = new URL(
      downloadUrl("campuscommons/id-cards/abc", "pdf", {
        type: "authenticated",
        expiresAt,
      }),
    );
    assert.equal(url.origin, "https://api.cloudinary.com");
    assert.equal(url.pathname, "/v1_1/campus/image/download");
    assert.equal(
      url.searchParams.get("public_id"),
      "campuscommons/id-cards/abc",
    );
    assert.equal(url.searchParams.get("format"), "pdf");
    assert.equal(url.searchParams.get("type"), "authenticated");
    assert.equal(
      Number(url.searchParams.get("expires_at")),
      expiresAt.getTime() / 1000,
    );
    assert.equal(url.searchParams.get("api_key"), "key123");
    assert.match(url.searchParams.get("signature"), /^[0-9a-f]{40}$/);
    assert.equal(url.href.includes("secret456"), false);
  });
});

describe("checkFiles: the type comes from the bytes", () => {
  test("photos take JPG, PNG and WebP; ID cards and evidence take PDF too; nothing is public but photos", () => {
    assert.deepEqual(Object.keys(KINDS).sort(), [
      "evidence",
      "id-cards",
      "photos",
    ]);
    assert.equal(KINDS.photos.type, "upload");
    assert.deepEqual(KINDS.photos.transformation, [
      { width: 1600, crop: "limit" },
    ]);
    for (const kind of ["id-cards", "evidence"]) {
      assert.equal(KINDS[kind].type, "authenticated");
      assert.equal(KINDS[kind].transformation, undefined);
      assert.ok(KINDS[kind].accepts["application/pdf"]);
    }
    assert.equal(KINDS.photos.accepts["application/pdf"], undefined);
  });

  test("a PNG renamed to .pdf is a PNG; a text file renamed to .jpg is refused", async () => {
    const [png] = await checkFiles(
      [file(PNG, "id-card.pdf", "application/pdf")],
      "id-cards",
      { field: "idCard" },
    );
    assert.equal(png.mime, "image/png");

    const err = await refusal(
      checkFiles([file(TEXT, "card.jpg", "image/jpeg")], "id-cards", {
        field: "idCard",
      }),
    );
    assert.equal(err.status, 400);
    assert.equal(err.code, "VALIDATION_ERROR");
    assert.deepEqual(err.details, [
      { path: "idCard", message: "Must be a JPG, PNG, WebP or PDF file." },
    ]);
  });

  test("a PDF is a document, not a photo; each bad file is named by its index", async () => {
    const [pdf] = await checkFiles([file(PDF, "x.jpg")], "evidence", {
      field: "evidence",
    });
    assert.equal(pdf.mime, "application/pdf");

    const err = await refusal(
      checkFiles(
        [file(JPG), file(PDF, "scan.png", "image/png"), file(Buffer.alloc(0))],
        "photos",
        { field: "images", multiple: true },
      ),
    );
    assert.equal(err.message, "2 files aren't an accepted type.");
    assert.deepEqual(err.details, [
      { path: "images.1", message: "Must be a JPG, PNG or WebP file." },
      { path: "images.2", message: "Must be a JPG, PNG or WebP file." },
    ]);
  });
});

describe("storeFiles", () => {
  test("photos: public, resized, random ids under campuscommons/photos → [{ url, publicId }]", async () => {
    const fake = fakeUploader();
    useUploader(fake);
    const stored = await storeFiles([file(PNG), file(JPG)], "photos", {
      field: "images",
      multiple: true,
    });
    assert.equal(fake.uploads.length, 2);
    for (const upload of fake.uploads) {
      assert.equal(upload.folder, "campuscommons/photos");
      assert.equal(upload.type, "upload");
      assert.deepEqual(upload.transformation, [{ width: 1600, crop: "limit" }]);
      assert.match(upload.publicId, UUID);
    }
    assert.notEqual(fake.uploads[0].publicId, fake.uploads[1].publicId);
    assert.ok(fake.uploads[0].buffer.equals(PNG));
    assert.deepEqual(stored, [
      {
        url: `https://res.cloudinary.com/test/image/upload/campuscommons/photos/${fake.uploads[0].publicId}`,
        publicId: `campuscommons/photos/${fake.uploads[0].publicId}`,
      },
      {
        url: `https://res.cloudinary.com/test/image/upload/campuscommons/photos/${fake.uploads[1].publicId}`,
        publicId: `campuscommons/photos/${fake.uploads[1].publicId}`,
      },
    ]);
  });

  test("ID cards and evidence: authenticated, not resized, and no URL handed out", async () => {
    const fake = fakeUploader();
    useUploader(fake);
    for (const kind of ["id-cards", "evidence"]) {
      const [stored] = await storeFiles([file(PDF)], kind, { field: "file" });
      const upload = fake.uploads.at(-1);
      assert.equal(upload.folder, `campuscommons/${kind}`);
      assert.equal(upload.type, "authenticated");
      assert.equal(upload.transformation, undefined);
      assert.deepEqual(stored, {
        publicId: `campuscommons/${kind}/${upload.publicId}`,
      });
    }
  });

  test("an ID-card PDF is stored as a JPG of its first page, so its scripts never reach an admin", async () => {
    const fake = fakeUploader();
    useUploader(fake);
    // file-type calls this application/pdf: the bytes start with %PDF.
    const ACTIVE_PDF = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\nendobj\n%%EOF\n",
    );
    const [pdf] = await checkFiles([file(ACTIVE_PDF)], "id-cards", {
      field: "idCard",
    });
    assert.equal(pdf.mime, "application/pdf");

    await storeFiles(
      [file(ACTIVE_PDF, "card.pdf", "application/pdf")],
      "id-cards",
      { field: "idCard" },
    );
    assert.equal(fake.uploads[0].format, "jpg");
    assert.equal(fake.uploads[0].type, "authenticated");
    // An image is stored as it is.
    await storeFiles([file(PNG)], "id-cards", { field: "idCard" });
    assert.equal(fake.uploads[1].format, undefined);
  });

  test("the Cloudinary uploader passes the conversion on to upload_stream", async (t) => {
    process.env.CLOUDINARY_CLOUD_NAME = "campus";
    process.env.CLOUDINARY_API_KEY = "key123";
    process.env.CLOUDINARY_API_SECRET = "secret456";
    const calls = [];
    t.mock.method(cloudinary.uploader, "upload_stream", (options, done) => {
      calls.push(options);
      return new Writable({
        write: (_chunk, _encoding, next) => next(),
        final(next) {
          next();
          done(null, {
            public_id: `${options.folder}/${options.public_id}`,
            secure_url: "https://api.cloudinary.com/x",
            format: options.format ?? "png",
          });
        },
      });
    });
    const [stored] = await storeFiles([file(PDF)], "id-cards", {
      field: "idCard",
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].format, "jpg");
    assert.equal(calls[0].type, "authenticated");
    assert.equal(calls[0].resource_type, "image");
    assert.match(stored.publicId, /^campuscommons\/id-cards\//);
    await storeFiles([file(PNG)], "photos", { field: "images" });
    assert.equal("format" in calls[1], false);
  });

  test("a refused type uploads nothing", async () => {
    const fake = fakeUploader();
    useUploader(fake);
    await refusal(
      storeFiles([file(PNG), file(TEXT)], "photos", {
        field: "images",
        multiple: true,
      }),
    );
    assert.equal(fake.uploads.length, 0);
  });

  test("one failed upload deletes the others and is 503; Cloudinary's 400 is the member's", async () => {
    const fake = fakeUploader({
      failOn: {
        1: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }),
      },
    });
    useUploader(fake);
    const err = await refusal(
      storeFiles([file(PNG), file(JPG), file(PNG)], "photos", {
        field: "images",
        multiple: true,
      }),
    );
    assert.equal(err.status, 503);
    assert.equal(err.code, "SERVICE_UNAVAILABLE");
    assert.deepEqual(
      fake.destroyed.map((d) => d.publicId).sort(),
      [0, 2]
        .map((i) => `campuscommons/photos/${fake.uploads[i].publicId}`)
        .sort(),
    );
    assert.ok(fake.destroyed.every((d) => d.type === "upload"));

    useUploader(
      fakeUploader({
        failOn: { 0: { message: "Invalid image file", http_code: 400 } },
      }),
    );
    const damaged = await refusal(
      storeFiles([file(PNG)], "id-cards", { field: "idCard" }),
    );
    assert.equal(damaged.status, 400);
    assert.deepEqual(damaged.details, [
      { path: "idCard", message: "This file couldn't be read. Is it damaged?" },
    ]);
  });
});

describe("signedUrl and discardAsset", () => {
  test("a signed link lasts 5 minutes and uses the asset's delivery type", async () => {
    const fake = fakeUploader();
    useUploader(fake);
    const now = new Date("2026-11-02T04:30:00.000Z");
    const link = await signedUrl("campuscommons/id-cards/abc", "id-cards", {
      now,
    });
    assert.equal(SIGNED_URL_SECONDS, 300);
    assert.equal(link.expiresAt.getTime(), now.getTime() + 300_000);
    assert.deepEqual(fake.signed, [
      {
        publicId: "campuscommons/id-cards/abc",
        type: "authenticated",
        expiresAt: link.expiresAt,
      },
    ]);
    // No such asset at Cloudinary → null, for the caller's 404.
    useUploader({ ...fake, signedUrl: async () => null });
    assert.equal(await signedUrl("gone", "id-cards"), null);
  });

  test("discardAsset never throws, and logs the id so the file can be removed by hand", async () => {
    useUploader({
      destroy: async () => {
        throw new Error("Cloudinary is down");
      },
    });
    assert.equal(
      await discardAsset("campuscommons/id-cards/x", "id-cards"),
      false,
    );
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], "error");
    assert.equal(logged[0][1].publicId, "campuscommons/id-cards/x");
  });
});

describe("receiveFiles: multer's limits are 400s, never 500s", () => {
  let server;
  let origin;
  before(async () => {
    const app = express();
    app.post("/one", receiveFiles("idCard", { maxCount: 1 }), (req, res) =>
      res.json({
        files: (req.files ?? []).map((f) => [f.fieldname, f.size]),
        body: { ...req.body },
      }),
    );
    app.post("/many", receiveFiles("images"), (req, res) =>
      res.json({ files: (req.files ?? []).map((f) => [f.fieldname, f.size]) }),
    );
    app.use(errorHandler);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await once(server, "close");
  });

  const form = (entries) => {
    const body = new FormData();
    for (const [name, value, filename] of entries)
      filename
        ? body.append(name, new Blob([value]), filename)
        : body.append(name, value);
    return body;
  };
  const post = async (path, body, headers) => {
    const res = await fetch(`${origin}${path}`, {
      method: "POST",
      body,
      headers,
    });
    return { status: res.status, body: await res.json() };
  };
  const assertRefused = (res, details) => {
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.deepEqual(res.body.error.details, details);
  };

  test("files in memory with the text fields beside them; exactly 5 MB is allowed", async () => {
    const res = await post(
      "/one",
      form([
        ["memberType", "ug"],
        ["idCard", Buffer.alloc(MAX_FILE_BYTES), "card.png"],
      ]),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      files: [["idCard", MAX_FILE_BYTES]],
      body: { memberType: "ug" },
    });
  });

  test("a file over 5 MB", async () => {
    assertRefused(
      await post(
        "/many",
        form([
          ["images", PNG, "a.png"],
          ["images", Buffer.alloc(MAX_FILE_BYTES + 1), "big.png"],
        ]),
      ),
      [{ path: "images", message: "Each file can be at most 5 MB." }],
    );
  });

  test("more than 3 files, or a second ID card", async () => {
    assertRefused(
      await post(
        "/many",
        form([1, 2, 3, 4].map((n) => ["images", PNG, `${n}.png`])),
      ),
      [{ path: "images", message: "Attach at most 3 files." }],
    );
    assertRefused(
      await post(
        "/one",
        form([
          ["idCard", PNG, "front.png"],
          ["idCard", PNG, "back.png"],
        ]),
      ),
      [{ path: "idCard", message: "Attach at most 1 file." }],
    );
  });

  test("a file under another field name, a long text field, a broken body", async () => {
    assertRefused(await post("/one", form([["photo", PNG, "a.png"]])), [
      { path: "photo", message: 'Send the file as "idCard".' },
    ]);
    assertRefused(
      await post("/one", form([["memberType", "x".repeat(2000)]])),
      [{ path: "memberType", message: "Too long." }],
    );
    assertRefused(
      await post(
        "/one",
        '--xyz\r\nContent-Disposition: form-data; name="a"\r\n\r\nunterminated',
        {
          "content-type": "multipart/form-data; boundary=xyz",
        },
      ),
      [{ path: "idCard", message: "The upload couldn't be read. Try again." }],
    );
  });

  test("a request that isn't multipart passes through with no files", async () => {
    const res = await post("/one", JSON.stringify({ a: 1 }), {
      "content-type": "application/json",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.files, []);
  });
});
