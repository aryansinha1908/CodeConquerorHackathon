import React from 'react';

export function BookingTimeline({ timeline = [] }) {
  if (!timeline || timeline.length === 0) {
    return (
      <p className="text-xs text-[#1a1a1a]/60 font-mono py-2">No audit timeline recorded yet.</p>
    );
  }

  // Format date in IST
  const formatIST = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }) + ' IST';
    } catch (e) {
      return isoString;
    }
  };

  return (
    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#1a1a1a]/20 font-mono">
      {timeline.map((item, idx) => {
        const isLatest = idx === timeline.length - 1;
        const eventName = item.event?.replace('booking.', '').replace('_', ' ').toUpperCase() || 'EVENT';

        return (
          <div key={idx} className="relative group">
            {/* Timeline node dot */}
            <div
              className={`absolute -left-[29px] top-1 w-4 h-4 rounded-full border-2 border-[#1a1a1a] shadow-[1px_1px_0_#1a1a1a] flex items-center justify-center ${
                isLatest ? 'bg-[#183d2d] text-white ring-4 ring-[#183d2d]/20' : 'bg-white text-[#1a1a1a]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
            </div>

            {/* Event Content Card */}
            <div className="bg-white border-2 border-[#1a1a1a] rounded-lg p-3.5 shadow-[3px_3px_0_#1a1a1a] space-y-1.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-xs font-black text-[#1a1a1a] tracking-tight flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-[#f5f0e8] border border-[#1a1a1a] text-[10px]">
                    {eventName}
                  </span>
                  <span>{item.actor || 'System'}</span>
                </span>
                <span className="text-[11px] text-[#1a1a1a]/60">
                  {formatIST(item.timestamp)}
                </span>
              </div>

              {item.reason && (
                <p className="text-xs text-[#1a1a1a]/80 bg-[#f5f0e8]/50 p-2 rounded border border-[#1a1a1a]/15">
                  &ldquo;{item.reason}&rdquo;
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
