import React from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../lib/utils';
import { approvalView, categoryLabel, formatLocation, resourceStatusView } from '../../resources/format';
import { LinkButton } from '../components/Bits';
import { STATUS_CHOICES } from './statusView';
import { textLinkClass } from './styles';

// The table of /manage/resources: one row per resource (a Card from GET /resources) with its unit,
// category, quantity, approval mode and status, the status toggles, and links to edit it and to
// its public page. On a narrow screen the table scrolls sideways inside its own focusable region.

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/**
 * Active / Maintenance / Archived as three toggle buttons; the current one is pressed. Choosing
 * another calls onChoose(status), which opens the dialog that asks for the reason.
 */
export function StatusToggle({ title, status, busy = false, onChoose }) {
  return (
    <div
      role="group"
      aria-label={`Status of ${title}`}
      className="inline-flex rounded-md border-2 border-[#1a1a1a] overflow-hidden shadow-[2px_2px_0_#1a1a1a]"
    >
      {STATUS_CHOICES.map((choice, index) => {
        const pressed = status === choice.value;
        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={pressed}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy && !pressed) onChoose(choice.value);
            }}
            className={cn(
              'px-2.5 min-h-[36px] text-[11px] font-bold font-mono tracking-tight',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#c0392b]',
              'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
              index > 0 && 'border-l-2 border-[#1a1a1a]',
              pressed ? 'bg-[#1a1a1a] text-white' : 'bg-white text-[#1a1a1a] hover:bg-[#ede8df]'
            )}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ resource, busy, onChooseStatus }) {
  const id = encodeURIComponent(asText(resource._id));
  const title = asText(resource.title) || 'Untitled resource';
  const unit = resource.orgUnit && typeof resource.orgUnit === 'object' ? resource.orgUnit : null;
  const status = resourceStatusView(resource.status);
  const approval = approvalView(resource.eligibility?.approvalMode);
  const location = formatLocation(resource.location);
  return (
    <tr className="border-t-2 border-[#1a1a1a]/10 align-top">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <Link to={`/resources/${id}`} className={cn(textLinkClass, 'text-sm text-[#1a1a1a] break-words')}>
          {title}
        </Link>
        {location && <span className="block text-xs text-[#1a1a1a]/70 mt-0.5">{location}</span>}
      </th>
      <td className="py-3 pr-4 text-xs">
        {unit ? (
          <>
            <span className="font-bold">{asText(unit.code).toUpperCase() || asText(unit.name)}</span>
            {unit.code && unit.name && <span className="block text-[#1a1a1a]/70">{asText(unit.name)}</span>}
          </>
        ) : (
          'Unit not shown'
        )}
      </td>
      <td className="py-3 pr-4 text-xs">{categoryLabel(resource.category)}</td>
      <td className="py-3 pr-4 text-xs tabular-nums">{Number(resource.quantity) || 1}</td>
      <td className="py-3 pr-4 text-xs">{approval.label}</td>
      <td className="py-3 pr-4">
        <div className="flex flex-col items-start gap-2">
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
          <StatusToggle title={title} status={resource.status} busy={busy} onChoose={(next) => onChooseStatus(resource, next)} />
        </div>
      </td>
      <td className="py-3 text-right">
        <LinkButton to={`/manage/resources/${id}/edit`} aria-label={`Edit ${title}`}>
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          Edit
        </LinkButton>
      </td>
    </tr>
  );
}

export function ResourceTable({ resources, caption, busyId = null, onChooseStatus, dimmed = false }) {
  return (
    <div
      role="region"
      aria-labelledby="manage-resources-caption"
      tabIndex={0}
      className={cn(
        // relative: the scroller, not the viewport, holds the sr-only header text (else the page scrolls sideways).
        'relative overflow-x-auto rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2',
        dimmed && 'opacity-60'
      )}
    >
      <table className="w-full min-w-[56rem] text-left font-mono text-[#1a1a1a]">
        <caption id="manage-resources-caption" className="sr-only">
          {caption}
        </caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/75">
            <th scope="col" className="pt-3 pb-2 pl-4 pr-4 font-bold">
              Resource
            </th>
            <th scope="col" className="pt-3 pb-2 pr-4 font-bold">
              Unit
            </th>
            <th scope="col" className="pt-3 pb-2 pr-4 font-bold">
              Category
            </th>
            <th scope="col" className="pt-3 pb-2 pr-4 font-bold">
              Quantity
            </th>
            <th scope="col" className="pt-3 pb-2 pr-4 font-bold">
              Approval
            </th>
            <th scope="col" className="pt-3 pb-2 pr-4 font-bold">
              Status
            </th>
            <th scope="col" className="pt-3 pb-2 pr-4 font-bold text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="[&_th]:pl-4 [&_td:last-child]:pr-4">
          {resources.map((resource) => (
            <Row
              key={resource._id}
              resource={resource}
              busy={busyId === String(resource._id)}
              onChooseStatus={onChooseStatus}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
