import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, UserCheck } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { getActiveOrgUnits, orgUnitKeys } from '../verification/api';
import {
  QUEUE_STATUSES,
  adminKeys,
  decideVerification,
  getIdCardUrl,
  listVerifications,
  pageCount,
  readPage,
  readQueueStatus,
} from './api';
import { QueueItem } from './components/QueueItem';
import { IdCardDialog } from './components/IdCardDialog';
import { DecisionDialog } from './components/DecisionDialog';
import { RequestError } from './components/RequestError';
import { StaggerList } from '../../components/Motion';

// /admin/verifications (frontend.md §6.4, F-15; architecture.md §8): the ID-verification queue.
// Status and page live in the URL so a filtered page can be linked and survives a reload.

const FILTER_LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

const EMPTY_TEXT = {
  pending: {
    title: 'No ID cards waiting',
    description: 'New submissions appear here, oldest first.',
  },
  approved: { title: 'No approved verifications', description: 'Approvals you make appear here.' },
  rejected: {
    title: 'No rejected verifications',
    description: 'Rejections and their reasons appear here.',
  },
};

function ListSkeleton() {
  return (
    <ul aria-busy="true" className="space-y-4">
      <li className="sr-only">Loading the verification queue…</li>
      {[0, 1, 2].map((n) => (
        <li
          key={n}
          className="rounded-xl border-2 border-[#1a1a1a] p-5 bg-white shadow-[4px_4px_0_#1a1a1a] space-y-3"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function VerificationQueuePage() {
  const queryClient = useQueryClient();
  const myId = useAuthStore((s) => s.user?._id);
  const headingRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const status = readQueueStatus(searchParams.get('status'));
  const page = readPage(searchParams.get('page'));
  const [announcement, setAnnouncement] = useState('');

  const setFilter = (next) =>
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next.status !== undefined) {
        if (next.status === 'pending') params.delete('status');
        else params.set('status', next.status);
        params.delete('page');
      }
      if (next.page !== undefined) {
        if (next.page <= 1) params.delete('page');
        else params.set('page', String(next.page));
      }
      return params;
    });

  const list = useQuery({
    queryKey: adminKeys.verificationList(status, page),
    queryFn: () => listVerifications({ status, page }),
    // Keep the previous page on screen while the next one loads, but never another status's rows.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey?.[2] === status ? previous : undefined,
    staleTime: 0, // on focus (frontend.md §8.2): another admin may have decided meanwhile
  });
  const units = useQuery({
    queryKey: orgUnitKeys.active,
    queryFn: getActiveOrgUnits,
    staleTime: 5 * 60 * 1000,
  });

  const items = Array.isArray(list.data?.data) ? list.data.data : [];
  const meta = list.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta);

  // A decision can empty the last page: step back to the page that is now the last.
  const settled = list.isSuccess && !list.isPlaceholderData;
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

  // ── View ID ────────────────────────────────────────────────────────────────
  // A mutation, not a query: each opening is one audited request ("verification.id_viewed"), the
  // URL is never cached or refetched on focus, and it is dropped when the dialog closes.
  const [viewing, setViewing] = useState(null);
  const idCard = useMutation({
    mutationFn: getIdCardUrl,
    onError: (err) => {
      // The card went away (decided elsewhere): the row's hasIdCard is stale.
      if (err?.code === 'NOT_FOUND') {
        queryClient.invalidateQueries({ queryKey: adminKeys.verifications });
      }
    },
  });
  const openIdCard = (item) => {
    setViewing(item);
    idCard.reset();
    idCard.mutate(item.user._id);
  };
  const closeIdCard = () => {
    setViewing(null);
    idCard.reset();
  };

  // ── Decide ─────────────────────────────────────────────────────────────────
  const [deciding, setDeciding] = useState(null); // { item, decision }
  const decide = useMutation({
    mutationFn: ({ userId, body }) => decideVerification(userId, body),
    // Returned, so the dialog stays on "Approving…" until the list shows the new state (no
    // optimistic updates on decisions, frontend.md §8.2).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.verifications }),
    onError: (err) => {
      // Decided by someone else, or the user is gone: show the queue as it is now.
      if (err?.code === 'INVALID_TRANSITION' || err?.code === 'NOT_FOUND') {
        queryClient.invalidateQueries({ queryKey: adminKeys.verifications });
      }
    },
  });
  const openDecision = (item, decision) => {
    decide.reset();
    setDeciding({ item, decision });
  };
  const closeDecision = () => {
    setDeciding(null);
    decide.reset();
  };
  const submitDecision = (body) => {
    const name = deciding?.item.user.name ?? 'the user';
    decide.mutate(
      // submittedAt names the submission the admin reviewed; the server answers 409 if the member
      // replaced the card meanwhile (the onError handler then reloads the queue).
      { userId: deciding.item.user._id, body: { ...body, submittedAt: deciding.item.submittedAt ?? null } },
      {
        onSuccess: () => {
          const message =
            body.decision === 'approve'
              ? `Approved ${name}'s verification.`
              : `Rejected ${name}'s verification.`;
          setDeciding(null);
          setAnnouncement(message);
          toast.success(message);
          // The row that opened the dialog has left the pending list, so focus can't go back to
          // it: move it to the list heading instead of letting it fall to <body>.
          setTimeout(() => {
            const active = document.activeElement;
            if (!active || active === document.body) headingRef.current?.focus();
          }, 50);
        },
      }
    );
  };

  return (
    <section aria-labelledby="verification-queue-heading" className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2
            id="verification-queue-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-black tracking-tight text-[#1a1a1a] focus:outline-none"
          >
            ID verification queue
          </h2>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-xl">
            Compare each ID card with the details the member chose. Opening a card is logged, and
            the image is deleted once you decide.
          </p>
        </div>
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {QUEUE_STATUSES.map((value) => {
            const active = value === status;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter({ status: value })}
                className={`px-3 py-2 min-h-[40px] text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2 ${
                  active
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                    : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                }`}
              >
                {FILTER_LABELS[value]}
              </button>
            );
          })}
        </div>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {list.isPending && <ListSkeleton />}

      {list.isError && !list.data && (
        <RequestError
          error={list.error}
          title="Couldn't load the verification queue"
          onRetry={() => list.refetch()}
        />
      )}

      {list.isSuccess && items.length === 0 && (
        <EmptyState
          icon={UserCheck}
          title={EMPTY_TEXT[status].title}
          description={EMPTY_TEXT[status].description}
        />
      )}

      {items.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-[#1a1a1a]/70">
            <span>
              {total} {total === 1 ? 'verification' : 'verifications'}
              {status === 'pending' ? ' · oldest first' : ''}
            </span>
            {list.isFetching && <span aria-hidden="true">Updating…</span>}
          </div>
          <StaggerList data-tour="verifications-queue" className={`space-y-4 transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
            {items.map((item) => (
              <QueueItem
                key={item.user._id}
                item={item}
                units={units.data?.data}
                isSelf={item.user._id === myId}
                onView={openIdCard}
                onDecide={openDecision}
              />
            ))}
          </StaggerList>
        </>
      )}

      {/* aria-disabled, not disabled: disabling the button just pressed (while the next page loads,
          or because it is the last) would drop a keyboard user's focus to <body>. Button swallows
          the click while aria-disabled. */}
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="bg-white min-h-[40px]"
            aria-disabled={page <= 1 || list.isFetching}
            onClick={() => setFilter({ page: page - 1 })}
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Previous
          </Button>
          <span className="text-xs font-bold">
            Page {Math.min(page, pages)} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="bg-white min-h-[40px]"
            aria-disabled={page >= pages || list.isFetching}
            onClick={() => setFilter({ page: page + 1 })}
          >
            Next
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Button>
        </nav>
      )}

      <IdCardDialog
        item={viewing}
        request={idCard}
        onClose={closeIdCard}
        onRetry={() => viewing && idCard.mutate(viewing.user._id)}
      />
      <DecisionDialog
        target={deciding}
        units={units.data?.data}
        unitsError={units.isError ? units.error : null}
        unitsLoading={units.isFetching && !units.data}
        onReloadUnits={() => units.refetch()}
        request={decide}
        onSubmit={submitDecision}
        onClose={closeDecision}
      />
    </section>
  );
}
