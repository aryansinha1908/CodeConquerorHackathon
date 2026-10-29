import React from 'react';
import { Building2 } from 'lucide-react';
import { PhotoUploader } from '../../../components/PhotoUploader';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { ChoiceCards, FieldError, FormSection, TextAreaField, TextField } from './FormBits';
import {
  BOOKING_MODE_OPTIONS,
  CATEGORY_OPTIONS,
  DESCRIPTION_MAX,
  IMAGES_MAX,
  LOCATION_MAX,
  QUANTITY_MAX,
  QUANTITY_MIN,
  RISK_OPTIONS,
  TITLE_MAX,
  TITLE_MIN,
  USAGE_RULES_MAX,
  fieldDomId,
  unitName,
} from './listingForm';
import { hintClass, inputClass, labelClass } from './styles';

// Basics (frontend.md §6.3): the unit (only units the user manages; fixed once listed), title,
// category, description, usage rules, booking mode, quantity, risk level, location and photos.
// Photos go up through PhotoUploader (POST /uploads/images, at most 3 per upload) and are kept as
// { url, publicId }; a listing holds up to 5.

function UnitField({ mode, resource, unitValue, units, onChange, error }) {
  const id = fieldDomId('orgUnit');
  const errorId = error ? `${id}-error` : null;

  if (mode === 'edit') {
    return (
      <div className="space-y-1">
        <p className={labelClass}>Unit</p>
        <p className="flex items-start gap-2 text-sm">
          <Building2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-bold">{unitName(resource?.orgUnit)}</span>
            <span className={`block ${hintClass}`}>A resource stays with the unit that listed it.</span>
          </span>
        </p>
      </div>
    );
  }
  if (units.loading) {
    return (
      <div aria-busy="true" className="space-y-1">
        <span className="sr-only">Loading your units…</span>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-11 w-full max-w-md" />
      </div>
    );
  }
  if (units.error) {
    return (
      <ErrorState
        error={units.error}
        title="Couldn't load your units"
        onRetry={units.retry}
        retrying={units.retrying}
      />
    );
  }
  if (units.choices.length === 1) {
    return (
      <div id={id} tabIndex={-1} className="space-y-1 focus:outline-none">
        <p className={labelClass}>Unit</p>
        <p className="flex items-start gap-2 text-sm">
          <Building2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-bold">{unitName(units.choices[0])}</span>
            <span className={`block ${hintClass}`}>The unit you manage. It can't change once listed.</span>
          </span>
        </p>
        <FieldError id={errorId} message={error} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 max-w-md">
      <label htmlFor={id} className={labelClass}>
        Unit
      </label>
      <select
        id={id}
        value={unitValue}
        onChange={(event) => onChange(event.target.value)}
        aria-required="true"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[`${id}-hint`, errorId].filter(Boolean).join(' ')}
        className={inputClass(error)}
      >
        <option value="">Choose a unit…</option>
        {units.choices.map((unit) => (
          <option key={unit._id} value={String(unit._id)}>
            {unitName(unit)}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className={hintClass}>
        Only the units you manage are listed. It can&apos;t change once listed.
      </p>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function BasicsSection({
  mode,
  form,
  update,
  errors,
  errorCount,
  resource,
  unitValue,
  units,
  changed,
  onUploadBusy,
}) {
  const set = (field) => (value) => update((f) => ({ ...f, [field]: value }));
  const setLocation = (key) => (value) => update((f) => ({ ...f, location: { ...f.location, [key]: value } }));
  const imageError =
    errors.images ??
    Object.entries(errors)
      .filter(([path]) => /^images\.\d+$/.test(path))
      .map(([path, message]) => `Photo ${Number(path.split('.')[1]) + 1}: ${message}`)[0];

  return (
    <FormSection
      id="section-basics"
      title="Basics"
      description="What it is, who lists it and where to find it. Members see all of this on the listing."
      errorCount={errorCount}
      changed={changed}
    >
      <UnitField
        mode={mode}
        resource={resource}
        unitValue={unitValue}
        units={units}
        onChange={set('orgUnit')}
        error={errors.orgUnit}
      />

      <TextField
        path="title"
        label="Title"
        required
        value={form.title}
        onChange={set('title')}
        maxLength={TITLE_MAX}
        autoComplete="off"
        hint={`${TITLE_MIN}–${TITLE_MAX} characters, e.g. "FDM 3D Printer #2".`}
        error={errors.title}
      />

      <div className="flex flex-col gap-1 max-w-md">
        <label htmlFor={fieldDomId('category')} className={labelClass}>
          Category
        </label>
        <select
          id={fieldDomId('category')}
          value={form.category}
          onChange={(event) => set('category')(event.target.value)}
          aria-required="true"
          aria-invalid={errors.category ? 'true' : undefined}
          aria-describedby={errors.category ? `${fieldDomId('category')}-error` : undefined}
          className={inputClass(errors.category)}
        >
          <option value="">Choose a category…</option>
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}: {option.description}
            </option>
          ))}
        </select>
        <FieldError id={`${fieldDomId('category')}-error`} message={errors.category} />
      </div>

      <TextAreaField
        path="description"
        label="Description"
        value={form.description}
        onChange={set('description')}
        maxLength={DESCRIPTION_MAX}
        hint="What it does and what to bring. Searched by Explore."
        error={errors.description}
      />

      <TextAreaField
        path="usageRules"
        label="Usage rules"
        value={form.usageRules}
        onChange={set('usageRules')}
        maxLength={USAGE_RULES_MAX}
        rows={3}
        hint="Shown on the listing before members book, e.g. which materials are allowed."
        error={errors.usageRules}
      />

      <ChoiceCards
        path="bookingMode"
        legend="Booking mode"
        options={BOOKING_MODE_OPTIONS}
        value={form.bookingMode}
        onChange={set('bookingMode')}
        error={errors.bookingMode}
      />

      <TextField
        path="quantity"
        label="Quantity"
        required
        type="number"
        inputMode="numeric"
        min={QUANTITY_MIN}
        max={QUANTITY_MAX}
        step={1}
        value={form.quantity}
        onChange={set('quantity')}
        hint={`Identical units that can be booked at the same time (${QUANTITY_MIN}–${QUANTITY_MAX}).`}
        error={errors.quantity}
        className="max-w-[16rem]"
      />

      <ChoiceCards
        path="riskLevel"
        legend="Risk level"
        options={RISK_OPTIONS}
        value={form.riskLevel}
        onChange={set('riskLevel')}
        error={errors.riskLevel}
        columns={3}
      />

      <fieldset className="min-w-0 space-y-2">
        <legend className={labelClass}>Location</legend>
        <p className={hintClass}>All optional. Members read it as "Prototyping Lab, Design and Innovation Centre (Ground floor)".</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextField
            path="location.building"
            label="Building"
            value={form.location.building}
            onChange={setLocation('building')}
            maxLength={LOCATION_MAX.building}
            error={errors['location.building']}
          />
          <TextField
            path="location.room"
            label="Room"
            value={form.location.room}
            onChange={setLocation('room')}
            maxLength={LOCATION_MAX.room}
            error={errors['location.room']}
          />
          <TextField
            path="location.floor"
            label="Floor"
            value={form.location.floor}
            onChange={setLocation('floor')}
            maxLength={LOCATION_MAX.floor}
            placeholder="Ground"
            error={errors['location.floor']}
          />
        </div>
      </fieldset>

      <div id={fieldDomId('images')} tabIndex={-1} className="focus:outline-none">
        <PhotoUploader
          value={form.images}
          onChange={set('images')}
          max={IMAGES_MAX}
          label="Photos"
          hint={`Up to ${IMAGES_MAX} photos (JPG, PNG or WebP), at most 3 per upload. The first one leads the card in Explore.`}
          photoLabel="Listing photo"
          subject={form.title.trim() || undefined}
          error={imageError}
          onBusyChange={onUploadBusy}
        />
      </div>
    </FormSection>
  );
}
