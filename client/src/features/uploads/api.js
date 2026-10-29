// The library's UMD build, emitted with the app (Vite `?url`) for the compression worker to load.
import compressionLibPath from 'browser-image-compression/dist/browser-image-compression.js?url';
import http from '../../lib/http';

// Condition and incident photos (api.md "Verification and uploads"): POST /uploads/images takes 1–3
// JPG, PNG or WebP files of at most 5 MB in the multipart field `images` and answers 201 with
// [{ url, publicId }] in the order sent. Check-in, check-out, confirm-return and POST /incidents take
// those objects exactly as returned (`photos`), so nothing here changes a URL.
//
// Only a verified, unsuspended user may upload: 403 otherwise, 503 when Cloudinary isn't
// configured or the upload failed, 429 past 20 uploads an hour.

export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 3;

// frontend.md §4: photos ≤ 1 MB / 1600 px before upload (the server resizes to 1600 px wide too).
export const PHOTO_COMPRESSION = { maxSizeMB: 1, maxWidthOrHeight: 1600, useWebWorker: true };

/**
 * Where browser-image-compression's web worker gets the library: { useWebWorker, libURL? }.
 * Without libURL it importScripts() a copy from jsDelivr, and a blob: worker runs with our origin
 * (it could call /auth/refresh with the refresh cookie), so it loads our own copy instead. The
 * blob: worker can't resolve a relative path, so the URL is made absolute against the page; with
 * no page to resolve against, compression runs on the main thread rather than fall back to the CDN.
 */
export function compressionWorkerOptions() {
  try {
    const base = globalThis.document?.baseURI;
    if (base) return { useWebWorker: true, libURL: new URL(compressionLibPath, base).href };
  } catch {
    // No usable base URL: compress without a worker.
  }
  return { useWebWorker: false };
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * browser-image-compression options for one photo. A type the server refuses (HEIC from an iPhone
 * gallery, say) is re-encoded as JPEG; an accepted type keeps its own.
 */
export function photoCompressionOptions(file) {
  const options = { ...PHOTO_COMPRESSION, ...compressionWorkerOptions() };
  return UPLOAD_IMAGE_TYPES.includes(file?.type) ? options : { ...options, fileType: 'image/jpeg' };
}

// "IMG_0042.HEIC" + image/jpeg → "IMG_0042.jpg"; a name that already fits is kept.
function nameFor(name, type) {
  const ext = EXTENSIONS[type];
  const base = typeof name === 'string' && name ? name : 'photo';
  if (!ext) return base;
  const stem = base.replace(/\.[^.]+$/, '');
  const current = base.slice(stem.length + 1).toLowerCase();
  if (current === ext || (ext === 'jpg' && current === 'jpeg')) return base;
  return `${stem}.${ext}`;
}

/**
 * One picked image → { file } ready to send, or { error }. `compress(file)` resolves with a smaller
 * Blob/File (browser-image-compression on the page). The original is kept when compressing failed
 * or didn't help, unless the server wouldn't take its type. The 5 MB limit applies to what is sent.
 */
export async function preparePhoto(picked, compress) {
  if (!picked || typeof picked.type !== 'string' || !picked.type.startsWith('image/')) {
    return { error: "This file isn't a photo." };
  }
  let file = picked;
  const accepted = UPLOAD_IMAGE_TYPES.includes(picked.type);
  try {
    const compressed = await compress(picked);
    const type = compressed?.type || picked.type;
    if (compressed && (compressed.size < picked.size || !accepted) && UPLOAD_IMAGE_TYPES.includes(type)) {
      file = new File([compressed], nameFor(picked.name, type), { type });
    }
  } catch {
    // An image the browser can't decode goes up as it is when the server may take it.
  }
  if (!UPLOAD_IMAGE_TYPES.includes(file.type)) return { error: 'Use a JPG, PNG or WebP photo.' };
  if (file.size > UPLOAD_MAX_BYTES) return { error: 'This photo is over 5 MB, even after compressing.' };
  return { file };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Picked files → { files, notes }: at most `room` photos prepared for upload (preparePhoto) and a
 * note for each one left out (not an image, no room, too big). Files keep the order picked.
 */
export async function preparePhotos(picked, { room, compress }) {
  const list = Array.from(picked ?? []);
  const notes = [];
  const images = [];
  for (const file of list) {
    if (typeof file?.type === 'string' && file.type.startsWith('image/')) images.push(file);
    else notes.push(`${file?.name || 'A file'} isn't a photo, so it was left out.`);
  }
  const space = Math.max(0, Number(room) || 0);
  const chosen = images.slice(0, space);
  if (images.length > chosen.length) {
    const left = images.length - chosen.length;
    notes.push(
      space === 0
        ? 'There is no room for more photos. Remove one to add another.'
        : `Only ${plural(space, 'more photo fits', 'more photos fit')}, so ${plural(left, 'was', 'were')} left out.`
    );
  }
  const files = [];
  for (const file of chosen) {
    const { file: ready, error } = await preparePhoto(file, compress);
    if (ready) files.push(ready);
    else notes.push(`${file.name || 'A photo'}: ${error}`);
  }
  return { files, notes };
}

/** The multipart body of POST /uploads/images: every file under `images`, in order. */
export function buildImagesForm(files) {
  const form = new FormData();
  for (const file of Array.from(files ?? [])) form.append('images', file, file?.name || 'photo.jpg');
  return form;
}

/**
 * POST /uploads/images (multipart, field `images`, 1–3 files) → { data: [{ url, publicId }] } in the
 * order sent. No Content-Type header: the browser writes multipart/form-data with its boundary.
 * Rejects with lib/http.js's normalised error.
 */
export async function uploadImages(files) {
  const res = await http.post('/uploads/images', buildImagesForm(files));
  return { data: res.data.data, meta: res.data.meta };
}

/** Only the two keys the booking and incident routes take, so nothing else rides along. */
export function toPhotoRefs(photos) {
  return (Array.isArray(photos) ? photos : [])
    .filter((photo) => photo && typeof photo.url === 'string' && typeof photo.publicId === 'string')
    .map(({ url, publicId }) => ({ url, publicId }));
}
