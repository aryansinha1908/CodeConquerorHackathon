import React, { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Compass } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Pagination } from '../../components/ui/Pagination';
import { Skeleton } from '../../components/ui/Skeleton';
import { pageCount, readPage } from '../../lib/paging';
import { cn } from '../../lib/utils';
import { MINE_PAGE_SIZE, MINE_TABS, useMyBookings } from './api';
import { BookingCard } from './components/BookingCard';
import { TAB_EMPTY, readTab } from './components/bookingView';
import { eyebrowClass, linkButtonClass, pageHeadingClass } from './components/styles';
import { useNow } from './components/useClock';
import { StaggerList } from '../../components/Motion';

// /bookings (frontend.md §6.2): tabs Upcoming (approved, checked_in) · Requests (pending,
// waitlisted with the place in line) · Past (the rest), each one GET /bookings/mine with its
// statuses, latest start first. Tab and page live in the URL, so a reload or a link keeps them.

function ListSkeleton() {
  return (
    <ul aria-busy="true" className="space-y-4">
      <li className="sr-only">Loading your bookings…</li>
      {[0, 1, 2].map((n) => (
        <li
          key={n}
          className="rounded-xl border-2 border-[#1a1a1a] p-5 bg-white shadow-[4px_4px_0_#1a1a1a] space-y-3"
        >
          <div className="flex justify-between gap-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </li>
      ))}
    </ul>
  );
}

export default function MyBookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readTab(searchParams.get('tab'));
  const page = readPage(searchParams.get('page'));
  const now = useNow();
  const tabRefs = useRef({});

  const list = useMyBookings({ status: tab.statuses, page, limit: MINE_PAGE_SIZE });
  const items = Array.isArray(list.data?.data) ? list.data.data : [];
  const meta = list.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta, MINE_PAGE_SIZE);

  const setView = ({ tab: nextTab, page: nextPage }, options) =>
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (nextTab !== undefined) {
        if (nextTab === MINE_TABS[0].id) params.delete('tab');
        else params.set('tab', nextTab);
        params.delete('page');
      }
      if (nextPage !== undefined) {
        if (nextPage <= 1) params.delete('page');
        else params.set('page', String(nextPage));
      }
      return params;
    }, options);

  // A cancelled booking can empty the last page: step back to the page that is now the last.
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

  // Tabs (WAI-ARIA tabs pattern): one tab stop, arrows / Home / End move and select.
  const selectTab = (id, focus = false) => {
    if (id !== tab.id) setView({ tab: id });
    if (focus) tabRefs.current[id]?.focus();
  };
  const onTabKeyDown = (event) => {
    const index = MINE_TABS.findIndex((t) => t.id === tab.id);
    const last = MINE_TABS.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last ? 0 : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0 ? last : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    selectTab(MINE_TABS[target].id, true);
  };

  const empty = TAB_EMPTY[tab.id];

  return (
    <div className="space-y-6 font-mono">
      <div className="border-b-2 border-[#1a1a1a] pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className={eyebrowClass}>Reservations</span>
          <h1 className={pageHeadingClass}>My bookings</h1>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-xl">
            Your upcoming bookings, open requests with their waitlist place, and past bookings. All
            times are IST.
          </p>
        </div>
        <Link to="/explore" className={linkButtonClass('outline', 'shrink-0')}>
          <Compass className="w-4 h-4" aria-hidden="true" />
          Book a resource
        </Link>
      </div>

      <div
        role="tablist"
        aria-label="Booking lists"
        onKeyDown={onTabKeyDown}
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {MINE_TABS.map((t) => {
          const active = t.id === tab.id;
          return (
            <button
              key={t.id}
              ref={(node) => {
                tabRefs.current[t.id] = node;
              }}
              type="button"
              role="tab"
              id={`bookings-tab-${t.id}`}
              aria-selected={active}
              aria-controls="bookings-panel"
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(t.id)}
              className={cn(
                'px-4 py-2 min-h-[44px] text-sm font-bold uppercase tracking-wider rounded-md border-2 whitespace-nowrap transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2',
                active
                  ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                  : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <section
        id="bookings-panel"
        role="tabpanel"
        aria-labelledby={`bookings-tab-${tab.id}`}
        className="space-y-4"
      >
        <h2 className="sr-only">{tab.label}</h2>

        {list.isPending && <ListSkeleton />}

        {list.isError && !list.data && (
          <ErrorState
            error={list.error}
            title="Couldn't load your bookings"
            onRetry={() => list.refetch()}
            retrying={list.isFetching}
          />
        )}

        {list.isSuccess && items.length === 0 && (
          <EmptyState
            icon={CalendarCheck}
            title={empty.title}
            description={empty.description}
          />
        )}

        {items.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 text-xs text-[#1a1a1a]/70">
              <span>
                {total} {total === 1 ? 'booking' : 'bookings'} · latest start first
              </span>
              {list.isFetching && <span aria-hidden="true">Updating…</span>}
            </div>
            {/* A failed refetch keeps the rows on screen, with the error above them. */}
            {list.isError && (
              <ErrorState
                error={list.error}
                title="Couldn't refresh your bookings"
                onRetry={() => list.refetch()}
                retrying={list.isFetching}
              />
            )}
            <StaggerList className={cn('space-y-4 transition-opacity', list.isPlaceholderData && 'opacity-60')}>
              {items.map((booking) => (
                <BookingCard key={booking._id} booking={booking} now={now} />
              ))}
            </StaggerList>
          </>
        )}

        <Pagination
          page={page}
          pageCount={pages}
          busy={list.isFetching}
          onPageChange={(next) => setView({ page: next })}
          label={`${tab.label} pages`}
        />
      </section>
    </div>
  );
}
