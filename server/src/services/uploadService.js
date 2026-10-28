// Uploads (backend.md §8.4, architecture.md §6 "Audit, uploads" and §16 "Uploads", "ID documents").
//
// 1. receiveFiles(): multer keeps the files in memory, never on disk, at most 5 MB each and 3 per
//    request. Its errors become 400 VALIDATION_ERROR with details, never a 500.
// 2. checkFiles(): the real type is read from the bytes (file-type). The client's MIME type and file
//    name are ignored: a PNG renamed to .pdf is a PNG, and a text file renamed to .jpg is refused.
// 3. storeFiles(): each file goes to Cloudinary under campuscommons/{kind} with a random public id.
//    Photos are public and resized to at most 1600 px wide; ID cards and badge evidence use the
//    `authenticated` delivery type, so only a signed URL opens them. An ID-card PDF is stored as a
//    JPG of its first page: a PDF can carry scripts and links, and admins open every card.
//
// Cloudinary is reached through config/cloudinary.js, which tests replace with a fake.
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import multer from "multer";
import { getUploader } from "../config/cloudinary.js";
import { log } from "../lib/log.js";
import { ServiceError, forbidden, invalid } from "../lib/serviceError.js";
import { requireUser } from "./params.js";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 3;
// architecture.md §8: an admin's link to an ID card works for 5 minutes.
export const SIGNED_URL_SECONDS = 5 * 60;

const IMAGES = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
};
const DOCUMENTS = { ...IMAGES, "application/pdf": "PDF" };

// kind → what it accepts and how Cloudinary stores it. `type` is Cloudinary's delivery type;
// `convert` maps a detected MIME type to the format Cloudinary turns it into before storing it.
export const KINDS = {
  photos: {
    accepts: IMAGES,
    type: "upload",
    transformation: [{ width: 1600, crop: "limit" }],
  },
  "id-cards": {
    accepts: DOCUMENTS,
    type: "authenticated",
    convert: { "application/pdf": "jpg" },
  },
  evidence: { accepts: DOCUMENTS, type: "authenticated" },
};

function kindOf(kind) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Unknown upload kind "${kind}"`);
  return spec;
}

const typeList = (accepts) => {
  const names = Object.values(accepts);
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`
    : names[0];
};

// Cloudinary answers 400 for a file it can't read although its first bytes looked right (a truncated
// or damaged image): that is the member's to fix. Anything else is on our side, or Cloudinary's.
function uploadError(err, field) {
  const status = err?.http_code ?? err?.error?.http_code;
  if (status === 400) {
    const message = "This file couldn't be read. Is it damaged?";
    return invalid(message, [{ path: field, message }]);
  }
  if (err instanceof ServiceError) return err;
  log.warn({ err }, "Upload to Cloudinary failed");
  return new ServiceError(
    503,
    "SERVICE_UNAVAILABLE",
    "The upload didn't go through. Try again in a minute.",
  );
}

// For routes: answer 503 before reading a multipart body that couldn't be stored anyway.
export function assertUploadsConfigured() {
  getUploader();
}

// ── Receiving ───────────────────────────────────────────────────────────────

const filesWord = (n) => (n === 1 ? "1 file" : `${n} files`);

function multerMessage(err, field, maxCount) {
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return "Each file can be at most 5 MB.";
    case "LIMIT_FILE_COUNT":
      return `Attach at most ${filesWord(maxCount)}.`;
    case "LIMIT_UNEXPECTED_FILE":
      return err.field === field
        ? `Attach at most ${filesWord(maxCount)}.`
        : `Send the file as "${field}".`;
    case "LIMIT_FIELD_VALUE":
      return "Too long.";
    default:
      return "This form couldn't be read.";
  }
}

// Anything multer or busboy reports is about the request (too big, too many, a broken multipart
// body), so it is a 400 with the field to mark, never a 500.
function receiveError(err, field, maxCount) {
  if (err instanceof multer.MulterError) {
    const message = multerMessage(err, field, maxCount);
    return invalid(message, [{ path: err.field ?? field, message }]);
  }
  log.info({ err }, "Unreadable multipart body");
  const message = "The upload couldn't be read. Try again.";
  return invalid(message, [{ path: field, message }]);
}

// Express middleware: up to maxCount files from the multipart field `field` into req.files (a list),
// the text fields into req.body. A request that isn't multipart passes through with no req.files.
export function receiveFiles(field, { maxCount = MAX_FILES } = {}) {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: maxCount,
      fields: 10,
      fieldSize: 1024,
      fieldNameSize: 100,
      parts: maxCount + 10,
      headerPairs: 100,
    },
  }).array(field, maxCount);
  return (req, res, next) =>
    parse(req, res, (err) =>
      next(err ? receiveError(err, field, maxCount) : undefined),
    );
}

// ── Checking ────────────────────────────────────────────────────────────────

