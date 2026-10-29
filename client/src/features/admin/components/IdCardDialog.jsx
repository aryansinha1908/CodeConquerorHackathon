import React, { useEffect, useRef, useState } from 'react';
import { Eye, ExternalLink, FileText, ScanText } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { errorMessage } from '../../../lib/errors';
import { formatIstDateTime } from '../../../lib/time';
import { DeviceCheckBadge, DeviceCheckList } from '../../verification/DeviceCheck';
import { deviceCheckAnnouncement, useIdCardCheck } from '../../verification/idCardCheck';
import { getIdCardFile } from '../api';

// The watermark over the image: the same words as the notice above it, for anyone looking at (or
// photographing) the screen. Decorative, so hidden from screen readers; the notice says it once.
function Watermark() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 overflow-hidden flex flex-col justify-around"
    >
      {[0, 1, 2].map((row) => (
        <span
          key={row}
          className="block text-center -rotate-12 text-xl sm:text-2xl font-black uppercase tracking-widest text-[#c0392b]/35 whitespace-nowrap"
        >
          Viewing is logged · Viewing is logged
        </span>
      ))}
    </div>
  );
}

// One signed URL. Keyed by the URL in the parent, so a new link starts without the old error.
function IdCardImage({ url, name }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    // A PDF (or a format the browser can't draw) doesn't render in an <img>.
    return (
      <div className="flex flex-col items-center gap-2 text-center py-10 px-4 border-2 border-dashed border-[#1a1a1a]/40 rounded-lg bg-[#f5f0e8]/60">
        <FileText className="w-8 h-8" aria-hidden="true" />
        <p className="text-sm font-bold">This file can&apos;t be shown here. It may be a PDF.</p>
        <p className="text-xs text-[#1a1a1a]/70">Open it in a new tab before the link expires.</p>
      </div>
    );
  }
  return (
    <div className="relative border-2 border-[#1a1a1a] rounded-lg bg-[#f5f0e8] overflow-hidden">
      <img
        src={url}
        alt={`ID card submitted by ${name}`}
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(true)}
        className="block max-h-[60vh] w-auto mx-auto object-contain"
      />
      <Watermark />
    </div>
  );
}

// "Check on this device" (FC-12): the same check as the member's, run here on the card's bytes (GET
// …/id-card/file, audited and counted with View ID's links), against the queue item's name, email and
// hints. Nothing is sent anywhere. The card is fetched once per dialog: "Check again" reuses it.
// Closing the dialog stops the fetch and the check.
function AdminDeviceCheck({ item }) {
  const check = useIdCardCheck();
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const imageRef = useRef(null);
  const fetchRef = useRef(null);
  useEffect(() => () => fetchRef.current?.abort(), []);
  const busy = loading || check.status === 'running';
  const who = { email: item.user.email, name: item.user.name, emailHints: item.user.emailHints };
  const start = async () => {
    if (busy) return;
    setLoadError(null);
    if (!imageRef.current) {
      const controller = new AbortController();
      fetchRef.current = controller;
      setLoading(true);
      try {
        imageRef.current = await getIdCardFile(item.user._id, { signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) return;
        setLoadError(
          err?.status === 409
            ? "This file can't be checked on this device. Look at it yourself."
            : err?.status === 404
              ? 'No ID card on file.'
              : errorMessage(err) || "The card couldn't be loaded."
        );
        return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    check.run(imageRef.current, who);
  };
  const result = check.result;
  const label = loading
    ? 'Loading the card…'
    : check.status === 'running'
      ? `Reading the card… ${Math.round((check.progress ?? 0) * 100)}%`
      : check.status === 'done' || check.status === 'failed'
        ? 'Check again'
        : 'Check on this device';
  return (
    <div className="rounded-lg border-2 border-[#1a1a1a]/30 bg-[#f5f0e8] p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-white min-h-[40px]"
          aria-disabled={busy || undefined}
          onClick={start}
        >
          <ScanText className="w-4 h-4" aria-hidden="true" />
          {label}
        </Button>
        {check.status === 'done' && result?.readable && (
          <DeviceCheckBadge score={result.score} total={result.total} checks={result.checks} />
        )}
      </div>
      {/* Start and end only: the percentage is in the button, not read out at every step. */}
      <p role="status" aria-live="polite" className="text-xs">
        {deviceCheckAnnouncement(check)}
      </p>
      {loadError && (
        <p role="alert" className="text-xs font-bold text-[#a93226]">
          {loadError}
        </p>
      )}
      {check.status === 'done' && result?.readable && <DeviceCheckList checks={result.checks} />}
      <p className="text-[11px] text-[#1a1a1a]/70">
        Runs in this browser; the card isn&apos;t sent anywhere else. A hint, not proof: compare the card yourself.
      </p>
    </div>
  );
}

/**
 * "View ID" (frontend.md §6.4): shows the 5-minute signed URL from GET …/:userId/id-card. The page
 * fetches it when the dialog opens and drops it on close (a mutation, never the query cache), so
 * each view is one audited request and no URL outlives the dialog.
 *
 * item: the queue item; request: the useMutation result of getIdCardUrl; onRetry: fetch again.
 */
export function IdCardDialog({ item, request, onClose, onRetry }) {
  const name = item?.user?.name ?? 'this user';
  const link = request.data?.data ?? null;
  const expires = formatIstDateTime(link?.expiresAt);

  return (
    <Dialog
      open={Boolean(item)}
      onClose={onClose}
      eyebrow="Identity document"
      title={`ID card: ${name}`}
      wide
    >
      <p className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 border-2 border-[#1a1a1a] rounded-md bg-[#fff5f5] text-xs font-bold text-[#c0392b] uppercase tracking-wider">
        <Eye className="w-4 h-4" aria-hidden="true" />
        Viewing is logged
      </p>

      {request.isPending && (
        <div aria-busy="true">
          <span className="sr-only">Getting a viewing link…</span>
          <Skeleton className="h-72 w-full" />
        </div>
      )}

      {request.isError && (
        <ErrorState
          error={request.error}
          title={
            request.error?.code === 'NOT_FOUND' ? 'No ID card on file' : "Couldn't open the ID card"
          }
          onRetry={request.error?.code === 'NOT_FOUND' ? undefined : onRetry}
        />
      )}

      {link?.url && (
        <div className="space-y-3">
          <IdCardImage key={link.url} url={link.url} name={name} />
          {item && <AdminDeviceCheck key={item.user._id} item={item} />}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <span className="text-[#1a1a1a]/70">
              {expires ? `The link expires at ${expires}.` : 'The link expires within 5 minutes.'}{' '}
              The image is deleted once you decide.
            </span>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="inline-flex items-center gap-1.5 font-bold text-[#183d2d] underline underline-offset-2 hover:text-[#c0392b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] rounded px-1 py-1"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              Open in a new tab
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
