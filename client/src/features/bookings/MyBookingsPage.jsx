import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMyBookings, cancelBooking } from './api';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { toast } from 'sonner';
import {
  CalendarCheck,
  Clock,
  MapPin,
  ArrowRight,
  LogIn,
  LogOut,
  Ban,
  AlertTriangle,
  Layers,
  ChevronRight,
} from 'lucide-react';

export default function MyBookingsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'upcoming';

  const [cancelModalBooking, setCancelModalBooking] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const { data: bookingsRes, isLoading, refetch } = useQuery({
    queryKey: ['bookings', 'mine'],
    queryFn: getMyBookings,
  });

  const allBookings = bookingsRes?.data || [];

  // Group by lifecycle tab
  const upcoming = allBookings.filter((b) =>
    ['approved', 'checked_in'].includes(b.status)
  );
  const requests = allBookings.filter((b) =>
    ['pending', 'waitlisted'].includes(b.status)
  );
  const past = allBookings.filter((b) =>
    ['completed', 'rejected', 'cancelled', 'no_show', 'expired', 'flagged'].includes(
      b.status
    )
  );

  const displayed =
    currentTab === 'upcoming'
      ? upcoming
      : currentTab === 'requests'
      ? requests
      : past;

  const handleCancelConfirm = async (reason) => {
    if (!cancelModalBooking) return;
    setIsCancelling(true);
    try {
      await cancelBooking(cancelModalBooking._id, reason);
      toast.success('Booking cancelled.');
      setCancelModalBooking(null);
      refetch();
    } catch (err) {
      toast.error(err.message || 'Cancellation failed');
    } finally {
      setIsCancelling(false);
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
      {/* ── Page Header ── */}
      <div className="border-b-2 border-[#1a1a1a] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-xs uppercase font-bold text-[#c0392b] tracking-widest block">
            RESERVATION MANAGEMENT
          </span>
          <h1 className="text-2xl font-black text-[#1a1a1a] tracking-tight">
            My Campus Bookings
          </h1>
        </div>
        <Link to="/explore">
          <Button variant="primary" size="sm">
            Book New Equipment →
          </Button>
        </Link>
      </div>

      {/* ── Lifecycle Tabs ── */}
      <div className="flex border-b-2 border-[#1a1a1a] gap-2">
        {[
          { key: 'upcoming', label: 'Upcoming & In-Use', count: upcoming.length },
          { key: 'requests', label: 'Pending Requests', count: requests.length },
          { key: 'past', label: 'Past & Completed', count: past.length },
        ].map((tab) => {
          const isActive = currentTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSearchParams({ tab: tab.key })}
              className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-t-2 border-x-2 -mb-[2px] rounded-t-lg transition-all ${
                isActive
                  ? 'bg-white border-[#1a1a1a] text-[#1a1a1a] shadow-[2px_-2px_0_#1a1a1a]'
                  : 'bg-[#ede8df] border-transparent text-[#1a1a1a]/60 hover:text-[#1a1a1a]'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`ml-2 px-1.5 py-0.2 rounded text-[10px] font-black ${
                  isActive ? 'bg-[#183d2d] text-white' : 'bg-[#1a1a1a]/15 text-[#1a1a1a]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Booking List ── */}
      {isLoading ? (
        <div className="p-12 text-center">
          <div className="w-8 h-8 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <span className="text-xs font-bold">LOADING RESERVATIONS...</span>
        </div>
      ) : displayed.length > 0 ? (
        <div className="space-y-4">
          {displayed.map((booking) => {
            const isApproved = booking.status === 'approved';
            const isInUse = booking.status === 'checked_in';
            const canCancel = ['pending', 'approved', 'waitlisted'].includes(booking.status);

            return (
              <div
                key={booking._id}
                className="rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a] hover:shadow-[5px_5px_0_#1a1a1a] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Left Info */}
                <div className="space-y-2 max-w-xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      status={booking.status}
                      waitlistPosition={booking.waitlistPosition}
                    />
                    <span className="text-xs text-[#1a1a1a]/50 font-bold">
                      REF: {booking._id}
                    </span>
                  </div>

                  <h3 className="text-base font-black text-[#1a1a1a] tracking-tight">
                    <Link
                      to={`/bookings/${booking._id}`}
                      className="hover:text-[#c0392b] transition-colors"
                    >
                      {booking.resource?.title || 'Resource'}
                    </Link>
                  </h3>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#1a1a1a]/70">
                    <span className="flex items-center gap-1.5 font-bold text-[#183d2d]">
                      <Clock className="w-3.5 h-3.5" />
                      {formatIST(booking.start)} → {formatIST(booking.end)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#c0392b]" />
                      {booking.resource?.location || booking.resource?.orgUnit?.name}
                    </span>
                  </div>

                  {booking.purpose && (
                    <p className="text-xs text-[#1a1a1a]/80 line-clamp-1 italic bg-[#f5f0e8] px-2 py-1 rounded border border-[#1a1a1a]/15">
                      &ldquo;{booking.purpose}&rdquo;
                    </p>
                  )}
                </div>

                {/* Right Contextual Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#1a1a1a]/10">
                  {isApproved && (
                    <Link to={`/bookings/${booking._id}/check-in`}>
                      <Button variant="primary" size="sm" className="bg-[#183d2d]">
                        <LogIn className="w-3.5 h-3.5" />
                        Check In Now
                      </Button>
                    </Link>
                  )}

                  {isInUse && (
                    <Link to={`/bookings/${booking._id}/check-out`}>
                      <Button variant="primary" size="sm" className="bg-[#1abc9c] text-[#1a1a1a]">
                        <LogOut className="w-3.5 h-3.5" />
                        Check Out & Return
                      </Button>
                    </Link>
                  )}

                  {canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCancelModalBooking(booking)}
                      className="text-[#c0392b] hover:bg-[#c0392b]/10"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Cancel
                    </Button>
                  )}

                  <Link to={`/bookings/${booking._id}`}>
                    <Button variant="outline" size="sm">
                      Timeline
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={`No ${currentTab} bookings`}
          description={
            currentTab === 'upcoming'
              ? 'You have no confirmed upcoming equipment reservations.'
              : currentTab === 'requests'
              ? 'No pending approval requests in queue.'
              : 'No past booking records in your history.'
          }
          actionLabel="Explore Campus Gear"
          onAction={() => (window.location.href = '/explore')}
        />
      )}

      {/* ── Cancel Reason Dialog ── */}
      <ReasonDialog
        isOpen={!!cancelModalBooking}
        onClose={() => setCancelModalBooking(null)}
        onSubmit={handleCancelConfirm}
        title="Cancel Equipment Reservation"
        subtitle={`Please state the reason for cancelling reservation ${cancelModalBooking?._id}.`}
        actionLabel="Confirm Cancellation"
        actionVariant="danger"
        loading={isCancelling}
        templates={[
          'Schedule clash with departmental coursework.',
          'Project completed earlier than expected.',
          'Selected wrong equipment or timeframe.',
        ]}
      />
    </div>
  );
}

