import React from 'react';
import { CheckCircle2, ScanText, XCircle } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { FIX_HINTS, STORED_LABELS, deviceCheckAnnouncement, verdictOf } from './idCardCheck';

// The on-device ID-card check's views (frontend.md FC-12): the list of checks, the member's panel
// under their upload, and the admin's summary of what the member's device found. Always labelled as
// a hint: a device check reads text, it can't tell a real card from a good fake.

// Green only when everything was found; gold when only the institute or the year is missing; amber
// when the roll number or the name is, which nothing else makes up for.
const VERDICT_VARIANTS = { all: 'green', most: 'gold', doubt: 'amber' };

/** checks: [{ id, label, passed }]. With `hints`, what to try for each check that failed. */
export function DeviceCheckList({ checks, hints = false }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((check) => (
        <li key={check.id} className="text-xs flex items-start gap-2">
          {check.passed ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1e7e45]" aria-hidden="true" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 text-[#c0392b]" aria-hidden="true" />
          )}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="sr-only">{check.passed ? 'Found: ' : 'Not found: '}</span>
            {check.label}
            {hints && !check.passed && FIX_HINTS[check.id] && (
              <span className="block text-[#1a1a1a]/75">{FIX_HINTS[check.id]}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Device check 3/4", coloured by which checks passed (checks: [{ id, passed }]). */
export function DeviceCheckBadge({ score, total, checks = [] }) {
  return (
    <Badge variant={VERDICT_VARIANTS[verdictOf(checks)]} size="sm" icon={ScanText}>
      Device check {score}/{total}
    </Badge>
  );
}

/**
 * Under the member's upload. check: useIdCardCheck(); pdf: the file is a PDF (not read here). Never
 * blocks the upload; the result goes with it as yes/no answers only, once it has finished.
 */
export function MemberDeviceCheck({ check, pdf = false }) {
  const result = check.result;
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {pdf ? '' : deviceCheckAnnouncement(check)}
      </p>
      {pdf ? (
        <p className="text-xs text-[#1a1a1a]/75">PDFs aren&apos;t checked on your device. An administrator checks the card.</p>
      ) : (
        check.status !== 'idle' && (
          <div
            className="rounded-lg border-2 border-[#1a1a1a]/30 bg-[#f5f0e8] p-3 space-y-2"
            aria-busy={check.status === 'running' || undefined}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold flex items-center gap-1.5">
                <ScanText className="w-4 h-4" aria-hidden="true" />
                Checking the card on this device
              </p>
              {check.status === 'done' && result?.readable && (
                <DeviceCheckBadge score={result.score} total={result.total} checks={result.checks} />
              )}
            </div>
            {check.status === 'running' && (
              <p className="text-xs">
                Reading the card… {Math.round((check.progress ?? 0) * 100)}%. The first check downloads about 7 MB. You
                can submit meanwhile, but the answers only go with the upload once the check has finished.
              </p>
            )}
            {check.status === 'failed' && (
              <p className="text-xs">The check couldn&apos;t run on this device. It&apos;s optional: you can still submit.</p>
            )}
            {check.status === 'done' && !result?.readable && (
              <p className="text-xs">
                No text could be read from this photo. A sharp, straight-on photo in good light works best; you can still
                submit this one.
              </p>
            )}
            {check.status === 'done' && result?.readable && (
              <>
                {result.score <= 1 && (
                  <p className="text-xs font-bold">
                    Most checks failed. Is the card upright (not sideways), flat and filling the photo?
                  </p>
                )}
                <DeviceCheckList checks={result.checks} hints />
              </>
            )}
            <p className="text-[11px] text-[#1a1a1a]/75">
              The photo stays on your device for this check; only the yes/no answers go with your upload. It&apos;s a
              hint for you and the administrator, not a decision.
            </p>
          </div>
        )
      )}
    </>
  );
}

/** The admin's queue: what the member's device reported, from the stored answers. */
export function StoredDeviceCheck({ ocrCheck }) {
  if (!ocrCheck?.checks) return null;
  const checks = Object.entries(ocrCheck.checks).map(([id, passed]) => ({ id, passed, label: STORED_LABELS[id] ?? id }));
  return (
    <div className="space-y-1.5">
      <DeviceCheckBadge score={ocrCheck.score} total={ocrCheck.total} checks={checks} />
      <DeviceCheckList checks={checks} />
      <p className="text-[11px] text-[#1a1a1a]/70">Reported by the member&apos;s browser: a hint, not proof.</p>
    </div>
  );
}
