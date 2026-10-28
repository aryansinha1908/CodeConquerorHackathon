import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

/**
 * A failed request as the user sees it (frontend.md §7 ErrorState, §8.3): what failed, the server's
 * message, the request id to quote, and an optional retry. `error` is lib/http.js's normalised error.
 */
export function RequestError({ error, title, onRetry, className = '' }) {
  if (!error) return null;
  const wait =
    error.code === 'RATE_LIMITED' && error.retryAfter ? ` Try again in ${error.retryAfter} s.` : '';
  return (
    <div
      role="alert"
      className={`p-4 bg-[#fff5f5] border-2 border-[#c0392b] rounded-lg text-sm text-[#1a1a1a] font-mono ${className}`}
    >
      <p className="font-bold text-[#c0392b] flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 break-words">
        {error.message || 'Something went wrong.'}
        {wait}
      </p>
      {error.requestId && <p className="mt-1 text-xs text-[#1a1a1a]/70">ref: {error.requestId}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3 bg-white" onClick={onRetry}>
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}
