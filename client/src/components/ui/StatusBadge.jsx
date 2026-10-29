import React from 'react';
import { Badge } from './Badge';
import { bookingStatusOf, bookingStatusView } from '../../lib/bookingStatus';

/**
 * A booking status as colour + icon + label (frontend.md §10.2). Pass a Booking object as
 * `booking` (it reads status, isOverdue / flags.overdue and waitlistPosition), or the parts as
 * `status`, `overdue` and `waitlistPosition`. Other props go to Badge (size, className, …).
 */
export function StatusBadge({ booking, status, overdue, waitlistPosition, size = 'md', ...props }) {
  const view = booking
    ? bookingStatusOf(booking)
    : bookingStatusView(status, { overdue: Boolean(overdue), waitlistPosition });
  return (
    <Badge variant={view.variant} icon={view.icon ?? undefined} size={size} {...props}>
      {view.label}
    </Badge>
  );
}
