// The scan page's pure helpers (ScanPage.jsx), apart so the page's file exports components only.

/** A camera error (a DOMException's name, or qr-scanner's message) → what to do about it. */
export function cameraAdvice(err) {
  const name = err?.name ?? '';
  const text = String(err?.message ?? err ?? '');
  if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied/i.test(text)) {
    return 'The browser was refused the camera. Allow it in the address bar, or type the code instead.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Another app is using the camera. Close it and try again, or type the code instead.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /no camera|not found/i.test(text)) {
    return 'No camera was found. Type the code from the pass instead.';
  }
  if (/secure|https/i.test(text)) return 'The camera needs a secure (https) page. Type the code instead.';
  return "The camera couldn't start. Type the code from the pass instead.";
}

/**
 * Asks for the camera once, directly, before qr-scanner does: qr-scanner reports every failure as
 * "Camera not found.", which would hide a refused permission or a camera in use. → advice, or null
 * when the camera is there and allowed. `env` is injectable for the tests.
 */
export async function cameraPreflight(env = { isSecureContext: globalThis.isSecureContext, mediaDevices: globalThis.navigator?.mediaDevices }) {
  if (!env.isSecureContext) return 'The camera needs a secure (https) page. Type the code instead.';
  if (!env.mediaDevices?.getUserMedia) return "This browser can't use a camera here. Type the code instead.";
  try {
    const stream = await env.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    stream.getTracks().forEach((track) => track.stop());
    return null;
  } catch (err) {
    return cameraAdvice(err);
  }
}

/** Whether a decoded QR is a ShareX pass; anything else is ignored and scanning carries on. */
export const isPassText = (text) => typeof text === 'string' && /^cc1\./.test(text.trim());

/** What's typed in the code box → the code: capitals and digits only, at most 6. */
export const cleanCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
