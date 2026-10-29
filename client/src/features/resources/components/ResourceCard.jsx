import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Award, Building2, Clock, MapPin, Zap } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import {
  approvalView,
  bookingModeLabel,
  categoryLabel,
  formatLocation,
  formatQuantity,
  isListingImage,
  resourceStatusView,
  riskView,
} from '../format';

// One resource in Explore's grid: a Card from GET /resources (api.md "Resources"). Shows the unit,
// risk level, approval mode, badges needed, location (an object, formatted) and the opening hours
// the server wrote ("Mon–Sat 09:00–17:00"). The title is the card's one link to the detail page,
// plus an explicit "View and book" link; no button sits inside a link.

const linkClass =
  'inline-flex items-center justify-center gap-1.5 font-bold font-mono tracking-tight border-2 border-[#1a1a1a] ' +
  'px-3 py-2 min-h-[40px] text-xs rounded-md bg-[#c0392b] text-white shadow-[3px_3px_0px_0px_#1a1a1a] ' +
  'hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px] transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a1a1a] focus-visible:ring-offset-2';

export function ResourceCard({ resource, headingLevel = 'h3' }) {
  const Heading = headingLevel;
  const href = `/resources/${encodeURIComponent(resource._id)}`;
  const risk = riskView(resource.riskLevel);
  const approval = approvalView(resource.eligibility?.approvalMode);
  const status = resourceStatusView(resource.status);
  const location = formatLocation(resource.location);
  const badges = Array.isArray(resource.eligibility?.badges)
    ? resource.eligibility.badges.filter((b) => b && typeof b === 'object')
    : [];
  // Only a Cloudinary upload of ours: any other host would see every visitor of Explore.
  const image = Array.isArray(resource.images) ? resource.images.find(isListingImage) : null;
  const unit = resource.orgUnit && typeof resource.orgUnit === 'object' ? resource.orgUnit : null;

  return (
    <article className="h-full rounded-xl border-2 border-[#1a1a1a] bg-white font-mono text-[#1a1a1a] shadow-[4px_4px_0_#1a1a1a] flex flex-col overflow-hidden">
      {image && (
        <img
          src={image.url}
          alt=""
          loading="lazy"
          className="w-full h-36 object-cover border-b-2 border-[#1a1a1a] bg-[#ede8df]"
        />
      )}
      <div className="p-5 flex flex-col gap-3 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="neutral" size="sm">
            {categoryLabel(resource.category)}
          </Badge>
          <Badge variant={risk.variant} size="sm">
            {risk.label}
          </Badge>
          {resource.status && resource.status !== 'active' && (
            <Badge variant={status.variant} size="sm">
              {status.label}
            </Badge>
          )}
        </div>

        <div>
          <Heading className="text-base font-black tracking-tight leading-snug break-words">
            <Link
              to={href}
              className="hover:text-[#a93226] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] rounded-sm"
            >
              {resource.title}
            </Link>
          </Heading>
          {unit?.name && (
            <p className="mt-1 text-xs text-[#1a1a1a]/80 flex items-start gap-1.5">
              <Building2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="sr-only">Unit: </span>
                {unit.name}
                {unit.code ? ` (${unit.code.toUpperCase()})` : ''}
              </span>
            </p>
          )}
        </div>

        {resource.description && (
          <p className="text-xs text-[#1a1a1a]/80 leading-relaxed line-clamp-2">{resource.description}</p>
        )}

        <dl className="grid grid-cols-1 gap-1.5 text-xs p-2.5 rounded-lg bg-[#f5f0e8] border border-[#1a1a1a]/25">
          <div className="flex items-start gap-1.5">
            <dt>
              <MapPin className="w-3.5 h-3.5 mt-0.5 text-[#a93226]" aria-hidden="true" />
              <span className="sr-only">Location</span>
            </dt>
            <dd className="min-w-0 break-words">{location ?? 'Location not listed'}</dd>
          </div>
          <div className="flex items-start gap-1.5">
            <dt>
              <Clock className="w-3.5 h-3.5 mt-0.5 text-[#183d2d]" aria-hidden="true" />
              <span className="sr-only">Opening hours</span>
            </dt>
            <dd className="min-w-0 break-words">{resource.openHours || 'Hours not listed'}</dd>
          </div>
          <div className="flex items-start gap-1.5">
            <dt>
              <Zap className="w-3.5 h-3.5 mt-0.5 text-[#183d2d]" aria-hidden="true" />
              <span className="sr-only">Approval</span>
            </dt>
            <dd>
              {approval.label} · {bookingModeLabel(resource.bookingMode)} · {formatQuantity(resource.quantity)}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75 mb-1.5">Badges needed</p>
          {badges.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <li
                  key={badge._id ?? badge.code ?? badge.name}
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded border border-[#1a1a1a] bg-[#fdf3c4]"
                >
                  <Award className="w-3 h-3" aria-hidden="true" />
                  {badge.name ?? badge.code}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs">None</p>
          )}
        </div>

        <div className="mt-auto pt-3 border-t-2 border-[#1a1a1a]/10 flex justify-end">
          <Link to={href} className={linkClass} aria-label={`View and book ${resource.title}`}>
            View and book
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
