import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlarmClock, CalendarClock, CheckCircle2, LogIn, LogOut, X } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Badge } from '../../components/ui/Badge';
import { formatIstDate } from '../../lib/time';
import { HandoverSection } from './components/HandoverSection';
import { InUseItem, ReturnItem, StartingItem } from './components/HandoverItems';
import { isOverdueAt } from './components/manageView';
import { useNow } from './components/useNow';

// /manage/handovers (frontend.md §6.3, F-12; judge step 10): three lists for the manager's units
// (an admin sees every unit), each from GET /bookings/manage and polled every 30 s:
// - starting soon: approved, starting today (IST);
// - in use: checked in, overdue highlighted;
// - awaiting return confirmation: checked out, each linking to /manage/returns/:bookingId.
// A confirmed return comes back here with a notice in the history state, and focus on the heading.

export default function HandoversPage() {
  const now = useNow();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const navigate = useNavigate();
  const headingRef = useRef(null);
  const [notice, setNotice] = useState(() =>
    typeof location.state?.notice === 'string' ? location.state.notice : null
  );

  // Arrived from a confirmed return: focus the heading (the page that had focus is gone) and drop
  // the notice from the history entry, so a reload doesn't show it again.
  const arrivedWithNotice = useRef(Boolean(notice));
  useEffect(() => {
    if (!arrivedWithNotice.current) return;
    arrivedWithNotice.current = false;
    headingRef.current?.focus();
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [navigate, location.pathname, location.search]);

  return (
    <section aria-labelledby="handovers-heading" className="space-y-8 font-mono text-[#1a1a1a]">
      <div className="border-b-2 border-[#1a1a1a] pb-4">
        <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">
          Today · {formatIstDate(now, { weekday: true })}
        </span>
        <h2
          id="handovers-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-black tracking-tight focus:outline-none"
        >
          Handovers
        </h2>
        <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-2xl leading-relaxed">
          Bookings starting today, items in use and returns waiting for your check, across the units
          you manage. Times are IST; the lists refresh every 30 seconds.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 p-4 rounded-lg border-2 border-[#183d2d] bg-[#f0faf5] text-sm"
        >
          <p className="flex items-start gap-2 font-bold">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-[#183d2d]" aria-hidden="true" />
            <span>{notice}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              headingRef.current?.focus();
            }}
            aria-label="Dismiss the notice"
            className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-lg border-2 border-[#1a1a1a] bg-white hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      )}

      <HandoverSection
        sectionId="starting"
        now={now}
        icon={CalendarClock}
        title="Starting soon"
        itemsName="today's bookings"
        description="Approved bookings that start today. Check-in opens 15 minutes before the start."
        emptyTitle="Nothing else starts today"
        emptyDescription="Approved bookings for today appear here until they are checked in."
        renderItem={(booking) => <StartingItem booking={booking} now={now} user={user} />}
      />

      <HandoverSection
        sectionId="inUse"
        now={now}
        icon={LogIn}
        title="In use"
        itemsName="the items in use"
        description="Checked in. A booking more than 15 minutes past its end is overdue."
        emptyTitle="Nothing in use"
        emptyDescription="Items appear here once they are checked in."
        aside={(items) => {
          const overdue = items.filter((b) => isOverdueAt(b, now)).length;
          return overdue > 0 ? (
            <Badge variant="overdue" icon={AlarmClock} size="sm">
              {overdue} overdue
            </Badge>
          ) : null;
        }}
        renderItem={(booking) => <InUseItem booking={booking} now={now} user={user} />}
      />

      <HandoverSection
        sectionId="returns"
        now={now}
        icon={LogOut}
        title="Awaiting return confirmation"
        itemsName="the returns to confirm"
        description="Checked out by the borrower. Compare the reports, then confirm the return or report an issue."
        emptyTitle="No returns to confirm"
        emptyDescription="When a borrower checks out, the return waits here for your check."
        renderItem={(booking) => <ReturnItem booking={booking} now={now} user={user} />}
      />
    </section>
  );
}
