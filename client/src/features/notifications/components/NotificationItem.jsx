import React, { useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { notificationView } from './notificationView';
import { StaggerItem } from '../../../components/Motion';

const linkClass =
  'inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-md border-2 border-[#1a1a1a] bg-[#183d2d] ' +
  'text-white text-xs font-bold shadow-[2px_2px_0_#1a1a1a] hover:shadow-[1px_1px_0_#1a1a1a] ' +
  'hover:translate-x-[1px] hover:translate-y-[1px] transition-all focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2';

/**
 * One row of /notifications: icon and area, title, body, time (relative, full IST on hover and in
 * the <time> element) and, for an unread one, an "Unread" label and "Mark read". "Open" follows the
 * in-app link and marks it read on the way. After "Mark read" the button goes away, so focus moves
 * to the row instead of falling to <body>.
 *
 * notification: a Notification as api.md describes; onMarkRead(notification); now: epoch ms.
 */
export function NotificationItem({ notification, onMarkRead, now }) {
  const ids = useId();
  const rowRef = useRef(null);
  const view = notificationView(notification, now);
  const Icon = view.icon;
  const titleId = `${ids}-title`;

  const markRead = () => {
    onMarkRead?.(notification);
    rowRef.current?.focus();
  };

  return (
    <StaggerItem>
      <article
        ref={rowRef}
        tabIndex={-1}
        aria-labelledby={titleId}
        className={cn(
          'flex gap-3 sm:gap-4 p-4 rounded-xl border-2 font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]',
          view.unread
            ? 'bg-[#fffbea] border-[#1a1a1a] shadow-[4px_4px_0_#1a1a1a]'
            : 'bg-white border-[#1a1a1a]/40'
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'w-10 h-10 shrink-0 rounded-lg border-2 border-[#1a1a1a] flex items-center justify-center',
            view.unread ? 'bg-[#f1c40f]' : 'bg-[#ede8df]'
          )}
        >
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest font-bold text-[#1a1a1a]/70">
              {view.area}
            </span>
            {view.unread && (
              <Badge variant="red" size="sm">
                Unread
              </Badge>
            )}
          </div>
          <h2
            id={titleId}
            className={cn('text-sm sm:text-base tracking-tight break-words', view.unread ? 'font-black' : 'font-bold')}
          >
            {view.title}
          </h2>
          {view.body && <p className="text-xs sm:text-sm text-[#1a1a1a]/85 leading-relaxed break-words">{view.body}</p>}
          {view.createdAt && (
            <p className="text-[11px] text-[#1a1a1a]/70">
              <time dateTime={view.createdAt} title={view.whenFull ?? undefined}>
                {view.when}
              </time>
              {view.whenFull && <span> · {view.whenFull}</span>}
            </p>
          )}
          {(view.link || view.unread) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {view.link && (
                <Link
                  to={view.link}
                  onClick={() => {
                    if (view.unread) onMarkRead?.(notification);
                  }}
                  className={linkClass}
                >
                  Open
                  <span className="sr-only">: {view.title}</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </Link>
              )}
              {view.unread && (
                <Button type="button" variant="outline" size="sm" className="bg-white min-h-[36px]" onClick={markRead}>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  Mark read
                  <span className="sr-only">: {view.title}</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </article>
    </StaggerItem>
  );
}
