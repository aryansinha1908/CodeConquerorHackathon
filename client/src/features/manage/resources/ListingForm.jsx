import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { History, RotateCcw } from 'lucide-react';
import { useAuthStore } from '../../../stores/auth';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { formatIstDateTime } from '../../../lib/time';
import { useOrgUnits } from '../../resources/api';
import { LiveRegion } from '../components/Bits';
import { useBadgeCatalogue, useCreateResource, useUpdateResource } from './api';
import { AvailabilitySection } from './AvailabilitySection';
import { BasicsSection } from './BasicsSection';
import { ChecklistSection } from './ChecklistSection';
import { EligibilitySection } from './EligibilitySection';
import { ErrorSummary } from './ErrorSummary';
import { focusById } from './focus';
import { LimitsSection } from './LimitsSection';
import {
  SECTIONS,
  changedSections,
  createBody,
  emptyForm,
  errorCounts,
  errorSummary,
  formFromResource,
  formValues,
  listingErrorsFrom,
  patchBody,
  previewResource,
  problemsText,
  sectionOf,
  sectionSnapshots,
  unitChoices,
  validateListing,
} from './listingForm';
import { PreviewSection } from './PreviewSection';
import { SmallButton } from './FormBits';

// The listing form of /manage/resources/new and /manage/resources/:id/edit (frontend.md §6.3, F-10;
// judge step 1). One page of sections: Basics, Availability, Eligibility, Limits, Condition
// checklist, Preview. The client checks the rules of §9 and api.md (listingForm.js) on submit and
// then as the manager fixes them; the server's 400 details land on the same fields because both use
// the server's paths. A new listing is POSTed whole; an edit PATCHes only what changed.

const sectionTitle = (id) => SECTIONS.find((section) => section.id === id)?.title ?? id;
const listText = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// Whether a failure is the form's to show beside its fields (400 with details).
const hasFieldDetails = (err) => err?.code === 'VALIDATION_ERROR' && Array.isArray(err.details) && err.details.length > 0;

