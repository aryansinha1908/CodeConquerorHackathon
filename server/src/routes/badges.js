// /api/v1/badges (architecture.md §6 Badges, backend.md B-09, frontend.md F-14): the catalogue, the
// member's own badges and requests, and the issuing unit's create and direct-grant actions. The
// request queue is in routes/badgeRequests.js. Thin: services/badgeService.js validates every input
// (backend.md §7 badges.*) and checks the unit scope and the verified ID card. Errors are thrown;
// Express 5 forwards rejected promises to middleware/errorHandler.js.
import express from "express";
import { verifyAuth } from "../middleware/auth.js";
import { blockSuspended } from "../middleware/blockSuspended.js";
import { generalLimiter, uploadLimiter } from "../middleware/rateLimit.js";
import { sendData } from "../lib/respond.js";
import { fieldError } from "../lib/serviceError.js";
import {
  createBadge,
  grantBadge,
  listBadges,
  listMyBadges,
  releaseEvidence,
  requestBadge,
} from "../services/badgeService.js";
import { absent, isPlainObject } from "../services/params.js";
import { receiveFiles, storeFiles } from "../services/uploadService.js";

const router = express.Router();

// architecture.md §7.1 "Suspension": a suspended user still reads, but every write is 403.
const read = [verifyAuth, generalLimiter];
const write = [verifyAuth, generalLimiter, blockSuspended];

// architecture.md §11: the upload tier counts requests that carry a multipart body, the only kind
// that can hold a file. A JSON request without evidence is an ordinary write.
const uploadTier = (req, res, next) =>
  req.is("multipart/form-data") ? uploadLimiter(req, res, next) : next();

// The note may be 500 characters (backend.md §7 badges.request), at most 4 bytes each in UTF-8, so
// a multipart note is refused by the service's character check, never by multer's byte limit first.
const NOTE_BYTES = 4 * 500;

// ?orgUnit → the badges members can request, by name; badges of an inactive unit are left out.
router.get("/", ...read, async (req, res) => {
  sendData(req, res, await listBadges(req.query));
});

// { name, code, orgUnit, description?, validityDays?, evidenceRequired? } → 201 with the badge.
router.post("/", ...write, async (req, res) => {
  const badge = await createBadge(req.user.id, req.body, {
    requestId: req.id,
  });
  sendData(req, res, badge, { status: 201 });
});

// Declared before the /:id routes, so "mine" is never read as a badge id.
router.get("/mine", ...read, async (req, res) => {
  sendData(req, res, await listMyBadges(req.user.id));
});

// JSON { note? }, or multipart with the text field note and an optional file "evidence" (JPG, PNG,
// WebP or PDF, at most 5 MB) → 201 with the member's row.
//
// The file is stored first (Cloudinary `authenticated`, campuscommons/evidence: backend.md §8.4) and
// passed on as { publicId }. It is the only way evidence gets in: a publicId sent in the body could
// name any asset of ours, an ID card included, and the queue would show it to managers. When the
// service then refuses (not verified, already requested, no such badge…), the stored file is
// discarded so nothing is left orphaned in Cloudinary (progress.md §10 "Badge evidence upload"),
// unless the request was saved before the failure and points to it. A new request replacing an
// earlier one's file deletes the old file in the service.
router.post(
  "/:id/requests",
  ...write,
  uploadTier,
  // Passes a JSON request through untouched, with no req.files.
  receiveFiles("evidence", { maxCount: 1, fieldSize: NOTE_BYTES }),
  async (req, res) => {
    const body = req.body ?? {};
    // A body that isn't an object goes to the service as it is, which answers 400.
    const fields = isPlainObject(body);
    if (fields && !absent(body.evidence))
      throw fieldError(
        "evidence",
        'Attach the evidence as a file in the multipart field "evidence".',
      );
    const [evidence] = req.files?.length
      ? await storeFiles(req.files, "evidence", { field: "evidence" })
      : [];
    let row;
    try {
      row = await requestBadge(
        req.user.id,
        req.params.id,
        fields ? { note: body.note, evidence } : body,
        { requestId: req.id },
      );
    } catch (err) {
      if (evidence) await releaseEvidence(evidence.publicId);
      throw err;
    }
    sendData(req, res, row, { status: 201 });
  },
);

// { userId, note? } → the queue row, the badge active (renewed if it was still valid). 200: the
// member's row is reused when there is one, so nothing new is necessarily created.
router.post("/:id/grant", ...write, async (req, res) => {
  sendData(
    req,
    res,
    await grantBadge(req.user.id, req.params.id, req.body, {
      requestId: req.id,
    }),
  );
});

export default router;
