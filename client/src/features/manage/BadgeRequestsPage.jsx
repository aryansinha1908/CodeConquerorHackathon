import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Gift } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Pagination } from '../../components/ui/Pagination';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { pageCount, readPage } from '../../lib/paging';
import { REASON_MIN_LENGTH } from '../../lib/reason';
import { useNow } from '../resources/hooks';
import { ListSkeleton, LiveRegion } from './components/Bits';
import {
  BADGE_REQUESTS_PAGE_SIZE,
  BADGE_TEXT_MAX,
  badgeRequestKeys,
  getBadgeEvidenceUrl,
  readBadgeRequestStatus,
  useBadgeRequests,
  useDecideBadgeRequest,
  useGrantBadge,
} from './badges/api';
import {
  EMPTY_TEXT,
  REJECT_TEMPLATES,
  STATUS_FILTERS,
  decisionFailure,
  decisionMessage,
  expiryOnGrant,
  grantMessage,
  requestView,
} from './badges/badgeView';
import { BadgeRequestCard } from './badges/BadgeRequestCard';
import { EvidenceDialog } from './badges/EvidenceDialog';
import { GrantDialog } from './badges/GrantDialog';

// /manage/badges (frontend.md §6.3; judge step 4): the badge requests of the units this manager
// runs (an admin sees every unit), from GET /badge-requests. The status filter and page live in the
// URL; "requested" (the default) comes oldest first. Approve or reject (a reason is required) go
// through PATCH /badge-requests/:id and wait for the server; "View evidence" asks for a fresh
// 5-minute link each time; "Grant directly" gives a member one of your units' badges by email.

