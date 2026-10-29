import React, { useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Pagination } from '../../../components/ui/Pagination';
import { pageCount } from '../../../lib/paging';
import { idOf, useManageBookings } from '../../bookings/api';
import { ListSkeleton } from './Bits';
import { HANDOVER_PAGE_SIZE, handoverFilters } from './manageView';

/**
 * One of the three handover lists: its own GET /bookings/manage query (['bookings', 'manage',
 * filters], polled every 30 s), page, loading, empty and error states. `renderItem(booking)`
 * draws a row (an <li>); `aside(items)` may add a line beside the heading (the overdue count);
 * `itemsName` ("the items in use") words the loading and error lines.
 */
export function HandoverSection({
  sectionId,
  now,
  title,
  itemsName,
  description,
  icon: Icon,
  emptyTitle,
  emptyDescription,
  renderItem,
  aside,
}) {
  const [page, setPage] = useState(1);
  const list = useManageBookings(handoverFilters(sectionId, { page, now }));
  const items = Array.isArray(list.data?.data) ? list.data.data.filter((b) => b && typeof b === 'object') : [];
  const meta = list.data?.meta;
  const total = Number(meta?.total) || 0;
  const pages = pageCount(meta, HANDOVER_PAGE_SIZE);
  const headingId = `handovers-${sectionId}-heading`;

  // A confirmed return or a check-in can empty the last page: step back to the new last page
  // (adjusting state while rendering, as React suggests, rather than in an effect).
  const settled = list.isSuccess && !list.isPlaceholderData;
  if (settled && page > pages) setPage(pages);

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-lg font-black tracking-tight flex items-center gap-2">
            {Icon && <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />}
            <span>{title}</span>
            {list.isSuccess && (
              <Badge variant={total ? 'dark' : 'neutral'} size="sm">
                {total}
                <span className="sr-only"> {total === 1 ? 'booking' : 'bookings'}</span>
              </Badge>
            )}
          </h3>
          {description && <p className="text-xs text-[#1a1a1a]/70 mt-0.5">{description}</p>}
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          {aside?.(items)}
          {list.isFetching && !list.isPending && (
            <span className="text-[#1a1a1a]/70" aria-hidden="true">
              Updating…
            </span>
          )}
        </div>
      </div>

      {list.isPending && <ListSkeleton label={`Loading ${itemsName}…`} rows={1} />}

      {list.isError && !list.data && (
        <ErrorState
          error={list.error}
          title={`Couldn't load ${itemsName}`}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        />
      )}

      {/* A failed 30-second refresh keeps the last list: say it may be out of date. */}
      {list.isError && list.data && (
        <ErrorState
          error={list.error}
          title={`Couldn't refresh ${itemsName}`}
          onRetry={() => list.refetch()}
          retrying={list.isFetching}
        >
          The list below may have changed since it was loaded.
        </ErrorState>
      )}

      {list.isSuccess && items.length === 0 && (
        <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} className="p-6" />
      )}

      {items.length > 0 && (
        <ul className={`space-y-3 ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
          {items.map((booking) => (
            <React.Fragment key={idOf(booking)}>{renderItem(booking)}</React.Fragment>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pageCount={pages}
        onPageChange={setPage}
        busy={list.isFetching}
        label={`${title} pages`}
      />
    </section>
  );
}
