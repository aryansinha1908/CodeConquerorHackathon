import React from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { MEMBER_TYPES, MEMBER_TYPE_OPTIONS, groupUnits } from '../../verification/api';
import { Checkbox, ChoiceCards, FieldError, FormSection, SmallButton } from './FormBits';
import { APPROVAL_OPTIONS, fieldDomId, toggleIn, unitName } from './listingForm';
import { hintClass, labelClass, textLinkClass } from './styles';

// Eligibility (frontend.md §6.3; api.md "Listing form": eligibility): who may book (member types,
// departments from GET /org-units), the badges they need (GET /badges) and how requests are
// approved. An empty department or badge list means no restriction. A selection the lists no longer
// offer (a unit made inactive since) stays visible, so saving doesn't drop it unseen.

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

function Loading({ label }) {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-10 w-full max-w-lg" />
      <Skeleton className="h-10 w-full max-w-md" />
    </div>
  );
}

function MemberTypes({ value, onChange, error }) {
  const id = fieldDomId('eligibility.memberTypes');
  const errorId = error ? `${id}-error` : null;
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, errorId].filter(Boolean).join(' ')}
      aria-invalid={error ? 'true' : undefined}
      className="min-w-0 space-y-2 focus:outline-none"
    >
      <legend className={labelClass}>Member types</legend>
      <p id={`${id}-hint`} className={hintClass}>
        Who may book it. Tick all five to open it to everyone.
      </p>
      <div className="flex flex-wrap gap-2">
        <SmallButton onClick={() => onChange([...MEMBER_TYPES])}>Everyone</SmallButton>
        <SmallButton onClick={() => onChange([])}>Clear</SmallButton>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
        {MEMBER_TYPE_OPTIONS.map((option) => (
          <Checkbox
            key={option.value}
            id={`${id}-${option.value}`}
            checked={value.includes(option.value)}
            onChange={() => onChange(toggleIn(value, option.value))}
            label={option.label}
          />
        ))}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

