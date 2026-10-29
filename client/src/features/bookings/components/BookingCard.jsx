import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight, MapPin } from 'lucide-react';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { cn } from '../../../lib/utils';
import { bookingPath, cardHint, formatLocation, formatSlot, resourceTitle, slotLength } from './bookingView';

/**
 * One booking of GET /bookings/mine (resource { _id, title, slug, location }, waitlistPosition on
 * waitlisted ones) as a card. The title is the link; its ::after covers the card, so the whole card
 * is a tap target while a screen reader hears only the title as the link's name.
 */
export function BookingCard({ booking, now }) {
  const title = resourceTitle(booking, 'Untitled resource');
  const slot = formatSlot(booking.start, booking.end) ?? 'Time not set';
  const length = slotLength(booking.start, booking.end);
  const location = formatLocation(booking.resource?.location);
  const hint = cardHint(booking, now);
  const overdue = booking.status === 'checked_in' && Boolean(booking.isOverdue ?? booking.flags?.overdue);
  const purpose = typeof booking.purpose === 'string' ? booking.purpose : '';

  return (
    <li
      className={cn(
        'relative rounded-xl border-2 bg-white p-4 sm:p-5 font-mono text-[#1a1a1a] transition-all',
        'shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:-translate-x-[2px] hover:-translate-y-[2px]',
        'focus-within:ring-2 focus-within:ring-[#c0392b] focus-within:ring-offset-2',
        overdue ? 'border-[#c0392b]' : 'border-[#1a1a1a]'
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-base font-bold tracking-tight break-words">
            <Link
              to={bookingPath(booking._id)}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none hover:underline underline-offset-2"
            >
              {title}
            </Link>
          </h3>
          <p className="text-sm flex items-start gap-1.5">
            <CalendarClock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <time dateTime={String(booking.start ?? '')}>{slot}</time>
              {length && <span className="text-[#1a1a1a]/70"> · {length}</span>}
            </span>
          </p>
          {location && (
            <p className="text-xs text-[#1a1a1a]/70 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span className="break-words">{location}</span>
            </p>
          )}
        </div>
        <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
          <StatusBadge booking={booking} />
          {hint && (
            <span className={cn('text-xs font-bold', overdue ? 'text-[#c0392b]' : 'text-[#1a1a1a]/80')}>
              {hint}
            </span>
          )}
        </div>
      </div>
      {purpose && (
        <p className="mt-3 pt-3 border-t border-[#1a1a1a]/15 text-xs text-[#1a1a1a]/80 line-clamp-2 break-words pr-6">
          <span className="font-bold">Purpose: </span>
          {purpose}
        </p>
      )}
      <ChevronRight
        className="hidden sm:block absolute right-3 bottom-4 w-4 h-4 text-[#1a1a1a]/50"
        aria-hidden="true"
      />
    </li>
  );
}
