import { STATUS_REASON_MAX } from './api';

// The status action of /manage/resources (api.md PATCH /resources/:id/status): what each change
// asks for and what the page says after it. A reason is required to take a resource out of service
// (maintenance or archived) and optional to bring it back; nothing is cancelled either way, so the
// answer's affectedBookings is shown for the manager to follow up.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** The three toggles, in order. */
export const STATUS_CHOICES = [
  { value: 'active', label: 'Active' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'archived', label: 'Archived' },
];

/** The ReasonDialog of each target status. */
export const STATUS_DIALOGS = {
  active: {
    title: (title) => `Reopen ${title} for booking`,
    description: 'Members can find and book it again straight away.',
    label: 'Note for the audit log',
    hint: `Optional, at most ${STATUS_REASON_MAX} characters.`,
    required: false,
    templates: [],
    submitLabel: 'Reopen for booking',
    pendingLabel: 'Reopening…',
    variant: 'forest',
  },
  maintenance: {
    title: (title) => `Put ${title} under maintenance`,
    description:
      "Members still see it but can't book it until it is active again. Bookings already made are not cancelled: you'll see how many are affected.",
    label: 'Reason',
    hint: `Required, 10–${STATUS_REASON_MAX} characters. Members and the audit log see it.`,
    required: true,
    templates: [
      'Scheduled servicing this week.',
      'Waiting for a replacement part.',
      'Calibration in progress.',
      'Being cleaned after a spill.',
    ],
    submitLabel: 'Put under maintenance',
    pendingLabel: 'Saving…',
    variant: 'primary',
  },
  archived: {
    title: (title) => `Archive ${title}`,
    description:
      "It leaves Explore, and members can't open it any more. Your unit's managers can still open and restore it. Bookings already made are not cancelled.",
    label: 'Reason',
    hint: `Required, 10–${STATUS_REASON_MAX} characters. The audit log keeps it.`,
    required: true,
    templates: ['Retired: replaced by a newer model.', 'No longer offered by the unit.', 'Moved to another lab.'],
    submitLabel: 'Archive it',
    pendingLabel: 'Archiving…',
    variant: 'danger',
  },
};

/** Whether a change from `from` to `to` needs the dialog at all (the current status is a no-op). */
export function isStatusChange(from, to) {
  return STATUS_CHOICES.some((choice) => choice.value === to) && from !== to;
}

/**
 * The page's notice after a change, from the answer { resource, affectedBookings }:
 * { tone: 'success' | 'warning', text, followUp } where followUp says to review the affected
 * bookings (pending, approved or in use, not ended yet) when the resource left service with some.
 */
export function statusChangeNotice({ title, status, affectedBookings }) {
  const name = asText(title) || 'The resource';
  const n = Math.max(0, Math.round(Number(affectedBookings) || 0));
  const bookings = `${plural(n, 'booking')} that ${n === 1 ? "hasn't" : "haven't"} ended`;
  if (status === 'active') {
    return {
      tone: 'success',
      text: `${name} is open for booking again.${n ? ` ${bookings} still ${n === 1 ? 'holds its slot' : 'hold their slots'}.` : ''}`,
      followUp: false,
    };
  }
  const what =
    status === 'archived' ? `${name} is archived and hidden from members.` : `${name} is under maintenance: members can't book it.`;
  if (!n) return { tone: 'success', text: `${what} No upcoming bookings are affected.`, followUp: false };
  return {
    tone: 'warning',
    text: `${what} ${bookings} ${n === 1 ? 'is' : 'are'} affected (pending, approved or in use). Nothing was cancelled: review ${
      n === 1 ? 'it' : 'them'
    } and let the borrowers know.`,
    followUp: true,
  };
}

/** The variables of the status mutation: the reason trimmed, left out when blank. */
export function statusVars(resource, status, reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  return { id: String(resource?._id ?? ''), status, ...(text && { reason: text }) };
}
