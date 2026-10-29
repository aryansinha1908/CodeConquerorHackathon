import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Sparkles } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { formatIstShortDateTime } from '../../../lib/time';
import { aiQuotaText, useAiQuota } from '../../ai/api';
import { useAiCompare } from '../../bookings/api';
import { COMPARE_STATUSES, SEVERITY_VIEW, canRetryCompare, compareErrorText, photoCount, verdictView } from './aiCompareView';

// The return check's AI photo comparison (frontend.md FC-13, api.md POST /bookings/:id/ai-compare):
// on a click, Google Gemini compares the borrower's pickup and return photos and lists what looks
// different. Always labelled as a suggestion: the manager looks at the photos and decides, with the
// form below. Only the photos and the checklist labels are sent. Offered once the item is back and
// both handovers have photos; asking again is free (the server caches by the photos). A 409 (the
// booking changed meanwhile) calls onStale so the page reloads what it shows.

const asText = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const VERDICT_ICONS = { damage: AlertTriangle, clear: CheckCircle2, unclear: HelpCircle };

export function AiCompareResult({ result, showForm = false, headingRef, Heading = 'h4' }) {
  const { comparison, photos, cached, generatedAt } = result;
  const verdict = verdictView(comparison);
  const differences = Array.isArray(comparison?.differences) ? comparison.differences : [];
  const at = formatIstShortDateTime(generatedAt);
  return (
    <Card variant="cream" className="p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading ref={headingRef} tabIndex={-1} className="text-sm font-bold flex items-center gap-2 focus:outline-none">
          <Sparkles className="w-4 h-4" aria-hidden="true" />
          AI suggestion: photo comparison
        </Heading>
        <Badge variant={verdict.variant} size="sm" icon={VERDICT_ICONS[verdict.tone]}>
          {verdict.label}
        </Badge>
      </div>
      <p className="text-sm [overflow-wrap:anywhere]">{asText(comparison?.summary)}</p>
      {differences.length > 0 ? (
        <ul className="space-y-2">
          {differences.map((d, i) => {
            const view = SEVERITY_VIEW[d.severity] ?? SEVERITY_VIEW.minor;
            return (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge variant={view.variant} size="sm" className="shrink-0">
                  {view.label}
                </Badge>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {asText(d.description)}
                  {d.checklistItem && <span className="text-[#1a1a1a]/75"> (checklist: {asText(d.checklistItem)})</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs">Gemini listed no differences.</p>
      )}
      {verdict.tone === 'damage' && showForm && (
        <p className="text-xs font-bold">If you agree after looking at the photos, choose “Report issue” in your check below.</p>
      )}
      <p className="text-xs text-[#1a1a1a]/70">
        Gemini compared {photos?.before ?? 0} pickup and {photos?.after ?? 0} return{' '}
        {photos?.after === 1 ? 'photo' : 'photos'}
        {at ? ` on ${at} IST` : ''}
        {cached ? ' (compared before: no AI request used)' : ''}. It can miss damage or see some that
        isn&apos;t there: check the photos yourself; a person decides.
      </p>
    </Card>
  );
}

export function AiCompareCard({ bookingId, status, checkIn, checkOut, returnCheck = null, showForm = false, onStale }) {
  const ids = useId();
  const headingId = `${ids}-heading`;
  const compare = useAiCompare();
  const quota = useAiQuota({ enabled: COMPARE_STATUSES.includes(status) });
  const resultHeadingRef = useRef(null);
  // A second activation before the first one's state arrives (a double click) would pay twice.
  const inFlightRef = useRef(false);
  // The result replaces the button: focus its heading once it's on screen, unless the manager has
  // moved on meanwhile (into the form, say): then focus stays where they are.
  const focusResultRef = useRef(false);
  const result = compare.data?.data ?? null;
  useEffect(() => {
    if (focusResultRef.current && result) {
      focusResultRef.current = false;
      const where = document.activeElement;
      if (!where || where === document.body) resultHeadingRef.current?.focus();
    }
  });

  if (!COMPARE_STATUSES.includes(status)) return null;
  const before = photoCount(checkIn);
  // The borrower's return photos, or the manager's own when the borrower took none (as the server).
  const after = photoCount(checkOut) || photoCount(returnCheck);
  const meter = aiQuotaText(quota.data?.data);
  const configured = quota.data?.data?.configured !== false;
  const offer = !compare.isError || canRetryCompare(compare.error);
  const ask = () => {
    if (inFlightRef.current || compare.isPending) return;
    inFlightRef.current = true;
    focusResultRef.current = true;
    compare.mutate(bookingId, {
      onError: (err) => {
        if (err?.status === 409) onStale?.();
      },
      onSettled: () => {
        inFlightRef.current = false;
      },
    });
  };
  const missing = !before && !after ? 'pickup or return' : !before ? 'pickup' : 'return';
  const verdict = result ? verdictView(result.comparison) : null;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="text-lg font-black tracking-tight flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-[#a93226]" aria-hidden="true" />
        Compare the photos with AI
      </h3>
      <p role="status" aria-live="polite" className="sr-only">
        {compare.isPending ? 'Gemini is comparing the photos.' : verdict ? `Comparison ready: ${verdict.label.toLowerCase()}.` : ''}
      </p>

      {!before || !after ? (
        <p className="text-xs">The AI comparison needs photos at both handovers; this booking has none at {missing}.</p>
      ) : result ? (
        <AiCompareResult result={result} showForm={showForm} headingRef={resultHeadingRef} />
      ) : (
        <div className="space-y-2">
          <p className="text-xs">
            Google Gemini looks at the {before} pickup and {after} return {after === 1 ? 'photo' : 'photos'} and lists
            what looks different. Only the photos and the checklist labels are sent, not the borrower&apos;s name,
            notes or email. On Gemini&apos;s free tier Google may keep and review the photos.
          </p>
          {!configured ? (
            <p className="text-xs font-bold">AI isn&apos;t set up on this server yet. Compare the photos above yourself.</p>
          ) : (
            offer && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  className="bg-white min-h-[40px]"
                  aria-disabled={compare.isPending || undefined}
                  onClick={ask}
                >
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                  {compare.isPending ? 'Comparing…' : compare.isError ? 'Try again' : 'Compare with AI'}
                </Button>
                {meter && <span className="text-[11px] font-bold text-[#1a1a1a]/75">{meter}</span>}
              </div>
            )
          )}
          {compare.isPending && <p className="text-xs">This can take up to half a minute.</p>}
          {compare.isError && (
            <p role="alert" className="text-xs font-bold p-3 rounded-lg border-2 border-[#e67e22] bg-[#fef9f3]">
              {compareErrorText(compare.error)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
