import { fieldErrorsFrom } from '../../../lib/errors';
import { CONDITION_OVERALL, ITEM_NOTE_MAX, REPORT_NOTES_MAX } from '../api';

// The check-in / check-out wizard as pure state (frontend.md §6.2: ① checklist ② photos ③ overall
// condition and notes). The page keeps it in useReducer; the tests drive it directly. The body it
// produces is the one api.md defines for POST /bookings/:id/check-in and /check-out:
// { items: [{ label, ok, note? }] (every checklist label once), overall, notes?, photos? }.

export const HANDOVER_STEPS = [
  { step: 1, id: 'checklist', label: 'Checklist' },
  { step: 2, id: 'photos', label: 'Photos' },
  { step: 3, id: 'confirm', label: 'Condition' },
];
export const LAST_STEP = HANDOVER_STEPS.length;

const OVERALL_VALUES = CONDITION_OVERALL.map((option) => option.value);

/** The resource's checklist labels from GET /bookings/:id (resource.checklist), in order. */
export function checklistOf(booking) {
  const list = booking?.resource && typeof booking.resource === 'object' ? booking.resource.checklist : null;
  return Array.isArray(list) ? list.filter((label) => typeof label === 'string' && label.trim()) : [];
}

export function initialHandover() {
  return {
    step: 1,
    answers: {}, // label → { ok: true | false, note }
    photos: [],
    overall: '',
    notes: '',
    errors: {}, // field path (as the server names it) → message
    itemsErrors: [], // messages on `items` itself: "Missing: …", "Not on this resource's checklist: …"
    focus: null, // { target: 'step' | <field path>, seq }: where focus goes after the next render
  };
}

const length = (value) => (typeof value === 'string' ? value.trim().length : 0);
const tooLong = (max, now) => `Use at most ${max} characters (now ${now}).`;

/**
 * Step ① → { 'items.<i>.ok' | 'items.<i>.note': message }: every item answered, a note on each one
 * marked Not OK (frontend.md §9, as the manager's return check asks), notes ≤ 200.
 */
export function validateChecklist(checklist, answers = {}) {
  const errors = {};
  checklist.forEach((label, index) => {
    const answer = answers[label];
    if (answer?.ok !== true && answer?.ok !== false) {
      errors[`items.${index}.ok`] = 'Choose OK or Not OK.';
    }
    const noteLength = length(answer?.note);
    if (answer?.ok === false && noteLength === 0) errors[`items.${index}.note`] = "Say what's wrong with it.";
    else if (noteLength > ITEM_NOTE_MAX) errors[`items.${index}.note`] = tooLong(ITEM_NOTE_MAX, noteLength);
  });
  return errors;
}

/** Step ③ → { overall?, notes? }: an overall condition chosen, notes ≤ 1000. */
export function validateCondition({ overall, notes } = {}) {
  const errors = {};
  if (!OVERALL_VALUES.includes(overall)) errors.overall = 'Choose the overall condition.';
  const notesLength = length(notes);
  if (notesLength > REPORT_NOTES_MAX) errors.notes = tooLong(REPORT_NOTES_MAX, notesLength);
  return errors;
}

/** The step a field path belongs to: items → 1, photos → 2, overall and notes → 3, else null. */
export function stepOfPath(path) {
  if (typeof path !== 'string') return null;
  if (path === 'items' || path.startsWith('items.')) return 1;
  if (path === 'photos' || path.startsWith('photos.')) return 2;
  if (path === 'overall' || path === 'notes') return 3;
  return null;
}

function validateStep(state, checklist, step) {
  if (step === 1) return validateChecklist(checklist, state.answers);
  if (step === 3) return validateCondition(state);
  return {};
}

/** Every step's local errors, in step order. */
export function validateAll(state, checklist) {
  return { ...validateChecklist(checklist, state.answers), ...validateCondition(state) };
}

/**
 * A refused submit → { fields, items }: the VALIDATION_ERROR details this wizard can show beside a
 * field (items.<i>…, photos…, overall, notes), and every message on `items` itself. Anything else
 * (409 check-in window, 403, 503, a network failure) has no fields and shows above the button.
 */
export function serverErrors(err) {
  const all = fieldErrorsFrom(err);
  const fields = {};
  for (const [path, message] of Object.entries(all)) {
    if (path !== 'items' && stepOfPath(path)) fields[path] = message;
  }
  const items =
    err?.code === 'VALIDATION_ERROR' && Array.isArray(err.details)
      ? err.details.filter((d) => d?.path === 'items').map((d) => String(d.message ?? 'Invalid value.'))
      : [];
  return { fields, items };
}

/** Whether a refused submit was about the form's fields (else it is shown as a request error). */
export function hasFieldErrors(err) {
  const { fields, items } = serverErrors(err);
  return items.length > 0 || Object.keys(fields).length > 0;
}

