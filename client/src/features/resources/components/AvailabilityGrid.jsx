import React, { useState } from 'react';
import { Calendar, Clock, Info } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_SLOTS = [
  '09:00 - 10:00',
  '10:00 - 11:00',
  '11:00 - 12:00',
  '12:00 - 13:00',
  '13:00 - 14:00',
  '14:00 - 15:00',
  '15:00 - 16:00',
  '16:00 - 17:00',
  '17:00 - 18:00',
];

export function AvailabilityGrid({ resource, availability }) {
  const [selectedSlot, setSelectedSlot] = useState(null);

  // Generate 7 days starting from today in IST
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return {
      date: d,
      dayName: DAYS[d.getDay()],
      dateStr: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      isToday: i === 0,
      offset: i,
    };
  });

  // Simulated busy slots hash
  const busySlots = availability?.busySlots || [
    { dayOffset: 1, timeIndex: 1, reason: 'Reserved' },
    { dayOffset: 1, timeIndex: 2, reason: 'Lab Class' },
    { dayOffset: 2, timeIndex: 4, reason: 'Reserved' },
    { dayOffset: 3, timeIndex: 6, reason: 'Maintenance' },
  ];

  const isSlotBusy = (dayOffset, timeIndex) => {
    return busySlots.find((b) => b.dayOffset === dayOffset && (b.timeIndex === timeIndex || (timeIndex >= 1 && timeIndex <= 2 && dayOffset === 1)));
  };

  const handleSelect = (day, time, busy) => {
    if (busy) return;
    setSelectedSlot({
      dateStr: day.dateStr,
      dayName: day.dayName,
      time,
    });
  };

  return (
    <div className="rounded-xl border-2 border-[#1a1a1a] bg-white p-5 font-mono shadow-[4px_4px_0_#1a1a1a] space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b-2 border-[#1a1a1a]/15">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#183d2d]" />
          <h3 className="text-base font-black text-[#1a1a1a] tracking-tight">
            7-Day Availability Matrix (IST)
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-[#1a1a1a] bg-[#f0faf5]" />
            Open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-[#1a1a1a] bg-[#1a1a1a]/80" />
            Busy
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-[#1a1a1a] bg-[#c0392b]/20" />
            Reserved/Maint
          </span>
        </div>
      </div>

      {/* ── Grid Container ── */}
      <div className="overflow-x-auto pb-2">
        <div role="grid" aria-label="Resource weekly availability" className="min-w-[620px]">
          {/* Day Headers */}
          <div role="row" className="grid grid-cols-8 gap-1.5 mb-1.5">
            <div className="text-[11px] font-bold text-[#1a1a1a]/60 uppercase p-1">Time</div>
            {weekDays.map((d) => (
              <div
                key={d.offset}
                className={`p-1.5 text-center rounded border-2 border-[#1a1a1a] ${
                  d.isToday ? 'bg-[#183d2d] text-white' : 'bg-[#ede8df] text-[#1a1a1a]'
                }`}
              >
                <div className="text-[10px] uppercase font-bold tracking-wider">{d.dayName}</div>
                <div className="text-xs font-black">{d.dateStr}</div>
              </div>
            ))}
          </div>

          {/* Time Slot Rows */}
          {TIME_SLOTS.map((slotTime, tIndex) => (
            <div role="row" key={slotTime} className="grid grid-cols-8 gap-1.5 mb-1 text-xs">
              <div className="text-[10px] font-bold text-[#1a1a1a]/70 flex items-center px-1">
                {slotTime.split(' - ')[0]}
              </div>

              {weekDays.map((d) => {
                const busy = isSlotBusy(d.offset, tIndex);
                const isSelected =
                  selectedSlot?.dateStr === d.dateStr && selectedSlot?.time === slotTime;

                return (
                  <button
                    role="gridcell"
                    key={`${d.offset}-${tIndex}`}
                    type="button"
                    disabled={!!busy}
                    onClick={() => handleSelect(d, slotTime, busy)}
                    aria-selected={isSelected}
                    title={busy ? `Slot unavailable: ${busy.reason || 'Busy'}` : `Select ${slotTime}`}
                    className={`h-8 rounded border transition-all flex items-center justify-center text-[10px] font-bold ${
                      busy
                        ? 'bg-[#1a1a1a]/85 border-[#1a1a1a] text-white/50 cursor-not-allowed select-none'
                        : isSelected
                        ? 'bg-[#c0392b] border-[#1a1a1a] text-white shadow-[2px_2px_0_#1a1a1a]'
                        : 'bg-[#f0faf5] hover:bg-[#183d2d]/15 border-[#1a1a1a]/30 text-[#183d2d]'
                    }`}
                  >
                    {busy ? 'BUSY' : isSelected ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Selected Slot Banner ── */}
      {selectedSlot && (
        <div className="p-3 bg-[#ede8df] border-2 border-[#1a1a1a] rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#c0392b]" />
            <span>
              Target Window: <strong>{selectedSlot.dayName}, {selectedSlot.dateStr}</strong> @{' '}
              <strong>{selectedSlot.time} (IST)</strong>
            </span>
          </div>
          <span className="text-[11px] font-bold text-[#183d2d]">
            [Ready for Phase 2 Booking Panel Submission]
          </span>
        </div>
      )}

      <div className="text-[11px] text-[#1a1a1a]/60 flex items-center gap-1.5 pt-1">
        <Info className="w-3.5 h-3.5 shrink-0" />
        <span>Slots are subject to resource limits (Min: {resource?.limits?.minDurationMinutes || 60}m, Max: {resource?.limits?.maxDurationMinutes || 240}m).</span>
      </div>
    </div>
  );
}

