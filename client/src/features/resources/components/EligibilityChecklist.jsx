import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Check, X } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../lib/utils';
import { fixLinksFor, isBlocking, ruleLabel, ruleText } from '../format';

// The server's eligibility results as a checklist (frontend.md §7 EligibilityChecklist). `results`
// is [{ rule, hard?, passed, message, fixHint, meta? }] from GET /resources/:id/eligibility,
// POST /bookings/check, or the details of a 422 INELIGIBLE. Nothing is worked out here: each line
// is the server's message and fix hint, plus a link where the fix lives in the app (a failed
// BADGES rule links to /badges?request=<badge code>). Never colour alone: every line has an icon
// and a word.

function RuleIcon({ state }) {
  const styles = {
    passed: 'bg-[#183d2d] text-white',
    failed: 'bg-[#c0392b] text-white',
    soft: 'bg-[#f1c40f] text-[#1a1a1a]',
  };
  const Icon = state === 'passed' ? Check : state === 'soft' ? AlertTriangle : X;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'w-6 h-6 rounded-md border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 mt-0.5',
        styles[state]
      )}
    >
      <Icon className="w-3.5 h-3.5 stroke-[3]" />
    </span>
  );
}

const STATE_WORDS = { passed: 'Passed', failed: 'Not met', soft: 'Slot taken' };
const STATE_TEXT = {
  passed: 'text-[#183d2d]',
  failed: 'text-[#a93226]',
  soft: 'text-[#7a4a00]',
};
const STATE_BOX = {
  passed: 'bg-[#f0faf5] border-[#183d2d]/40',
  failed: 'bg-[#fff5f5] border-[#c0392b]',
  soft: 'bg-[#fef9f3] border-[#e67e22]',
};

/** One rule as a list item. Exported for the review queue and the tests. */
export function RuleItem({ result, resource }) {
  const state = result.passed ? 'passed' : isBlocking(result) ? 'failed' : 'soft';
  const message = ruleText(result.message);
  const fixHint = result.passed ? '' : ruleText(result.fixHint);
  const links = fixLinksFor(result, resource);
  return (
    <li className={cn('p-3 rounded-lg border-2 flex items-start gap-3', STATE_BOX[state])}>
      <RuleIcon state={state} />
      <div className="flex-1 min-w-0 text-xs">
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className="font-bold tracking-tight text-[#1a1a1a] text-sm">{ruleLabel(result.rule)}</span>
          <span className={cn('text-[11px] font-bold uppercase tracking-wider', STATE_TEXT[state])}>
            <span className="sr-only">: </span>
            {STATE_WORDS[state]}
          </span>
        </p>
        {message && <p className="text-[#1a1a1a]/85 mt-1 leading-relaxed break-words">{message}</p>}
        {fixHint && (
          <p className="text-[#1a1a1a] mt-1 leading-relaxed break-words">
            <span className="font-bold">What to do: </span>
            {fixHint}
          </p>
        )}
        {links.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {links.map((link) => (
              <li key={`${link.to}|${link.label}`}>
                <Link
                  to={link.to}
                  className="inline-flex items-center gap-1 min-h-[32px] px-2.5 py-1 rounded-md border-2 border-[#1a1a1a] bg-white font-bold text-xs text-[#a93226] hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-1"
                >
                  {link.label}
                  <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * The checklist card. `title` heads it (as `headingLevel`, default h2); `summary` (text) can replace
 * the default line under it; `bare` drops the card frame for use inside another card. `busy` marks
 * the list as being re-checked.
 */
export function EligibilityChecklist({
  results,
  resource,
  title = 'Eligibility checklist',
  eyebrow,
  summary,
  headingLevel = 'h2',
  bare = false,
  busy = false,
  className,
  children,
}) {
  const headingId = useId();
  const Heading = headingLevel;
  const items = (Array.isArray(results) ? results : []).filter((r) => r && typeof r === 'object');
  const blocking = items.filter(isBlocking).length;
  const softFail = items.some((r) => r.passed === false && !isBlocking(r));
  const badge =
    blocking > 0
      ? { variant: 'red', label: `${blocking} to fix` }
      : softFail
        ? { variant: 'gold', label: 'Waitlist only' }
        : { variant: 'forest', label: 'All checks pass' };
  const line =
    summary ??
    (blocking > 0
      ? `${blocking} of ${items.length} checks aren't met yet. Each one says what to do.`
      : softFail
        ? 'You meet every rule, but the slot is taken: you can join the waitlist.'
        : 'You meet every rule the server checked.');

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      className={cn(
        'font-mono text-[#1a1a1a] space-y-4',
        !bare && 'rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a]',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b-2 border-[#1a1a1a]/15">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]/70">{eyebrow}</p>
          )}
          <Heading id={headingId} className="text-base font-black tracking-tight">
            {title}
          </Heading>
          {items.length > 0 && <p className="text-xs text-[#1a1a1a]/75 mt-1">{line}</p>}
        </div>
        {items.length > 0 && (
          <Badge variant={badge.variant} size="sm">
            {badge.label}
          </Badge>
        )}
      </div>
      {children}
      {items.length > 0 ? (
        <ul className={cn('space-y-2.5', busy && 'opacity-60')}>
          {items.map((result, index) => (
            <RuleItem key={`${result.rule ?? 'rule'}-${index}`} result={result} resource={resource} />
          ))}
        </ul>
      ) : (
        !children && <p className="text-xs text-[#1a1a1a]/70">No rules to show.</p>
      )}
    </section>
  );
}