// The earliest step with an error, and the first path on it (items in checklist order).
function firstError(errors, itemsErrors = []) {
  const paths = Object.keys(errors).filter((path) => stepOfPath(path));
  const ordered = paths.sort((a, b) => {
    const step = stepOfPath(a) - stepOfPath(b);
    if (step) return step;
    const index = (path) => Number(/^\w+\.(\d+)/.exec(path)?.[1] ?? -1);
    return index(a) - index(b);
  });
  if (itemsErrors.length) return { step: 1, target: 'step' };
  if (!ordered.length) return null;
  const path = ordered[0];
  return { step: stepOfPath(path), target: stepOfPath(path) === 2 ? 'step' : path };
}

const focusOn = (state, target) => ({ target, seq: (state.focus?.seq ?? 0) + 1 });

function withoutError(errors, path) {
  if (!(path in errors)) return errors;
  const next = { ...errors };
  delete next[path];
  return next;
}

/**
 * The wizard's reducer. Actions: answer { index, label, ok }, note { index, label, note }, photos
 * { photos }, overall { value }, notes { value }, next { checklist }, back, invalid { errors },
 * serverError { error }.
 */
export function handoverReducer(state, action) {
  switch (action.type) {
    case 'answer': {
      const current = state.answers[action.label] ?? {};
      const answered = withoutError(state.errors, `items.${action.index}.ok`);
      return {
        ...state,
        answers: { ...state.answers, [action.label]: { ...current, ok: Boolean(action.ok) } },
        // An item marked OK again no longer needs its note (Next checks the length again).
        errors: action.ok ? withoutError(answered, `items.${action.index}.note`) : answered,
        itemsErrors: [],
      };
    }
    case 'note': {
      const current = state.answers[action.label] ?? {};
      return {
        ...state,
        answers: { ...state.answers, [action.label]: { ...current, note: String(action.note ?? '') } },
        errors: withoutError(state.errors, `items.${action.index}.note`),
      };
    }
    case 'photos': {
      const errors = Object.fromEntries(
        Object.entries(state.errors).filter(([path]) => stepOfPath(path) !== 2)
      );
      return { ...state, photos: Array.isArray(action.photos) ? action.photos : [], errors };
    }
    case 'overall':
      return { ...state, overall: action.value, errors: withoutError(state.errors, 'overall') };
    case 'notes':
      return { ...state, notes: String(action.value ?? ''), errors: withoutError(state.errors, 'notes') };
    case 'next': {
      const errors = validateStep(state, action.checklist ?? [], state.step);
      const first = firstError(errors);
      if (first) return { ...state, errors: { ...state.errors, ...errors }, focus: focusOn(state, first.target) };
      if (state.step >= LAST_STEP) return state;
      return { ...state, step: state.step + 1, focus: focusOn(state, 'step') };
    }
    case 'back':
      if (state.step <= 1) return state;
      return { ...state, step: state.step - 1, focus: focusOn(state, 'step') };
    case 'invalid':
    case 'serverError': {
      const { fields, items } =
        action.type === 'invalid' ? { fields: action.errors ?? {}, items: [] } : serverErrors(action.error);
      const first = firstError(fields, items);
      if (!first) return state;
      return {
        ...state,
        step: first.step,
        errors: { ...state.errors, ...fields },
        itemsErrors: items,
        focus: focusOn(state, first.target),
      };
    }
    default:
      return state;
  }
}

/**
 * The wizard's state → the variables of useCheckIn / useCheckOut (without id): every checklist
 * label in order with its answer; buildReportBody (api.js) trims the notes and leaves out blanks.
 */
export function reportFor(state, checklist) {
  return {
    items: checklist.map((label) => ({
      label,
      ok: state.answers[label]?.ok === true,
      note: state.answers[label]?.note ?? '',
    })),
    overall: state.overall,
    notes: state.notes,
    photos: state.photos,
  };
}

/** { total, answered, notOk } for the summary on step ③. */
export function checklistSummary(checklist, answers = {}) {
  let answered = 0;
  let notOk = 0;
  for (const label of checklist) {
    const ok = answers[label]?.ok;
    if (ok === true || ok === false) answered += 1;
    if (ok === false) notOk += 1;
  }
  return { total: checklist.length, answered, notOk };
}

/** A condition report's items ([{ label, ok, note? }]) → label → { ok, note }, for the reference. */
export function itemsByLabel(report) {
  const map = {};
  for (const item of Array.isArray(report?.items) ? report.items : []) {
    if (item && typeof item.label === 'string') {
      map[item.label] = { ok: Boolean(item.ok), note: typeof item.note === 'string' ? item.note : '' };
    }
  }
  return map;
}

/** A field path → the id of the control that should take focus (null: the step heading). */
export function fieldDomId(prefix, path) {
  const item = /^items\.(\d+)(?:\.(ok|note))?$/.exec(path ?? '');
  if (item) return `${prefix}-items-${item[1]}-${item[2] === 'note' ? 'note' : 'ok'}`;
  if (path === 'overall') return `${prefix}-overall-${OVERALL_VALUES[0]}`;
  if (path === 'notes') return `${prefix}-notes`;
  return null;
}
