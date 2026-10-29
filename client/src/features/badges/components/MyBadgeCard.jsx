import React from 'react';
import { CheckCircle2, Eye, RotateCcw } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { StaggerItem } from '../../../components/Motion';
import { formatIstDate, formatIstDateTime } from '../../../lib/time';
import {
  badgeStateView,
  badgeUnitName,
  validityText,
} from '../badgeView';

export function MyBadgeCard({ row, onRequest, onViewEvidence }) {
  const badge = row.badge;
  const unit = badgeUnitName(badge);
  const state = badgeStateView(row);

  const isHeld = row.state === 'active' || row.status === 'active';
  const isPending = row.state === 'requested' || row.status === 'requested';
  const isExpired = row.state === 'expired' || row.status === 'expired';
  const isRejected = row.state === 'rejected' || row.status === 'rejected';

  const requestedDate = row.requestedAt ? formatIstDateTime(row.requestedAt) : null;
  const decidedDate = row.decidedAt ? formatIstDateTime(row.decidedAt) : null;
  const expiresDate = row.expiresAt ? formatIstDate(row.expiresAt, { year: true }) : null;

  return (
    <StaggerItem>
      <Card className="p-5 bg-white space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-[#183d2d] tracking-widest block">
              {unit}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <h3 className="text-base font-black tracking-tight text-[#1a1a1a] break-words">
                {badge.name}
              </h3>
              <span className="text-xs text-[#1a1a1a]/60 font-mono">({badge.code})</span>
            </div>
            <p className="text-xs text-[#1a1a1a]/70 mt-0.5">
              {validityText(badge.validityDays)}
              {badge.evidenceRequired ? ' · evidence required' : ''}
            </p>
          </div>
          <Badge variant={state.variant} icon={state.icon} size="md" className="shrink-0 self-start">
            {state.label}
          </Badge>
        </div>

        {/* Timelines and info grid */}
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs p-3 rounded-lg border border-[#1a1a1a]/20 bg-[#f5f0e8]/50">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-[#1a1a1a]/60">
              Requested
            </dt>
            <dd className="font-bold text-[#1a1a1a] mt-0.5">{requestedDate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-[#1a1a1a]/60">
              {isPending ? 'Review Status' : 'Decision Date'}
            </dt>
            <dd className="font-bold text-[#1a1a1a] mt-0.5">
              {isPending ? 'In Manager Queue' : decidedDate ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-[#1a1a1a]/60">
              Validity Expiry
            </dt>
            <dd className="font-bold text-[#1a1a1a] mt-0.5">
              {expiresDate ? expiresDate : 'Never expires'}
            </dd>
          </div>
        </dl>

        {/* User's note */}
        {row.note && (
          <div className="text-xs">
            <span className="font-bold text-[#1a1a1a]/70">Your submission note: </span>
            <span className="italic text-[#1a1a1a]/90">“{row.note}”</span>
          </div>
        )}

        {/* Rejection notice */}
        {isRejected && (
          <div
            role="alert"
            className="p-3 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] text-xs space-y-1"
          >
            <p className="font-bold text-[#c0392b]">Rejection Reason:</p>
            <p className="text-[#1a1a1a]/90 italic">“{row.reason || 'Criteria not met.'}”</p>
          </div>
        )}

        {/* Actions bar */}
        <div className="pt-3 border-t-2 border-[#1a1a1a]/15 flex flex-wrap items-center justify-between gap-2">
          <div>
            {row.hasEvidence && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onViewEvidence?.(row)}
                className="bg-white"
              >
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                View Submitted Evidence
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isExpired && (
              <Button
                type="button"
                variant="forest"
                size="sm"
                onClick={() => onRequest?.(badge, row)}
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Renew Credential
              </Button>
            )}
            {isRejected && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => onRequest?.(badge, row)}
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Re-apply for Badge
              </Button>
            )}
            {isHeld && (
              <span className="text-xs font-bold text-[#183d2d] flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                Active Credential
              </span>
            )}
          </div>
        </div>
      </Card>
    </StaggerItem>
  );
}
