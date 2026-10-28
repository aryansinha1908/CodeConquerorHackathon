import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { X, MessageSquare, AlertCircle } from 'lucide-react';

const DEFAULT_TEMPLATES = [
  'Clashes with scheduled academic lab session.',
  'Missing required prerequisite safety training certification.',
  'Maximum slot capacity reached for this timeframe.',
  'Scheduled maintenance or calibration window in progress.',
  'Borrower requested cancellation due to schedule conflict.',
];

export function ReasonDialog({
  isOpen,
  onClose,
  onSubmit,
  title = 'Provide Decision Reason',
  subtitle = 'A mandatory explanation (10–500 characters) will be recorded in the audit log.',
  actionLabel = 'Confirm Decision',
  actionVariant = 'danger',
  templates = DEFAULT_TEMPLATES,
  loading = false,
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const charCount = reason.trim().length;
  const isValid = charCount >= 10 && charCount <= 500;

  const handleConfirm = () => {
    if (!isValid) {
      setError('Reason must be between 10 and 500 characters.');
      return;
    }
    onSubmit(reason.trim());
  };

  const handleTemplateClick = (tmpl) => {
    setReason(tmpl);
    setError('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1a1a1a]/60 backdrop-blur-xs font-mono"
    >
      <div className="relative w-full max-w-lg bg-white border-2 border-[#1a1a1a] rounded-xl shadow-[6px_6px_0_#1a1a1a] p-6 space-y-4 animate-fadeSlideIn">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b-2 border-[#1a1a1a]/15">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#f5f0e8] border border-[#1a1a1a] rounded-lg text-[#1a1a1a]">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-black text-[#1a1a1a] tracking-tight">{title}</h3>
              <p className="text-xs text-[#1a1a1a]/60">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#ede8df] text-[#1a1a1a]/70 hover:text-[#1a1a1a]"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick-pick templates */}
        {templates?.length > 0 && (
          <div>
            <label className="text-[11px] font-bold text-[#1a1a1a]/70 uppercase block mb-1.5">
              Quick Templates
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {templates.map((tmpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleTemplateClick(tmpl)}
                  className="text-[10px] px-2 py-1 rounded border border-[#1a1a1a]/40 bg-[#f5f0e8] hover:bg-[#ede8df] hover:border-[#1a1a1a] text-left transition-colors"
                >
                  {tmpl}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Textarea */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs font-bold">
            <label htmlFor="reason-text" className="text-[#1a1a1a]">
              Mandatory Rationale / Notes:
            </label>
            <span
              className={`text-[11px] ${
                charCount < 10
                  ? 'text-[#c0392b]'
                  : charCount > 500
                  ? 'text-[#c0392b]'
                  : 'text-[#183d2d]'
              }`}
            >
              {charCount} / 500 chars (min 10)
            </span>
          </div>
          <textarea
            id="reason-text"
            rows={4}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError('');
            }}
            placeholder="Specify reason for audit and borrower notification..."
            className="w-full p-3 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
          />
          {error && (
            <p className="text-xs text-[#c0392b] font-bold flex items-center gap-1 mt-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="pt-3 border-t-2 border-[#1a1a1a]/15 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={actionVariant}
            size="sm"
            onClick={handleConfirm}
            disabled={!isValid || loading}
            loading={loading}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

