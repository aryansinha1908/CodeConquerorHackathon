import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import { toast } from 'sonner';
import {
  IdCard,
  UploadCloud,
  CheckCircle2,
  Clock,
  XCircle,
  FileCheck,
  FileText,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card, CardHeader } from '../../components/ui/Card';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { fieldErrorsFrom } from '../../lib/errors';
import { formatIstDateTime } from '../../lib/time';
import { compressionWorkerOptions } from '../uploads/api';
import {
  MEMBER_TYPES,
  MEMBER_TYPE_OPTIONS,
  ID_CARD_TYPES,
  buildIdCardForm,
  activeUnits,
  checkIdCardFile,
  departmentFromHints,
  getActiveOrgUnits,
  getVerificationStatus,
  groupUnits,
  memberTypeFromHints,
  memberTypeLabel,
  orgUnitKeys,
  prepareIdCardFile,
  refreshCurrentUser,
  uploadIdCard,
  verificationKeys,
} from './api';

// /verification (frontend.md §6.2, F-02): the real status from GET /verification/status and the
// ID-card upload (POST /verification/id-card). No demo shortcuts: approval comes from an admin.

// Gold, not amber, for pending: white on amber is under 4.5:1 (frontend.md §10.3).
const STATUS_BADGES = {
  approved: { variant: 'forest', icon: CheckCircle2, label: 'Verified' },
  pending: { variant: 'gold', icon: Clock, label: 'Under review' },
  rejected: { variant: 'red', icon: XCircle, label: 'Rejected' },
  unsubmitted: { variant: 'neutral', icon: IdCard, label: 'Action required' },
};

// A <Link> styled as a Button: a <button> inside an <a> is two nested controls for a screen reader.
const linkButtonClass =
  'inline-flex items-center justify-center gap-2 font-bold font-mono tracking-tight border-2 border-[#1a1a1a] ' +
  'px-5 py-2.5 text-sm rounded-md bg-[#183d2d] text-white shadow-[3px_3px_0px_0px_#1a1a1a] ' +
  'hover:shadow-[1px_1px_0px_0px_#1a1a1a] hover:translate-x-[2px] hover:translate-y-[2px] transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2 shrink-0';

// CardTitle's look on an <h2>: CardTitle is always an <h3>, and the page has only an <h1> above.
// Headings that take focus (tabIndex -1) show no ring: they aren't controls.
const headingClass =
  'text-base md:text-lg font-bold font-mono tracking-tight text-[#1a1a1a] focus:outline-none';
const statusHeadingClass = 'text-xl font-black text-[#1a1a1a] mb-1 focus:outline-none';

// browser-image-compression settings from frontend.md §4: photos ≤ 1 MB / 1600 px before upload.
// The worker loads our own copy of the library, never jsDelivr's (compressionWorkerOptions).
const COMPRESSION = { maxSizeMB: 1, maxWidthOrHeight: 1600 };

const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Fact({ children, dark = false }) {
  return (
    <span
      className={`px-2.5 py-1 border border-[#1a1a1a] rounded ${
        dark ? 'bg-[#183d2d] text-white' : 'bg-white text-[#1a1a1a]'
      }`}
    >
      {children}
    </span>
  );
}

function ApprovedCard({ view, headingRef }) {
  const reviewed = formatIstDateTime(view.reviewedAt);
  return (
    <Card variant="success" className="md:p-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-[#183d2d] text-white rounded-xl border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 shadow-[3px_3px_0_#1a1a1a]">
            <ShieldCheck className="w-7 h-7" aria-hidden="true" />
          </div>
          <div>
            <span className="text-xs font-bold text-[#183d2d] uppercase tracking-wider block">
              Identity confirmed
            </span>
            <h2 ref={headingRef} tabIndex={-1} className={statusHeadingClass}>
              You&apos;re verified
            </h2>
            <p className="text-sm text-[#1a1a1a]/80 max-w-xl">
              An administrator checked your ID card. You can book any resource you&apos;re eligible
              for. Your ID image has been deleted.
            </p>
            <div className="flex flex-wrap gap-2 mt-3 text-xs font-bold font-mono">
              <Fact>MEMBER TYPE: {memberTypeLabel(view.memberType)}</Fact>
              <Fact>DEPARTMENT: {view.department?.name ?? 'Not set'}</Fact>
              {reviewed && <Fact dark>APPROVED: {reviewed}</Fact>}
            </div>
          </div>
        </div>
        <Link to="/explore" className={linkButtonClass}>
          Browse &amp; book resources →
        </Link>
      </div>
    </Card>
  );
}

