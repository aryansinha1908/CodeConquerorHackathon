import React, { useState } from 'react';
import { Eye, ExternalLink, FileText } from 'lucide-react';
import { AdminDialog } from './AdminDialog';
import { RequestError } from './RequestError';
import { Skeleton } from '../../../components/ui/Skeleton';
import { formatIstDateTime } from '../../verification/api';

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
    <AdminDialog
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
        <RequestError
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
    </AdminDialog>
  );
}
