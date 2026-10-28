// Cloudinary, behind a small "uploader" seam (backend.md §8.4, architecture.md §16 "Uploads"). Files
// are stored there, never on our disk. The upload service only ever talks to the uploader below, so
// tests swap in a fake with useUploader() and never reach Cloudinary.
//
// The uploader has three methods. Every asset is a Cloudinary "image" resource, PDFs included:
//   upload(buffer, { folder, publicId, type, transformation?, format? })
//                                                               → { publicId, url, format }
//                         format: converted to before storing (an ID-card PDF becomes a JPG)
//   destroy(publicId, { type })                                → { deleted } (already gone counts)
//   signedUrl(publicId, { type, expiresAt })                    → a URL that stops working at
//                                                                  expiresAt, or null with no asset
//
// CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET are read on use, after dotenv has run. With any of
// them missing, getUploader() is 503 SERVICE_UNAVAILABLE, so the rest of the API still works on a
// deployment without Cloudinary.
import { v2 as cloudinary } from "cloudinary";
import { ServiceError } from "../lib/serviceError.js";

// Cloudinary treats PDFs as images, so one resource type covers photos, ID cards and evidence, and a
// destroy or a download never has to guess.
const RESOURCE_TYPE = "image";

let override = null;
let configuredWith = null;

// Tests (and scripts) pass a fake with the three methods; null goes back to Cloudinary.
export function useUploader(next) {
  override = next;
}

export const uploadsUnavailable = () =>
  new ServiceError(503, "SERVICE_UNAVAILABLE", "Uploads aren't configured.");

function settings() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  return cloud_name && api_key && api_secret
    ? { cloud_name, api_key, api_secret }
    : null;
}

export const uploadsConfigured = () => Boolean(override || settings());

// Cloudinary's settings are global; set them again only when the environment changed (tests do).
function configure() {
  const config = settings();
  if (!config) throw uploadsUnavailable();
  const key = `${config.cloud_name}\n${config.api_key}\n${config.api_secret}`;
  if (configuredWith !== key) {
    cloudinary.config({ ...config, secure: true });
    configuredWith = key;
  }
}

// The Download API URL for an `authenticated` (or private) asset, signed with the API secret and
// refused by Cloudinary after expiresAt (architecture.md §8 "5-minute signed URLs"). A delivery URL
// signed with sign_url never expires, which is why ID cards don't use one. It makes no network call,
// so tests check it directly.
export function downloadUrl(publicId, format, { type, expiresAt }) {
  configure();
  return cloudinary.utils.private_download_url(publicId, format, {
    type,
    resource_type: RESOURCE_TYPE,
    expires_at: Math.floor(new Date(expiresAt).getTime() / 1000),
  });
}

// Cloudinary's API errors are plain objects carrying the HTTP status.
const httpCode = (err) => err?.http_code ?? err?.error?.http_code;

const cloudinaryUploader = {
  upload(buffer, { folder, publicId, type, transformation, format }) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          type,
          resource_type: RESOURCE_TYPE,
          overwrite: false,
          ...(transformation && { transformation }),
          ...(format && { format }),
        },
        (err, result) =>
          err
            ? reject(err)
            : resolve({
                publicId: result.public_id,
                url: result.secure_url,
                format: result.format,
              }),
      );
      stream.end(buffer);
    });
  },

  // invalidate also drops CDN copies, so a deleted photo stops being served at once.
  async destroy(publicId, { type }) {
    const { result } = await cloudinary.uploader.destroy(publicId, {
      type,
      resource_type: RESOURCE_TYPE,
      invalidate: true,
    });
    if (result !== "ok" && result !== "not found")
      throw new Error(`Cloudinary destroy answered "${result}"`);
    return { deleted: result === "ok" };
  },

  // The Download API needs the stored format (a PDF must come back as a PDF), and the asset id alone
  // doesn't carry it, so the Admin API is asked first. That also tells us when the asset is gone.
  async signedUrl(publicId, { type, expiresAt }) {
    let format;
    try {
      ({ format } = await cloudinary.api.resource(publicId, {
        type,
        resource_type: RESOURCE_TYPE,
      }));
    } catch (err) {
      if (httpCode(err) === 404) return null;
      throw err;
    }
    return downloadUrl(publicId, format, { type, expiresAt });
  },
};

// → the uploader, or 503 when Cloudinary isn't configured.
export function getUploader() {
  if (override) return override;
  configure();
  return cloudinaryUploader;
}
