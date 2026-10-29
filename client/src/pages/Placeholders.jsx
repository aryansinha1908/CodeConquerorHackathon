import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Award, Construction, Layers, Shield } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';

const linkClass =
  'inline-flex items-center justify-center gap-2 font-bold font-mono tracking-tight border-2 border-[#1a1a1a] ' +
  'px-5 py-2.5 min-h-[44px] text-sm rounded-md bg-white text-[#1a1a1a] shadow-[3px_3px_0px_0px_#1a1a1a] ' +
  'hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px] transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2';

/**
 * A page that is routed but not built yet. It shows no data at all (never mock data): only what
 * the page will be for and a way back. `level` is the heading level: 1 in the app shell, 2 under
 * the manage and admin layouts, which have their own h1.
 */
export function PagePlaceholder({ eyebrow, title, description, backTo = '/explore', backLabel = 'Back to Explore', level = 1 }) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section className="space-y-6 font-mono" aria-labelledby="placeholder-heading">
      <div className="border-b-2 border-[#1a1a1a] pb-4">
        {eyebrow && (
          <span className="text-xs uppercase font-bold text-[#183d2d] tracking-widest">{eyebrow}</span>
        )}
        <Heading id="placeholder-heading" className="text-2xl font-black text-[#1a1a1a] tracking-tight">
          {title}
        </Heading>
      </div>
      <Card className="p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#ede8df] flex items-center justify-center mx-auto shadow-[3px_3px_0_#1a1a1a]">
          <Construction className="w-7 h-7" aria-hidden="true" />
        </div>
        <p className="text-sm font-bold text-[#1a1a1a]">This page is being built.</p>
        {description && <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">{description}</p>}
        <Link to={backTo} className={linkClass}>
          {backLabel}
        </Link>
      </Card>
    </section>
  );
}

/**
 * /incidents/new and /incidents/:id until the incident pages are built: "Report an issue" (the
 * booking's action bar) and "Open the incident" (the booking history) link here. `kind` is
 * 'report' or 'detail'. A report opened from a booking (?bookingId=) leads back to it.
 */
export function IncidentPlaceholder({ kind = 'detail' }) {
  const [searchParams] = useSearchParams();
  const bookingId = kind === 'report' ? searchParams.get('bookingId') : null;
  return (
    <PagePlaceholder
      eyebrow="Incidents"
      title={kind === 'report' ? 'Report an issue' : 'Incident'}
      description={
        kind === 'report'
          ? 'Reporting damage, a delay or a safety problem from here is coming. Until then, tell the unit’s managers.'
          : 'The incident’s thread and resolution will show here. Until then, the booking’s history lists each incident and its outcome.'
      }
      backTo={bookingId ? `/bookings/${encodeURIComponent(bookingId)}` : '/bookings'}
      backLabel={bookingId ? 'Back to the booking' : 'Back to My bookings'}
    />
  );
}

export function BadgesPlaceholder() {
  return (
    <div className="space-y-6 font-mono">
      <div className="border-b-2 border-[#1a1a1a] pb-4 flex items-center justify-between">
        <div>
          <span className="text-xs uppercase font-bold text-[#e67e22] tracking-widest">
            SAFETY & TRAINING CREDENTIALS
          </span>
          <h1 className="text-2xl font-black text-[#1a1a1a]">Badges & Certifications</h1>
        </div>
        <Badge variant="amber" size="md">
          PHASE 3 TARGET
        </Badge>
      </div>

      <Card className="p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#e67e22]/15 text-[#e67e22] flex items-center justify-center mx-auto shadow-[3px_3px_0_#1a1a1a]">
          <Award className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-[#1a1a1a]">Safety Badge Registry</h3>
        <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">
          Request department badges (3D Printing Basics, Laser Safety, HPC Slurm, UTM) and submit workshop
          completion proof for manager sign-off in Phase 3.
        </p>
        <Link to="/explore">
          <Button variant="outline" size="md">
            Return to Explore
          </Button>
        </Link>
      </Card>
    </div>
  );
}

export function ManagePlaceholder() {
  return (
    <div className="space-y-6 font-mono">
      <Card className="p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#e67e22]/15 text-[#e67e22] flex items-center justify-center mx-auto shadow-[3px_3px_0_#1a1a1a]">
          <Layers className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-[#1a1a1a]">Facility Review & Handover Desk</h3>
        <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">
          Manager review queue grouped by conflicting slots, condition photo comparisons, and incident reporting
          coming in Phases 2 and 3.
        </p>
      </Card>
    </div>
  );
}

export function AdminPlaceholder() {
  return (
    <div className="space-y-6 font-mono">
      <Card className="p-8 text-center max-w-xl mx-auto space-y-4">
        <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#c0392b]/15 text-[#c0392b] flex items-center justify-center mx-auto shadow-[3px_3px_0_#1a1a1a]">
          <Shield className="w-7 h-7" />
        </div>
        <h3 className="text-lg font-black text-[#1a1a1a]">Institute Administration Console</h3>
        <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">
          ID card verification queue, user role management, cryptographic audit trail, and escalation handling
          coming in Phase 3.
        </p>
      </Card>
    </div>
  );
}

