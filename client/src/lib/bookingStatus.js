import {
  AlarmClock,
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock,
  ListOrdered,
  LogIn,
  LogOut,
  TimerOff,
  UserX,
  XCircle,
} from 'lucide-react';

// Booking status styles (frontend.md §10.2): never colour alone (§1 principle 2), so every status
// has an icon and a label too. `variant` is a components/ui/Badge variant; each one is at least
// 4.5:1 for its text (§10.3).

export const BOOKING_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'waitlisted',
  'cancelled',
  'expired',
  'checked_in',
  'checked_out',
  'completed',
  'flagged',
  'no_show',
];

export const BOOKING_STATUS_STYLES = {
  pending: { variant: 'amber', icon: Clock, label: 'Awaiting review' },
  approved: { variant: 'green', icon: CheckCircle2, label: 'Approved' },
  waitlisted: { variant: 'violet', icon: ListOrdered, label: 'Waitlisted' },
  rejected: { variant: 'red', icon: XCircle, label: 'Rejected' },
  cancelled: { variant: 'slate', icon: Ban, label: 'Cancelled' },
  expired: { variant: 'slateLight', icon: TimerOff, label: 'Expired' },
  checked_in: { variant: 'blue', icon: LogIn, label: 'In use' },
  checked_out: { variant: 'teal', icon: LogOut, label: 'Returned, awaiting confirmation' },
  completed: { variant: 'emerald', icon: BadgeCheck, label: 'Completed' },
  flagged: { variant: 'orange', icon: AlertTriangle, label: 'Issue reported' },
  no_show: { variant: 'rose', icon: UserX, label: 'No-show' },
};

const OVERDUE = { variant: 'overdue', icon: AlarmClock, label: 'Overdue' };

/**
 * A booking's status as shown: { status, variant, icon, label }. `overdue` turns checked_in into
 * "Overdue" (GET /bookings/:id sends isOverdue, the lists flags.overdue); `waitlistPosition` adds
 * the place in line: "Waitlisted (#2)". An unknown status shows as itself, in neutral.
 */
export function bookingStatusView(status, { overdue = false, waitlistPosition = null } = {}) {
  if (status === 'checked_in' && overdue) return { status, ...OVERDUE };
  const style = BOOKING_STATUS_STYLES[status];
  if (!style) {
    const label = status ? String(status).replace(/_/g, ' ') : 'Unknown';
    return { status, variant: 'neutral', icon: null, label };
  }
  const position = Number(waitlistPosition);
  if (status === 'waitlisted' && Number.isInteger(position) && position > 0) {
    return { status, ...style, label: `${style.label} (#${position})` };
  }
  return { status, ...style };
}

/** The view of a Booking object: its status, isOverdue / flags.overdue and waitlistPosition. */
export function bookingStatusOf(booking) {
  return bookingStatusView(booking?.status, {
    overdue: Boolean(booking?.isOverdue ?? booking?.flags?.overdue),
    waitlistPosition: booking?.waitlistPosition ?? null,
  });
}
