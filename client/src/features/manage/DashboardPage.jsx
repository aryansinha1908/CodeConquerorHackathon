import React from 'react';
import { AlertTriangle, Award, CalendarClock, ClipboardList, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { formatIstDate } from '../../lib/time';
import { isAdmin } from './components/manageView';
import { useNow } from './components/useNow';
import { CountCard } from './dashboard/CountCard';
import { useDashboardCounts } from './dashboard/counts';
import { StaggerList } from '../../components/Motion';

// /manage (frontend.md §6.3): what is waiting for the manager, as count cards that each link to
// the page where it is worked. Every count is the meta.total of a limit=1 page of that page's own
// list (dashboard/counts.js), so the numbers match what the page then shows. A manager's counts
// cover the units they manage; an admin's cover every unit. Polled every 30 s while open.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function DashboardPage() {
  const now = useNow();
  const user = useAuthStore((s) => s.user);
  const counts = useDashboardCounts(now);
  const scope = isAdmin(user) ? 'every unit' : 'the units you manage';

  const cards = [
    {
      id: 'requests',
      to: '/manage/requests',
      title: 'Requests to review',
      icon: ClipboardList,
      query: counts.pending,
      noun: (n) => `${plural(n, 'slot')} waiting`,
      description: 'Slots with a booking request waiting for your decision. Competing requests share one slot.',
      linkLabel: 'Open the review queue',
    },
    {
      id: 'today',
      to: '/manage/handovers',
      title: 'Handovers today',
      icon: CalendarClock,
      query: counts.today,
      noun: (n) => `${plural(n, 'booking')} starting today`,
      description: 'Approved bookings that start today (IST) and are still waiting to be checked in.',
      linkLabel: "Open today's handovers",
    },
    {
      id: 'returns',
      to: '/manage/handovers',
      title: 'Returns to confirm',
      icon: LogOut,
      query: counts.returns,
      noun: (n) => `${plural(n, 'return')} to confirm`,
      description: 'Checked out by the borrower. Compare the reports, then confirm the return or report an issue.',
      linkLabel: 'Confirm returns',
    },
    {
      id: 'incidents',
      to: '/manage/incidents',
      title: 'Open incidents',
      icon: AlertTriangle,
      query: counts.incidents,
      noun: (n) => `${plural(n, 'incident')} open`,
      description: 'Incidents that are open or in review: damage, late returns, misuse and safety reports.',
      linkLabel: 'Open the incidents',
    },
    {
      id: 'badges',
      to: '/manage/badges',
      title: 'Badge requests',
      icon: Award,
      query: counts.badges,
      noun: (n) => `${plural(n, 'request')} waiting`,
      description: 'Members waiting for one of your badges, which unlock resources that need training.',
      linkLabel: 'Review badge requests',
    },
  ];

  const updating = Object.values(counts).some((q) => q.isFetching && !q.isPending);

  return (
    <section aria-labelledby="dashboard-heading" className="space-y-5 font-mono text-[#1a1a1a]">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b-2 border-[#1a1a1a] pb-4">
        <div>
          <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">
            Today · {formatIstDate(now, { weekday: true })}
          </span>
          <h2 id="dashboard-heading" className="text-2xl font-black tracking-tight">
            Dashboard
          </h2>
          <p className="text-xs text-[#1a1a1a]/70 mt-1 max-w-2xl leading-relaxed">
            What is waiting for you across {scope}. Each card opens the list where you work it. The
            counts refresh every 30 seconds.
          </p>
        </div>
        {updating && (
          <p className="text-xs text-[#1a1a1a]/70 shrink-0" aria-hidden="true">
            Updating…
          </p>
        )}
      </div>

      <StaggerList step={0.06} aria-label="What needs you" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((card) => (
          <CountCard key={card.id} {...card} />
        ))}
      </StaggerList>
    </section>
  );
}
