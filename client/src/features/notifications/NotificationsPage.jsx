import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BellOff, CheckCheck, Inbox } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Pagination } from '../../components/ui/Pagination';
import { Skeleton } from '../../components/ui/Skeleton';
import { errorToastText } from '../../lib/errors';
import { pageCount, readPage } from '../../lib/paging';
import { useNow } from '../resources/hooks';
import {
  NOTIFICATIONS_PAGE_SIZE,
  isUnread,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
} from './api';
import { NotificationItem } from './components/NotificationItem';
import { StaggerList } from '../../components/Motion';

// /notifications (frontend.md §6.2): the signed-in user's notifications, newest first, with an
// unread filter, "Mark read" (optimistic, frontend.md §8.2) and "Mark all read" (waits for the
// server). Filter and page live in the URL, so a reload or a link keeps them. Each answer's
// meta.unread also sets the header bell's count (features/notifications/api.js).

const FILTERS = [
  { id: 'all', label: 'All', unread: false },
  { id: 'unread', label: 'Unread', unread: true },
];

const EMPTY = {
  all: {
    icon: Inbox,
    title: 'No notifications yet',
    description:
      'Booking decisions, reminders, badge and verification results and incident updates appear here. Notifications are kept for 60 days.',
  },
  unread: {
    icon: BellOff,
    title: "You're all caught up",
    description: 'Nothing unread. New notifications appear here and on the bell in the header.',
  },
};

function ListSkeleton() {
  return (
    <ul aria-busy="true" className="space-y-3">
      <li className="sr-only">Loading your notifications…</li>
      {[0, 1, 2].map((n) => (
        <li key={n} className="flex gap-4 p-4 rounded-xl border-2 border-[#1a1a1a]/40 bg-white">
          <Skeleton className="w-10 h-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-64 max-w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function NotificationsPage() {
  const now = useNow();
  const headingRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('unread') === 'true' ? FILTERS[1] : FILTERS[0];
  const page = readPage(searchParams.get('page'));
  const [announcement, setAnnouncement] = useState('');

  const list = useNotifications({ unread: filter.unread, page, limit: NOTIFICATIONS_PAGE_SIZE });
  const items = Array.isArray(list.data?.data)
    ? list.data.data.filter((n) => n && typeof n === 'object')
    : [];
  const meta = list.data?.meta;
  const total = Number(meta?.total) || 0;
  const unread = Number(meta?.unread) || 0;
  const pages = pageCount(meta, NOTIFICATIONS_PAGE_SIZE);

  const setView = ({ unread: nextUnread, page: nextPage }) =>
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextUnread !== undefined) {
        if (nextUnread) params.set('unread', 'true');
        else params.delete('unread');
        params.delete('page');
      }
      if (nextPage !== undefined) {
        if (nextPage <= 1) params.delete('page');
        else params.set('page', String(nextPage));
      }
      return params;
    });

  // Reading the last unread ones can empty the last page: step back to the page that is now last.
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

  // Under "Unread" a row leaves the list once the refetch lands: if focus was on it, it would fall
  // to <body>, so it goes to the heading instead.
  const keepFocus = () =>
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) headingRef.current?.focus();
    }, 50);

  const markRead = useMarkRead();
  const onMarkRead = (notification) => {
    if (!isUnread(notification)) return;
    markRead.mutate(notification._id, {
      onSuccess: () => setAnnouncement(`Marked “${notification.title}” read.`),
      onError: (err) => {
        setAnnouncement("Couldn't mark the notification read.");
        toast.error("Couldn't mark the notification read.", { description: errorToastText(err) });
      },
      onSettled: keepFocus,
    });
  };

  const markAll = useMarkAllRead();
  const onMarkAll = () => {
    if (markAll.isPending || unread <= 0) return;
    markAll.mutate(undefined, {
      onSuccess: (result) => {
        const updated = Number(result?.data?.updated) || 0;
        const message = updated === 1 ? 'Marked 1 notification read.' : `Marked ${updated} notifications read.`;
        setAnnouncement(message);
        toast.success(message);
      },
      onSettled: keepFocus,
    });
  };

  const empty = EMPTY[filter.id];

  return (
    <div className="space-y-6 font-mono text-[#1a1a1a]">
      <div className="border-b-2 border-[#1a1a1a] pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="text-xs uppercase font-bold text-[#c0392b] tracking-widest block mb-1">Inbox</span>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-black tracking-tight break-words focus:outline-none"
          >
            Notifications
          </h1>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-xl">
            Updates about your bookings, badges, ID verification and incidents, newest first. Times
            are IST.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-white min-h-[44px] shrink-0"
          aria-disabled={unread <= 0 || undefined}
          loading={markAll.isPending}
          onClick={onMarkAll}
        >
          {!markAll.isPending && <CheckCheck className="w-4 h-4" aria-hidden="true" />}
          {markAll.isPending ? 'Marking…' : 'Mark all read'}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div role="group" aria-label="Show" className="flex gap-2">
          {FILTERS.map((option) => {
            const active = option.id === filter.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!active) setView({ unread: option.unread });
                }}
                className={`px-3 py-2 min-h-[44px] text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2 ${
                  active
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                    : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                }`}
              >
                {option.label}
                {option.unread && list.isSuccess && <span> ({unread})</span>}
              </button>
            );
          })}
        </div>
        {list.isSuccess && (
          <p className="text-xs text-[#1a1a1a]/70">
            {filter.unread
              ? `${total} unread`
              : `${total} ${total === 1 ? 'notification' : 'notifications'} · ${unread} unread`}
            {list.isFetching && <span aria-hidden="true"> · updating…</span>}
          </p>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {markAll.isError && (
        <ErrorState error={markAll.error} title="Couldn't mark your notifications read" onRetry={onMarkAll} retrying={markAll.isPending} />
      )}

      {list.isPending && <ListSkeleton />}

      {list.isError && !list.data && (
        <ErrorState
          error={list.error}
          title="Couldn't load your notifications"
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      )}

      {/* A failed refetch keeps the last list: say it may be out of date. */}
      {list.isError && list.data && (
        <ErrorState
          error={list.error}
          title="Couldn't refresh your notifications"
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        >
          The list below may have changed since it was loaded.
        </ErrorState>
      )}

      {list.isSuccess && items.length === 0 && (
        <EmptyState icon={empty.icon} title={empty.title} description={empty.description} />
      )}

      {items.length > 0 && (
        <StaggerList step={0.04} aria-label={filter.unread ? 'Unread notifications' : 'Notifications'} className={`space-y-3 transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
          {items.map((notification) => (
            <NotificationItem
              key={notification._id}
              notification={notification}
              onMarkRead={onMarkRead}
              now={now}
            />
          ))}
        </StaggerList>
      )}

      <Pagination
        page={page}
        pageCount={pages}
        onPageChange={(next) => setView({ page: next })}
        busy={list.isFetching}
        label="Notification pages"
      />
    </div>
  );
}
