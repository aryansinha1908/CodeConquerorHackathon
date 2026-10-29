import React, { useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import { getBooking, checkInBooking, checkOutBooking } from '../api';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader, CardTitle } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { toast } from 'sonner';
import {
  Camera,
  CheckSquare,
  Square,
  AlertTriangle,
  Upload,
  ArrowLeft,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  Layers,
  FileCheck,
} from 'lucide-react';

export function CheckInOutWizard({ mode = 'check-in' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCheckIn = mode === 'check-in';

  const { data: bookingRes, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => getBooking(id),
  });

  const booking = bookingRes?.data;
  const resource = booking?.resource;
  const defaultChecklist = resource?.checklist || [
    'Inspect physical housing for prior cracks or burns',
    'Verify emergency stop and power switch operation',
    'Confirm workstation and surrounding bench area is tidy',
  ];

  // Form State
  const [checkedItems, setCheckedItems] = useState({});
  const [overallCondition, setOverallCondition] = useState('good');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState([]);
  const [photoPreviews, setPhotoPreviews] = useState([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const toggleCheck = (idx) => {
    setCheckedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const allChecked = defaultChecklist.every((_, idx) => checkedItems[idx]);

  // Image upload with compression
  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (photos.length >= 3) {
      toast.error('Maximum 3 photos permitted per handover report.');
      return;
    }

    setIsCompressing(true);
    try {
      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      };
      const compressed = await imageCompression(file, options);
      const preview = URL.createObjectURL(compressed);
      setPhotos((p) => [...p, compressed]);
      setPhotoPreviews((p) => [...p, preview]);
      toast.success(
        `Photo optimized (${(compressed.size / 1024).toFixed(0)} KB)`
      );
    } catch (err) {
      // fallback
      const preview = URL.createObjectURL(file);
      setPhotos((p) => [...p, file]);
      setPhotoPreviews((p) => [...p, preview]);
    } finally {
      setIsCompressing(false);
    }
  };

  const removePhoto = (idx) => {
    setPhotos((p) => p.filter((_, i) => i !== idx));
    setPhotoPreviews((p) => p.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!allChecked) {
      toast.error('Please verify and toggle every checklist item.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        overall: overallCondition,
        notes: notes.trim(),
        checklist: defaultChecklist.filter((_, i) => checkedItems[i]),
        photos: photoPreviews.length > 0 ? photoPreviews : ['/background.jpeg'],
      };

      if (isCheckIn) {
        await checkInBooking(id, payload);
        toast.success('Check-in confirmed! Equipment is now in use.');
      } else {
        await checkOutBooking(id, payload);
        toast.success('Check-out completed! Return awaiting manager confirmation.');
      }

      navigate(`/bookings/${id}`);
    } catch (err) {
      toast.error(err.message || 'Handover submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center font-mono">
        <div className="w-8 h-8 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin mb-3" />
        <span className="text-xs font-bold text-[#1a1a1a]">LOADING HANDOVER WIZARD...</span>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="p-8 text-center font-mono space-y-4">
        <h2 className="text-xl font-black text-[#c0392b]">Booking Record Not Found</h2>
        <Link to="/bookings">
          <Button variant="outline" size="sm">
            ← Return to My Bookings
          </Button>
        </Link>
      </div>
    );
  }

  const checkInPhotos = booking.conditionReports?.checkIn?.photos || [];

  return (
    <div className="max-w-3xl mx-auto space-y-6 font-mono">
      {/* ── Top Header ── */}
      <div className="flex items-center justify-between pb-3 border-b-2 border-[#1a1a1a]/15 text-xs">
        <Link
          to={`/bookings/${id}`}
          className="inline-flex items-center gap-1.5 font-bold text-[#183d2d] hover:text-[#c0392b]"
        >
          <ArrowLeft className="w-4 h-4" />
          BACK TO BOOKING DETAILS
        </Link>
        <span className="text-[#1a1a1a]/60">
          REF: <strong>{booking._id}</strong>
        </span>
      </div>

      <div className="bg-[#ede8df] border-2 border-[#1a1a1a] rounded-xl p-5 shadow-[4px_4px_0_#1a1a1a] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#c0392b] block">
            {isCheckIn ? 'STEP 1: PRE-USAGE HANDOVER' : 'STEP 2: POST-USAGE RETURN'}
          </span>
          <h1 className="text-xl font-black text-[#1a1a1a] tracking-tight">
            {isCheckIn ? 'Machine Check-In Wizard' : 'Machine Check-Out & Return'}
          </h1>
          <p className="text-xs text-[#1a1a1a]/70 mt-1">
            {resource?.title} · {resource?.location}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      {/* ── Side-by-side comparison for Check-Out mode ── */}
      {!isCheckIn && checkInPhotos.length > 0 && (
        <Card className="border-2 border-[#2980b9] bg-[#f0f4ff]">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-[#2980b9]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#2980b9]">
              Reference: Photos Captured During Check-In
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {checkInPhotos.map((photo, i) => (
              <div
                key={i}
                className="rounded-lg border-2 border-[#1a1a1a] overflow-hidden bg-white shadow-[2px_2px_0_#1a1a1a]"
              >
                <img
                  src={photo}
                  alt={`Check-in condition ${i + 1}`}
                  className="w-full h-28 object-cover"
                />
                <div className="p-1.5 text-[10px] font-bold text-center bg-[#ede8df]">
                  Check-in Photo #{i + 1}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Wizard Form ── */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Step 1: Checklist */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-[#183d2d] text-white flex items-center justify-center text-xs font-black">
                1
              </span>
              <CardTitle>Physical Safety & Condition Checklist</CardTitle>
            </div>
            <span className="text-xs font-bold text-[#183d2d]">
              {Object.values(checkedItems).filter(Boolean).length} / {defaultChecklist.length} verified
            </span>
          </CardHeader>

          <p className="text-xs text-[#1a1a1a]/70 mb-4">
            Inspect the equipment on-site and check each mandatory verification requirement:
          </p>

          <div className="space-y-2.5">
            {defaultChecklist.map((item, idx) => {
              const isChecked = !!checkedItems[idx];
              return (
                <div
                  key={idx}
                  onClick={() => toggleCheck(idx)}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all flex items-start gap-3 select-none ${
                    isChecked
                      ? 'bg-[#f0faf5] border-[#183d2d] text-[#183d2d]'
                      : 'bg-white border-[#1a1a1a] hover:bg-[#f5f0e8]'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 text-[#183d2d]" />
                    ) : (
                      <Square className="w-4 h-4 text-[#1a1a1a]/40" />
                    )}
                  </div>
                  <span className="text-xs font-bold">{item}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Step 2: Photos */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-[#183d2d] text-white flex items-center justify-center text-xs font-black">
                2
              </span>
              <CardTitle>Capture Handover Photographs</CardTitle>
            </div>
            <span className="text-xs text-[#1a1a1a]/60">Max 3 images · Compressed</span>
          </CardHeader>

          <div className="space-y-3">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#1a1a1a] rounded-xl p-6 bg-[#f5f0e8]/50 hover:bg-[#ede8df] cursor-pointer text-center transition-colors flex flex-col items-center justify-center gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <div className="w-10 h-10 rounded-lg bg-white border-2 border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a] flex items-center justify-center text-[#183d2d]">
                <Camera className="w-5 h-5" />
              </div>
              <span className="text-xs font-bold text-[#1a1a1a]">
                Take photo with mobile camera or upload from device
              </span>
              <span className="text-[10px] text-[#1a1a1a]/60">
                Automatic on-device compression & thumbnail generation
              </span>
            </div>

            {/* Photo Previews */}
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-3 gap-3 pt-2">
                {photoPreviews.map((src, idx) => (
                  <div
                    key={idx}
                    className="relative rounded-lg border-2 border-[#1a1a1a] overflow-hidden bg-white shadow-[2px_2px_0_#1a1a1a]"
                  >
                    <img
                      src={src}
                      alt={`Handover photo ${idx + 1}`}
                      className="w-full h-24 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-[#c0392b] text-white text-[10px] font-bold"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Step 3: Overall Condition & Notes */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-[#183d2d] text-white flex items-center justify-center text-xs font-black">
                3
              </span>
              <CardTitle>Overall Equipment Condition</CardTitle>
            </div>
          </CardHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'good', label: 'Good / Clean', color: 'border-[#183d2d] bg-[#f0faf5]' },
                { value: 'minor_issue', label: 'Minor Wear', color: 'border-[#e67e22] bg-[#fef9f3]' },
                { value: 'damaged', label: 'Damaged / Fault', color: 'border-[#c0392b] bg-[#fff5f5]' },
              ].map((c) => (
                <label
                  key={c.value}
                  className={`p-3 rounded-lg border-2 cursor-pointer text-center text-xs font-bold transition-all ${
                    overallCondition === c.value
                      ? `${c.color} shadow-[2px_2px_0_#1a1a1a]`
                      : 'border-[#1a1a1a]/30 bg-white opacity-70'
                  }`}
                >
                  <input
                    type="radio"
                    name="condition"
                    value={c.value}
                    checked={overallCondition === c.value}
                    onChange={(e) => setOverallCondition(e.target.value)}
                    className="hidden"
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>

            <div className="space-y-1">
              <label htmlFor="notes" className="text-xs font-bold text-[#1a1a1a]">
                Notes or Observations:
              </label>
              <textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  isCheckIn
                    ? 'Note any existing scuffs or probe quirks prior to power on...'
                    : 'Note machine bed cleanliness, job completion status, or consumable usage...'
                }
                className="w-full p-2.5 text-xs rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
              />
            </div>
          </div>
        </Card>

        {/* Submit Actions */}
        <div className="pt-2 flex items-center justify-between">
          <Link to={`/bookings/${id}`}>
            <Button variant="outline" size="md">
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={!allChecked || isSubmitting || isCompressing}
            loading={isSubmitting || isCompressing}
          >
            {isCheckIn ? 'Confirm Check-In & Start Use →' : 'Confirm Check-Out & Return →'}
          </Button>
        </div>
      </form>
    </div>
  );
}

