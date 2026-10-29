// The QR pass card's pure helpers (PassCard.jsx), in a module of their own so the card's file exports
// components only (fast refresh).

/** The booking statuses a pass is shown for: an approved booking (pickup), an item out or returned. */
export const PASS_STATUSES = ['approved', 'checked_in', 'checked_out'];

/**
 * Seconds left on a pass, by the server's clock: its lifetime (expiresAt − issuedAt, both from the
 * server) less the time since it arrived (receivedAt and now, both from this device). A phone whose
 * clock is minutes off still counts down right. → null when the times are missing.
 */
export function passSecondsLeft({ issuedAt, expiresAt } = {}, receivedAt, now) {
  const lifetime = new Date(expiresAt).getTime() - new Date(issuedAt).getTime();
  if (!Number.isFinite(lifetime) || !receivedAt) return null;
  return Math.max(0, Math.round((lifetime - (now - receivedAt)) / 1000));
}