function PendingCard({ view, onReplace, formOpen, headingRef, triggerRef }) {
  const submitted = formatIstDateTime(view.submittedAt);
  return (
    <Card variant="warning" className="md:p-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-[#e67e22] text-white rounded-xl border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 shadow-[3px_3px_0_#1a1a1a]">
            <Clock className="w-7 h-7 motion-safe:animate-pulse" aria-hidden="true" />
          </div>
          <div>
            <span className="text-xs font-bold text-[#a04000] uppercase tracking-wider block">
              In the review queue
            </span>
            <h2 ref={headingRef} tabIndex={-1} className={statusHeadingClass}>
              Waiting for an administrator
            </h2>
            <p className="text-sm text-[#1a1a1a]/80 max-w-xl">
              {view.hasIdCard
                ? 'Your ID card is with the administrators. Until it is approved you can browse resources but not book them.'
                : "We don't have an ID image for this request. Upload one so an administrator can check it."}
            </p>
            <div className="flex flex-wrap gap-2 mt-3 text-xs font-bold font-mono">
              {submitted && <Fact>SUBMITTED: {submitted}</Fact>}
              <Fact>MEMBER TYPE: {memberTypeLabel(view.memberType)}</Fact>
              <Fact>DEPARTMENT: {view.department?.name ?? 'Not set'}</Fact>
            </div>
          </div>
        </div>
        {!formOpen && (
          <Button
            ref={triggerRef}
            variant={view.hasIdCard ? 'outline' : 'primary'}
            size="md"
            className="shrink-0 bg-white"
            onClick={onReplace}
          >
            <UploadCloud className="w-4 h-4" aria-hidden="true" />
            {view.hasIdCard ? 'Replace ID card' : 'Upload ID card'}
          </Button>
        )}
      </div>
    </Card>
  );
}

