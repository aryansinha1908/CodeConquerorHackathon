import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkBooking, createBooking } from '../api';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Select } from '../../../components/ui/Select';
import { toast } from 'sonner';
import {
  Calendar,
  Clock,
  Send,
  AlertCircle,
  CheckCircle2,
  ListOrdered,
  Sparkles,
  Info,
} from 'lucide-react';
import { useAuthStore } from '../../../stores/auth';

export function BookingPanel({ resource }) {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const slotMinutes = resource?.slotMinutes || 60;
  const minMins = resource?.limits?.minDurationMinutes || 60;
  const maxMins = resource?.limits?.maxDurationMinutes || 240;

  // Generate date options (Tomorrow onwards for booking per Golden Path)
  const dateOptions = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + (i + 1));
    const isoDate = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-IN', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return { value: isoDate, label };
  });

  const [selectedDate, setSelectedDate] = useState(dateOptions[0].value);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('12:00');
  const [purpose, setPurpose] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  // Time options based on operating hours (09:00 to 19:00)
  const timeOptions = [
    '09:00', '10:00', '11:00', '12:00', '13:00',
    '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'
  ];

  // Debounced live pre-check
  useEffect(() => {
    if (!selectedDate || !startTime || !endTime) return;

    const startISO = `${selectedDate}T${startTime}:00.000Z`;
    const endISO = `${selectedDate}T${endTime}:00.000Z`;

    // Validate that end > start
    if (endTime <= startTime) {
      setCheckResult({
        available: false,
        message: 'End time must be after start time.',
      });
      return;
    }

    const timer = setTimeout(async () => {
      setIsChecking(true);
      try {
        const res = await checkBooking({
          resourceId: resource._id,
          start: startISO,
          end: endISO,
          purpose,
        });
        setCheckResult(res.data);
      } catch (err) {
        setCheckResult({
          available: false,
          message: err.message || 'Slot check error',
        });
      } finally {
        setIsChecking(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [resource._id, selectedDate, startTime, endTime, purpose]);

  const purposeLength = purpose.trim().length;
  const isPurposeValid = purposeLength >= 10 && purposeLength <= 300;
  const canSubmit = isPurposeValid && endTime > startTime && !isSubmitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const startISO = `${selectedDate}T${startTime}:00.000Z`;
      const endISO = `${selectedDate}T${endTime}:00.000Z`;

      const res = await createBooking({
        resourceId: resource._id,
        start: startISO,
        end: endISO,
        purpose: purpose.trim(),
        joinWaitlist: !checkResult?.available,
      });

      toast.success(res.message || 'Booking placed successfully!');
      navigate('/bookings');
    } catch (err) {
      toast.error(err.message || 'Booking submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-2 border-[#1a1a1a] bg-white p-6 shadow-[5px_5px_0_#1a1a1a] font-mono space-y-5">
      <CardHeader className="pb-3 border-b-2 border-[#1a1a1a]/15">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#c0392b] block">
            LIVE AVAILABILITY ENGINE
          </span>
          <CardTitle>Reserve Time Slot</CardTitle>
        </div>
        <Badge variant={resource?.approvalMode === 'auto' ? 'forest' : 'outline'} size="sm">
          {resource?.approvalMode === 'auto' ? '⚡ INSTANT BOOK' : 'MANAGER REVIEW'}
        </Badge>
      </CardHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Date Selector */}
        <div>
          <label className="text-xs font-bold text-[#1a1a1a] uppercase block mb-1">
            Reservation Date (IST)
          </label>
          <div className="relative">
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full py-2.5 px-3 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
            >
              {dateOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.value})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Start and End Time Selectors */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-[#1a1a1a] uppercase block mb-1">
              Start Time
            </label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full py-2 px-3 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
            >
              {timeOptions.slice(0, -1).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-[#1a1a1a] uppercase block mb-1">
              End Time
            </label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full py-2 px-3 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
            >
              {timeOptions.slice(1).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Pre-check Result Banner */}
        <div className="pt-1">
          {isChecking ? (
            <div className="p-3 bg-[#ede8df] border-2 border-[#1a1a1a] rounded-lg text-xs flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-[#1a1a1a] border-t-transparent rounded-full animate-spin" />
              <span>Checking conflicts & capacity against live timetable...</span>
            </div>
          ) : checkResult ? (
            checkResult.available ? (
              <div className="p-3 bg-[#f0faf5] border-2 border-[#183d2d] rounded-lg text-xs text-[#183d2d] flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">✓ Slot is Open & Available</span>
                  <span className="text-[#183d2d]/80">{checkResult.message}</span>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-[#fdf2ff] border-2 border-[#8e44ad] rounded-lg text-xs text-[#8e44ad] flex items-start gap-2.5">
                <ListOrdered className="w-4 h-4 shrink-0 mt-0.5 text-[#8e44ad]" />
                <div>
                  <span className="font-bold block">
                    Slot Held by Another Request (Join Waitlist #{checkResult.waitlistPosition || 1})
                  </span>
                  <span className="text-[#8e44ad]/85">{checkResult.message}</span>
                </div>
              </div>
            )
          ) : null}
        </div>

        {/* Purpose Input */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs font-bold">
            <label htmlFor="purpose" className="text-[#1a1a1a]">
              Academic / Project Purpose:
            </label>
            <span
              className={
                purposeLength < 10 || purposeLength > 300
                  ? 'text-[#c0392b]'
                  : 'text-[#183d2d]'
              }
            >
              {purposeLength} / 300 (min 10)
            </span>
          </div>
          <textarea
            id="purpose"
            rows={3}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Printing drone frame for robotics final year project..."
            className="w-full p-2.5 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-[#f5f0e8]/30 focus:bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
          />
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <Button
            type="submit"
            variant={checkResult?.available === false ? 'outline' : 'primary'}
            size="md"
            disabled={!canSubmit}
            loading={isSubmitting}
            className={`w-full py-3 text-xs md:text-sm ${
              checkResult?.available === false ? 'border-[#8e44ad] text-[#8e44ad] hover:bg-[#8e44ad]/10' : ''
            }`}
          >
            {checkResult?.available === false ? (
              <>
                <ListOrdered className="w-4 h-4" />
                Join Waitlist as #{checkResult.waitlistPosition || 1}
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {resource?.approvalMode === 'auto'
                  ? 'Confirm Instant Booking'
                  : 'Submit Request for Approval'}
              </>
            )}
          </Button>
        </div>

        <p className="text-[10px] text-[#1a1a1a]/60 text-center">
          Slots comply with fair usage ({maxMins / 60}h max duration · weekly quota applied).
        </p>
      </form>
    </Card>
  );
}

