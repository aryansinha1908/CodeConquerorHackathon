import React from 'react';
import { Gauge } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { quotaView } from '../format';

// The viewer's fair-use quota on one resource (frontend.md §7 QuotaMeter): "4 of 6 h this week ·
// 1 of 1 active booking", with a bar for each limit that is set. `quota` is GET
// /resources/:id/eligibility's { hoursThisWeek, maxHoursPerWeek|null, activeCount,
// maxActiveBookings|null }, counted over the current IST week (Monday to Sunday).

function Meter({ label, value, max, valueText, ratio }) {
  const pct = Math.round((ratio ?? 0) * 100);
  const colour = ratio >= 1 ? 'bg-[#c0392b]' : ratio >= 0.75 ? 'bg-[#e67e22]' : 'bg-[#183d2d]';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
        <span>{label}</span>
        <span className="tabular-nums">{valueText}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-valuetext={valueText}
        className="w-full h-3 rounded-full border-2 border-[#1a1a1a] bg-white overflow-hidden"
      >
        <div className={cn('h-full', colour)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function QuotaMeter({ quota, className }) {
  const view = quotaView(quota);
  if (!view) return null;
  return (
    <div
      className={cn(
        'p-4 bg-[#f5f0e8] border-2 border-[#1a1a1a] rounded-xl space-y-3 font-mono text-[#1a1a1a]',
        className
      )}
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
          <Gauge className="w-4 h-4 text-[#183d2d]" aria-hidden="true" />
          Your quota here
        </p>
        <p className="text-sm font-bold mt-1">{view.text}</p>
      </div>
      {view.hours.limit != null && (
        <Meter
          label="Hours this week"
          value={view.hours.used}
          max={view.hours.limit}
          ratio={view.hours.ratio}
          valueText={view.hours.text.replace(' this week', '')}
        />
      )}
      {view.active.limit != null && (
        <Meter
          label="Active bookings"
          value={view.active.used}
          max={view.active.limit}
          ratio={view.active.ratio}
          valueText={view.active.text}
        />
      )}
      <p className="text-[11px] text-[#1a1a1a]/75">
        Counted on this resource, for the week from Monday to Sunday (IST).
      </p>
    </div>
  );
}
