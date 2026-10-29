import React from 'react';
import { CheckCircle2, ListOrdered, Lock, Users, XCircle } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { formatIstShortDateTime } from '../../../lib/time';
import { idOf } from '../../bookings/api';
import { EligibilitySnapshot } from './EligibilitySnapshot';
import { Field } from './Bits';
import {
  OWN_BOOKING_MESSAGE,
  blocksOwnDecision,
  groupCounts,
  quantityText,
  requesterView,
  slotText,
} from './manageView';

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/**
 * One request in a conflict group: who asked (name, member type, department; never an email),
 * the slot, the purpose, the eligibility snapshot and, for a pending one, Approve / Waitlist /
 * Reject. A waitlisted one shows its place in line: it moves up on its own when the slot frees.
 */
export function RequestRow({ booking, position, oldestPending, user, onDecide }) {
  const person = requesterView(booking.borrower);
  const pending = booking.status === 'pending';
  const own = blocksOwnDecision(booking, user);
  const requested = formatIstShortDateTime(booking.createdAt);
  const decisionReason =
    booking.status === 'waitlisted' && booking.decision?.action === 'waitlist'
      ? asText(booking.decision.reason)
      : '';
  const who = <span className="sr-only"> {person.name}&apos;s request</span>;

  return (
    <li
      className={`rounded-lg border-2 p-3 sm:p-4 space-y-3 ${
        pending ? 'border-[#1a1a1a] bg-white' : 'border-[#1a1a1a]/30 bg-[#f5f0e8]'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-black tracking-tight break-words">
            <span className="text-[#1a1a1a]/70">{position}.</span> {person.name}
          </h4>
          <p className="text-xs text-[#1a1a1a]/70 break-words">
            {person.memberType} · {person.department}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {oldestPending && (
            <Badge variant="neutral" size="sm">
              Oldest request
            </Badge>
          )}
          <StatusBadge booking={booking} size="sm" />
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Slot (IST)">{slotText(booking.start, booking.end)}</Field>
        <Field label="Requested">{requested ? `${requested} IST` : 'Not recorded'}</Field>
        <Field label="Purpose" className="sm:col-span-2">
          <span className="font-normal">“{asText(booking.purpose) || 'No purpose given'}”</span>
        </Field>
      </dl>

      <EligibilitySnapshot snapshot={booking.eligibilitySnapshot} />

      {booking.status === 'waitlisted' && (
        <p className="text-xs flex items-start gap-1.5">
          <ListOrdered className="w-4 h-4 shrink-0 text-[#8e44ad]" aria-hidden="true" />
          <span>
            {Number.isInteger(booking.waitlistPosition)
              ? `#${booking.waitlistPosition} on the waitlist. `
              : 'On the waitlist. '}
            It moves up on its own when the slot frees.
            {decisionReason && (
              <span className="block mt-1 text-[#1a1a1a]/70">Reason given: “{decisionReason}”</span>
            )}
          </span>
        </p>
      )}

      {pending &&
        (own ? (
          <p className="text-xs font-bold flex items-start gap-1.5 p-2 rounded-md bg-[#f5f0e8] border-2 border-[#1a1a1a]/20">
            <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Your own request. {OWN_BOOKING_MESSAGE}
            </span>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="forest"
              size="sm"
              className="min-h-[44px]"
              onClick={() => onDecide('approve', booking)}
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Approve{who}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] bg-white"
              onClick={() => onDecide('waitlist', booking)}
            >
              <ListOrdered className="w-4 h-4" aria-hidden="true" />
              Waitlist{who}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="min-h-[44px]"
              onClick={() => onDecide('reject', booking)}
            >
              <XCircle className="w-4 h-4" aria-hidden="true" />
              Reject{who}
            </Button>
          </div>
        ))}
    </li>
  );
}

/**
 * One conflict group of GET /bookings/manage?status=pending: { resource { _id, title, slug,
 * quantity }, start, end, bookings: [Booking, oldest request first] }. One card per contested
 * slot, every request in it listed in the order they came in.
 */
export function ConflictGroupCard({ group, user, onDecide, headingLevel = 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const bookings = Array.isArray(group?.bookings)
    ? group.bookings.filter((b) => b && typeof b === 'object')
    : [];
  const counts = groupCounts({ bookings });
  const title = asText(group?.resource?.title) || 'Resource';
  const units = quantityText(group?.resource?.quantity);
  const contested = bookings.length > 1;
  const firstPending = bookings.find((b) => b.status === 'pending');
  const headingId = `group-${idOf(group?.resource) ?? 'r'}-${idOf(bookings[0]) ?? 'b'}`;

  return (
    <li>
      <Card className="p-4 sm:p-5" aria-labelledby={headingId} role="group">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 mb-3 border-b-2 border-[#1a1a1a]/15">
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-bold tracking-widest text-[#a04000]">
              {contested ? 'Contested slot' : 'Single request'}
            </p>
            <Heading id={headingId} className="text-base md:text-lg font-black tracking-tight break-words">
              {title}
            </Heading>
            <p className="text-xs text-[#1a1a1a]/70">
              {slotText(group?.start, group?.end)} IST
              {units && ` · ${units}`}
            </p>
          </div>
          <Badge variant={contested ? 'amber' : 'neutral'} icon={Users} className="self-start shrink-0">
            {counts.total} {counts.total === 1 ? 'request' : 'requests'}
          </Badge>
        </div>
        {contested && (
          <p className="text-xs text-[#1a1a1a]/70 mb-3">
            {counts.pending} pending, {counts.waitlisted} waitlisted, oldest first.
            {Number(group?.resource?.quantity) === 1 &&
              ' Only one of these can hold the slot: approve one, then reject or waitlist the rest.'}
          </p>
        )}
        <ol className="space-y-3" aria-label={`Requests for ${title}, oldest first`}>
          {bookings.map((booking, index) => (
            <RequestRow
              key={idOf(booking) ?? index}
              booking={booking}
              position={index + 1}
              oldestPending={contested && booking === firstPending}
              user={user}
              onDecide={onDecide}
            />
          ))}
        </ol>
      </Card>
    </li>
  );
}
