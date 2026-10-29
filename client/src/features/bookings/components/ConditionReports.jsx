import React from 'react';
import { CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { formatIstShortDateTime } from '../../../lib/time';
import { PHASE_LABELS } from './bookingView';

// The condition reports of a booking (kind "condition_report" in GET /bookings/:id/timeline:
// { phase, overall, items: [{ label, ok, note? }], photos: [{ url, publicId }], notes, by, at }),
// side by side so check-in and check-out can be compared at a glance.

const OVERALL = {
  good: { variant: 'green', label: 'Good condition' },
  minor_issue: { variant: 'amber', label: 'Minor issue' },
  damaged: { variant: 'red', label: 'Damaged' },
};

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** Photo thumbnails that open the full image; alt "Check-in photo 1 of 2, FDM 3D Printer #2". */
export function ReportPhotos({ photos, phaseLabel, subject, className = 'grid grid-cols-3 gap-2 max-w-sm' }) {
  const list = Array.isArray(photos) ? photos.filter((photo) => photo && typeof photo === 'object') : [];
  if (!list.length) return null;
  return (
    <ul className={className} aria-label={`${phaseLabel} photos`}>
      {list.map((photo, index) => {
        const alt = `${phaseLabel} photo ${index + 1} of ${list.length}${subject ? `, ${subject}` : ''}`;
        return (
          <li key={asText(photo.publicId) || index}>
            <a
              href={asText(photo.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md border-2 border-[#1a1a1a] overflow-hidden bg-[#f5f0e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
            >
              <img src={asText(photo.url)} alt={alt} loading="lazy" className="block w-full aspect-square object-cover" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** A checklist answer list: an icon and "OK" / "Not OK" for a screen reader, the note after a dash. */
export function ReportItems({ items }) {
  const list = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
  if (!list.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {list.map((item, index) => (
        <li key={`${asText(item.label)}-${index}`} className="flex gap-2">
          {item.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1e7e45]" aria-hidden="true" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 text-[#c0392b]" aria-hidden="true" />
          )}
          <span className="break-words">
            <span className="sr-only">{item.ok ? 'OK: ' : 'Not OK: '}</span>
            {asText(item.label)}
            {item.note && <span className="text-[#1a1a1a]/70"> — {asText(item.note)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReportCard({ report, subject }) {
  const phase = PHASE_LABELS[report.phase] ?? 'Condition';
  const overall = OVERALL[report.overall];
  const when = formatIstShortDateTime(report.at);
  const items = Array.isArray(report.items) ? report.items : [];
  const flagged = items.filter((item) => item && !item.ok).length;
  return (
    <li className="rounded-xl border-2 border-[#1a1a1a] bg-white p-4 shadow-[3px_3px_0_#1a1a1a] space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
            {phase}
          </h3>
          <p className="text-xs text-[#1a1a1a]/70">
            {when && <time dateTime={asText(report.at)}>{when} IST</time>}
            {report.by && <span> · by {asText(report.by)}</span>}
          </p>
        </div>
        {overall && (
          <Badge variant={overall.variant} size="sm">
            {overall.label}
          </Badge>
        )}
      </div>
      {items.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-bold">
            Checklist: {items.length} {items.length === 1 ? 'item' : 'items'}
            {flagged ? `, ${flagged} not OK` : ', all OK'}
          </p>
          <ReportItems items={items} />
        </div>
      )}
      {report.notes && (
        <p className="text-xs bg-[#f5f0e8] border-l-4 border-[#1a1a1a] px-3 py-2 rounded-r-md break-words">
          <span className="font-bold">Notes: </span>“{asText(report.notes)}”
        </p>
      )}
      <ReportPhotos photos={report.photos} phaseLabel={phase} subject={subject} />
    </li>
  );
}

/** Every condition report in the timeline items, oldest first; nothing when there are none. */
export function ConditionReports({ items, subject }) {
  const reports = (Array.isArray(items) ? items : []).filter(
    (item) => item && typeof item === 'object' && item.kind === 'condition_report'
  );
  if (!reports.length) return null;
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {reports.map((report, index) => (
        <ReportCard key={`${asText(report.phase)}-${index}`} report={report} subject={subject} />
      ))}
    </ul>
  );
}
