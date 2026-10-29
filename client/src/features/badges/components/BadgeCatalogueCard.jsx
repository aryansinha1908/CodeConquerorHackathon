import React from 'react';
import { Award, CheckCircle2, Clock, RotateCcw } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { StaggerItem } from '../../../components/Motion';
import { formatIstDate } from '../../../lib/time';
import {
  badgeStateView,
  badgeUnitName,
  validityText,
} from '../badgeView';

export function BadgeCatalogueCard({ badge, userBadge, onRequest, onSelectTab }) {
  const unit = badgeUnitName(badge);
  const state = userBadge ? badgeStateView(userBadge) : null;
  const isHeld = state && (userBadge.state === 'active' || userBadge.status === 'active');
  const isPending = state && (userBadge.state === 'requested' || userBadge.status === 'requested');
  const isExpired = state && (userBadge.state === 'expired' || userBadge.status === 'expired');
  const isRejected = state && (userBadge.state === 'rejected' || userBadge.status === 'rejected');

  const expiresDate =
    isHeld && userBadge?.expiresAt
      ? formatIstDate(userBadge.expiresAt, { year: true })
      : null;

  return (
    <StaggerItem>
      <Card className="p-5 flex flex-col justify-between h-full bg-white transition-all hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_#1a1a1a]">
        <div className="space-y-3">
          {/* Header row: title and status chip */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-[#183d2d] tracking-widest block">
                {unit}
              </span>
              <h3 className="text-base font-black tracking-tight text-[#1a1a1a] break-words mt-0.5">
                {badge.name}
              </h3>
              <p className="text-xs text-[#1a1a1a]/60 font-mono mt-0.5">{badge.code}</p>
            </div>
            {state ? (
              <Badge variant={state.variant} icon={state.icon} size="sm" className="shrink-0">
                {state.label}
              </Badge>
            ) : (
              <Badge variant="outline" size="sm" className="shrink-0 text-[#1a1a1a]/70">
                Available
              </Badge>
            )}
          </div>

          {/* Description */}
          {badge.description && (
            <p className="text-xs text-[#1a1a1a]/75 leading-relaxed line-clamp-3">
              {badge.description}
            </p>
          )}

          {/* Specifications list */}
          <div className="pt-2 border-t border-[#1a1a1a]/15 flex flex-wrap items-center gap-2 text-[11px] text-[#1a1a1a]/70">
            <span className="px-2 py-0.5 rounded bg-[#f5f0e8] border border-[#1a1a1a]/30 font-bold">
              {validityText(badge.validityDays)}
            </span>
            {badge.evidenceRequired ? (
              <span className="px-2 py-0.5 rounded bg-[#fff5f5] border border-[#c0392b]/40 text-[#c0392b] font-bold">
                Evidence required
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-[#f0faf5] border border-[#183d2d]/30 text-[#183d2d] font-bold">
                Standard induction
              </span>
            )}
          </div>
        </div>

        {/* Action button row */}
        <div className="mt-4 pt-3 border-t-2 border-[#1a1a1a]/15 flex items-center justify-between gap-2">
          {isHeld ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#183d2d] font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                {expiresDate ? `Valid until ${expiresDate}` : 'Permanent credential'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelectTab?.('mine')}
                className="text-xs py-1 px-2.5 h-auto"
              >
                View
              </Button>
            </div>
          ) : isPending ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-[11px] text-[#e67e22] font-bold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                Under review
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelectTab?.('mine')}
                className="text-xs py-1 px-2.5 h-auto"
              >
                Status
              </Button>
            </div>
          ) : isExpired ? (
            <Button
              type="button"
              variant="forest"
              size="sm"
              onClick={() => onRequest?.(badge, userBadge)}
              className="w-full justify-center"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Renew Badge
            </Button>
          ) : isRejected ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => onRequest?.(badge, userBadge)}
              className="w-full justify-center"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Re-apply
            </Button>
          ) : (
            <Button
              type="button"
              variant="forest"
              size="sm"
              onClick={() => onRequest?.(badge, userBadge)}
              className="w-full justify-center"
            >
              <Award className="w-3.5 h-3.5" aria-hidden="true" />
              Request Badge
            </Button>
          )}
        </div>
      </Card>
    </StaggerItem>
  );
}