function RejectedCard({ view, onReupload, formOpen, headingRef, triggerRef }) {
  const reviewed = formatIstDateTime(view.reviewedAt);
  return (
    <Card variant="danger" className="md:p-8">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-14 h-14 bg-[#c0392b] text-white rounded-xl border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 shadow-[3px_3px_0_#1a1a1a]">
          <XCircle className="w-7 h-7" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <span className="text-xs font-bold text-[#c0392b] uppercase tracking-wider block">
            Attention required{reviewed ? ` · ${reviewed}` : ''}
          </span>
          <h2 ref={headingRef} tabIndex={-1} className={statusHeadingClass}>
            Your ID card wasn&apos;t accepted
          </h2>
          <div className="p-3 bg-white border-2 border-[#c0392b] rounded-lg text-sm text-[#c0392b] font-bold mt-2 break-words">
            REASON FROM THE ADMINISTRATOR:{' '}
            {view.reason ? `“${view.reason}”` : 'No reason was given.'}
          </div>
        </div>
      </div>
      <p className="text-sm text-[#1a1a1a]/80 mb-6">
        Upload a clear photo or scan of your NIT Jamshedpur student or staff ID card. Your name,
        roll number and department must be readable.
      </p>
      {!formOpen && (
        <Button ref={triggerRef} variant="primary" size="md" onClick={onReupload}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Upload a new ID card
        </Button>
      )}
    </Card>
  );
}

function IdCardForm({ view, user, onSubmitted, onCancel, headingRef }) {
  const queryClient = useQueryClient();
  const ids = useId();
  const memberTypeId = `${ids}-member-type`;
  const departmentId = `${ids}-department`;
  const fileId = `${ids}-file`;
  const fileLabelId = `${ids}-file-label`;
  const fileStatusId = `${ids}-file-status`;
  const fileHelpId = `${ids}-file-help`;
  const fileErrorId = `${ids}-file-error`;

  const memberTypeRef = useRef(null);
  const departmentRef = useRef(null);
  const fileInputRef = useRef(null);
  const pickRef = useRef(0);

  const units = useQuery({
    queryKey: orgUnitKeys.active,
    queryFn: getActiveOrgUnits,
    staleTime: 5 * 60 * 1000,
  });
  // Every active unit, grouped like the admin's dialog: staff of a centre or a central facility
  // pick their own unit, not some academic department.
  const unitList = activeUnits(units.data?.data);
  const unitGroups = groupUnits(unitList);

  // Pre-fill: what was submitted before, else the profile, else the email hints (architecture.md §8).
  // The user's own choice (state) wins once made; until then the default follows the loaded data.
  const hints = user?.emailHints ?? null;
  const savedType = view?.memberType ?? user?.memberType ?? null;
  const hintedType = memberTypeFromHints(hints);
  const savedDeptId = view?.department?._id ?? user?.department?._id ?? null;
  const savedDept = unitList.find((unit) => unit._id === savedDeptId) ?? null;
  const hintedDept = departmentFromHints(hints, unitList);

  const [memberTypeChoice, setMemberTypeChoice] = useState(null);
  const [departmentChoice, setDepartmentChoice] = useState(null);
  const memberType = memberTypeChoice ?? savedType ?? hintedType ?? '';
  const department = departmentChoice ?? savedDept?._id ?? hintedDept?._id ?? '';
  const typeFromEmail = memberTypeChoice === null && !savedType && Boolean(hintedType);
  const deptFromEmail = departmentChoice === null && !savedDept && Boolean(hintedDept);

  const [file, setFile] = useState(null);
  const [fileNote, setFileNote] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);

  // Each preview URL is released when it is replaced and when the form goes away.
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const upload = useMutation({ mutationFn: uploadIdCard });
  const busy = compressing || upload.isPending;
  const fileError = fieldErrors.idCard;

  const setFieldError = (path, message) =>
    setFieldErrors((current) => ({ ...current, [path]: message }));

  const takeFile = async (picked) => {
    if (!picked) return;
    // A wrong type is refused at once. The 5 MB limit waits for compression, so a large phone
    // photo is shrunk rather than refused (prepareIdCardFile).
    if (!ID_CARD_TYPES.includes(picked.type)) {
      setFieldError('idCard', checkIdCardFile(picked));
      return;
    }
    setFieldError('idCard', undefined);
    // A later pick wins over a compression still running for an earlier one.
    const pick = ++pickRef.current;
    setCompressing(picked.type.startsWith('image/'));
    const { file: chosen, error } = await prepareIdCardFile(picked, (image) =>
      imageCompression(image, { ...COMPRESSION, ...compressionWorkerOptions() })
    );
    if (pick !== pickRef.current) return;
    setCompressing(false);
    if (error) {
      setFieldError('idCard', error);
      return;
    }
    setFile(chosen);
    setPreviewUrl(chosen.type.startsWith('image/') ? URL.createObjectURL(chosen) : null);
    setFileNote(
      chosen === picked ? kb(picked.size) : `${kb(picked.size)} → ${kb(chosen.size)}, optimised`
    );
  };

  const clearFile = () => {
    pickRef.current += 1;
    setCompressing(false);
    setFile(null);
    setPreviewUrl(null);
    setFileNote(null);
  };

  // Remove unmounts the preview it sits in: hand focus to the file input, the next thing to use.
  const removeFile = () => {
    clearFile();
    fileInputRef.current?.focus();
  };

  // Focus the first field with an error, if any; → whether one was found.
  const focusFirstInvalid = (errors) => {
    const target = errors.memberType
      ? memberTypeRef
      : errors.department
        ? departmentRef
        : errors.idCard
          ? fileInputRef
          : null;
    target?.current?.focus();
    return Boolean(target);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    const errors = {};
    if (!MEMBER_TYPES.includes(memberType)) errors.memberType = 'Choose your member type.';
    if (!department) errors.department = 'Choose your department or unit.';
    const fileProblem = checkIdCardFile(file);
    if (fileProblem) errors.idCard = fileProblem;
    setFieldErrors(errors);
    setSubmitError(null);
    if (focusFirstInvalid(errors)) return;

    upload.mutate(buildIdCardForm({ file, memberType, department }), {
      onSuccess: (envelope) => {
        clearFile();
        onSubmitted(envelope);
      },
      onError: (err) => {
        // The submit button kept focus while uploading (it is only aria-disabled); a refused field
        // takes it from there. Otherwise it stays on the button, under the announced error.
        const refused = fieldErrorsFrom(err);
        setFieldErrors(refused);
        setSubmitError(err);
        focusFirstInvalid(refused);
        toast.error("Your ID card wasn't submitted", {
          description: err?.requestId ? `${err.message} (ref ${err.requestId})` : err?.message,
        });
        // Approved meanwhile (409), or the status changed some other way: show what's true now.
        if (err?.code === 'INVALID_TRANSITION') {
          queryClient.invalidateQueries({ queryKey: verificationKeys.status });
        }
      },
    });
  };


  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div>
              <h2 ref={headingRef} tabIndex={-1} className={headingClass}>
                Submit your institute ID card
              </h2>
              <p className="text-xs text-[#1a1a1a]/70 mt-1">
                An administrator compares it with your details before you can book.
              </p>
            </div>
          </CardHeader>

          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                ref={memberTypeRef}
                id={memberTypeId}
                label="Member type"
                value={memberType}
                onChange={(e) => {
                  setMemberTypeChoice(e.target.value);
                  setFieldError('memberType', undefined);
                }}
                error={fieldErrors.memberType}
                hint={typeFromEmail ? 'Pre-filled from your email address: check it.' : undefined}
                required
              >
                <option value="" disabled>
                  Choose your member type
                </option>
                {MEMBER_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>

              <Select
                ref={departmentRef}
                id={departmentId}
                label="Department or unit"
                value={department}
                onChange={(e) => {
                  setDepartmentChoice(e.target.value);
                  setFieldError('department', undefined);
                }}
                disabled={units.isPending}
                error={
                  fieldErrors.department ??
                  (units.isError
                    ? `Couldn't load the units: ${units.error?.message ?? 'try again'}${
                        units.error?.requestId ? ` (ref ${units.error.requestId})` : ''
                      }`
                    : undefined)
                }
                hint={
                  units.isPending
                    ? 'Loading units…'
                    : deptFromEmail
                      ? 'Pre-filled from your email address: check it.'
                      : undefined
                }
                required
              >
                <option value="" disabled>
                  {units.isPending ? 'Loading…' : 'Choose your department or unit'}
                </option>
                {unitGroups.map((group) => (
                  <optgroup key={group.type} label={group.label}>
                    {group.units.map((unit) => (
                      <option key={unit._id} value={unit._id}>
                        {unit.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            {units.isError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="bg-white -mt-3"
                onClick={() => units.refetch()}
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Reload units
              </Button>
            )}

            {/* Dropzone: the <label> makes the whole area a click target for the real file input,
                which stays focusable (sr-only, not display:none) for keyboard users. The input is
                named by the visible field label (aria-labelledby), not by the dropzone's text;
                the chosen file, the rules and any error are its description. */}
            <div className="space-y-2">
              <span
                id={fileLabelId}
                className="text-sm font-bold font-mono text-[#1a1a1a] tracking-tight block"
              >
                ID card image or PDF
              </span>
              <label
                htmlFor={fileId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  takeFile(e.dataTransfer.files?.[0]);
                }}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 group focus-within:ring-2 focus-within:ring-[#c0392b] focus-within:ring-offset-2 ${
                  fileError ? 'border-[#c0392b] bg-[#fff5f5]' : 'border-[#1a1a1a]'
                } ${dragging ? 'bg-[#ede8df]' : 'bg-[#f5f0e8]/50 hover:bg-[#ede8df]'}`}
              >
                <input
                  ref={fileInputRef}
                  id={fileId}
                  type="file"
                  accept={ID_CARD_TYPES.join(',')}
                  aria-labelledby={fileLabelId}
                  aria-describedby={[
                    (file || compressing) && fileStatusId,
                    fileHelpId,
                    fileError && fileErrorId,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-required="true"
                  aria-invalid={fileError ? 'true' : undefined}
                  onChange={(e) => {
                    takeFile(e.target.files?.[0]);
                    e.target.value = ''; // so picking the same file again still fires onChange
                  }}
                  className="sr-only"
                />
                <span className="w-12 h-12 rounded-xl bg-white border-2 border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a] flex items-center justify-center text-[#183d2d] motion-safe:group-hover:scale-105 transition-transform">
                  <UploadCloud className="w-6 h-6" aria-hidden="true" />
                </span>
                <span id={fileStatusId} className="text-sm font-bold text-[#1a1a1a]">
                  {compressing ? (
                    'Optimising the image…'
                  ) : file ? (
                    <span className="text-[#183d2d] flex items-center gap-1.5 justify-center break-all">
                      <FileCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {file.name} ({fileNote})
                    </span>
                  ) : (
                    'Choose a file, or drop your ID card here'
                  )}
                </span>
                <span id={fileHelpId} className="text-xs text-[#1a1a1a]/70 font-mono">
                  JPG, PNG, WEBP or PDF · at most 5 MB · images are compressed first
                </span>
              </label>
              {fileError && (
                <p
                  id={fileErrorId}
                  role="alert"
                  className="text-xs font-semibold text-[#c0392b] flex items-center gap-1 font-mono"
                >
                  <span aria-hidden="true">✕</span> {fileError}
                </p>
              )}
            </div>

            {file && (
              <div className="border-2 border-[#1a1a1a] rounded-lg p-3 bg-white shadow-[3px_3px_0_#1a1a1a]">
                <div className="flex items-center justify-between pb-2 border-b border-[#1a1a1a]/20 mb-2 text-xs font-bold">
                  <span>PREVIEW</span>
                  <button
                    type="button"
                    onClick={removeFile}
                    className="text-[#c0392b] hover:underline px-2 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
                  >
                    Remove
                  </button>
                </div>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview of the ID card you chose"
                    className="max-h-56 w-auto mx-auto object-contain rounded border border-[#1a1a1a]/20"
                  />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-[#1a1a1a]/80 py-4 justify-center">
                    <FileText className="w-5 h-5" aria-hidden="true" />
                    PDF attached: no preview
                  </p>
                )}
              </div>
            )}

            <ErrorState error={submitError} title="Your ID card wasn't submitted" />

            <div className="pt-4 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 border-t border-[#1a1a1a]/15">
              <span className="text-xs text-[#1a1a1a]/70">
                Stored privately. Only administrators can view it, and every view is logged.
              </span>
              {/* Stacked full width on phones: side by side the two lg buttons need about 300 px. */}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 shrink-0">
                {onCancel && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={onCancel}
                    disabled={upload.isPending}
                  >
                    Cancel
                  </Button>
                )}
                {/* loading, not disabled: the button keeps a keyboard user's focus while busy. */}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full sm:w-auto"
                  loading={busy}
                >
                  {upload.isPending ? 'Uploading…' : 'Submit for verification →'}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      </div>

      <div className="space-y-4">
        <Card variant="cream">
          <h2 className="text-sm font-bold font-mono tracking-tight text-[#1a1a1a] flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-[#e67e22]" aria-hidden="true" />
            Before you upload
          </h2>
          <ol className="text-xs text-[#1a1a1a]/80 space-y-2.5 leading-relaxed">
            <li className="flex items-start gap-2">
              <span className="font-bold text-[#183d2d]">01.</span>
              Lay the card flat in good light.
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-[#183d2d]">02.</span>
              Your name, roll number and photo must be readable, without glare.
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-[#183d2d]">03.</span>
              Gate passes and fee receipts aren&apos;t accepted.
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold text-[#183d2d]">04.</span>
              The image is deleted as soon as an administrator decides.
            </li>
          </ol>
        </Card>
        {hints && (hintedType || hintedDept) && (
          <Card variant="forest">
            <p className="flex items-center gap-2 mb-2 text-[#1abc9c] text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              From your email address
            </p>
            <p className="text-xs text-white/80 leading-relaxed">
              {[hintedType && memberTypeLabel(hintedType), hintedDept?.name, hints.year]
                .filter(Boolean)
                .join(' · ')}
              . A hint only: an administrator confirms it against your card.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function VerificationPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [formOpen, setFormOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const statusQuery = useQuery({
    queryKey: verificationKeys.status,
    queryFn: getVerificationStatus,
    staleTime: 0, // an admin may decide while the page is open: refetch on focus
  });
  const view = statusQuery.data?.data ?? null;
  const status = view?.status ?? null;

  // Opening, cancelling or submitting the form unmounts the control that was pressed. Focus goes to
  // what took its place (frontend.md §10.3) instead of falling to <body>: the form's heading, the
  // Replace / Upload button again, or the new status card's heading. A request { ref, status? } is
  // honoured after the first commit that renders ref (with that status, when given): the status
  // from a submission can arrive a render after the form closes.
  const statusHeadingRef = useRef(null);
  const triggerRef = useRef(null);
  const formHeadingRef = useRef(null);
  const focusNext = useRef(null);
  useEffect(() => {
    const next = focusNext.current;
    if (!next || !next.ref.current || (next.status && next.status !== status)) return;
    focusNext.current = null;
    next.ref.current.focus();
  });
  const openForm = () => {
    focusNext.current = { ref: formHeadingRef };
    setFormOpen(true);
  };
  const closeForm = () => {
    focusNext.current = { ref: triggerRef };
    setFormOpen(false);
  };

  // GET /auth/me into the store, one call at a time, so the nav badge, the banner and
  // RequireVerified agree with this page. A failure leaves the page right and the store as it was.
  const syncing = useRef(false);
  const syncUser = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      await refreshCurrentUser();
    } catch {
      // The status card already shows the server's answer; the store catches up on the next boot.
    } finally {
      syncing.current = false;
    }
  }, []);

  // An admin decided since the session started: the store still has the old status.
  const storeStatus = user?.verification?.status;
  useEffect(() => {
    if (status && storeStatus && status !== storeStatus) syncUser();
  }, [status, storeStatus, syncUser]);

  const handleSubmitted = (envelope) => {
    focusNext.current = { ref: statusHeadingRef, status: envelope?.data?.status ?? 'pending' };
    queryClient.setQueryData(verificationKeys.status, envelope);
    setFormOpen(false);
    setAnnouncement('ID card submitted. Your verification is waiting for an administrator.');
    toast.success('ID card submitted for review');
    syncUser();
  };

  const showForm =
    status === 'unsubmitted' || ((status === 'pending' || status === 'rejected') && formOpen);
  const badge = STATUS_BADGES[status];

  return (
    <div className="space-y-6">
      <div className="border-b-2 border-[#1a1a1a] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <span className="text-xs uppercase font-bold text-[#c0392b] tracking-widest block mb-1">
            CAMPUS IDENTITY // NIT JAMSHEDPUR
          </span>
          <h1 className="text-2xl font-black text-[#1a1a1a] tracking-tight">
            ID card verification
          </h1>
        </div>
        {badge && (
          <Badge variant={badge.variant} size="lg" icon={badge.icon}>
            {badge.label}
          </Badge>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {statusQuery.isPending && (
        <Card aria-busy="true">
          <span className="sr-only">Loading your verification status…</span>
          <div className="flex items-start gap-4">
            <Skeleton className="w-14 h-14 rounded-xl shrink-0" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </Card>
      )}

      {statusQuery.isError && !view && (
        <ErrorState
          error={statusQuery.error}
          title="Couldn't load your verification status"
          onRetry={() => statusQuery.refetch()}
        />
      )}

      {status === 'approved' && <ApprovedCard view={view} headingRef={statusHeadingRef} />}
      {status === 'pending' && (
        <PendingCard
          view={view}
          formOpen={formOpen}
          onReplace={openForm}
          headingRef={statusHeadingRef}
          triggerRef={triggerRef}
        />
      )}
      {status === 'rejected' && (
        <RejectedCard
          view={view}
          formOpen={formOpen}
          onReupload={openForm}
          headingRef={statusHeadingRef}
          triggerRef={triggerRef}
        />
      )}

      {showForm && (
        <IdCardForm
          view={view}
          user={user}
          onSubmitted={handleSubmitted}
          onCancel={status === 'unsubmitted' ? undefined : closeForm}
          headingRef={formHeadingRef}
        />
      )}
    </div>
  );
}
