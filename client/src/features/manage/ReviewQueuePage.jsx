import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getManageBookings, decideBooking } from '../bookings/api';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { toast } from 'sonner';
import {
  Layers,
  Clock,
  User,
  CheckCircle2,
  XCircle,
  ListOrdered,
  AlertCircle,
  ShieldCheck,
  Award,
} from 'lucide-react';

export default function ReviewQueuePage() {
  const queryClient = useQueryClient();

  const { data: queueRes, isLoading, refetch } = useQuery({
    queryKey: ['bookings', 'manage'],
    queryFn: getManageBookings,
    refetchInterval: 30000,
  });

  const slotGroups = queueRes?.data || [];

  // Decision Modal State
  const [decisionModal, setDecisionModal] = useState({
    isOpen: false,
    bookingId: null,
    action: 'approve', // 'approve' | 'reject' | 'waitlist'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openDecision = (bookingId, action) => {
    setDecisionModal({ isOpen: true, bookingId, action });
  };

  const handleDecisionConfirm = async (reason) => {
    const { bookingId, action } = decisionModal;
    setIsSubmitting(true);
    try {
      await decideBooking(bookingId, action, reason);
      toast.success(
        `Request ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'waitlisted'} with audit rationale.`
      );
      setDecisionModal({ isOpen: false, bookingId: null, action: 'approve' });
      refetch();
    } catch (err) {
      toast.error(err.message || 'Decision failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatIST = (isoString) => {
    try {
      const d = new Date(isoString);
      return (
        d.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        }) + ' IST'
      );
    } catch (e) {
      return isoString;
    }
  };

  return (
    <div className="space-y-6 font-mono">
      {/* ── Top Queue Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-[#1a1a1a] pb-4">
        <div>
          <span className="text-xs uppercase font-bold text-[#e67e22] tracking-widest block">
            CONFLICT-AWARE ADJUDICATION
          </span>
          <h1 className="text-2xl font-black text-[#1a1a1a] tracking-tight">
            Facility Review Queue
          </h1>
          <p className="text-xs text-[#1a1a1a]/70 mt-1">
            Competing borrower requests are grouped side-by-side to ensure equitable allocation and conflict-free machine schedules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="amber" size="lg">
            {slotGroups.length} CONTESTED SLOTS
          </Badge>
        </div>
      </div>

      {/* ── Conflict Slot Groups ── */}
      {isLoading ? (
        <div className="p-12 text-center">
          <div className="w-8 h-8 border-4 border-[#e67e22] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <span className="text-xs font-bold">GROUPING CONFLICTING SLOTS...</span>
        </div>
      ) : slotGroups.length > 0 ? (
        <div className="space-y-6">
          {slotGroups.map((group, gIdx) => {
            const hasMultiple = group.requests.length > 1;

            return (
              <div
                key={group.slotKey || gIdx}
                className="rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[5px_5px_0_#1a1a1a] space-y-4"
              >
                {/* Slot Window Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b-2 border-[#1a1a1a]/15 bg-[#f5f0e8] -m-5 mb-0 p-4 rounded-t-lg">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded bg-white border border-[#1a1a1a]">
                      <Layers className="w-4 h-4 text-[#e67e22]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-[#1a1a1a] tracking-tight">
                        {group.resource?.title}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-[#183d2d] font-bold">
                        <Clock className="w-3.5 h-3.5" />
                        <span>
                          {formatIST(group.start)} → {formatIST(group.end)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasMultiple && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#c0392b] text-white">
                        ⚡ {group.requests.length} COMPETING REQUESTS
                      </span>
                    )}
                    <span className="text-xs text-[#1a1a1a]/60">
                      Unit: {group.resource?.orgUnit?.code || 'DIC'}
                    </span>
                  </div>
                </div>

                {/* Competing Requests Side-by-Side Grid */}
                <div
                  className={`grid gap-4 pt-2 ${
                    hasMultiple ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
                  }`}
                >
                  {group.requests.map((req, rIdx) => {
                    const isPending = req.status === 'pending';
                    const isWaitlisted = req.status === 'waitlisted';
                    const isApproved = req.status === 'approved';

                    return (
                      <div
                        key={req._id}
                        className={`rounded-lg border-2 p-4 space-y-3 transition-all ${
                          isApproved
                            ? 'bg-[#f0faf5] border-[#183d2d]'
                            : isWaitlisted
                            ? 'bg-[#fdf2ff] border-[#8e44ad]'
                            : 'bg-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                        }`}
                      >
                        {/* Requester Profile Snapshot */}
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#1a1a1a]/15">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded border border-[#1a1a1a] bg-white flex items-center justify-center font-bold text-xs">
                              {req.user?.name?.[0] || 'U'}
                            </div>
                            <div>
                              <div className="text-xs font-black text-[#1a1a1a]">
                                {req.user?.name}
                              </div>
                              <div className="text-[10px] text-[#1a1a1a]/70">
                                {req.user?.memberType} · {req.user?.department?.code || 'ENG'} ·{' '}
                                {req.user?.email}
                              </div>
                            </div>
                          </div>
                          <StatusBadge
                            status={req.status}
                            waitlistPosition={req.waitlistPosition}
                            size="sm"
                          />
                        </div>

                        {/* Purpose */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold uppercase text-[#1a1a1a]/60 block">
                            Stated Purpose:
                          </span>
                          <p className="text-xs text-[#1a1a1a]/90 bg-[#f5f0e8]/60 p-2 rounded border border-[#1a1a1a]/15 line-clamp-3">
                            &ldquo;{req.purpose}&rdquo;
                          </p>
                        </div>

                        {/* Eligibility Snapshot */}
                        <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                          <span className="px-2 py-0.5 rounded border border-[#183d2d] bg-[#f0faf5] text-[#183d2d]">
                            ✓ ID Verified
                          </span>
                          <span className="px-2 py-0.5 rounded border border-[#183d2d] bg-[#f0faf5] text-[#183d2d]">
                            ✓ Tier Approved ({req.user?.memberType})
                          </span>
                          <span className="px-2 py-0.5 rounded border border-[#183d2d] bg-[#f0faf5] text-[#183d2d]">
                            ✓ Quota Available
                          </span>
                        </div>

                        {/* Decision Action Buttons */}
                        <div className="pt-2 border-t border-[#1a1a1a]/15 flex flex-wrap items-center justify-end gap-2">
                          {!isApproved && (
                            <Button
                              variant="forest"
                              size="sm"
                              onClick={() => openDecision(req._id, 'approve')}
                              className="text-xs"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve Request
                            </Button>
                          )}

                          {!isWaitlisted && !isApproved && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openDecision(req._id, 'waitlist')}
                              className="text-xs border-[#8e44ad] text-[#8e44ad] hover:bg-[#8e44ad]/10"
                            >
                              <ListOrdered className="w-3.5 h-3.5" />
                              Waitlist
                            </Button>
                          )}

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDecision(req._id, 'reject')}
                            className="text-xs text-[#c0392b] hover:bg-[#c0392b]/10"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Review Queue Clear"
          description="There are currently no contested or pending equipment reservations awaiting manager adjudication."
          actionLabel="Refresh Queue"
          onAction={() => refetch()}
        />
      )}

      {/* ── Decision Reason Dialog ── */}
      <ReasonDialog
        isOpen={decisionModal.isOpen}
        onClose={() =>
          setDecisionModal({ isOpen: false, bookingId: null, action: 'approve' })
        }
        onSubmit={handleDecisionConfirm}
        title={
          decisionModal.action === 'approve'
            ? 'Approve Reservation Request'
            : decisionModal.action === 'reject'
            ? 'Reject Reservation Request'
            : 'Waitlist Competing Request'
        }
        subtitle="Mandatory recorded rationale delivered to the borrower and logged in the immutable audit trail."
        actionLabel={
          decisionModal.action === 'approve'
            ? 'Confirm Approval'
            : decisionModal.action === 'reject'
            ? 'Confirm Rejection'
            : 'Confirm Waitlist Placement'
        }
        actionVariant={
          decisionModal.action === 'approve'
            ? 'forest'
            : decisionModal.action === 'reject'
            ? 'danger'
            : 'primary'
        }
        loading={isSubmitting}
        templates={
          decisionModal.action === 'approve'
            ? [
                'Project purpose aligns with academic facility usage guidelines.',
                'Highest priority senior capstone submission.',
                'Safety compliance and operator checklist verified.',
              ]
            : decisionModal.action === 'waitlist'
            ? [
                'Slot held by an earlier competing request. Placed on waitlist.',
                'Capacity cap reached for this machine batch.',
              ]
            : [
                'Clashes with scheduled departmental lab coursework.',
                'Prerequisite safety workshop not completed.',
                'Consumables requested are out of stock in this unit.',
              ]
        }
      />
    </div>
  );
}

