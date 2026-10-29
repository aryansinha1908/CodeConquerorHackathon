import React, { useId, useState } from 'react';
import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import { Dialog } from '../../../components/ui/Dialog';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import {
  MEMBER_TYPE_OPTIONS,
  activeUnits as onlyActive,
  departmentFromHints,
  formatEmailHints,
  groupUnits,
  memberTypeFromHints,
  memberTypeLabel,
} from '../../verification/api';
import { REASON_MAX, REASON_MIN, readDecision } from '../api';
import { fieldErrorsFrom } from '../../../lib/errors';

// Quick picks for a rejection (frontend.md §7 ReasonDialog); the admin can edit the text after.
const REJECT_TEMPLATES = [
  'The ID card image is blurred or unreadable.',
  "The name on the card doesn't match the account.",
  'The ID card has expired.',
  "This isn't an NIT Jamshedpur ID card.",
];

/** The form inside DecisionDialog; exported for the tests. */
export function DecisionForm({
  item,
  initialDecision,
  units,
  unitsError,
  unitsLoading = false,
  onReloadUnits,
  request,
  onSubmit,
  onCancel,
}) {
  const ids = useId();
  const { user } = item;
  const hints = user.emailHints ?? null;
  const activeUnits = onlyActive(units);
  // GET /org-units failed: the member's own unit (from the queue item) is still a valid answer,
  // which the server checks is active, so the admin can approve without the list.
  const ownUnit = !activeUnits.length && unitsError && user.department?._id ? user.department : null;

  const [decision, setDecision] = useState(initialDecision);
  // What the user chose on their form, else what the email hints point at: the admin confirms it
  // against the card and may correct it (architecture.md §8).
  const [memberType, setMemberType] = useState(user.memberType ?? memberTypeFromHints(hints) ?? '');
  const [departmentChoice, setDepartmentChoice] = useState(null);
  const submittedDept = activeUnits.find((unit) => unit._id === user.department?._id) ?? null;
  const department =
    departmentChoice ??
    submittedDept?._id ??
    departmentFromHints(hints, activeUnits)?._id ??
    ownUnit?._id ??
    '';
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});

  const serverErrors = fieldErrorsFrom(request.error);
  const fieldError = (path) => errors[path] ?? serverErrors[path];
  const rejecting = decision === 'reject';
  const reasonId = `${ids}-reason`;
  const reasonHelpId = `${ids}-reason-help`;
  const reasonErrorId = `${ids}-reason-error`;
  const hintText = formatEmailHints(hints);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (request.isPending) return;
    const { body, errors: found } = readDecision({ decision, reason, memberType, department });
    setErrors(found);
    if (body) onSubmit(body);
  };

  const radioClass = (value, tone) =>
    `flex items-center gap-2 px-4 py-3 min-h-[44px] rounded-lg border-2 cursor-pointer text-sm font-bold transition-colors focus-within:ring-2 focus-within:ring-[#c0392b] focus-within:ring-offset-2 ${
      decision === value
        ? `${tone} text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]`
        : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
    }`;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs p-3 bg-[#f5f0e8] border-2 border-[#1a1a1a]/20 rounded-lg">
        <div className="min-w-0">
          <dt className="text-[#1a1a1a]/70 uppercase tracking-wider">Email</dt>
          <dd className="font-bold break-all">{user.email}</dd>
        </div>
        <div>
          <dt className="text-[#1a1a1a]/70 uppercase tracking-wider">Email hints</dt>
          <dd className="font-bold">{hintText ?? 'None (not a roll-number address)'}</dd>
        </div>
        <div>
          <dt className="text-[#1a1a1a]/70 uppercase tracking-wider">They chose</dt>
          <dd className="font-bold">
            {memberTypeLabel(user.memberType)} · {user.department?.name ?? 'No department'}
          </dd>
        </div>
      </dl>

      <fieldset>
        <legend className="text-sm font-bold tracking-tight mb-2">Decision</legend>
        <div className="grid grid-cols-2 gap-3">
          <label className={radioClass('approve', 'bg-[#183d2d]')}>
            <input
              type="radio"
              name={`${ids}-decision`}
              value="approve"
              checked={decision === 'approve'}
              onChange={() => setDecision('approve')}
              className="sr-only"
              data-autofocus={initialDecision === 'approve' ? true : undefined}
            />
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            Approve
          </label>
          <label className={radioClass('reject', 'bg-[#c0392b]')}>
            <input
              type="radio"
              name={`${ids}-decision`}
              value="reject"
              checked={decision === 'reject'}
              onChange={() => setDecision('reject')}
              className="sr-only"
            />
            <XCircle className="w-4 h-4" aria-hidden="true" />
            Reject
          </label>
        </div>
      </fieldset>

      {!rejecting && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            id={`${ids}-member-type`}
            label="Member type"
            value={memberType}
            onChange={(e) => setMemberType(e.target.value)}
            error={fieldError('memberType')}
            hint="Check it against the card."
            required
          >
            <option value="" disabled>
              Choose a member type
            </option>
            {MEMBER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Select
            id={`${ids}-department`}
            label="Department"
            value={department}
            onChange={(e) => setDepartmentChoice(e.target.value)}
            error={
              fieldError('department') ??
              (unitsError && !ownUnit
                ? `Couldn't load the units: ${unitsError.message ?? 'try again'}${
                    unitsError.requestId ? ` (ref ${unitsError.requestId})` : ''
                  }`
                : undefined)
            }
            hint={
              unitsLoading
                ? 'Loading units…'
                : ownUnit
                  ? `Couldn't load the other units${
                      unitsError.requestId ? ` (ref ${unitsError.requestId})` : ''
                    }: approve with the one they chose, or reload.`
                  : 'Check it against the card.'
            }
            required
          >
            <option value="" disabled>
              {unitsLoading ? 'Loading…' : 'Choose a unit'}
            </option>
            {ownUnit && <option value={ownUnit._id}>{ownUnit.name} (their choice)</option>}
            {groupUnits(activeUnits).map((group) => (
              <optgroup key={group.type} label={group.label}>
                {group.units.map((unit) => (
                  <option key={unit._id} value={unit._id}>
                    {unit.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {unitsError && onReloadUnits && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="bg-white justify-self-start sm:col-start-2 -mt-2"
              onClick={onReloadUnits}
              loading={unitsLoading}
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Reload units
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="text-sm font-bold tracking-tight">
          {rejecting ? 'Reason (required, the member sees it)' : 'Note (optional)'}
        </label>
        {rejecting && (
          <div className="flex flex-wrap gap-1.5 mb-1" role="group" aria-label="Common reasons">
            {REJECT_TEMPLATES.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => setReason(text)}
                className="text-[11px] px-2 py-1 rounded-md border-2 border-[#1a1a1a]/40 bg-white hover:border-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
              >
                {text}
              </button>
            ))}
          </div>
        )}
        <textarea
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={REASON_MAX}
          required={rejecting}
          aria-invalid={fieldError('reason') ? 'true' : undefined}
          aria-describedby={[reasonHelpId, fieldError('reason') && reasonErrorId]
            .filter(Boolean)
            .join(' ')}
          data-autofocus={initialDecision === 'reject' ? true : undefined}
          className={`w-full px-4 py-2.5 text-sm rounded-lg border-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1 ${
            fieldError('reason') ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
          }`}
        />
        <p id={reasonHelpId} className="text-xs text-[#1a1a1a]/70 flex justify-between gap-2">
          <span>
            {rejecting
              ? `${REASON_MIN}–${REASON_MAX} characters. Say what to fix.`
              : `Optional, ${REASON_MIN}–${REASON_MAX} characters. Kept in the audit log.`}
          </span>
          <span aria-hidden="true">
            {reason.trim().length}/{REASON_MAX}
          </span>
        </p>
        {fieldError('reason') && (
          <p
            id={reasonErrorId}
            role="alert"
            className="text-xs font-semibold text-[#c0392b] flex items-center gap-1"
          >
            <span aria-hidden="true">✕</span> {fieldError('reason')}
          </p>
        )}
      </div>

      <ErrorState
        error={request.error}
        title={rejecting ? "The rejection wasn't saved" : "The approval wasn't saved"}
      />

      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#1a1a1a]/15">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={onCancel}
          disabled={request.isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={rejecting ? 'primary' : 'forest'}
          size="lg"
          loading={request.isPending}
        >
          {request.isPending
            ? rejecting
              ? 'Rejecting…'
              : 'Approving…'
            : rejecting
              ? 'Reject verification'
              : 'Approve verification'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Approve or reject one pending verification (frontend.md §6.4). target: { item, decision } or
 * null; units: GET /org-units data (unitsError when it failed, unitsLoading while it loads,
 * onReloadUnits to ask again); request: the page's decide mutation (its error is shown here);
 * onSubmit(body) sends it.
 */
export function DecisionDialog({
  target,
  units,
  unitsError,
  unitsLoading,
  onReloadUnits,
  request,
  onSubmit,
  onClose,
}) {
  const item = target?.item ?? null;
  return (
    <Dialog
      open={Boolean(target)}
      onClose={() => {
        if (!request.isPending) onClose();
      }}
      eyebrow="Verification decision"
      title={item ? item.user.name : ''}
    >
      {item && (
        // Keyed so each opening starts from the item's own values, not the previous form's.
        <DecisionForm
          key={`${item.user._id}:${target.decision}`}
          item={item}
          initialDecision={target.decision}
          units={units}
          unitsError={unitsError}
          unitsLoading={unitsLoading}
          onReloadUnits={onReloadUnits}
          request={request}
          onSubmit={onSubmit}
          onCancel={onClose}
        />
      )}
    </Dialog>
  );
}
