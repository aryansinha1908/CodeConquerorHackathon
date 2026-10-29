import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Pagination } from '../../components/ui/Pagination';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { pageCount, readPage } from '../../lib/paging';
import { REASON_MIN_LENGTH } from '../../lib/reason';
import {
  MANAGE_PAGE_SIZE,
  useApproveBooking,
  useManageBookings,
  useRejectBooking,
  useWaitlistBooking,
} from '../bookings/api';
import { ConflictGroupCard } from './components/ConflictGroupCard';
import { SlotTakenDialog } from './components/SlotTakenDialog';
import { ListSkeleton, LiveRegion } from './components/Bits';
import {
  DECISION_MAX,
  DECISION_TEMPLATES,
  decisionFailure,
  decisionMessage,
  decisionVars,
  groupKey,
  requesterView,
  slotText,
} from './components/manageView';

// /manage/requests (frontend.md §6.3, F-11; judge step 7): GET /bookings/manage?status=pending
// returns conflict groups, one card per contested slot with every request in it. Approve takes an
// optional note; reject and waitlist need a reason (api.md "Bookings"). Nothing is applied
// optimistically: each dialog stays on "Approving…" until the queue shows the server's new state.

const DECISIONS = {
  approve: {
    title: (name) => `Approve ${name}'s request`,
    description:
      'The slot is confirmed for them. Overlapping requests stay in the queue: reject them or move them to the waitlist.',
    label: 'Note for the requester',
    hint: `Optional, at most ${DECISION_MAX} characters. They see it with the approval.`,
    required: false,
    submitLabel: 'Approve request',
    pendingLabel: 'Approving…',
    variant: 'forest',
    errorTitle: "The approval didn't go through",
  },
  waitlist: {
    title: (name) => `Move ${name}'s request to the waitlist`,
    description:
      'It joins the waitlist and moves up on its own if the slot frees. The slot passes to the next request in line, not straight back to this one.',
    label: 'Reason',
    hint: `Required, ${REASON_MIN_LENGTH}–${DECISION_MAX} characters. The requester sees it.`,
    required: true,
    submitLabel: 'Move to the waitlist',
    pendingLabel: 'Moving…',
    variant: 'primary',
    errorTitle: "The request wasn't moved",
  },
  reject: {
    title: (name) => `Reject ${name}'s request`,
    description: 'The request is closed and the slot is offered to the waitlist.',
    label: 'Reason',
    hint: `Required, ${REASON_MIN_LENGTH}–${DECISION_MAX} characters. The requester sees it.`,
    required: true,
    submitLabel: 'Reject request',
    pendingLabel: 'Rejecting…',
    variant: 'danger',
    errorTitle: "The rejection didn't go through",
  },
};

