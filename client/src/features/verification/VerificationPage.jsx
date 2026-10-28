import React, { useState, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import { useAuthStore } from '../../stores/auth';
import { uploadIdCard } from './api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardHeader, CardTitle } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { toast } from 'sonner';
import {
  IdCard,
  UploadCloud,
  CheckCircle2,
  Clock,
  XCircle,
  FileCheck,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

const DEPARTMENTS = [
  { value: 'CSE', label: 'Computer Science & Engineering' },
  { value: 'ECE', label: 'Electronics & Communication Engineering' },
  { value: 'EE', label: 'Electrical Engineering' },
  { value: 'ME', label: 'Mechanical Engineering' },
  { value: 'CE', label: 'Civil Engineering' },
  { value: 'MME', label: 'Metallurgical & Materials Engineering' },
  { value: 'PIE', label: 'Production & Industrial Engineering' },
  { value: 'PHY', label: 'Physics / DIC' },
  { value: 'CHEM', label: 'Chemistry' },
];

const MEMBER_TYPES = [
  { value: 'UG', label: 'Undergraduate (B.Tech)' },
  { value: 'PG', label: 'Postgraduate (M.Tech / MCA)' },
  { value: 'RS', label: 'Research Scholar (Ph.D.)' },
  { value: 'FACULTY', label: 'Faculty Member' },
  { value: 'STAFF', label: 'Technical Staff' },
];

export default function VerificationPage() {
  const { user, setUser } = useAuthStore();
  const fileInputRef = useRef(null);

  const verification = user?.verification || { status: 'unsubmitted' };
  const [status, setStatus] = useState(verification.status || 'unsubmitted');
  const rejectionReason =
    verification.reason || 'Image was illegible. Please submit a clearer photo showing your roll number.';

  const [memberType, setMemberType] = useState(user?.memberType || 'UG');
  const [department, setDepartment] = useState(
    user?.department?.code || user?.department?.name || 'CSE'
  );

  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [compressedSize, setCompressedSize] = useState(null);

  // File selection & client-side compression
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Type validation
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file format. Please upload JPG, PNG, WEBP, or PDF.');
      return;
    }

    // Size limit 5MB
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds 5MB limit.');
      return;
    }

    if (file.type.startsWith('image/')) {
      setIsCompressing(true);
      try {
        const options = {
          maxSizeMB: 1,
          maxWidthOrHeight: 1600,
          useWebWorker: true,
        };
        const compressed = await imageCompression(file, options);
        setSelectedFile(compressed);
        setCompressedSize((compressed.size / 1024).toFixed(0) + ' KB');
        setPreviewUrl(URL.createObjectURL(compressed));
        toast.info(
          `Image optimized: ${(file.size / 1024).toFixed(0)}KB → ${(
            compressed.size / 1024
          ).toFixed(0)}KB`
        );
      } catch (err) {
        // Fallback to original file
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
      } finally {
        setIsCompressing(false);
      }
    } else {
      setSelectedFile(file);
      setPreviewUrl(null);
      setCompressedSize((file.size / 1024).toFixed(0) + ' KB');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please attach a scanned copy or photo of your institute ID card.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('idCard', selectedFile);
      formData.append('memberType', memberType);
      formData.append('department', department);

      await uploadIdCard(formData);

      setStatus('pending');
      setUser({
        ...user,
        memberType,
        verification: {
          status: 'pending',
          submittedAt: new Date().toISOString(),
          reason: null,
        },
      });
      toast.success('ID card submitted successfully for verification!');
    } catch (err) {
      toast.error(err.message || 'Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForResubmit = () => {
    setStatus('unsubmitted');
    setSelectedFile(null);
    setPreviewUrl(null);
  };

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb / Header ───────────────────────────────────────────── */}
      <div className="border-b-2 border-[#1a1a1a] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase font-bold text-[#c0392b] tracking-widest">
              CAMPUS IDENTITY // NIT JAMSHEDPUR
            </span>
          </div>
          <h1 className="text-2xl font-black text-[#1a1a1a] tracking-tight">
            Institute ID Card Verification
          </h1>
        </div>
        <div>
          {status === 'approved' && (
            <Badge variant="forest" size="lg" icon={CheckCircle2}>
              VERIFIED ACTIVE
            </Badge>
          )}
          {status === 'pending' && (
            <Badge variant="amber" size="lg" icon={Clock}>
              UNDER REVIEW
            </Badge>
          )}
          {status === 'rejected' && (
            <Badge variant="red" size="lg" icon={XCircle}>
              VERIFICATION REJECTED
            </Badge>
          )}
          {status === 'unsubmitted' && (
            <Badge variant="neutral" size="lg" icon={IdCard}>
              ACTION REQUIRED
            </Badge>
          )}
        </div>
      </div>

      {/* ── STATUS CARD: APPROVED ─────────────────────────────────────────── */}
      {status === 'approved' && (
        <Card className="border-2 border-[#183d2d] bg-[#f0faf5] p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-[#183d2d] text-white rounded-xl border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 shadow-[3px_3px_0_#1a1a1a]">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <div>
                <span className="text-xs font-bold text-[#183d2d] uppercase tracking-wider block">
                  Identity Confirmed
                </span>
                <h2 className="text-xl font-black text-[#1a1a1a] mb-1">
                  Full Reservation Access Granted
                </h2>
                <p className="text-sm text-[#1a1a1a]/80 max-w-xl">
                  Your identity card has been verified by the institute administrator. You can
                  reserve any eligible workshops, instruments, and 3D printers on campus.
                </p>
                <div className="flex flex-wrap gap-2 mt-3 text-xs font-bold font-mono">
                  <span className="px-2.5 py-1 bg-white border border-[#1a1a1a] rounded">
                    MEMBER TYPE: {user?.memberType || memberType}
                  </span>
                  <span className="px-2.5 py-1 bg-white border border-[#1a1a1a] rounded">
                    DEPARTMENT: {user?.department?.name || department}
                  </span>
                  <span className="px-2.5 py-1 bg-[#183d2d] text-white border border-[#1a1a1a] rounded">
                    STATUS: ALL CLEAR
                  </span>
                </div>
              </div>
            </div>
            <Button
              variant="forest"
              size="md"
              onClick={() => (window.location.href = '/explore')}
              className="shrink-0"
            >
              Browse & Book Resources →
            </Button>
          </div>
        </Card>
      )}

      {/* ── STATUS CARD: PENDING ──────────────────────────────────────────── */}
      {status === 'pending' && (
        <Card className="border-2 border-[#e67e22] bg-[#fef9f3] p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-[#e67e22] text-white rounded-xl border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 shadow-[3px_3px_0_#1a1a1a]">
                <Clock className="w-7 h-7 animate-pulse" />
              </div>
              <div>
                <span className="text-xs font-bold text-[#e67e22] uppercase tracking-wider block">
                  In Queue // Expected: Under 24h
                </span>
                <h2 className="text-xl font-black text-[#1a1a1a] mb-1">
                  Verification Pending Administrator Review
                </h2>
                <p className="text-sm text-[#1a1a1a]/80 max-w-xl">
                  Your ID card has been uploaded and encrypted. While under review, you have
                  browse-only access to view equipment catalogs and schedules. Once verified,
                  reservation slots will unlock automatically.
                </p>
                <div className="mt-3 text-xs font-mono text-[#1a1a1a]/60">
                  SUBMITTED: {new Date().toLocaleDateString('en-IN')} · APPLIED ROLE: {memberType} (
                  {department})
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatus('approved')}
                title="Quick demo preview helper"
              >
                Simulate Admin Approval
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── STATUS CARD: REJECTED ─────────────────────────────────────────── */}
      {status === 'rejected' && (
        <Card className="border-2 border-[#c0392b] bg-[#fff5f5] p-8">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-14 h-14 bg-[#c0392b] text-white rounded-xl border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 shadow-[3px_3px_0_#1a1a1a]">
              <XCircle className="w-7 h-7" />
            </div>
            <div>
              <span className="text-xs font-bold text-[#c0392b] uppercase tracking-wider block">
                Attention Required
              </span>
              <h2 className="text-xl font-black text-[#1a1a1a] mb-1">
                ID Card Verification Could Not Be Completed
              </h2>
              <div className="p-3 bg-white border-2 border-[#c0392b] rounded-lg text-sm text-[#c0392b] font-bold mt-2">
                REASON FROM ADMIN: &quot;{rejectionReason}&quot;
              </div>
            </div>
          </div>
          <p className="text-sm text-[#1a1a1a]/80 mb-6">
            Please re-upload a clear, readable photograph or scan of your physical NIT Jamshedpur
            student or faculty ID card. Ensure your name, roll number, and department are in sharp
            focus.
          </p>
          <Button variant="danger" size="md" onClick={handleResetForResubmit}>
            <RotateCcw className="w-4 h-4" />
            Upload New ID Card
          </Button>
        </Card>
      )}

      {/* ── FORM: UNSUBMITTED / RE-UPLOAD ─────────────────────────────────── */}
      {status === 'unsubmitted' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main submission form */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Submit Institute ID Credentials</CardTitle>
                  <p className="text-xs text-[#1a1a1a]/60 mt-1">
                    Upload your official NIT Jamshedpur ID to unlock booking privileges.
                  </p>
                </div>
              </CardHeader>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Member Category"
                    value={memberType}
                    onChange={(e) => setMemberType(e.target.value)}
                    options={MEMBER_TYPES}
                    hint="Matches your enrollment tier"
                  />

                  <Select
                    label="Academic Department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    options={DEPARTMENTS}
                    hint="Your primary enrolled branch"
                  />
                </div>

                {/* Dropzone */}
                <div className="space-y-2">
                  <label className="text-sm font-bold font-mono text-[#1a1a1a] tracking-tight block">
                    Upload ID Card Image / PDF
                  </label>

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[#1a1a1a] bg-[#f5f0e8]/50 hover:bg-[#ede8df] rounded-xl p-8 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 group"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={handleFileChange}
                      className="hidden"
                    />

                    <div className="w-12 h-12 rounded-xl bg-white border-2 border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a] flex items-center justify-center text-[#183d2d] group-hover:scale-105 transition-transform">
                      <UploadCloud className="w-6 h-6" />
                    </div>

                    <div className="text-sm font-bold text-[#1a1a1a]">
                      {selectedFile ? (
                        <span className="text-[#183d2d] flex items-center gap-1.5 justify-center">
                          <FileCheck className="w-4 h-4" />
                          {selectedFile.name} ({compressedSize})
                        </span>
                      ) : (
                        'Click to browse or drop ID card photo'
                      )}
                    </div>
                    <p className="text-xs text-[#1a1a1a]/60 font-mono">
                      JPG, PNG, WEBP, or PDF · Max 5MB · Auto-compressed
                    </p>
                  </div>
                </div>

                {/* Image preview */}
                {previewUrl && (
                  <div className="border-2 border-[#1a1a1a] rounded-lg p-3 bg-white shadow-[3px_3px_0_#1a1a1a]">
                    <div className="flex items-center justify-between pb-2 border-b border-[#1a1a1a]/20 mb-2 text-xs font-bold">
                      <span>PREVIEW // READY FOR COMPRESSION & ENCRYPTION</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFile(null);
                          setPreviewUrl(null);
                        }}
                        className="text-[#c0392b] hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <img
                      src={previewUrl}
                      alt="ID Card preview"
                      className="max-h-56 w-auto mx-auto object-contain rounded border border-[#1a1a1a]/20"
                    />
                  </div>
                )}

                <div className="pt-2 flex items-center justify-between border-t border-[#1a1a1a]/15">
                  <span className="text-xs text-[#1a1a1a]/60">
                    Encrypted via authenticated cloud storage
                  </span>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={!selectedFile || isCompressing || isSubmitting}
                    loading={isCompressing || isSubmitting}
                  >
                    Submit ID for Verification →
                  </Button>
                </div>
              </form>
            </Card>
          </div>

          {/* Guidelines Sidebar */}
          <div className="space-y-4">
            <Card className="bg-[#ede8df]">
              <CardTitle className="text-sm flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-[#e67e22]" />
                Verification Guidelines
              </CardTitle>
              <ul className="text-xs text-[#1a1a1a]/80 space-y-2.5 leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#183d2d]">01.</span>
                  Ensure the physical student/faculty ID card is laid flat under good lighting.
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#183d2d]">02.</span>
                  Roll number, enrollment year, and photo must be clearly discernible without glare.
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#183d2d]">03.</span>
                  Temporary gate passes or fee receipts are not accepted for machine booking.
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-[#183d2d]">04.</span>
                  Uploaded images are deleted immediately following administrator review.
                </li>
              </ul>
            </Card>

            <Card className="bg-[#183d2d] text-white">
              <div className="flex items-center gap-2 mb-2 text-[#1abc9c]">
                <Sparkles className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Demo Helper</span>
              </div>
              <p className="text-xs text-white/80 leading-relaxed mb-3">
                Need to test as verified right now without admin approval? Click below:
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full bg-white text-[#1a1a1a]"
                onClick={() => {
                  setStatus('approved');
                  setUser({
                    ...user,
                    memberType,
                    verification: { status: 'approved', submittedAt: new Date().toISOString() },
                  });
                  toast.success('Instant demo verification applied!');
                }}
              >
                Instant Verify (Demo)
              </Button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
