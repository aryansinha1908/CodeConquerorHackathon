import React, { useId, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { AI_QUESTION_MAX, AI_QUESTION_MIN, aiQuotaText, useAiQuota } from '../../ai/api';

// Explore's "Ask in your own words" box (frontend.md FC-06): a description of what you need goes to
// POST /resources/ai-search through the page's ?ask. Beside it, the AI requests left today (GET
// /ai/quota) and what is sent where: the question and the catalogue go to Google Gemini, nothing
// about the member. The text is the filter bar's (value, onValueChange), so it carries over to the
// keyword search; `inputRef` is the bar's, so its "Clear filters" can put focus back here.

export function AiAskForm({ value = '', onValueChange, onAsk, inputRef }) {
  const ids = useId();
  const inputId = `${ids}-ask`;
  const hintId = `${ids}-hint`;
  const errorId = `${ids}-error`;
  const [error, setError] = useState(null);

  const quota = useAiQuota();
  const meter = aiQuotaText(quota.data?.data);
  const configured = quota.data?.data?.configured !== false;

  const change = (next) => {
    onValueChange?.(next);
    if (error) setError(null);
  };

  const submit = (event) => {
    event.preventDefault();
    const text = value.trim();
    if (text.length < AI_QUESTION_MIN) {
      setError(`Describe what you need in at least ${AI_QUESTION_MIN} characters.`);
      inputRef?.current?.focus();
      return;
    }
    setError(null);
    onAsk?.(text);
  };

  return (
    <form role="search" aria-label="Ask in your own words" className="flex-1 flex flex-col gap-1" onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="text-sm font-bold tracking-tight">
        Describe what you need
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Sparkles
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#a93226] pointer-events-none"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={value}
            maxLength={AI_QUESTION_MAX}
            enterKeyHint="search"
            onChange={(event) => change(event.target.value)}
            placeholder="Something to print a phone case on…"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
            className="w-full pl-9 pr-10 py-2.5 text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono placeholder:text-[#1a1a1a]/60 focus:outline-none focus:ring-2 focus:ring-[#c0392b] focus:ring-offset-1"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                change('');
                inputRef?.current?.focus();
              }}
              aria-label="Clear the question"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 inline-flex items-center justify-center rounded-md hover:bg-[#ede8df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <Button type="submit" variant="primary" size="md" className="shrink-0">
          Ask
        </Button>
      </div>
      {/* An alert: on Enter, focus is already in the box, so a new description wouldn't be read. */}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-bold text-[#a93226]">
          {error}
        </p>
      )}
      <div id={hintId} className="text-[11px] text-[#1a1a1a]/75 space-y-0.5">
        <p>
          Your question and the list of resources go to Google Gemini; your name, email and bookings
          don&apos;t. On Gemini&apos;s free tier Google may keep and review what it receives, so don&apos;t
          type personal details.
        </p>
        {!configured ? (
          <p className="font-bold">AI search isn&apos;t set up on this server yet. Keyword search still works.</p>
        ) : (
          meter && <p className="font-bold">{meter}. Asking the same thing again is usually free.</p>
        )}
      </div>
    </form>
  );
}
