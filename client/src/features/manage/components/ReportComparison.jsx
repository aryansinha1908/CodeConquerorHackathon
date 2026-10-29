import React from 'react';
import { CheckCircle2, ImageOff, XCircle } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { formatIstShortDateTime } from '../../../lib/time';
import { compareChecklists } from './manageView';

// The check-in and check-out condition reports of GET /bookings/:id/timeline (kind
// "condition_report": { at, phase, overall, items: [{ label, ok, note? }], photos: [{ url,
// publicId }], notes, by }) side by side: one table for the checklist, then each report's photos
// and notes in two columns (stacked on a phone).

const PHASE_LABELS = { check_in: 'Check-in', check_out: 'Check-out' };

const OVERALL_BADGES = {
  good: { variant: 'green', label: 'Good condition' },
  minor_issue: { variant: 'amber', label: 'Minor issue' },
  damaged: { variant: 'red', label: 'Damaged' },
};

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

function ItemCell({ entry }) {
  if (!entry) return <span className="text-[#1a1a1a]/70">Not recorded</span>;
  return (
    <span className="flex items-start gap-1.5">
      {entry.ok ? (
        <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1e7e45]" aria-hidden="true" />
      ) : (
        <XCircle className="w-4 h-4 shrink-0 text-[#c0392b]" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="font-bold">{entry.ok ? 'OK' : 'Not OK'}</span>
        {entry.note && <span className="block text-[#1a1a1a]/70 break-words">{entry.note}</span>}
      </span>
    </span>
  );
}

/** The resource checklist as answered at check-in and at check-out, one row per item. */
export function ChecklistComparison({ checklist, checkIn, checkOut }) {
  const rows = compareChecklists(checklist, checkIn, checkOut);
  if (!rows.length) {
    return <p className="text-xs text-[#1a1a1a]/70">This resource has no checklist.</p>;
  }
  const changed = rows.filter((row) => row.changed).length;
  return (
    <div className="space-y-2">
      {changed > 0 && (
        <p className="text-xs font-bold text-[#c0392b] flex items-center gap-1.5">
          <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          {changed === 1
            ? '1 item was OK at check-in and is not OK at check-out.'
            : `${changed} items were OK at check-in and are not OK at check-out.`}
        </p>
      )}
      {/* Scrolls on its own on a narrow phone instead of the page; focusable so a keyboard can scroll it. */}
      <div
        className="overflow-x-auto rounded-lg border-2 border-[#1a1a1a] bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
        role="region"
        aria-label="Checklist at check-in and at check-out"
        tabIndex={0}
      >
        <table className="w-full min-w-[300px] text-xs text-left border-collapse">
          <caption className="sr-only">
            Each checklist item as the borrower answered it at check-in and at check-out
          </caption>
          <thead className="bg-[#ede8df]">
            <tr>
              <th scope="col" className="px-3 py-2 font-bold border-b-2 border-[#1a1a1a]">
                Item
              </th>
              <th scope="col" className="px-3 py-2 font-bold border-b-2 border-[#1a1a1a]">
                At check-in
              </th>
              <th scope="col" className="px-3 py-2 font-bold border-b-2 border-[#1a1a1a]">
                At check-out
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className={`align-top border-b border-[#1a1a1a]/15 last:border-b-0 ${
                  row.changed ? 'bg-[#fff5f5]' : ''
                }`}
              >
                <th scope="row" className="px-3 py-2 font-bold break-words">
                  {row.label}
                  {row.changed && (
                    <Badge variant="red" size="sm" className="ml-1.5 mt-1">
                      Changed
                    </Badge>
                  )}
                </th>
                <td className="px-3 py-2">
                  <ItemCell entry={row.checkIn} />
                </td>
                <td className="px-3 py-2">
                  <ItemCell entry={row.checkOut} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One report's time, author, overall condition, notes and photos. */
export function ReportPanel({ phase, report, subject }) {
  const label = PHASE_LABELS[phase] ?? 'Condition';
  const headingId = `report-${phase}-heading`;
  const photos = Array.isArray(report?.photos)
    ? report.photos.filter((photo) => photo && typeof photo.url === 'string')
    : [];
  const overall = OVERALL_BADGES[report?.overall];
  const when = formatIstShortDateTime(report?.at);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border-2 border-[#1a1a1a] bg-white p-4 shadow-[3px_3px_0_#1a1a1a] space-y-3 min-w-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={headingId} className="text-sm font-black tracking-tight">
            {label}
          </h4>
          {report ? (
            <p className="text-xs text-[#1a1a1a]/70">
              {when ? <time dateTime={asText(report.at)}>{when} IST</time> : 'Time not recorded'}
              {report.by && <span> · by {asText(report.by)}</span>}
            </p>
          ) : (
            <p className="text-xs text-[#1a1a1a]/70">No {label.toLowerCase()} report was recorded.</p>
          )}
        </div>
        {overall && (
          <Badge variant={overall.variant} size="sm">
            {overall.label}
          </Badge>
        )}
      </div>

      {report?.notes && (
        <p className="text-xs bg-[#f5f0e8] border-l-4 border-[#1a1a1a] px-3 py-2 rounded-r-md break-words">
          <span className="font-bold">Notes: </span>“{asText(report.notes)}”
        </p>
      )}

      {report &&
        (photos.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2" aria-label={`${label} photos`}>
            {photos.map((photo, index) => {
              const alt = `${label} photo ${index + 1} of ${photos.length}${subject ? `, ${subject}` : ''}`;
              return (
                <li key={asText(photo.publicId) || index}>
                  <a
                    href={photo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md border-2 border-[#1a1a1a] overflow-hidden bg-[#f5f0e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
                  >
                    <img src={photo.url} alt={alt} loading="lazy" className="block w-full aspect-square object-cover" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-[#1a1a1a]/70 flex items-center gap-1.5">
            <ImageOff className="w-4 h-4 shrink-0" aria-hidden="true" />
            No photos with this report.
          </p>
        ))}
    </section>
  );
}

/** The checklist table, then the check-in and check-out panels side by side. */
export function ReportComparison({ checklist, checkIn, checkOut, subject }) {
  return (
    <div className="space-y-4">
      <ChecklistComparison checklist={checklist} checkIn={checkIn} checkOut={checkOut} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ReportPanel phase="check_in" report={checkIn} subject={subject} />
        <ReportPanel phase="check_out" report={checkOut} subject={subject} />
      </div>
    </div>
  );
}
