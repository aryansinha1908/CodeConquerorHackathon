import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getBooking, cancelBooking } from './api';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { BookingTimeline } from './components/BookingTimeline';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { ReasonDialog } from '../../components/ui/ReasonDialog';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Clock,
  MapPin,
  LogIn,
  LogOut,
  Ban,
  FileCheck,
  Camera,
  Layers,
  User,
  ShieldCheck,
} from 'lucide-react';

export function BookingDetailPage() {
  const { id } = useParams();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const { data: bookingRes, isLoading, refetch } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => getBooking(id),
  });

  const booking = bookingRes?.data;
  const resource = booking?.resource;

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center font-mono">
        <div className="w-8 h-8 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin mb-3" />
        <span className="text-xs font-bold text-[#1a1a1a]">LOADING BOOKING TIMELINE...</span>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="p-8 text-center font-mono space-y-4">
        <h2 className="text-xl font-black text-[#c0392b]">Booking Record Not Found</h2>
        <Link to="/bookings">
          <Button variant="outline" size="sm">
            ← Return to Bookings
          </Button>
        </Link>
      </div>
    );
  }

  const handleCancelConfirm = async (reason) => {
    setIsCancelling(true);
    try {
      await cancelBooking(id, reason);
      toast.success('Reservation cancelled.');
      setCancelOpen(false);
      refetch();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel');
    } finally {
      setIsCancelling(false);
    }
  };

  const isApproved = booking.status === 'approved';
  const isInUse = booking.status === 'checked_in';
  const canCancel = ['pending', 'approved', 'waitlisted'].includes(booking.status);

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
      {/* ── Top Breadcrumb ── */}
      <div className="flex items-center justify-between pb-2 border-b-2 border-[#1a1a1a]/15 text-xs">
        <Link
          to="/bookings"
          className="inline-flex items-center gap-1.5 font-bold text-[#183d2d] hover:text-[#c0392b]"
        >
          <ArrowLeft className="w-4 h-4" />
          BACK TO ALL BOOKINGS
        </Link>
        <span className="text-[#1a1a1a]/60">
          IDENTIFIER: <strong>{booking._id}</strong>
        </span>
      </div>

      {/* ── Main Hero Card ── */}
      <Card className="border-2 border-[#1a1a1a] bg-white p-6 shadow-[5px_5px_0_#1a1a1a]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b-2 border-[#1a1a1a]/15">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#183d2d]">
              NIT JAMSHEDPUR // RESOURCE PASS
            </span>
            <h1 className="text-xl md:text-2xl font-black text-[#1a1a1a] tracking-tight">
              {resource?.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#1a1a1a]/70">
              <span className="flex items-center gap-1.5 font-bold text-[#183d2d]">
                <Clock className="w-3.5 h-3.5" />
                {formatIST(booking.start)} → {formatIST(booking.end)}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#c0392b]" />
                {resource?.location || resource?.orgUnit?.name}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StatusBadge
              status={booking.status}
              waitlistPosition={booking.waitlistPosition}
              size="lg"
            />
          </div>
        </div>

        {/* Purpose */}
        {booking.purpose && (
          <div className="pt-4 pb-2">
            <span className="text-[11px] font-bold text-[#1a1a1a]/60 uppercase block mb-1">
              Recorded Purpose of Use:
            </span>
            <p className="text-xs text-[#1a1a1a] bg-[#f5f0e8] p-3 rounded-lg border border-[#1a1a1a]/20">
              &ldquo;{booking.purpose}&rdquo;
            </p>
          </div>
        )}

        {/* Actions bar */}
        <div className="pt-4 flex flex-wrap items-center gap-3 border-t border-[#1a1a1a]/15">
          {isApproved && (
            <Link to={`/bookings/${id}/check-in`}>
              <Button variant="primary" size="md" className="bg-[#183d2d]">
                <LogIn className="w-4 h-4" />
                Check In to Equipment
              </Button>
            </Link>
          )}

          {isInUse && (
            <Link to={`/bookings/${id}/check-out`}>
              <Button variant="primary" size="md" className="bg-[#1abc9c] text-[#1a1a1a]">
                <LogOut className="w-4 h-4" />
                Check Out & Return Gear
              </Button>
            </Link>
          )}

          {canCancel && (
            <Button
              variant="outline"
              size="md"
              onClick={() => setCancelOpen(true)}
              className="text-[#c0392b] hover:bg-[#c0392b]/10"
            >
              <Ban className="w-4 h-4" />
              Cancel Booking
            </Button>
          )}

          <Link to={`/resources/${resource?._id}`}>
            <Button variant="outline" size="md">
              View Machine Catalog
            </Button>
          </Link>
        </div>
      </Card>

      {/* ── 2 Columns: Condition Reports (Left) & Audit Timeline (Right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Handover Condition Reports */}
        <div className="lg:col-span-6 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-[#183d2d]" />
                <CardTitle>Handover & Condition Reports</CardTitle>
              </div>
            </CardHeader>

            {booking.conditionReports ? (
              <div className="space-y-4">
                {booking.conditionReports.checkIn && (
                  <div className="p-4 rounded-lg border-2 border-[#1a1a1a] bg-[#f5f0e8]/50 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-[#183d2d] flex items-center gap-1.5">
                        <LogIn className="w-3.5 h-3.5" />
                        CHECK-IN REPORT
                      </span>
                      <span className="uppercase text-[10px] px-2 py-0.5 rounded bg-white border border-[#1a1a1a]">
                        CONDITION: {booking.conditionReports.checkIn.overall}
                      </span>
                    </div>
                    <p className="text-xs text-[#1a1a1a]/80 italic">
                      &ldquo;{booking.conditionReports.checkIn.notes}&rdquo;
                    </p>
                    {booking.conditionReports.checkIn.photos?.length > 0 && (
                      <div className="flex gap-2 pt-1">
                        {booking.conditionReports.checkIn.photos.map((p, idx) => (
                          <img
                            key={idx}
                            src={p}
                            alt="Check-in"
                            className="w-16 h-16 object-cover rounded border border-[#1a1a1a]"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {booking.conditionReports.checkOut && (
                  <div className="p-4 rounded-lg border-2 border-[#1a1a1a] bg-[#f0faf5] space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-[#1abc9c] flex items-center gap-1.5">
                        <LogOut className="w-3.5 h-3.5" />
                        CHECK-OUT REPORT
                      </span>
                      <span className="uppercase text-[10px] px-2 py-0.5 rounded bg-white border border-[#1a1a1a]">
                        CONDITION: {booking.conditionReports.checkOut.overall}
                      </span>
                    </div>
                    <p className="text-xs text-[#1a1a1a]/80 italic">
                      &ldquo;{booking.conditionReports.checkOut.notes}&rdquo;
                    </p>
                    {booking.conditionReports.checkOut.photos?.length > 0 && (
                      <div className="flex gap-2 pt-1">
                        {booking.conditionReports.checkOut.photos.map((p, idx) => (
                          <img
                            key={idx}
                            src={p}
                            alt="Check-out"
                            className="w-16 h-16 object-cover rounded border border-[#1a1a1a]"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-[#1a1a1a]/60 bg-[#f5f0e8]/40 rounded-lg border-2 border-dashed border-[#1a1a1a]/20">
                No physical condition photos submitted yet. Handover reports are generated during Check-in and Check-out.
              </div>
            )}
          </Card>
        </div>

        {/* Right: Booking Timeline (Audit Trail) */}
        <div className="lg:col-span-6 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#c0392b]" />
                <CardTitle>Lifecycle Audit Timeline</CardTitle>
              </div>
            </CardHeader>
            <BookingTimeline timeline={booking.timeline} />
          </Card>
        </div>
      </div>

      {/* ── Cancel Reason Dialog ── */}
      <ReasonDialog
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onSubmit={handleCancelConfirm}
        title="Cancel Equipment Reservation"
        subtitle={`Please state the reason for cancelling reservation ${id}.`}
        actionLabel="Confirm Cancellation"
        actionVariant="danger"
        loading={isCancelling}
      />
    </div>
  );
}

