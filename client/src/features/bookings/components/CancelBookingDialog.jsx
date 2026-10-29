import React from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { ReasonDialog } from '../../../components/ui/ReasonDialog';
import { REASON_MIN_LENGTH } from '../../../lib/reason';
import { DECISION_TEXT_MAX, isBorrower } from '../api';
import { formatSlot, resourceTitle } from './bookingView';

const MANAGER_TEMPLATES = [
  'The resource is needed for maintenance at this time.',
  'The unit is closed for an event during this slot.',
  'The booking breaks the unit’s usage rules.',
];

/**
 * Cancel with a confirmation (api.md POST /bookings/:id/cancel): the borrower just confirms, as
 * the server needs no reason from them; a manager or admin must give one, which the member sees.
 * `onConfirm(reason)` gets '' from the borrower. Pass the mutation as `request`.
 */
export function CancelBookingDialog({ open, onClose, onConfirm, booking, user, request, returnFocusRef }) {
  if (!booking) return null;
  const isRequest = booking.status === 'pending' || booking.status === 'waitlisted';
  const noun = isRequest ? 'request' : 'booking';
  const title = `Cancel this ${noun}?`;
  const description = [resourceTitle(booking, ''), formatSlot(booking.start, booking.end)].filter(Boolean).join(' · ');
  const common = {
    open,
    onClose,
    title,
    description,
    pendingLabel: 'Cancelling…',
    variant: 'danger',
    pending: request.isPending,
    error: request.error,
    errorTitle: `The ${noun} wasn't cancelled`,
    returnFocusRef,
  };

  if (isBorrower(booking, user)) {
    return (
      <ConfirmDialog
        {...common}
        onConfirm={() => onConfirm('')}
        confirmLabel={`Cancel ${noun}`}
        cancelLabel={`Keep the ${noun}`}
      >
        <p>
          {isRequest
            ? 'Your request is withdrawn and the managers no longer see it.'
            : 'The slot is released and offered to the next person on the waitlist.'}{' '}
          This can&apos;t be undone.
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <ReasonDialog
      {...common}
      onSubmit={onConfirm}
      label="Reason for the member"
      hint={`Required, ${REASON_MIN_LENGTH}–${DECISION_TEXT_MAX} characters. The member sees it.`}
      required
      maxLength={DECISION_TEXT_MAX}
      templates={MANAGER_TEMPLATES}
      submitLabel={`Cancel ${noun}`}
    />
  );
}