export default function RequestsPage() {
  const user = useAuthStore((s) => s.user);
  const headingRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = readPage(searchParams.get('page'));

  const queue = useManageBookings({ status: 'pending', page, limit: MANAGE_PAGE_SIZE });
  const groups = Array.isArray(queue.data?.data) ? queue.data.data : [];
  const meta = queue.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta, MANAGE_PAGE_SIZE);

  const setPage = (next) =>
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next <= 1) params.delete('page');
      else params.set('page', String(next));
      return params;
    });

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

  // ── Decisions ──────────────────────────────────────────────────────────────
  const approve = useApproveBooking();
  const waitlist = useWaitlistBooking();
  const reject = useRejectBooking();
  const mutations = { approve, waitlist, reject };

  // { kind: 'approve' | 'waitlist' | 'reject' | 'slotTaken', booking, error? }
  const [dialog, setDialog] = useState(null);
  // A decision refused because the request changed meanwhile (409 INVALID_TRANSITION, 404).
  const [stale, setStale] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  const resetAll = () => {
    approve.reset();
    waitlist.reset();
    reject.reset();
  };
  const busy = approve.isPending || waitlist.isPending || reject.isPending;

  const openDecision = (kind, booking) => {
    if (busy) return;
    resetAll();
    setStale(null);
    setDialog({ kind, booking });
  };
  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    resetAll();
  };

  const submit = (kind, text) => {
    const booking = dialog?.booking;
    if (!booking || busy) return;
    mutations[kind].mutate(decisionVars(kind, booking, text), {
      onSuccess: () => {
        const message = decisionMessage(kind, booking);
        setDialog(null);
        setAnnouncement(message);
        toast.success(message);
      },
      onError: (err) => {
        const failure = decisionFailure(kind, err);
        if (failure === 'slotTaken') {
          // The hook has already asked for the queue again; offer what still works.
          setDialog({ kind: 'slotTaken', booking, error: err });
        } else if (failure === 'stale') {
          setDialog(null);
          setStale(err);
        }
        // Anything else (403 own booking, 400 reason, 503) stays in the dialog, which shows the
        // server's message and request id and can be sent again.
      },
    });
  };

  const current = dialog?.booking ?? null;
  const currentName = requesterView(current?.borrower).name;
  const currentSubject = current
    ? `${current.resource?.title ?? 'Resource'} · ${slotText(current.start, current.end)}`
    : undefined;

  return (
    <section aria-labelledby="requests-heading" className="space-y-5 font-mono text-[#1a1a1a]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b-2 border-[#1a1a1a] pb-4">
        <div>
          <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">Review queue</span>
          <h2
            id="requests-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-black tracking-tight focus:outline-none"
          >
            Booking requests
          </h2>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-2xl leading-relaxed">
            Requests competing for the same slot share one card, oldest first, with the eligibility
            each had when it was made. Rejecting or waitlisting needs a reason, which the requester
            sees.
          </p>
        </div>
        {queue.isSuccess && (
          <p className="text-xs text-[#1a1a1a]/70 shrink-0">
            {total} {total === 1 ? 'slot' : 'slots'} waiting · refreshes every 30 s
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

      {queue.isPending && <ListSkeleton label="Loading the review queue…" rows={2} />}

      {queue.isError && !queue.data && (
        <ErrorState
          error={queue.error}
          title="Couldn't load the review queue"
          onRetry={() => queue.refetch()}
          retrying={queue.isFetching}
        />
      )}

      {/* A failed 30-second refresh keeps the last queue: say it may be out of date. */}
      {queue.isError && queue.data && (
        <ErrorState
          error={queue.error}
          title="Couldn't refresh the review queue"
          onRetry={() => queue.refetch()}
          retrying={queue.isFetching}
        >
          The requests below may have changed since they were loaded.
        </ErrorState>
      )}

      {queue.isSuccess && groups.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="No requests waiting"
          description="New booking requests for your units appear here, grouped by slot. The list refreshes every 30 seconds."
        />
      )}

      {groups.length > 0 && (
        <ul className={`space-y-5 ${queue.isPlaceholderData ? 'opacity-60' : ''}`}>
          {groups.map((group, index) => (
            <ConflictGroupCard
              key={groupKey(group, index)}
              group={group}
              user={user}
              onDecide={openDecision}
            />
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pageCount={pages}
        onPageChange={setPage}
        busy={queue.isFetching}
        label="Review queue pages"
      />

      {Object.entries(DECISIONS).map(([kind, text]) => (
        <ReasonDialog
          key={kind}
          open={dialog?.kind === kind}
          onClose={closeDialog}
          returnFocusRef={headingRef}
          eyebrow={currentSubject}
          title={text.title(currentName)}
          description={text.description}
          label={text.label}
          hint={text.hint}
          required={text.required}
          maxLength={DECISION_MAX}
          templates={DECISION_TEMPLATES[kind] ?? []}
          submitLabel={text.submitLabel}
          pendingLabel={text.pendingLabel}
          variant={text.variant}
          pending={mutations[kind].isPending}
          error={mutations[kind].error}
          errorTitle={text.errorTitle}
          onSubmit={(value) => submit(kind, value)}
        />
      ))}

      <SlotTakenDialog
        open={dialog?.kind === 'slotTaken'}
        error={dialog?.kind === 'slotTaken' ? dialog.error : null}
        name={currentName}
        subject={currentSubject}
        returnFocusRef={headingRef}
        onClose={closeDialog}
        onWaitlist={() => current && openDecision('waitlist', current)}
        onReject={() => current && openDecision('reject', current)}
      />
    </section>
  );
}
