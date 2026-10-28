import React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import {
  MapPin,
  Clock,
  Award,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Flame,
  ArrowRight,
} from 'lucide-react';

export function ResourceCard({ resource }) {
  const {
    _id,
    title,
    categoryLabel,
    orgUnit,
    location,
    description,
    riskLevel,
    approvalMode,
    limits,
    eligibility,
  } = resource;

  const riskBadgeProps = {
    low: { variant: 'teal', label: 'LOW RISK' },
    medium: { variant: 'amber', label: 'MED RISK' },
    high: { variant: 'red', label: 'HIGH RISK' },
  }[riskLevel] || { variant: 'neutral', label: 'STANDARD' };

  return (
    <div className="rounded-xl border-2 border-[#1a1a1a] bg-white p-5 font-mono shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:-translate-x-[2px] hover:-translate-y-[2px] transition-all flex flex-col justify-between group">
      {/* ── Top Meta ── */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <Badge variant="outline" size="sm" className="bg-[#ede8df]">
            {categoryLabel || 'EQUIPMENT'}
          </Badge>
          <div className="flex items-center gap-1.5">
            <Badge variant={riskBadgeProps.variant} size="sm">
              {riskBadgeProps.label}
            </Badge>
            <Badge
              variant={approvalMode === 'auto' ? 'forest' : 'outline'}
              size="sm"
              className={approvalMode === 'auto' ? 'bg-[#183d2d] text-white' : ''}
            >
              {approvalMode === 'auto' ? '⚡ INSTANT' : 'REVIEW'}
            </Badge>
          </div>
        </div>

        {/* ── Title & Unit ── */}
        <h3 className="text-base font-black text-[#1a1a1a] tracking-tight group-hover:text-[#c0392b] transition-colors line-clamp-1 mb-1">
          <Link to={`/resources/${_id}`}>{title}</Link>
        </h3>

        <div className="flex items-center gap-1 text-xs text-[#1a1a1a]/70 mb-3">
          <MapPin className="w-3.5 h-3.5 text-[#c0392b] shrink-0" />
          <span className="truncate">{location || orgUnit?.name}</span>
        </div>

        <p className="text-xs text-[#1a1a1a]/80 line-clamp-2 mb-4 leading-relaxed">
          {description}
        </p>

        {/* ── Key Limits ── */}
        <div className="grid grid-cols-2 gap-2 mb-4 p-2.5 rounded-lg bg-[#f5f0e8] border border-[#1a1a1a]/20 text-[11px]">
          <div className="flex items-center gap-1.5 text-[#1a1a1a]/80">
            <Clock className="w-3.5 h-3.5 text-[#183d2d]" />
            <span>Max {limits?.maxDurationMinutes ? limits.maxDurationMinutes / 60 : 4}h / slot</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#1a1a1a]/80">
            <ShieldCheck className="w-3.5 h-3.5 text-[#183d2d]" />
            <span>Quota: {limits?.maxHoursPerWeek || 6}h / wk</span>
          </div>
        </div>

        {/* ── Required Badges ── */}
        {eligibility?.requiredBadges?.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {eligibility.requiredBadges.map((b) => (
              <span
                key={b._id || b.code}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border border-[#1a1a1a] bg-[#f1c40f]/20 text-[#1a1a1a]"
              >
                <Award className="w-3 h-3 text-[#e67e22]" />
                {b.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Bottom Action ── */}
      <div className="pt-3 border-t-2 border-[#1a1a1a]/10 flex items-center justify-between gap-2 mt-auto">
        <span className="text-[11px] font-bold text-[#183d2d] flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#183d2d]" />
          READY TO BOOK
        </span>
        <Link to={`/resources/${_id}`}>
          <Button variant="primary" size="sm" className="text-xs">
            Check & Book
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

