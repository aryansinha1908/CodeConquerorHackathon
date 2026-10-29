import React from 'react';
import { ListOrdered, XCircle } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { ErrorState } from '../../../components/ui/ErrorState';

/**
 * The body of SlotTakenDialog; exported for the tests (Headless UI dialogs render nothing on the
 * server). `error` is the approve's 409 SLOT_TAKEN: "Another booking already holds this slot.
 * Reject this request or move it to the waitlist."
 */
export function SlotTakenChoices({ error, name, onWaitlist, onReject, onCancel }) {
  return (
    <div className="space-y-4">
      <ErrorState error={error} title="Another booking holds this slot" />
      <p className="text-sm leading-relaxed">
        {name}&apos;s request is still pending. Move it to the waitlist so it moves up if the slot
        frees, or reject it. Either way you give a reason, and they see it.
      </p>
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#1a1a1a]/15">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          Go back
        </Button>
        <Button type="button" variant="danger" size="lg" onClick={onReject}>
          <XCircle className="w-4 h-4" aria-hidden="true" />
          Reject instead
        </Button>
        <Button type="button" variant="primary" size="lg" onClick={onWaitlist} data-autofocus>
          <ListOrdered className="w-4 h-4" aria-hidden="true" />
          Move to the waitlist
        </Button>
      </div>
    </div>
  );
}

/**
 * Approve came back 409 SLOT_TAKEN (api.md "Bookings": another booking already holds the slot):
 * offer the two decisions that still work. Each opens the reason dialog for it.
 */
export function SlotTakenDialog({ open, error, name, subject, onWaitlist, onReject, onClose, returnFocusRef }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow={subject}
      title="This slot is already taken"
      returnFocusRef={returnFocusRef}
    >
      {open && (
        <SlotTakenChoices
          error={error}
          name={name}
          onWaitlist={onWaitlist}
          onReject={onReject}
          onCancel={onClose}
        />
      )}
    </Dialog>
  );
}