function SectionNav({ counts, changed }) {
  return (
    <nav aria-label="Form sections" className="flex flex-wrap gap-2">
      {[...SECTIONS, { id: 'preview', title: 'Preview' }].map((section) => {
        const count = counts[section.id] ?? 0;
        return (
          <a
            key={section.id}
            href={`#section-${section.id}`}
            onClick={(event) => {
              if (focusById(`section-${section.id}-heading`)) event.preventDefault();
            }}
            className="inline-flex items-center gap-1.5 px-3 min-h-[36px] text-xs font-bold rounded-md border-2 border-[#1a1a1a]/30 bg-white hover:border-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
          >
            {section.title}
            {count > 0 && (
              <span className="text-[#a93226]">
                · {problemsText(count)}
              </span>
            )}
            {changed.includes(section.id) && <span className="sr-only"> (changed)</span>}
            {changed.includes(section.id) && (
              <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#e67e22]" />
            )}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The form itself. `resource` is the Detail being edited (edit only): the form starts from it
 * once, so a background refetch never overwrites what the manager typed; a newer version is
 * reported instead, with `onReload` to start again from it.
 */
export function ListingForm({ mode = 'new', resource = null, onReload }) {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const summaryRef = useRef(null);
  const requestErrorRef = useRef(null);
  const barRef = useRef(null);

  const unitsQuery = useOrgUnits();
  const badgesQuery = useBadgeCatalogue();
  const unitList = useMemo(() => (Array.isArray(unitsQuery.data?.data) ? unitsQuery.data.data : []), [unitsQuery.data]);
  const badgeList = Array.isArray(badgesQuery.data?.data) ? badgesQuery.data.data : [];
  const choices = useMemo(() => unitChoices(unitList, user), [unitList, user]);

  const [initial] = useState(() => {
    const form = mode === 'edit' ? formFromResource(resource) : emptyForm();
    return { form, values: formValues(form), updatedAt: resource?.updatedAt ?? null };
  });
  const [form, setForm] = useState(initial.form);
  const [submitted, setSubmitted] = useState(false);
  const [server, setServer] = useState(null); // { fields, other, snapshots } of the last 400
  const [uploading, setUploading] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [focusSeq, setFocusSeq] = useState(null); // { target: 'summary' | 'request', n }

  const create = useCreateResource();
  const save = useUpdateResource();
  const mutation = mode === 'edit' ? save : create;
  const busy = mutation.isPending || mutation.isSuccess;

  // A manager of a single unit lists for it without choosing.
  const unitValue =
    mode === 'new' ? form.orgUnit || (choices.length === 1 ? String(choices[0]._id) : '') : form.orgUnit;
  const values = useMemo(() => formValues({ ...form, orgUnit: unitValue }), [form, unitValue]);
  const patch = useMemo(() => patchBody(initial.values, values), [initial.values, values]);
  const changed = mode === 'edit' ? changedSections(patch) : [];
  // The unit counts only when chosen: the one a single-unit manager gets by default isn't a change.
  const dirty = Object.keys(patch).length > 0 || form.orgUnit !== initial.form.orgUnit;

  // Errors: the client's (once a submit was tried) over the server's, which stay until their
  // section changes.
  const snapshots = sectionSnapshots(values);
  const clientErrors = submitted ? validateListing(values, { mode }) : {};
  const serverFields = server
    ? Object.fromEntries(
        Object.entries(server.fields).filter(([path]) => {
          const section = sectionOf(path);
          return section && server.snapshots[section] === snapshots[section];
        })
      )
    : {};
  const serverOther =
    server && JSON.stringify(server.snapshots) === JSON.stringify(snapshots) ? server.other : [];
  const errors = { ...serverFields, ...clientErrors };
  const summary = errorSummary(errors, values);
  const counts = errorCounts(errors);
  const requestError = mutation.error && !hasFieldDetails(mutation.error) ? mutation.error : null;

  useEffect(() => {
    if (!focusSeq) return;
    const target = focusSeq.target === 'summary' ? summaryRef.current : requestErrorRef.current;
    target?.focus();
    target?.scrollIntoView?.({ block: 'start' });
  }, [focusSeq]);

  // From sm up the action bar sticks to the bottom of the screen. The browser doesn't scroll a
  // control that takes focus while it is in the viewport but under the bar, so the page keeps the
  // bar's height as scroll padding: focused controls land above it (WCAG 2.4.11). Below sm the bar
  // isn't sticky (it would cover a third of a phone) and the padding is dropped.
  useEffect(() => {
    const bar = barRef.current;
    const html = globalThis.document?.documentElement;
    if (!bar || !html || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => {
      const sticky = getComputedStyle(bar).position === 'sticky';
      html.style.scrollPaddingBottom = sticky ? `${Math.ceil(bar.getBoundingClientRect().height) + 16}px` : '';
    };
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    apply();
    return () => {
      observer.disconnect();
      html.style.scrollPaddingBottom = '';
    };
  }, []);

  // Typed work isn't lost to a closed tab or a reload by accident.
  useEffect(() => {
    if (!dirty || mutation.isSuccess) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, mutation.isSuccess]);

  const update = (change) => {
    if (busy) return;
    setForm((current) => change(current));
  };

  const focusLater = (target) => setFocusSeq((current) => ({ target, n: (current?.n ?? 0) + 1 }));

  const finish = (detail) => {
    const title = detail?.title ?? values.title;
    const message =
      mode === 'new'
        ? `${title} is listed and open for booking. Members can find it in Explore.`
        : `Saved ${title}: ${listText(changed.map(sectionTitle).map((t) => t.toLowerCase()))} updated.`;
    toast.success(message);
    navigate('/manage/resources', {
      state: { notice: message, resourceId: detail?._id ? String(detail._id) : null },
    });
  };

  const failed = (err) => {
    const mapped = listingErrorsFrom(err);
    if (Object.keys(mapped.fields).length || mapped.other.length) {
      setServer({ ...mapped, snapshots: sectionSnapshots(values) });
      focusLater('summary');
    } else {
      focusLater('request');
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    if (uploading) {
      setAnnouncement('Wait for the photos to finish uploading, then save.');
      return;
    }
    setSubmitted(true);
    setServer(null);
    mutation.reset();
    const found = validateListing(values, { mode });
    if (Object.keys(found).length) {
      setAnnouncement('');
      focusLater('summary');
      return;
    }
    if (mode === 'edit') {
      if (!Object.keys(patch).length) {
        setAnnouncement('Nothing has changed yet, so there is nothing to save.');
        return;
      }
      save.mutate({ id: String(resource._id), patch }, { onSuccess: (res) => finish(res?.data), onError: failed });
    } else {
      create.mutate(createBody(values), { onSuccess: (res) => finish(res?.data), onError: failed });
    }
  };

  const unitState = {
    choices,
    loading: unitsQuery.isPending,
    error: unitsQuery.isError && !unitsQuery.data ? unitsQuery.error : null,
    retry: () => unitsQuery.refetch(),
    retrying: unitsQuery.isFetching,
  };
  const known = {
    departments: Array.isArray(resource?.eligibility?.departments) ? resource.eligibility.departments : [],
    badges: Array.isArray(resource?.eligibility?.badges) ? resource.eligibility.badges : [],
  };
  const preview = previewResource(values, {
    unit:
      mode === 'edit'
        ? resource?.orgUnit ?? null
        : choices.find((unit) => String(unit._id) === unitValue) ?? null,
    departments: [...unitList, ...known.departments],
    badges: [...badgeList, ...known.badges],
  });

  const changedMeanwhile =
    mode === 'edit' &&
    !busy &&
    Boolean(initial.updatedAt && resource?.updatedAt && resource.updatedAt !== initial.updatedAt);
  const action = mode === 'edit' ? 'saving' : 'publishing';
  const nothingToSave = mode === 'edit' && !Object.keys(patch).length;

  return (
    <form onSubmit={submit} noValidate aria-label={mode === 'edit' ? 'Edit the listing' : 'New listing'} className="space-y-6">
      <SectionNav counts={counts} changed={changed} />

      {changedMeanwhile && (
        <div role="status" className="p-4 rounded-lg border-2 border-[#e67e22] bg-[#fef9f3] text-sm space-y-2">
          <p className="font-bold flex items-start gap-2">
            <History className="w-5 h-5 shrink-0" aria-hidden="true" />
            Someone saved this listing at {formatIstDateTime(resource.updatedAt)} since you opened it.
          </p>
          <p className="text-xs">
            Saving sends only the sections you changed, so theirs keep the new values. To see their
            version first, start again from it.
          </p>
          <SmallButton onClick={() => onReload?.()}>
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Discard my changes and load their version
          </SmallButton>
        </div>
      )}

      {submitted && <ErrorSummary ref={summaryRef} items={summary} other={serverOther} action={action} />}

      <BasicsSection
        mode={mode}
        form={form}
        update={update}
        errors={errors}
        errorCount={counts.basics ?? 0}
        resource={resource}
        unitValue={unitValue}
        units={unitState}
        changed={changed.includes('basics')}
        onUploadBusy={setUploading}
      />
      <AvailabilitySection
        form={form}
        update={update}
        errors={errors}
        errorCount={counts.availability ?? 0}
        changed={changed.includes('availability')}
      />
      <EligibilitySection
        form={form}
        update={update}
        errors={errors}
        errorCount={counts.eligibility ?? 0}
        changed={changed.includes('eligibility')}
        units={{ ...unitState, list: unitList }}
        badges={{
          list: badgeList,
          loading: badgesQuery.isPending,
          error: badgesQuery.isError && !badgesQuery.data ? badgesQuery.error : null,
          retry: () => badgesQuery.refetch(),
          retrying: badgesQuery.isFetching,
        }}
        known={known}
      />
      <LimitsSection
        form={form}
        update={update}
        errors={errors}
        errorCount={counts.limits ?? 0}
        changed={changed.includes('limits')}
      />
      <ChecklistSection
        form={form}
        update={update}
        errors={errors}
        errorCount={counts.checklist ?? 0}
        changed={changed.includes('checklist')}
      />
      <PreviewSection preview={preview} />

      <div ref={barRef} className="sm:sticky sm:bottom-0 z-10 -mx-1 px-1 pb-1">
        <div className="rounded-xl border-2 border-[#1a1a1a] bg-[#ede8df] p-4 shadow-[3px_3px_0_#1a1a1a] space-y-3">
          {requestError && (
            <div ref={requestErrorRef} tabIndex={-1} className="focus:outline-none">
              <ErrorState
                error={requestError}
                title={mode === 'edit' ? "The changes weren't saved" : "The resource wasn't listed"}
              >
                {requestError.status === 403
                  ? 'Only managers of the unit (or an admin) can do this, and not while suspended.'
                  : requestError.status === 404
                    ? 'It may have been archived or removed. Go back to the list to see it as it is.'
                    : 'Nothing was saved. You can try again.'}
              </ErrorState>
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs" aria-live="polite">
              {uploading
                ? 'Uploading photos… Save once they are done.'
                : mode === 'edit'
                  ? changed.length
                    ? `Changed: ${listText(changed.map(sectionTitle))}. Only these are sent.`
                    : 'No changes yet.'
                  : summary.length && submitted
                    ? `${problemsText(summary.length + serverOther.length)} to fix.`
                    : 'Publishing lists it as active: members can book it straight away.'}
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              {mode === 'edit' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  aria-disabled={!dirty || busy || undefined}
                  onClick={() => {
                    if (!dirty || busy) return;
                    setForm(initial.form);
                    setServer(null);
                    setSubmitted(false);
                    setAnnouncement('Your changes were undone.');
                  }}
                >
                  Undo changes
                </Button>
              )}
              <Link
                to="/manage/resources"
                className="inline-flex items-center justify-center px-5 min-h-[44px] rounded-md text-sm font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
              >
                Cancel
              </Link>
              <Button
                type="submit"
                variant={mode === 'edit' ? 'forest' : 'primary'}
                size="lg"
                loading={busy}
                aria-disabled={(!busy && (uploading || nothingToSave)) || undefined}
              >
                {mode === 'edit'
                  ? mutation.isPending
                    ? 'Saving…'
                    : 'Save changes'
                  : mutation.isPending
                    ? 'Publishing…'
                    : 'Publish listing'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <LiveRegion>{announcement}</LiveRegion>
    </form>
  );
}
