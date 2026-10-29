import React, { useRef, useState } from 'react';
import { Gavel } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { ErrorState } from '../../../components/ui/ErrorState';
import { fieldErrorsFrom } from '../../../lib/errors';
import { INCIDENT_OUTCOMES, RATIONALE_MAX, validateResolution } from '../api';
import { ChoiceGroup } from './ChoiceGroup';
import { TextAreaField } from './TextAreaField';
import { incidentResourceTitle, typeLabel } from './incidentView';

function ResolveForm({ incident, pending, error, onSubmit, onCancel }) {
  const hasBooking = Boolean(incident?.booking?._id);
  const borrower = incident?.booking?.borrower?.name;
  const [outcome, setOutcome] = useState('');
  const [rationale, setRationale] = useState('');
  const [errors, setErrors] = useState({});
  const outcomeRef = useRef(null);
  const rationaleRef = useRef(null);
  const server = fieldErrorsFrom(error);
  const shown = {
    outcome: errors.outcome ?? server.outcome ?? null,
    rationale: errors.rationale ?? server.rationale ?? null,
  };
  const fieldProblem = Boolean(server.outcome || server.rationale);

  const options = INCIDENT_OUTCOMES.map((option) =>
    option.value === 'strike' && !hasBooking
      ? { ...option, disabled: true, note: "This incident isn't tied to a booking, so there's no borrower to strike." }
      : option
  );

  const submit = (event) => {
    event.preventDefault();
    if (pending) return;
    const found = validateResolution({ outcome, rationale, hasBooking });
    setErrors(found);
    if (found.outcome) outcomeRef.current?.focus();
    else if (found.rationale) rationaleRef.current?.focus();
    if (Object.keys(found).length) return;
    onSubmit?.({ outcome, rationale: rationale.trim() });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <ChoiceGroup
        ref={outcomeRef}
        legend="Outcome"
        name="incident-outcome"
        options={options}
        value={outcome}
        onChange={(value) => {
          setOutcome(value);
          setErrors((current) => ({ ...current, outcome: undefined }));
        }}
        error={shown.outcome}
        columns={2}
        disabled={pending}
      />
      {outcome === 'strike' && hasBooking && (
        <p className="text-xs text-[#a93226] -mt-2">
          {borrower ? `${borrower} gets` : 'The borrower gets'} one strike on their record. Strikes only
          ever suggest a suspension to an admin; nothing happens on its own.
        </p>
      )}
      <TextAreaField
        ref={rationaleRef}
        label="Rationale"
        required
        rows={4}
        value={rationale}
        onChange={(value) => {
          setRationale(value);
          setErrors((current) => ({ ...current, rationale: undefined }));
        }}
        maxLength={RATIONALE_MAX}
        hint={`At most ${RATIONALE_MAX} characters. Everyone involved sees it, and it goes into the audit log.`}
        error={shown.rationale}
        disabled={pending}
      />
      {!fieldProblem && <ErrorState error={error} title="The incident wasn't resolved" />}
      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#1a1a1a]/15">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={pending}>
          Go back
        </Button>
        <Button type="submit" variant="forest" size="lg" loading={pending}>
          {!pending && <Gavel className="w-4 h-4" aria-hidden="true" />}
          {pending ? 'Resolving…' : 'Resolve incident'}
        </Button>
      </div>
    </form>
  );
}

/**
 * The resolve dialog (frontend.md §6.3 "detail with resolve dialog (outcome + rationale)"; api.md
 * POST /incidents/:id/resolve). Pass the mutation's state as `pending` and `error`; close it
 * yourself on success. A strike needs a booking, so it is offered only on one. The form is mounted
 * only while open, so each opening starts empty.
 */
export function ResolveDialog({ open, onClose, incident, pending = false, error = null, onSubmit, returnFocusRef }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={pending}
      wide
      returnFocusRef={returnFocusRef}
      eyebrow={`${typeLabel(incident?.type)} · ${incidentResourceTitle(incident)}`}
      title="Resolve this incident"
      description="Choose what happens next and say why. The thread closes, and everyone involved is notified."
    >
      {open && (
        <ResolveForm incident={incident} pending={pending} error={error} onSubmit={onSubmit} onCancel={onClose} />
      )}
    </Dialog>
  );
}
