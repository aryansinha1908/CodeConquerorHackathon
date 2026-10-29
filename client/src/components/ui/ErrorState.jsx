import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { errorMessage } from '../../lib/errors';

/**
 * A failed request as the user sees it (frontend.md §7 ErrorState, §8.3): what failed, the server's
 * message, the request id to quote and, with `onRetry`, a "Try again" button. `error` is lib/http.js's
 * normalised error; nothing renders without one. `retrying` keeps the button (and its focus) while
 * the retry runs. `children` adds a line of advice or a link under the message.
 */
export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  retrying = false,
  retryLabel = 'Try again',
  children,
  className,
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn(
        'p-4 bg-[#fff5f5] border-2 border-[#c0392b] rounded-lg text-sm text-[#1a1a1a] font-mono',
        className
      )}
    >
      <p className="font-bold text-[#c0392b] flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 break-words">{errorMessage(error)}</p>
      {children && <div className="mt-2 text-xs">{children}</div>}
      {error.requestId && (
        <p className="mt-1 text-xs text-[#1a1a1a]/70 break-all">ref: {error.requestId}</p>
      )}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 bg-white min-h-[44px]"
          onClick={onRetry}
          loading={retrying}
        >
          {!retrying && <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
