import React, { useId, useRef, useState } from 'react';
import { Award, RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { fieldErrorsFrom } from '../../../lib/errors';
import { isAdmin } from '../components/manageView';
import { useNow } from '../../resources/hooks';
import { BADGE_TEXT_MAX, useGrantableBadges } from './api';
import { expiryOnGrant, groupBadgesByUnit, managedUnitIds, readGrant, validityText } from './badgeView';

// The fields the form shows; any other server field error goes above the buttons.
const FORM_FIELDS = ['email', 'note'];

/**
 * The form inside GrantDialog; exported for the tests. Lists the badges of the units this user
 * manages (every badge for an admin) and grants one by the member's email (POST /badges/:id/grant
 * { email, note? }). request: the page's grant mutation (pending, error); onSubmit(body).
 */
export function GrantForm({ user, request, onSubmit, onCancel }) {
  const ids = useId();
  const now = useNow();
  const emailRef = useRef(null);
  const admin = isAdmin(user);
  const unitIds = managedUnitIds(user);
  const catalogue = useGrantableBadges(unitIds, { all: admin });
  const groups = groupBadgesByUnit(catalogue.badges);
  const only = catalogue.badges.length === 1 ? catalogue.badges[0]._id : '';

  const [badgeChoice, setBadgeChoice] = useState(null);
  const badgeId = badgeChoice ?? only;
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});

  const badge = catalogue.badges.find((b) => b._id === badgeId) ?? null;
  const serverErrors = fieldErrorsFrom(request.error);
  const fieldError = (path) => errors[path] ?? serverErrors[path];
  const otherServerError = request.error && !FORM_FIELDS.some((path) => serverErrors[path]);
  const noteId = `${ids}-note`;
  const noteHelpId = `${ids}-note-help`;
  const noteErrorId = `${ids}-note-error`;
  const noUnits = !admin && unitIds.length === 0;
  const loading = catalogue.isPending;
  const noBadges = !loading && !catalogue.error && catalogue.badges.length === 0;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (request.isPending) return;
    const { body, errors: found } = readGrant({ badgeId, email, note }, user);
    setErrors(found);
    if (!body) {
      if (found.email) emailRef.current?.focus();
      return;
    }
    onSubmit?.(body, badge);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {catalogue.error && (
        <ErrorState error={catalogue.error} title="Couldn't load your units' badges">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white"
            onClick={() => catalogue.refetch()}
            loading={catalogue.isFetching}
          >
            {!catalogue.isFetching && <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
            Reload badges
          </Button>
        </ErrorState>
      )}

      {noUnits ? (
        <p role="status" className="text-sm p-3 rounded-lg border-2 border-[#1a1a1a]/30 bg-[#f5f0e8]">
          You don&apos;t manage any unit yet, so there are no badges you can grant.
        </p>
      ) : noBadges ? (
        <p role="status" className="text-sm p-3 rounded-lg border-2 border-[#1a1a1a]/30 bg-[#f5f0e8]">
          {admin ? 'No unit has a badge yet.' : 'Your units have no badges yet.'}
        </p>
      ) : (
        <Select
          id={`${ids}-badge`}
          label="Badge"
          value={badgeId}
          onChange={(e) => {
            setBadgeChoice(e.target.value);
            if (errors.badgeId) setErrors((current) => ({ ...current, badgeId: undefined }));
          }}
          error={fieldError('badgeId')}
          hint={
            loading
              ? 'Loading badges…'
              : badge
                ? `${validityText(badge.validityDays)}. ${expiryOnGrant(badge.validityDays, now)}`
                : admin
                  ? 'Any unit’s badge.'
                  : 'Badges of the units you manage.'
          }
          required
          aria-required="true"
          data-autofocus
        >
          <option value="" disabled>
            {loading ? 'Loading…' : 'Choose a badge'}
          </option>
          {groups.map((group) => (
            <optgroup key={group.unit._id} label={group.unit.name}>
              {group.badges.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                  {b.code ? ` (${b.code})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}

      <Input
        ref={emailRef}
        id={`${ids}-email`}
        type="email"
        label="Member's email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
        }}
        autoComplete="off"
        inputMode="email"
        spellCheck={false}
        placeholder="2024ugcs001@nitjsr.ac.in"
        hint="The address they sign in with. Case doesn't matter."
        error={fieldError('email')}
        required
        aria-required="true"
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="text-sm font-bold tracking-tight">
          Note (optional)
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            if (errors.note) setErrors((current) => ({ ...current, note: undefined }));
          }}
          rows={3}
          maxLength={BADGE_TEXT_MAX}
          aria-invalid={fieldError('note') ? 'true' : undefined}
          aria-describedby={[noteHelpId, fieldError('note') && noteErrorId].filter(Boolean).join(' ')}
          placeholder="Completed the induction on 28 Oct with the lab supervisor."
          className={`w-full px-4 py-2.5 text-sm rounded-lg border-2 bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1 ${
            fieldError('note') ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
          }`}
        />
        <p id={noteHelpId} className="text-xs text-[#1a1a1a]/70 flex justify-between gap-2">
          <span>Kept in the audit log only; the member doesn&apos;t see it.</span>
          <span aria-hidden="true" className="shrink-0 tabular-nums">
            {note.trim().length}/{BADGE_TEXT_MAX}
          </span>
        </p>
        {fieldError('note') && (
          <p id={noteErrorId} role="alert" className="text-xs font-semibold text-[#c0392b] flex items-center gap-1">
            <span aria-hidden="true">✕</span> {fieldError('note')}
          </p>
        )}
      </div>

      {otherServerError && <ErrorState error={request.error} title="The badge wasn't granted" />}

      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#1a1a1a]/15">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel} disabled={request.isPending}>
          Go back
        </Button>
        <Button
          type="submit"
          variant="forest"
          size="lg"
          loading={request.isPending}
          aria-disabled={noUnits || noBadges || undefined}
        >
          {!request.isPending && <Award className="w-4 h-4" aria-hidden="true" />}
          {request.isPending ? 'Granting…' : 'Grant badge'}
        </Button>
      </div>
    </form>
  );
}

/**
 * "Grant directly" (frontend.md §6.3): give a member one of your units' badges without a request,
 * by their email. open, onClose; user: the signed-in user; request: the grant mutation;
 * onSubmit(body, badge) sends it; returnFocusRef as in Dialog.
 */
export function GrantDialog({ open, onClose, user, request, onSubmit, returnFocusRef }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={request.isPending}
      eyebrow="Grant directly"
      title="Grant a badge"
      description="For a member who has already shown the training, such as at an induction. The badge is active at once and they are notified."
      returnFocusRef={returnFocusRef}
    >
      {/* Mounted only while open: each opening starts empty, and the badges load only when needed. */}
      {open && <GrantForm user={user} request={request} onSubmit={onSubmit} onCancel={onClose} />}
    </Dialog>
  );
}
