import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getResource, getAvailability } from '../features/resources/api';
import { EligibilityChecklist } from '../features/resources/components/EligibilityChecklist';
import { AvailabilityGrid } from '../features/resources/components/AvailabilityGrid';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import {
  ArrowLeft,
  MapPin,
  Clock,
  ShieldCheck,
  CheckSquare,
  AlertTriangle,
  Zap,
  Info,
  Calendar,
  Layers,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth';

export default function ResourceDetailPage() {
  const { id } = useParams();
  const { user } = useAuthStore();

  const {
    data: resourceRes,
    isLoading: resLoading,
    isError,
  } = useQuery({
    queryKey: ['resource', id],
    queryFn: () => getResource(id),
  });

  const { data: availRes, isLoading: availLoading } = useQuery({
    queryKey: ['resource', id, 'availability'],
    queryFn: () => getAvailability(id),
  });

  const resource = resourceRes?.data;
  const availability = availRes?.data;

  if (resLoading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center font-mono">
        <div className="w-8 h-8 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs font-bold text-[#1a1a1a]">LOADING RESOURCE SPECS...</p>
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="p-8 text-center font-mono space-y-4">
        <h2 className="text-xl font-black text-[#c0392b]">Resource Not Found</h2>
        <p className="text-xs text-[#1a1a1a]/70">The requested equipment ID does not exist in the active catalogue.</p>
        <Link to="/explore">
          <Button variant="outline" size="sm">
            ← Return to Explore
          </Button>
        </Link>
      </div>
    );
  }

  const riskBadgeProps = {
    low: { variant: 'teal', label: 'LOW RISK' },
    medium: { variant: 'amber', label: 'MED RISK' },
    high: { variant: 'red', label: 'HIGH RISK' },
  }[resource.riskLevel] || { variant: 'neutral', label: 'STANDARD' };

  return (
    <div className="space-y-6 font-mono">
      {/* ── Breadcrumb & Back ── */}
      <div className="flex items-center justify-between text-xs pb-2 border-b-2 border-[#1a1a1a]/15">
        <Link
          to="/explore"
          className="inline-flex items-center gap-1.5 font-bold text-[#183d2d] hover:text-[#c0392b] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          BACK TO ALL RESOURCES
        </Link>
        <div className="text-[#1a1a1a]/60">
          <span>{resource.orgUnit?.name || 'CAMPUS'}</span> /{' '}
          <strong className="text-[#1a1a1a]">{resource.title}</strong>
        </div>
      </div>

      {/* ── Main Layout (2 Columns) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left Column: Specs, Rules, Checklist (5 cols) ── */}
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <div className="flex items-center justify-between gap-2 mb-3">
              <Badge variant="outline" size="sm" className="bg-[#ede8df]">
                {resource.categoryLabel || 'EQUIPMENT'}
              </Badge>
              <div className="flex items-center gap-1.5">
                <Badge variant={riskBadgeProps.variant} size="sm">
                  {riskBadgeProps.label}
                </Badge>
                <Badge
                  variant={resource.approvalMode === 'auto' ? 'forest' : 'outline'}
                  size="sm"
                  className={resource.approvalMode === 'auto' ? 'bg-[#183d2d] text-white' : ''}
                >
                  {resource.approvalMode === 'auto' ? '⚡ INSTANT' : 'MANAGER APPROVAL'}
                </Badge>
              </div>
            </div>

            <h1 className="text-xl md:text-2xl font-black text-[#1a1a1a] tracking-tight leading-snug mb-2">
              {resource.title}
            </h1>

            <div className="flex items-start gap-1.5 text-xs text-[#1a1a1a]/80 mb-4">
              <MapPin className="w-4 h-4 text-[#c0392b] shrink-0 mt-0.5" />
              <span>
                <strong>{resource.location}</strong> ({resource.orgUnit?.name})
              </span>
            </div>

            <p className="text-xs text-[#1a1a1a]/80 leading-relaxed mb-6">
              {resource.description}
            </p>

            {/* Quota meter */}
            <div className="p-3.5 bg-[#f5f0e8] border-2 border-[#1a1a1a] rounded-xl space-y-2 mb-6">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#183d2d]" />
                  WEEKLY USAGE QUOTA
                </span>
                <span className="text-[#183d2d]">0 / {resource.limits?.maxHoursPerWeek || 6} h used</span>
              </div>
              <div className="w-full bg-white h-2.5 rounded-full border border-[#1a1a1a] overflow-hidden">
                <div className="bg-[#183d2d] h-full w-[0%]" />
              </div>
              <p className="text-[10px] text-[#1a1a1a]/60">
                Resets every Monday 00:00 IST · Max {resource.limits?.maxDurationMinutes ? resource.limits.maxDurationMinutes / 60 : 4}h per single reservation.
              </p>
            </div>

            {/* Return condition checklist preview */}
            {resource.checklist?.length > 0 && (
              <div className="border-t-2 border-[#1a1a1a]/15 pt-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a] mb-2 flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-[#183d2d]" />
                  Mandatory Return Checklist
                </h4>
                <p className="text-[11px] text-[#1a1a1a]/70 mb-3">
                  Borrowers must verify each condition with photos during check-in and return:
                </p>
                <ul className="space-y-1.5 text-xs text-[#1a1a1a]/85">
                  {resource.checklist.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-[#c0392b] mt-0.5">[{idx + 1}]</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* Guidelines Box */}
          <Card className="bg-[#ede8df]">
            <h4 className="text-xs font-bold uppercase text-[#1a1a1a] mb-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-[#e67e22]" />
              Reservation Protocol
            </h4>
            <ul className="text-xs text-[#1a1a1a]/80 space-y-2 leading-relaxed">
              <li>
                <strong>Automatic Cancellation:</strong> Bookings not checked-in within 15 minutes of slot start time are marked as <code>no_show</code>.
              </li>
              <li>
                <strong>Safety Gear:</strong> Operators must provide their own safety goggles, lab coats, and PPE where applicable.
              </li>
            </ul>
          </Card>
        </div>

        {/* ── Right Column: Eligibility & 7-Day Schedule (7 cols) ── */}
        <div className="lg:col-span-7 space-y-6">
          {/* Eligibility Checklist */}
          <EligibilityChecklist resource={resource} />

          {/* 7-Day Availability Grid */}
          <AvailabilityGrid resource={resource} availability={availability} />
        </div>
      </div>
    </div>
  );
}

