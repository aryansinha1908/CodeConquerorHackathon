import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, MessageSquare } from 'lucide-react';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { formatIstShortDateTime } from '../../../lib/time';
import { IncidentStatusBadge, SeverityBadge } from './IncidentBadges';
import {
  commentCountText,
  excerpt,
  incidentBookingView,
  incidentPath,
  incidentTitle,
  reporterText,
  resolutionView,
  unitLabel,
} from './incidentView';

/**
 * One incident in a list (api.md IncidentListItem: no photos or thread, commentCount instead). The
 * title links to the scope's detail route; the rest says enough to triage without opening it.
 */
export function IncidentCard({ incident, scope, Heading = 'h3' }) {
  const booking = incidentBookingView(incident);
  const resolution = resolutionView(incident.resolution);
  const reported = formatIstShortDateTime(incident.createdAt);
  const unit = unitLabel(incident.orgUnit);
  return (
    <li>
      <Card variant={incident.severity === 'high' && incident.status !== 'resolved' ? 'danger' : 'default'} className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
          <div className="min-w-0">
            <Heading className="text-sm md:text-base font-black tracking-tight break-words">
              <Link
                to={incidentPath(incident._id, scope)}
                className="underline underline-offset-2 decoration-2 hover:text-[#c0392b] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
              >
                {incidentTitle(incident)}
              </Link>
            </Heading>
            <p className="text-xs text-[#1a1a1a]/70 break-words">
              {[unit, reporterText(incident), reported && `${reported} IST`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0 sm:justify-end">
            <IncidentStatusBadge status={incident.status} size="sm" />
            <SeverityBadge severity={incident.severity} size="sm" />
          </div>
        </div>
        {incident.description && <p className="text-sm break-words">{excerpt(incident.description)}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            {commentCountText(incident.commentCount)}
          </span>
          {booking ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <CalendarCheck className="w-4 h-4" aria-hidden="true" />
              <span>
                Booking {booking.slot} IST{booking.borrower ? ` · ${booking.borrower.name}` : ''}
              </span>
              <StatusBadge booking={incident.booking} size="sm" />
            </span>
          ) : (
            <span className="text-[#1a1a1a]/70">Not tied to a booking</span>
          )}
        </div>
        {resolution && (
          <p className="text-xs border-l-4 border-[#0b6e4f] pl-2">
            <span className="font-bold">Resolved: {resolution.outcome.label}</span> by {resolution.by}
            {resolution.at ? `, ${resolution.at}` : ''}
          </p>
        )}
      </Card>
    </li>
  );
}
