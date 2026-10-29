import React from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { ErrorState } from './ErrorState';

/**
 * "Are you sure?" for an action that needs no text (frontend.md §10.3: a real dialog, focus trapped,
 * Esc closes, focus returns). Focus starts on "Go back", the safe choice. Pass the mutation's state
 * as `pending` and `error`; close the dialog yourself when it succeeds. `children` (or
 * `description`) says what will happen.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  eyebrow,
  description,
  children,
  confirmLabel = 'Confirm',
  pendingLabel,
  cancelLabel = 'Go back',
  variant = 'primary',
  pending = false,
  error = null,
  errorTitle = "That didn't go through",
  returnFocusRef,
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={pending}
      title={title}
      eyebrow={eyebrow}
      description={description}
      returnFocusRef={returnFocusRef}
    >
      <div className="space-y-4">
        {children && <div className="text-sm leading-relaxed">{children}</div>}
        <ErrorState error={error} title={errorTitle} />
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2 border-t border-[#1a1a1a]/15">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onClose}
            disabled={pending}
            data-autofocus
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant}
            size="lg"
            loading={pending}
            onClick={() => {
              if (!pending) onConfirm?.();
            }}
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
