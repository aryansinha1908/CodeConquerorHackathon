import React, { useRef, useState } from 'react';
import { Lock, MessageSquare, Send } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { fieldErrorsFrom } from '../../../lib/errors';
import { formatIstShortDateTime } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { COMMENT_MAX, readComment, useAddComment } from '../api';
import { Notice } from './Notice';
import { TextAreaField } from './TextAreaField';
import { commentAuthor, managesUnit, isAdmin } from './incidentView';

/**
 * The incident's thread (api.md IncidentDetail `comments: [{ _id, by: { _id, name }, text, at }]`,
 * oldest first) and, while `canComment`, the form for POST /incidents/:id/comments (1–1000
 * characters). Once resolved the thread is closed and says so. `Heading` is the section's heading
 * element; `onAnnounce(text)` reports a posted comment to the page's live region.
 */
export function CommentThread({ incident, user, Heading = 'h2', onAnnounce }) {
  const add = useAddComment();
  const fieldRef = useRef(null);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState(null);
  const comments = Array.isArray(incident?.comments) ? incident.comments.filter((c) => c && typeof c === 'object') : [];
  const canComment = incident?.canComment === true;
  const staff = isAdmin(user) || managesUnit(user, incident?.orgUnit);
  const serverField = fieldErrorsFrom(add.error).text ?? null;
  const fieldError = localError ?? serverField;

  const submit = (event) => {
    event.preventDefault();
    if (add.isPending) return;
    const { value, error } = readComment(text);
    setLocalError(error);
    if (error) {
      fieldRef.current?.focus();
      return;
    }
    add.mutate(
      { id: String(incident._id), text: value },
      {
        onSuccess: () => {
          setText('');
          onAnnounce?.('Comment posted.');
        },
        onError: (err) => {
          if (fieldErrorsFrom(err).text) fieldRef.current?.focus();
        },
      }
    );
  };

  return (
    <section aria-labelledby="incident-thread-heading" className="space-y-4">
      <Heading id="incident-thread-heading" className="text-base md:text-lg font-bold tracking-tight flex items-center gap-2">
        <MessageSquare className="w-5 h-5" aria-hidden="true" />
        Thread
        <span className="text-xs font-normal text-[#1a1a1a]/70">
          ({comments.length} {comments.length === 1 ? 'comment' : 'comments'})
        </span>
      </Heading>

      {comments.length === 0 ? (
        <p className="text-sm text-[#1a1a1a]/70">
          No comments yet.{canComment ? ' Ask a question or add what you know.' : ''}
        </p>
      ) : (
        <ol className="space-y-3" aria-label="Comments, oldest first">
          {comments.map((comment, index) => {
            const author = commentAuthor(comment, user);
            const at = formatIstShortDateTime(comment.at);
            const mine = author === 'You';
            return (
              <li
                key={String(comment._id ?? index)}
                className={cn(
                  'rounded-lg border-2 p-3 bg-white',
                  mine ? 'border-[#183d2d] sm:ml-8' : 'border-[#1a1a1a]/40 sm:mr-8'
                )}
              >
                <p className="text-xs flex flex-wrap gap-x-2">
                  <span className="font-bold">{author}</span>
                  {at && (
                    <time dateTime={String(comment.at)} className="text-[#1a1a1a]/70">
                      {at} IST
                    </time>
                  )}
                </p>
                <p className="text-sm mt-1 whitespace-pre-wrap break-words">
                  {typeof comment.text === 'string' ? comment.text : ''}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {canComment ? (
        <form onSubmit={submit} noValidate className="space-y-3">
          <TextAreaField
            ref={fieldRef}
            label="Add a comment"
            required
            rows={3}
            value={text}
            onChange={(value) => {
              setText(value);
              if (localError) setLocalError(null);
            }}
            maxLength={COMMENT_MAX}
            hint={
              staff && incident?.status === 'open'
                ? `At most ${COMMENT_MAX} characters. Everyone involved is notified, and your first comment marks the incident “In review”.`
                : `At most ${COMMENT_MAX} characters. Everyone involved is notified.`
            }
            error={fieldError}
          />
          {!serverField && (
            <ErrorState error={add.error} title="The comment wasn't posted">
              {add.error?.code === 'INVALID_TRANSITION' ? 'The incident above shows its current state.' : null}
            </ErrorState>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="forest" loading={add.isPending}>
              {!add.isPending && <Send className="w-4 h-4" aria-hidden="true" />}
              {add.isPending ? 'Posting…' : 'Post comment'}
            </Button>
          </div>
        </form>
      ) : (
        <Notice icon={Lock}>
          <p>This incident is resolved, so its thread is closed.</p>
        </Notice>
      )}
    </section>
  );
}
