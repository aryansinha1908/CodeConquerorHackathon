import React from 'react';
import { BadgeCheck, CalendarCheck } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { bookingAfterResolve, resolutionView } from './incidentView';

/**
 * The resolution (api.md IncidentDetail `resolution: { outcome, rationale, decidedBy, at }`): the
 * outcome, the rationale, who decided and when, and, right after this page resolved it, whether
 * that closed the booking (`bookingClosed` from POST /incidents/:id/resolve). Nothing renders for an
 * unresolved incident.
 */
export function ResolutionCard({ incident, bookingClosed, Heading = 'h2' }) {
  const view = resolutionView(incident?.resolution);
  if (!view) return null;
  const booking = bookingAfterResolve(incident, bookingClosed);
  return (
    <Card variant="success" className="p-5 space-y-3">
      <Heading className="text-base md:text-lg font-bold tracking-tight flex items-center gap-2">
        <BadgeCheck className="w-5 h-5 text-[#0b6e4f]" aria-hidden="true" />
        Resolution
      </Heading>
      <div>
        <p className="text-sm font-black">{view.outcome.label}</p>
        {view.outcome.description && <p className="text-xs text-[#1a1a1a]/70">{view.outcome.description}</p>}
      </div>
      {view.rationale && (
        <p className="text-sm bg-white border-l-4 border-[#0b6e4f] rounded-r-md px-3 py-2 whitespace-pre-wrap break-words">
          <span className="font-bold">Rationale: </span>“{view.rationale}”
        </p>
      )}
      <p className="text-xs text-[#1a1a1a]/70">
        Decided by {view.by}
        {view.at && (
          <>
            {' '}
            on <time dateTime={String(incident.resolution.at)}>{view.at}</time>
          </>
        )}
      </p>
      {booking && (
        <p className="text-sm flex items-start gap-2 font-bold">
          <CalendarCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          {booking}
        </p>
      )}
    </Card>
  );
}
