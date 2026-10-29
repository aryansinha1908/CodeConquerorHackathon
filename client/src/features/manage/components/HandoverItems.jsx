import React from 'react';
import { AlarmClock, ClipboardCheck, ExternalLink, Lock, LogIn, LogOut, TimerReset } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import {
  formatDuration,
  formatIstShortDateTime,
  formatIstTime,
  formatRelative,
  toDate,
} from '../../../lib/time';
import { OVERDUE_GRACE_MINUTES, checkInOpensAt, idOf } from '../../bookings/api';
import { LinkButton } from './Bits';
import {
  OWN_BOOKING_MESSAGE,
  blocksOwnDecision,
  canHandOver,
  checkInWindow,
  isOverdueAt,
  lateReturnMinutes,
  minutesPastEnd,
  requesterView,
  slotText,
} from './manageView';

// One booking in a handover list (GET /bookings/manage, Booking objects with resource { _id,
// title, slug, quantity } and borrower { _id, name, memberType, department }).

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const bookingPath = (booking, suffix = '') => `/bookings/${encodeURIComponent(idOf(booking))}${suffix}`;

function Header({ booking, badge }) {
  const person = requesterView(booking.borrower);
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="text-sm md:text-base font-black tracking-tight break-words">
          {asText(booking.resource?.title) || 'Resource'}
        </h4>
        <p className="text-xs break-words">
          <span className="font-bold">{person.name}</span>
          <span className="text-[#1a1a1a]/70">
            {' '}
            · {person.memberType} · {person.department}
          </span>
        </p>
        <p className="text-xs text-[#1a1a1a]/70">{slotText(booking.start, booking.end)} IST</p>
      </div>
      <div className="self-start shrink-0">{badge}</div>
    </div>
  );
}

// "for FDM 3D Printer #2, Aarav Student": the link texts repeat per row, so each says which one.
function Which({ booking }) {
  return (
    <span className="sr-only">
      {' '}
      for {asText(booking.resource?.title) || 'the resource'}, {requesterView(booking.borrower).name}
    </span>
  );
}

function Line({ icon: Icon, tone = '', children }) {
  return (
    <p className={`text-xs flex items-start gap-1.5 ${tone}`}>
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Starting soon: an approved booking today, with the check-in window (opens 15 min before). The
 * check-in link is for the borrower or a manager of the unit only (canHandOver).
 */
export function StartingItem({ booking, now, user }) {
  const checkIn = checkInWindow(booking, now);
  const handOver = canHandOver(booking, user);
  const starts = formatRelative(booking.start, now);
  const started = (toDate(booking.start)?.getTime() ?? Infinity) <= now;
  return (
    <li>
      <Card className="p-4 space-y-3">
        <Header booking={booking} badge={<StatusBadge booking={booking} size="sm" />} />
        {starts && (
          <Line icon={TimerReset}>
            {started ? `Started ${starts}, not checked in yet.` : `Starts ${starts}.`}
          </Line>
        )}
        {checkIn === 'early' && (
          <p className="text-xs text-[#1a1a1a]/70">
            Check-in opens at {formatIstTime(checkInOpensAt(booking)) ?? 'the start'} IST.
          </p>
        )}
        {checkIn === 'ended' && (
          <p className="text-xs text-[#1a1a1a]/70">The slot has ended without a check-in.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {checkIn === 'open' && handOver && (
            <LinkButton to={bookingPath(booking, '/check-in')} variant="forest">
              <LogIn className="w-4 h-4" aria-hidden="true" />
              Check in
              <Which booking={booking} />
            </LinkButton>
          )}
          <LinkButton to={bookingPath(booking)}>
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
            Open booking
            <Which booking={booking} />
          </LinkButton>
        </div>
      </Card>
    </li>
  );
}

/**
 * In use: checked in; overdue (more than 15 min past the end) is highlighted. The check-out link is
 * for the borrower or a manager of the unit only (canHandOver).
 */
export function InUseItem({ booking, now, user }) {
  const overdue = isOverdueAt(booking, now);
  const handOver = canHandOver(booking, user);
  const checkedIn = formatIstShortDateTime(booking.checkIn?.at);
  const late = minutesPastEnd(booking, now);
  const dueAt = formatIstTime(booking.end);
  const dueIn = formatRelative(booking.end, now);
  return (
    <li>
      <Card variant={overdue ? 'danger' : 'default'} className="p-4 space-y-3">
        <Header
          booking={booking}
          badge={<StatusBadge status="checked_in" overdue={overdue} size="sm" />}
        />
        {checkedIn && <Line icon={LogIn}>Checked in {checkedIn} IST.</Line>}
        {overdue ? (
          <Line icon={AlarmClock} tone="font-bold text-[#c0392b]">
            Overdue by {formatDuration(late) ?? 'a while'}
            {dueAt ? `: due back at ${dueAt} IST.` : '.'}
          </Line>
        ) : (
          dueIn && (
            <Line icon={TimerReset}>
              {late > 0
                ? `Ended ${dueIn}; overdue after ${OVERDUE_GRACE_MINUTES} min.`
                : `Due back ${dueIn} (${dueAt} IST).`}
            </Line>
          )
        )}
        <div className="flex flex-wrap gap-2">
          {handOver && (
            <LinkButton to={bookingPath(booking, '/check-out')} variant={overdue ? 'primary' : 'outline'}>
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Check out
              <Which booking={booking} />
            </LinkButton>
          )}
          <LinkButton to={bookingPath(booking)}>
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
            Open booking
            <Which booking={booking} />
          </LinkButton>
        </div>
      </Card>
    </li>
  );
}

/** Awaiting return confirmation: checked out; links to /manage/returns/:bookingId. */
export function ReturnItem({ booking, now, user }) {
  const returnedAt = booking.checkOut?.at;
  const returned = formatIstShortDateTime(returnedAt);
  const late = lateReturnMinutes(booking);
  const own = blocksOwnDecision(booking, user);
  const to = `/manage/returns/${encodeURIComponent(idOf(booking))}`;
  return (
    <li>
      <Card className="p-4 space-y-3">
        <Header booking={booking} badge={<StatusBadge booking={booking} size="sm" />} />
        {returned && (
          <Line icon={LogOut}>
            Returned {formatRelative(returnedAt, now)} ({returned} IST).
          </Line>
        )}
        {late > OVERDUE_GRACE_MINUTES && (
          <Line icon={AlarmClock} tone="font-bold text-[#a04000]">
            Came back {formatDuration(late)} after the slot ended.
          </Line>
        )}
        {own && (
          <Line icon={Lock} tone="font-bold">
            Your own booking. {OWN_BOOKING_MESSAGE}
          </Line>
        )}
        <div className="flex flex-wrap gap-2">
          <LinkButton to={to} variant={own ? 'outline' : 'forest'}>
            <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
            {own ? 'View the return' : 'Confirm return'}
            <Which booking={booking} />
          </LinkButton>
        </div>
      </Card>
    </li>
  );
}
