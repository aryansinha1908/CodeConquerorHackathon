import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Award, CalendarCheck, Compass, ShieldCheck, Zap } from 'lucide-react';
import { StaggerItem, StaggerList } from '../../components/Motion';

// One-click jumps into the app. A signed-out visitor is asked to log in first, then lands where the
// link pointed.

const SHORTCUTS = [
  { to: '/explore', title: 'Browse the catalogue', icon: Compass, color: '#183d2d', text: () => 'Every listed instrument, tool and room, with live filters.' },
  { to: '/bookings', title: 'My bookings', icon: CalendarCheck, color: '#2471a3', text: () => 'Upcoming slots, your QR pass, check-in and your waitlist place.' },
  {
    to: '/verification',
    title: 'ID verification',
    icon: ShieldCheck,
    color: '#b9470b',
    text: (status) =>
      ({
        approved: 'Verified: you can book.',
        pending: 'Under review: an admin is checking your card.',
        rejected: 'Not approved: see why, and send a new card.',
      })[status] ?? 'Upload your institute ID card to start booking.',
  },
  { to: '/badges', title: 'Training badges', icon: Award, color: '#8e44ad', text: () => 'The badges risky equipment needs, and how to request them.' },
];

export function ShortcutsSection({ user }) {
  const status = user?.verification?.status ?? null;
  return (
    <section aria-labelledby="shortcuts-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="shortcuts-heading" className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#1a1a1a]/75">
          <Zap className="h-4 w-4 text-[#e67e22]" aria-hidden="true" />
          Jump right in
        </h2>
        {!user && <span className="text-[11px] text-[#1a1a1a]/70">You’ll be asked to log in first</span>}
      </div>
      <StaggerList className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SHORTCUTS.map(({ to, title, icon: Icon, color, text }) => (
          <StaggerItem key={to}>
            <Link
              to={to}
              className="group flex h-full items-start gap-3.5 rounded-xl border-2 border-[#1a1a1a] bg-white p-4 shadow-[4px_4px_0_#1a1a1a] transition-all hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[6px_6px_0_#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
            >
              <span className="shrink-0 rounded-lg border-2 border-[#1a1a1a] p-2.5 text-white transition-transform group-hover:scale-105" style={{ backgroundColor: color }}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center justify-between gap-2 text-sm font-black tracking-tight">
                  {title}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" style={{ color }} aria-hidden="true" />
                </span>
                <span className="mt-0.5 block text-xs text-[#1a1a1a]/75">{text(status)}</span>
              </span>
            </Link>
          </StaggerItem>
        ))}
      </StaggerList>
    </section>
  );
}