function Departments({ value, onChange, errors, units, known }) {
  const id = fieldDomId('eligibility.departments');
  const listError = errors['eligibility.departments'];
  const groups = groupUnits(units.list);
  const offered = new Set(groups.flatMap((group) => group.units.map((unit) => String(unit._id))));
  const knownById = new Map(known.filter(Boolean).map((unit) => [String(unit._id), unit]));
  const extra = value.filter((unitId) => !offered.has(unitId));
  const errorFor = (unitId) => errors[`eligibility.departments.${value.indexOf(unitId)}`];

  const box = (unit, detail) => {
    const unitId = String(unit._id);
    const error = value.includes(unitId) ? errorFor(unitId) : null;
    const boxId = `${id}-${unitId}`;
    return (
      <div key={unitId}>
        <Checkbox
          id={boxId}
          checked={value.includes(unitId)}
          onChange={() => onChange(toggleIn(value, unitId))}
          label={unitName(unit)}
          detail={detail}
          describedBy={error ? `${boxId}-error` : undefined}
        />
        <FieldError id={`${boxId}-error`} message={error} />
      </div>
    );
  };

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, listError && `${id}-error`].filter(Boolean).join(' ')}
      className="min-w-0 space-y-2 focus:outline-none"
    >
      <legend className={labelClass}>Departments</legend>
      <p id={`${id}-hint`} className={hintClass}>
        {value.length
          ? `Only members of the ${value.length === 1 ? 'ticked unit' : `${value.length} ticked units`} may book it.`
          : 'None ticked: members of every department may book it.'}
      </p>
      <FieldError id={`${id}-error`} message={listError} />
      {units.loading && <Loading label="Loading the departments…" />}
      {units.error && (
        <ErrorState error={units.error} title="Couldn't load the departments" onRetry={units.retry} retrying={units.retrying}>
          The departments already chosen are kept.
        </ErrorState>
      )}
      {groups.map((group) => (
        <div key={group.type} className="space-y-1">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#1a1a1a]/80">{group.label}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">{group.units.map((unit) => box(unit))}</div>
        </div>
      ))}
      {extra.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#1a1a1a]/80">Also chosen</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {extra.map((unitId) =>
              box(knownById.get(unitId) ?? { _id: unitId, name: 'A unit no longer listed' }, 'Not in the active list. Untick to remove it.')
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function badgeDetail(badge) {
  const parts = [];
  if (badge?.orgUnit?.name) parts.push(`Issued by ${asText(badge.orgUnit.name)}`);
  if (badge?.validityDays === null) parts.push('never expires');
  else if (Number(badge?.validityDays) > 0) parts.push(`valid ${badge.validityDays} days`);
  if (badge?.evidenceRequired) parts.push('needs evidence');
  return parts.join(' · ') || null;
}

function Badges({ value, onChange, errors, badges, known }) {
  const id = fieldDomId('eligibility.badges');
  const listError = errors['eligibility.badges'];
  const list = Array.isArray(badges.list) ? badges.list.filter((b) => b && b._id) : [];
  const offered = new Set(list.map((b) => String(b._id)));
  const knownById = new Map(known.filter(Boolean).map((b) => [String(b._id), b]));
  const extra = value.filter((badgeId) => !offered.has(badgeId));
  const byUnit = new Map();
  for (const badge of list) {
    const unit = asText(badge.orgUnit?.name) || 'Other badges';
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), badge]);
  }

  const box = (badge, detail) => {
    const badgeId = String(badge._id);
    const index = value.indexOf(badgeId);
    const error = index === -1 ? null : errors[`eligibility.badges.${index}`];
    const boxId = `${id}-${badgeId}`;
    return (
      <div key={badgeId}>
        <Checkbox
          id={boxId}
          checked={index !== -1}
          onChange={() => onChange(toggleIn(value, badgeId))}
          label={asText(badge.name) || asText(badge.code) || 'Badge'}
          detail={detail}
          describedBy={error ? `${boxId}-error` : undefined}
        />
        <FieldError id={`${boxId}-error`} message={error} />
      </div>
    );
  };

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={[`${id}-hint`, listError && `${id}-error`].filter(Boolean).join(' ')}
      className="min-w-0 space-y-2 focus:outline-none"
    >
      <legend className={labelClass}>Required badges</legend>
      <p id={`${id}-hint`} className={hintClass}>
        {value.length
          ? `Members need ${value.length === 1 ? 'this badge' : `all ${value.length} badges`} to book. The listing links them to the request.`
          : 'None ticked: no badge needed.'}{' '}
        {/* A new tab, so the form typed so far is kept: an in-app link would drop it. */}
        <Link to="/manage/badges" target="_blank" rel="noopener noreferrer" className={textLinkClass}>
          Badge requests and grants<span className="sr-only"> (opens in a new tab)</span>
        </Link>
      </p>
      <FieldError id={`${id}-error`} message={listError} />
      {badges.loading && <Loading label="Loading the badges…" />}
      {badges.error && (
        <ErrorState error={badges.error} title="Couldn't load the badges" onRetry={badges.retry} retrying={badges.retrying}>
          The badges already chosen are kept.
        </ErrorState>
      )}
      {!badges.loading && !badges.error && list.length === 0 && (
        <p className="text-xs text-[#1a1a1a]/70">No unit has created a badge yet.</p>
      )}
      {[...byUnit.entries()].map(([unit, group]) => (
        <div key={unit} className="space-y-1">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#1a1a1a]/80">{unit}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">{group.map((badge) => box(badge, badgeDetail(badge)))}</div>
        </div>
      ))}
      {extra.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-black uppercase tracking-wider text-[#1a1a1a]/80">Also required</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {extra.map((badgeId) =>
              box(knownById.get(badgeId) ?? { _id: badgeId, name: 'A badge no longer offered' }, "Its unit isn't active any more. Untick to remove it.")
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

export function EligibilitySection({ form, update, errors, errorCount, changed, units, badges, known = {} }) {
  const set = (field) => (value) => update((f) => ({ ...f, [field]: value }));
  return (
    <FormSection
      id="section-eligibility"
      title="Eligibility"
      description="Who may book it and how requests are approved. Members see each rule, with a fix, on the listing."
      errorCount={errorCount}
      changed={changed}
    >
      <MemberTypes value={form.memberTypes} onChange={set('memberTypes')} error={errors['eligibility.memberTypes']} />
      <Departments
        value={form.departments}
        onChange={set('departments')}
        errors={errors}
        units={units}
        known={known.departments ?? []}
      />
      <Badges value={form.badges} onChange={set('badges')} errors={errors} badges={badges} known={known.badges ?? []} />
      <ChoiceCards
        path="eligibility.approvalMode"
        legend="Approval"
        options={APPROVAL_OPTIONS}
        value={form.approvalMode}
        onChange={set('approvalMode')}
        error={errors['eligibility.approvalMode']}
      />
    </FormSection>
  );
}
