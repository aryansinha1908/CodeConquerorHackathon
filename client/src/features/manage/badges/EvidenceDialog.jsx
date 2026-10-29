import React, { useState } from 'react';
import { ExternalLink, Eye, FileText } from 'lucide-react';
import { Dialog } from '../../../components/ui/Dialog';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { isRetryable } from '../../../lib/errors';
import { formatIstDateTime } from '../../../lib/time';
import { requestView } from './badgeView';

// One signed link. Keyed by the URL in the parent, so a new link starts without the old failure.
function EvidenceFile({ url, label }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    // A PDF (evidence may be one) doesn't draw in an <img>.
    return (
      <div className="flex flex-col items-center gap-2 text-center py-10 px-4 border-2 border-dashed border-[#1a1a1a]/40 rounded-lg bg-[#f5f0e8]/60">
        <FileText className="w-8 h-8" aria-hidden="true" />
        <p className="text-sm font-bold">This file can&apos;t be shown here. It may be a PDF.</p>
        <p className="text-xs text-[#1a1a1a]/70">Open it in a new tab before the link expires.</p>
      </div>
    );
  }
  return (
    <div className="border-2 border-[#1a1a1a] rounded-lg bg-[#f5f0e8] overflow-hidden">
      <img
        src={url}
        alt={label}
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(true)}
        className="block max-h-[60vh] w-auto mx-auto object-contain"
      />
    </div>
  );
}

/**
 * What the evidence dialog shows: the "Viewing is logged" notice, then the file, its expiry and a
 * new-tab link, a placeholder while the link is fetched, or the error (with "Try again" unless
 * asking again can't help, as for no evidence at all). Exported for the tests. row: the queue row;
 * request: the useMutation result of getBadgeEvidenceUrl; onRetry: ask for a link again.
 */
export function EvidenceBody({ row, request, onRetry }) {
  const view = requestView(row);
  const link = request.data?.data ?? null;
  const expires = formatIstDateTime(link?.expiresAt);
  const missing = request.error?.code === 'NOT_FOUND';

  return (
    <>
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
          title={missing ? 'No evidence on file' : "Couldn't open the evidence"}
          // Asking again helps only after a network failure, a 429 or a 5xx; a 403 or 404 stays.
          onRetry={isRetryable(request.error) ? onRetry : undefined}
          retrying={request.isPending}
        />
      )}

      {link?.url && (
        <div className="space-y-3">
          <EvidenceFile
            key={link.url}
            url={link.url}
            label={`Evidence ${view.member.name} sent for ${view.badgeName}`}
          />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <span className="text-[#1a1a1a]/70">
              {expires ? `The link expires at ${expires}.` : 'The link expires within 5 minutes.'}
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
    </>
  );
}

/**
 * "View evidence" (frontend.md §6.3 "queue with evidence preview"): the link from GET
 * /badge-requests/:id/evidence, which stops working within 5 minutes. The page asks for it each
 * time the dialog opens (a mutation, never the query cache) and drops it on close, so every view is
 * one audited request and no link outlives the dialog.
 *
 * row: the queue row or null; request: the useMutation result of getBadgeEvidenceUrl; onRetry.
 */
export function EvidenceDialog({ row, request, onClose, onRetry }) {
  const view = row ? requestView(row) : null;
  return (
    <Dialog
      open={Boolean(row)}
      onClose={onClose}
      eyebrow={view ? `${view.member.name} · ${view.badgeName}` : undefined}
      title="Badge evidence"
      wide
    >
      {row && <EvidenceBody row={row} request={request} onRetry={onRetry} />}
    </Dialog>
  );
}
