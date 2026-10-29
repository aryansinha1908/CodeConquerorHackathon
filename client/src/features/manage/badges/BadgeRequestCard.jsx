import React from 'react';
import { Award, CheckCircle2, Eye, FileWarning, XCircle } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field } from '../components/Bits';
import { OWN_REQUEST_MESSAGE, badgeStateView, canDecide, isOwnRequest, requestView } from './badgeView';

/**
 * One row of GET /badge-requests: the member (name, member type, department; never an email), the
 * badge and its unit, their note, the evidence ("View evidence" asks for a fresh 5-minute link each
 * time) and, while it is requested, Approve / Reject. A decided row shows who decided, when and why.
 *
 * row: a queue row as api.md describes; user: the signed-in user; onView(row), onDecide(kind, row).
 */
export function BadgeRequestCard({ row, user, onView, onDecide }) {
  const view = requestView(row);
  const state = badgeStateView(row);
  const decidable = canDecide(row, user);
  const own = isOwnRequest(row, user);
  const subject = `${view.member.name}'s request for ${view.badgeName}`;
  const noEvidenceId = `badge-request-${view.id}-no-evidence`;

  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-black tracking-tight break-words">{view.member.name}</h3>
            <p className="text-xs text-[#1a1a1a]/70">
              {view.member.memberType} · {view.member.department}
            </p>
          </div>
          <Badge variant={state.variant} icon={state.icon} className="self-start shrink-0">
            {state.label}
          </Badge>
        </div>

        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Award className="w-4 h-4 shrink-0 text-[#a04000]" aria-hidden="true" />
          <span className="font-bold break-words">{view.badgeName}</span>
          {view.badgeCode && <span className="text-xs text-[#1a1a1a]/70">({view.badgeCode})</span>}
          {view.unitName && <span className="text-xs text-[#1a1a1a]/70">· {view.unitName}</span>}
        </p>
        <p className="mt-1 text-[11px] text-[#1a1a1a]/70">
          {view.validity}
          {view.evidenceRequired ? ' · evidence required' : ''}
        </p>

        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Field label="Requested">{view.requestedAt ?? 'Not recorded'}</Field>
          <Field label="Evidence">{view.hasEvidence ? 'Attached' : 'None'}</Field>
          {view.decidedAt && <Field label="Decided">{view.decidedAt}</Field>}
          {view.decidedBy && <Field label="Decided by">{view.decidedBy}</Field>}
          {view.expiresAt && <Field label="Expires">{view.expiresAt}</Field>}
          <Field label="Their note" className="sm:col-span-2 lg:col-span-4">
            <span className="font-normal">{view.note ? `“${view.note}”` : 'No note.'}</span>
          </Field>
          {view.reason && (
            <Field label="Reason" className="sm:col-span-2 lg:col-span-4">
              <span className="font-normal">“{view.reason}”</span>
            </Field>
          )}
        </dl>

        <div className="mt-4 pt-3 border-t-2 border-[#1a1a1a]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="bg-white min-h-[44px]"
              disabled={!view.hasEvidence}
              aria-describedby={view.hasEvidence ? undefined : noEvidenceId}
              onClick={() => onView?.(row)}
            >
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              View evidence
              <span className="sr-only">: {subject}</span>
            </Button>
            {!view.hasEvidence && (
              <span id={noEvidenceId} className="text-[11px] text-[#1a1a1a]/70 inline-flex items-center gap-1">
                {view.evidenceRequired && <FileWarning className="w-3.5 h-3.5" aria-hidden="true" />}
                No evidence attached
              </span>
            )}
          </div>
          {row?.status === 'requested' &&
            (decidable ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="forest"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => onDecide?.('approve', row)}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Approve
                  <span className="sr-only"> {subject}</span>
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => onDecide?.('reject', row)}
                >
                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  Reject
                  <span className="sr-only"> {subject}</span>
                </Button>
              </div>
            ) : (
              own && (
                <p className="text-[11px] font-bold text-[#1a1a1a]/70 max-w-xs">Your own request. {OWN_REQUEST_MESSAGE}</p>
              )
            ))}
        </div>
      </Card>
    </li>
  );
}
