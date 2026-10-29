import React from 'react';
import { Award, Building2, ClipboardCheck, Clock, Eye, MapPin, Users, Zap } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import {
  approvalView,
  bookingModeLabel,
  categoryLabel,
  departmentsText,
  formatLocation,
  formatQuantity,
  isListingImage,
  limitsList,
  memberTypesText,
  riskView,
} from '../../resources/format';
import { FormSection } from './FormBits';
import { unitName } from './listingForm';

// The preview (frontend.md §6.3): the listing as members will read it, in Explore's card style,
// from the form as it stands, with the opening hours written the way the server writes them.
// Nothing here is sent; links are left out so nothing points at a page that doesn't exist yet.

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="shrink-0">
        <Icon className="w-4 h-4 mt-0.5 text-[#183d2d]" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function PreviewSection({ preview }) {
  const risk = riskView(preview.riskLevel);
  const approval = approvalView(preview.eligibility.approvalMode);
  const location = formatLocation(preview.location);
  const image = (preview.images ?? []).find(isListingImage);
  const badges = preview.eligibility.badges;
  const limits = limitsList(preview.limits);

  return (
    <FormSection
      id="section-preview"
      title="Preview"
      description="How members will see the listing in Explore and on its page, from the form as it is now."
    >
      <article
        aria-label={`Preview of ${preview.title}`}
        className="max-w-xl rounded-xl border-2 border-[#1a1a1a] bg-white font-mono text-[#1a1a1a] shadow-[4px_4px_0_#1a1a1a] overflow-hidden"
      >
        {image && (
          <img src={image.url} alt="" className="w-full h-40 object-cover border-b-2 border-[#1a1a1a] bg-[#ede8df]" />
        )}
        <div className="p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral" size="sm">
              {preview.category ? categoryLabel(preview.category) : 'No category yet'}
            </Badge>
            <Badge variant={risk.variant} size="sm">
              {risk.label}
            </Badge>
            <Badge variant={approval.variant} size="sm">
              {approval.label}
            </Badge>
          </div>
          <div>
            <p className="text-base font-black tracking-tight break-words">{preview.title}</p>
            <p className="mt-1 text-xs text-[#1a1a1a]/80 flex items-start gap-1.5">
              <Building2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{preview.orgUnit ? unitName(preview.orgUnit) : 'Unit not chosen yet'}</span>
            </p>
          </div>
          {preview.description && <p className="text-xs leading-relaxed whitespace-pre-line">{preview.description}</p>}

          <dl className="grid grid-cols-1 gap-1.5 text-xs p-3 rounded-lg bg-[#f5f0e8] border border-[#1a1a1a]/25">
            <Row icon={MapPin} label="Location">
              {location ?? 'Location not listed'}
            </Row>
            <Row icon={Clock} label="Opening hours">
              {preview.openHours}
              {preview.closures > 0 && ` · ${preview.closures} ${preview.closures === 1 ? 'closure' : 'closures'} planned`}
              {` · ${preview.slotMinutes}-minute slots`}
            </Row>
            <Row icon={Zap} label="How it is booked">
              {bookingModeLabel(preview.bookingMode)} · {formatQuantity(preview.quantity)}
            </Row>
            <Row icon={Users} label="Who may book">
              {memberTypesText(preview.eligibility.memberTypes)} · {departmentsText(preview.eligibility.departments)}
            </Row>
          </dl>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75 mb-1.5">Badges needed</p>
            {badges.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {badges.map((badge) => (
                  <li
                    key={badge._id}
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

          {limits.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75 mb-1.5">Limits</p>
              <ul className="text-xs space-y-0.5">
                {limits.map((limit) => (
                  <li key={limit.label}>
                    <span className="font-bold">{limit.label}:</span> {limit.value}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.usageRules && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75 mb-1.5">Usage rules</p>
              <p className="text-xs leading-relaxed whitespace-pre-line">{preview.usageRules}</p>
            </div>
          )}

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#1a1a1a]/75 mb-1.5 flex items-center gap-1">
              <ClipboardCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Checked at every handover
            </p>
            {preview.checklist.length ? (
              <ul className="text-xs list-disc pl-5 space-y-0.5">
                {preview.checklist.map((label, index) => (
                  <li key={`${index}-${label}`}>{label}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs">No items yet</p>
            )}
          </div>
        </div>
      </article>
      <p className="text-xs text-[#1a1a1a]/70 flex items-center gap-1.5">
        <Eye className="w-4 h-4" aria-hidden="true" />
        Members also see the live availability grid and their own eligibility checklist.
      </p>
    </FormSection>
  );
}