export default function BadgeRequestsPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const now = useNow();
  const headingRef = useRef(null);
  const grantButtonRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const status = readBadgeRequestStatus(searchParams.get('status'));
  const page = readPage(searchParams.get('page'));
  const [announcement, setAnnouncement] = useState('');

  const setView = ({ status: nextStatus, page: nextPage }) =>
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextStatus !== undefined) {
        if (nextStatus === 'requested') params.delete('status');
        else params.set('status', nextStatus);
        params.delete('page');
      }
      if (nextPage !== undefined) {
        if (nextPage <= 1) params.delete('page');
        else params.set('page', String(nextPage));
      }
      return params;
    });

  const queue = useBadgeRequests({ status, page, limit: BADGE_REQUESTS_PAGE_SIZE });
  const rows = Array.isArray(queue.data?.data) ? queue.data.data.filter((r) => r && typeof r === 'object') : [];
  const meta = queue.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta, BADGE_REQUESTS_PAGE_SIZE);

  // A decision can empty the last page: step back to the page that is now the last.
  const settled = queue.isSuccess && !queue.isPlaceholderData;
  useEffect(() => {
    if (settled && page > pages) {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (pages <= 1) params.delete('page');
          else params.set('page', String(pages));
          return params;
        },
        { replace: true }
      );
    }
  }, [settled, page, pages, setSearchParams]);

  // ── View evidence ──────────────────────────────────────────────────────────
  // A mutation, not a query: each opening is one audited request, the link is never cached or
  // refetched on focus, and it is dropped when the dialog closes.
  const [viewing, setViewing] = useState(null);
  const evidence = useMutation({
    mutationFn: (id) => getBadgeEvidenceUrl(id),
    onError: (err) => {
      // The file went away (replaced by a new request, or decided elsewhere): the row is stale.
      if (err?.code === 'NOT_FOUND') queryClient.invalidateQueries({ queryKey: badgeRequestKeys.all });
    },
  });
  const openEvidence = (row) => {
    setViewing(row);
    evidence.reset();
    evidence.mutate(row._id);
  };
  const closeEvidence = () => {
    setViewing(null);
    evidence.reset();
  };

  // ── Decide ─────────────────────────────────────────────────────────────────
  const decide = useDecideBadgeRequest();
  const [deciding, setDeciding] = useState(null); // { kind: 'approve' | 'reject', row }
  // A decision refused because the request changed meanwhile (409 INVALID_TRANSITION, 404).
  const [stale, setStale] = useState(null);

  const openDecision = (kind, row) => {
    if (decide.isPending) return;
    decide.reset();
    setStale(null);
    setDeciding({ kind, row });
  };
  const closeDecision = () => {
    if (decide.isPending) return;
    setDeciding(null);
    decide.reset();
  };
  const submitDecision = (kind, reason) => {
    const row = deciding?.row;
    if (!row || decide.isPending) return;
    decide.mutate(
      { id: row._id, decision: kind, reason },
      {
        onSuccess: () => {
          const message = decisionMessage(kind, row);
          setDeciding(null);
          setAnnouncement(message);
          toast.success(message);
        },
        onError: (err) => {
          if (decisionFailure(err) === 'stale') {
            // The hook has already asked for the queue again; say why the row moved.
            setDeciding(null);
            setStale(err);
          }
          // Anything else (403 own request, 400 reason, 503) stays in the dialog, which shows the
          // server's message and request id and can be sent again.
        },
      }
    );
  };

  // ── Grant directly ─────────────────────────────────────────────────────────
  const grant = useGrantBadge();
  const [granting, setGranting] = useState(false);
  const openGrant = () => {
    grant.reset();
    setGranting(true);
  };
  const closeGrant = () => {
    if (grant.isPending) return;
    setGranting(false);
    grant.reset();
  };
  const submitGrant = (body, badge) => {
    if (grant.isPending) return;
    grant.mutate(body, {
      onSuccess: (result) => {
        const message = grantMessage(result?.data, badge);
        setGranting(false);
        setAnnouncement(message);
        toast.success(message);
      },
    });
  };

  const current = deciding?.row ? requestView(deciding.row) : null;
  const subject = current ? `${current.member.name} · ${current.badgeName}` : undefined;
  const filterLabel = STATUS_FILTERS.find((f) => f.value === status)?.label ?? 'Requested';
  const empty = EMPTY_TEXT[status];

  return (
    <section aria-labelledby="badge-requests-heading" className="space-y-5 font-mono text-[#1a1a1a]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b-2 border-[#1a1a1a] pb-4">
        <div>
          <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">Badges</span>
          <h2
            id="badge-requests-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-black tracking-tight focus:outline-none"
          >
            Badge requests
          </h2>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-2xl leading-relaxed">
            Members ask for your units’ badges to unlock resources that need training. Check their
            note and evidence, then approve or reject; a rejection needs a reason, which they see.
            Opening evidence is logged.
          </p>
        </div>
        <Button
          ref={grantButtonRef}
          type="button"
          variant="forest"
          size="sm"
          className="min-h-[44px] shrink-0"
          onClick={openGrant}
        >
          <Gift className="w-4 h-4" aria-hidden="true" />
          Grant directly
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((option) => {
            const active = option.value === status;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!active) setView({ status: option.value });
                }}
                className={`px-3 py-2 min-h-[44px] text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2 ${
                  active
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                    : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {queue.isSuccess && (
          <p className="text-xs text-[#1a1a1a]/70">
            {total} {filterLabel.toLowerCase()}
            {status === 'requested' ? ' · oldest first' : ' · newest decision first'}
            {queue.isFetching && <span aria-hidden="true"> · updating…</span>}
          </p>
        )}
      </div>

      <LiveRegion>{announcement}</LiveRegion>

      {stale && (
        <ErrorState
          error={stale}
          title="That request changed meanwhile"
          onRetry={() => queue.refetch()}
          retrying={queue.isFetching}
          retryLabel="Reload the queue"
        >
          The queue below has been reloaded with its current state.
        </ErrorState>
      )}

      {queue.isPending && <ListSkeleton label="Loading the badge requests…" rows={2} />}

      {queue.isError && !queue.data && (
        <ErrorState
          error={queue.error}
          title="Couldn't load the badge requests"
          onRetry={() => queue.refetch()}
          retrying={queue.isFetching}
        />
      )}

      {/* A failed refetch keeps the last list: say it may be out of date. */}
      {queue.isError && queue.data && (
        <ErrorState
          error={queue.error}
          title="Couldn't refresh the badge requests"
          onRetry={() => queue.refetch()}
          retrying={queue.isFetching}
        >
          The requests below may have changed since they were loaded.
        </ErrorState>
      )}

      {queue.isSuccess && rows.length === 0 && (
        <EmptyState icon={Award} title={empty.title} description={empty.description} />
      )}

      {rows.length > 0 && (
        <ul
          aria-label={`${filterLabel} badge requests`}
          className={`space-y-4 ${queue.isPlaceholderData ? 'opacity-60' : ''}`}
        >
          {rows.map((row) => (
            <BadgeRequestCard key={row._id} row={row} user={user} onView={openEvidence} onDecide={openDecision} />
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pageCount={pages}
        onPageChange={(next) => setView({ page: next })}
        busy={queue.isFetching}
        label="Badge request pages"
      />

      <EvidenceDialog
        row={viewing}
        request={evidence}
        onClose={closeEvidence}
        onRetry={() => viewing && evidence.mutate(viewing._id)}
      />

      <ConfirmDialog
        open={deciding?.kind === 'approve'}
        onClose={closeDecision}
        onConfirm={() => submitDecision('approve')}
        returnFocusRef={headingRef}
        eyebrow={subject}
        title={current ? `Grant ${current.badgeName} to ${current.member.name}?` : 'Approve the request'}
        confirmLabel="Approve request"
        pendingLabel="Approving…"
        variant="forest"
        pending={decide.isPending && deciding?.kind === 'approve'}
        error={deciding?.kind === 'approve' ? decide.error : null}
        errorTitle="The approval didn't go through"
      >
        {current && (
          <p>
            They can book the resources that need this badge straight away, and they are notified.{' '}
            {expiryOnGrant(deciding.row.badge?.validityDays, now)}
          </p>
        )}
      </ConfirmDialog>

      <ReasonDialog
        open={deciding?.kind === 'reject'}
        onClose={closeDecision}
        returnFocusRef={headingRef}
        eyebrow={subject}
        title={current ? `Reject ${current.member.name}'s request` : 'Reject the request'}
        description="They see the reason with the rejection and can request the badge again."
        label="Reason"
        hint={`Required, ${REASON_MIN_LENGTH}–${BADGE_TEXT_MAX} characters. Say what they need to do next.`}
        required
        maxLength={BADGE_TEXT_MAX}
        templates={REJECT_TEMPLATES}
        submitLabel="Reject request"
        pendingLabel="Rejecting…"
        variant="danger"
        pending={decide.isPending && deciding?.kind === 'reject'}
        error={deciding?.kind === 'reject' ? decide.error : null}
        errorTitle="The rejection didn't go through"
        onSubmit={(reason) => submitDecision('reject', reason)}
      />

      <GrantDialog
        open={granting}
        onClose={closeGrant}
        user={user}
        request={grant}
        onSubmit={submitGrant}
        returnFocusRef={grantButtonRef}
      />
    </section>
  );
}