// → the files, or 400 when there are fewer than min (the form forgot the file).
export function requireFiles(files, field, { min = 1, message } = {}) {
  const list = Array.isArray(files) ? files : [];
  if (list.length >= min) return list;
  const text =
    message ?? (min === 1 ? "Attach a file." : `Attach at least ${min} files.`);
  throw invalid(text, [{ path: field, message: text }]);
}

// The type comes from the file's first bytes, never from what the client says it is. → [{ buffer,
// mime }] in the same order, or 400 with one detail per refused file (`field`, or `field.i` when the
// field can hold several).
export async function checkFiles(files, kind, { field, multiple = false }) {
  const { accepts } = kindOf(kind);
  const problems = [];
  const checked = [];
  for (const [index, file] of files.entries()) {
    const buffer = file?.buffer;
    const detected = Buffer.isBuffer(buffer)
      ? await fileTypeFromBuffer(buffer)
      : undefined;
    if (detected && accepts[detected.mime]) {
      checked.push({ buffer, mime: detected.mime });
      continue;
    }
    problems.push({
      path: multiple ? `${field}.${index}` : field,
      message: `Must be a ${typeList(accepts)} file.`,
    });
  }
  if (problems.length)
    throw invalid(
      problems.length === 1
        ? "1 file isn't an accepted type."
        : `${problems.length} files aren't an accepted type.`,
      problems,
    );
  return checked;
}

// ── Storing ─────────────────────────────────────────────────────────────────

// Checks, then uploads every file. → [{ url, publicId }] for photos, [{ publicId }] for private kinds:
// their Cloudinary URL opens nothing without a signature, so there is no point handing it out. If one
// upload fails, the others are deleted again and the request is 503.
export async function storeFiles(files, kind, { field, multiple = false }) {
  const spec = kindOf(kind);
  const checked = await checkFiles(files, kind, { field, multiple });
  const uploader = getUploader();
  const settled = await Promise.allSettled(
    checked.map(async ({ buffer, mime }) =>
      uploader.upload(buffer, {
        folder: `campuscommons/${kind}`,
        publicId: randomUUID(),
        type: spec.type,
        ...(spec.transformation && { transformation: spec.transformation }),
        ...(spec.convert?.[mime] && { format: spec.convert[mime] }),
      }),
    ),
  );
  const failed = settled.find((r) => r.status === "rejected");
  if (failed) {
    await Promise.all(
      settled
        .filter((r) => r.status === "fulfilled")
        .map((r) => discardAsset(r.value.publicId, kind)),
    );
    throw uploadError(failed.reason, field);
  }
  return settled.map(({ value }) =>
    spec.type === "upload"
      ? { url: value.url, publicId: value.publicId }
      : { publicId: value.publicId },
  );
}

// Throws when Cloudinary refuses or can't be reached; an asset that is already gone counts as deleted.
export async function deleteAsset(publicId, kind) {
  await getUploader().destroy(publicId, { type: kindOf(kind).type });
}

// Best effort, for clean-up after the change that matters has been saved: a failure is logged with
// the asset's (random) id so it can be removed by hand, and never fails the request.
export async function discardAsset(publicId, kind) {
  try {
    await deleteAsset(publicId, kind);
    return true;
  } catch (err) {
    log.error({ err, kind, publicId }, "Couldn't delete an uploaded file");
    return false;
  }
}

// → { url, expiresAt } for a private asset: the URL stops working after SIGNED_URL_SECONDS. null when
// Cloudinary has no such asset; 503 when it can't be asked.
export async function signedUrl(publicId, kind, { now = new Date() } = {}) {
  const expiresAt = new Date(now.getTime() + SIGNED_URL_SECONDS * 1000);
  const uploader = getUploader();
  let url;
  try {
    url = await uploader.signedUrl(publicId, {
      type: kindOf(kind).type,
      expiresAt,
    });
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    log.warn({ err, kind }, "Couldn't sign a Cloudinary link");
    throw new ServiceError(
      503,
      "SERVICE_UNAVAILABLE",
      "The file can't be opened right now. Try again in a minute.",
    );
  }
  return url ? { url, expiresAt } : null;
}

// ── POST /uploads/images ────────────────────────────────────────────────────

// Condition and incident photos are for verified members (architecture.md §6): the route checks this
// before reading the body, and uploadImages again, for callers other than the route.
export async function requireVerifiedUploader(userId) {
  const user = await requireUser(userId);
  if (user.verification?.status !== "approved")
    throw forbidden(
      "Your ID card must be verified before you can upload photos.",
    );
  return user;
}

// files: req.files from receiveFiles("images"). → [{ url, publicId }], 1 to 3 of them.
export async function uploadImages(userId, files) {
  await requireVerifiedUploader(userId);
  const list = requireFiles(files, "images", {
    message: `Attach 1 to ${MAX_FILES} photos.`,
  });
  return storeFiles(list, "photos", { field: "images", multiple: true });
}
