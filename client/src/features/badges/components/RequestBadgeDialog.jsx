import React, { useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  FileCheck,
  IdCard,
  UploadCloud,
  X,
} from 'lucide-react';
import { Dialog } from '../../../components/ui/Dialog';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ErrorState } from '../../../components/ui/ErrorState';
import {
  BADGE_NOTE_MAX,
  prepareEvidenceFile,
  useRequestBadge,
} from '../api';
import {
  badgeStateView,
  badgeUnitName,
  validityText,
} from '../badgeView';

export function RequestBadgeDialog({
  open,
  onClose,
  badge,
  user,
  userBadgeRow,
  returnFocusRef,
}) {
  const ids = useId();
  const fileInputRef = useRef(null);
  const noteRef = useRef(null);

  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const request = useRequestBadge();

  // Reset form when dialog opens with a new badge
  React.useEffect(() => {
    if (open) {
      setNote('');
      setFile(null);
      setFileError(null);
      setCompressing(false);
      request.reset();
    }
  }, [open, badge?._id]);

  if (!badge) return null;

  const isVerified =
    user?.verification?.status === 'approved' ||
    user?.roles?.includes('manager') ||
    user?.roles?.includes('admin');

  const unitName = badgeUnitName(badge);
  const state = userBadgeRow ? badgeStateView(userBadgeRow) : null;
  const isHeld = state && (userBadgeRow.state === 'active' || userBadgeRow.status === 'active');
  const isPendingReview = state && (userBadgeRow.state === 'requested' || userBadgeRow.status === 'requested');
  const isRenewal = state && (userBadgeRow.state === 'expired' || userBadgeRow.status === 'expired');
  const isReapply = state && (userBadgeRow.state === 'rejected' || userBadgeRow.status === 'rejected');

  const handleFileChange = async (pickedFile) => {
    if (!pickedFile) return;
    setFileError(null);
    setCompressing(true);
    try {
      const result = await prepareEvidenceFile(pickedFile);
      if (result.error) {
        setFileError(result.error);
        setFile(null);
      } else {
        setFile(result.file);
      }
    } catch {
      setFile(pickedFile);
    } finally {
      setCompressing(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFileChange(dropped);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (request.isPending || compressing) return;

    if (!isVerified) {
      toast.error('You must verify your ID card before requesting badges.');
      return;
    }

    if (badge.evidenceRequired && !file) {
      setFileError('Evidence file is required for this badge.');
      fileInputRef.current?.focus();
      return;
    }

    request.mutate(
      { badgeId: badge._id, note, file },
      {
        onSuccess: () => {
          toast.success(
            `Request submitted for ${badge.name}. ${unitName} managers will review it.`
          );
          onClose();
        },
      }
    );
  };

  const noteId = `${ids}-note`;
  const fileId = `${ids}-file`;
  const remaining = BADGE_NOTE_MAX - (note?.length || 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      busy={request.isPending || compressing}
      returnFocusRef={returnFocusRef}
      eyebrow={`Safety Credential · ${unitName}`}
      title={isRenewal ? `Renew ${badge.name}` : `Request ${badge.name}`}
      description="Members hold badges to unlock high-risk tools and restricted facilities."
    >
      <div className="space-y-5 font-mono text-[#1a1a1a]">
        {/* Badge metadata summary card */}
        <div className="p-4 rounded-xl border-2 border-[#1a1a1a] bg-[#f5f0e8] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[2px_2px_0_#1a1a1a]">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-[#a93226]" aria-hidden="true" />
              <h3 className="font-black text-base tracking-tight">{badge.name}</h3>
              <span className="text-xs text-[#1a1a1a]/60">({badge.code})</span>
            </div>
            <p className="text-xs text-[#1a1a1a]/80">
              Issuing Unit: <span className="font-bold">{unitName}</span> ·{' '}
              <span className="font-bold">{validityText(badge.validityDays)}</span>
            </p>
          </div>
          {badge.evidenceRequired ? (
            <Badge variant="amber" size="sm" className="shrink-0">
              Evidence Required
            </Badge>
          ) : (
            <Badge variant="neutral" size="sm" className="shrink-0">
              Standard Training
            </Badge>
          )}
        </div>

        {/* Existing status notices */}
        {isHeld && (
          <div
            role="status"
            className="p-3.5 rounded-lg border-2 border-[#183d2d] bg-[#f0faf5] flex items-start gap-3"
          >
            <CheckCircle2 className="w-5 h-5 text-[#183d2d] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs">
              <p className="font-bold text-[#183d2d]">You currently hold this badge</p>
              <p className="text-[#1a1a1a]/80 mt-0.5">
                This credential is active and unlocks associated resources. You do not need to request it again.
              </p>
            </div>
          </div>
        )}

        {isPendingReview && (
          <div
            role="status"
            className="p-3.5 rounded-lg border-2 border-[#1a1a1a] bg-[#fef9f3] flex items-start gap-3 shadow-[2px_2px_0_#1a1a1a]"
          >
            <Award className="w-5 h-5 text-[#e67e22] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs">
              <p className="font-bold text-[#1a1a1a]">Request already pending review</p>
              <p className="text-[#1a1a1a]/80 mt-0.5">
                Your request was submitted and is in the manager review queue. You will be notified once reviewed.
              </p>
            </div>
          </div>
        )}

        {isReapply && userBadgeRow.reason && (
          <div
            role="alert"
            className="p-3.5 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5] text-xs"
          >
            <p className="font-bold text-[#c0392b] mb-1">Previous reviewer feedback:</p>
            <p className="italic text-[#1a1a1a]/90">“{userBadgeRow.reason}”</p>
            <p className="mt-1.5 text-[#1a1a1a]/70">
              Ensure you attach updated evidence or address the note before submitting again.
            </p>
          </div>
        )}

        {/* ID verification warning if unverified */}
        {!isVerified && (
          <div
            role="alert"
            className="p-4 rounded-xl border-2 border-[#c0392b] bg-[#fff5f5] space-y-2 shadow-[2px_2px_0_#1a1a1a]"
          >
            <div className="flex items-center gap-2 text-sm font-bold text-[#c0392b]">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>ID Verification Required</span>
            </div>
            <p className="text-xs text-[#1a1a1a]/80 leading-relaxed">
              Campus policy requires an approved institute ID card before members can request equipment badges or book resources.
            </p>
            <Link
              to="/verification"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-[#1a1a1a] bg-white text-xs font-bold hover:bg-[#ede8df] transition-colors"
            >
              <IdCard className="w-3.5 h-3.5" aria-hidden="true" />
              Go to ID Verification
            </Link>
          </div>
        )}

        {/* Server error if any */}
        {request.isError && (
          <ErrorState
            error={request.error}
            title="Could not submit badge request"
          />
        )}

        {/* Main form */}
        {(!isHeld && !isPendingReview) && (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Note input */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={noteId}
                  className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]"
                >
                  Applicant Note <span className="font-normal lowercase text-[#1a1a1a]/60">(optional)</span>
                </label>
                <span className="text-[11px] text-[#1a1a1a]/60">{remaining} characters left</span>
              </div>
              <textarea
                ref={noteRef}
                id={noteId}
                rows={3}
                maxLength={BADGE_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={!isVerified || request.isPending}
                placeholder="Mention workshop batch, instructor name, Slurm cluster ID, or completion date..."
                className="w-full p-3 text-xs rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] placeholder:text-[#1a1a1a]/40 focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1 transition-all disabled:opacity-50"
              />
            </div>

            {/* Evidence attachment */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={fileId}
                  className="text-xs font-bold uppercase tracking-wider text-[#1a1a1a]"
                >
                  Training Evidence{' '}
                  {badge.evidenceRequired ? (
                    <span className="text-[#c0392b] font-bold">* (Required)</span>
                  ) : (
                    <span className="font-normal lowercase text-[#1a1a1a]/60">(optional)</span>
                  )}
                </label>
                <span className="text-[11px] text-[#1a1a1a]/60">PDF, JPG, PNG, WEBP ≤ 5 MB</span>
              </div>

              {!file ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
                    dragOver
                      ? 'border-[#c0392b] bg-[#fff5f5]'
                      : 'border-[#1a1a1a]/40 bg-[#f5f0e8]/50 hover:border-[#1a1a1a]'
                  } ${!isVerified ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <input
                    ref={fileInputRef}
                    id={fileId}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="sr-only"
                    disabled={!isVerified || request.isPending}
                    onChange={(e) => handleFileChange(e.target.files?.[0])}
                  />
                  <UploadCloud className="w-8 h-8 mx-auto text-[#1a1a1a]/60 mb-2" aria-hidden="true" />
                  <p className="text-xs font-bold text-[#1a1a1a]">
                    Drop certificate or workshop proof here, or{' '}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[#c0392b] underline hover:text-[#a93226] focus-visible:outline-none"
                    >
                      browse file
                    </button>
                  </p>
                  <p className="text-[11px] text-[#1a1a1a]/60 mt-1">
                    Upload scanned certificate, safety induction pass, or training sign-off sheet.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-lg border-2 border-[#1a1a1a] bg-white flex items-center justify-between gap-3 shadow-[2px_2px_0_#1a1a1a]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded border border-[#1a1a1a] bg-[#183d2d] text-white flex items-center justify-center shrink-0">
                      <FileCheck className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 text-xs">
                      <p className="font-bold truncate text-[#1a1a1a]">{file.name}</p>
                      <p className="text-[10px] text-[#1a1a1a]/60">
                        {Math.max(1, Math.round(file.size / 1024))} KB · {file.type || 'Document'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    disabled={request.isPending}
                    className="p-1 rounded hover:bg-[#ede8df] text-[#1a1a1a] focus-visible:outline-none"
                    aria-label="Remove attached evidence"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {compressing && (
                <p className="text-xs text-[#183d2d] flex items-center gap-1 font-bold">
                  <span className="w-3 h-3 border-2 border-[#183d2d] border-t-transparent rounded-full animate-spin" />
                  Optimising document…
                </p>
              )}

              {fileError && (
                <p role="alert" className="text-xs font-bold text-[#c0392b] flex items-center gap-1 mt-1">
                  <span aria-hidden="true">✕</span> {fileError}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="pt-3 border-t-2 border-[#1a1a1a]/15 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={request.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="forest"
                size="sm"
                disabled={!isVerified || compressing}
                loading={request.isPending}
              >
                {request.isPending
                  ? 'Submitting…'
                  : isRenewal
                    ? 'Submit Renewal'
                    : 'Submit Request'}
              </Button>
            </div>
          </form>
        )}

        {(isHeld || isPendingReview) && (
          <div className="pt-3 border-t-2 border-[#1a1a1a]/15 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
