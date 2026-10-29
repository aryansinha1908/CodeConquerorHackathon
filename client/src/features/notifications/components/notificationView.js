import {
  AlarmClock,
  AlertTriangle,
  Award,
  BadgeCheck,
  Ban,
  Bell,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  IdCard,
  ListOrdered,
  LogIn,
  LogOut,
  MessageSquare,
  ShieldCheck,
  TimerOff,
  UserX,
  XCircle,
} from 'lucide-react';
import { formatIstDateTime, formatRelative } from '../../../lib/time';
import { isInAppPath } from '../api';

// How each notification type (api.md "Notifications") reads: the area it belongs to and an icon,
// so a list of them scans by kind without relying on colour (frontend.md §1 principle 2).

const AREAS = {
  booking: 'Booking',
  badge: 'Badge',
  verification: 'ID verification',
  incident: 'Incident',
};

const ICONS = {
  'booking.requested': ClipboardList,
  'booking.approved': CheckCircle2,
  'booking.rejected': XCircle,
  'booking.waitlisted': ListOrdered,
  'booking.promoted': CheckCircle2,
  'booking.cancelled': Ban,
  'booking.checked_in': LogIn,
  'booking.checked_out': LogOut,
  'booking.completed': BadgeCheck,
  'booking.no_show': UserX,
  'booking.expired': TimerOff,
  'booking.reminder_start': Clock,
  'booking.reminder_end': Clock,
  'booking.overdue': AlarmClock,
  'badge.requested': Award,
  'badge.granted': Award,
  'badge.rejected': XCircle,
  'verification.approved': ShieldCheck,
  'verification.rejected': IdCard,
  'incident.created': AlertTriangle,
  'incident.commented': MessageSquare,
  'incident.resolved': CheckCircle2,
};

const AREA_ICONS = { booking: CalendarCheck, badge: Award, verification: IdCard, incident: AlertTriangle };

/** A notification type ("booking.approved") → { area: 'Booking', icon }. Unknown types get a bell. */
export function notificationKind(type) {
  const key = typeof type === 'string' ? type : '';
  const prefix = key.split('.')[0];
  return {
    area: AREAS[prefix] ?? 'Update',
    icon: ICONS[key] ?? AREA_ICONS[prefix] ?? Bell,
  };
}

/**
 * A Notification → what a row shows: title and body as text (never an object), whether it is
 * unread, the in-app link or null, and its time both relative ("5 min ago") and in full IST.
 */
export function notificationView(notification, now = Date.now()) {
  const n = notification && typeof notification === 'object' ? notification : {};
  const kind = notificationKind(n.type);
  const link = isInAppPath(n.link) ? n.link : null;
  return {
    id: n._id != null ? String(n._id) : null,
    title: typeof n.title === 'string' && n.title.trim() ? n.title : kind.area,
    body: typeof n.body === 'string' ? n.body : '',
    unread: !n.readAt,
    link,
    area: kind.area,
    icon: kind.icon,
    createdAt: typeof n.createdAt === 'string' ? n.createdAt : null,
    when: formatRelative(n.createdAt, now),
    whenFull: formatIstDateTime(n.createdAt),
  };
}
