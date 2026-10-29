import React, { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Menu,
  MenuButton,
  MenuHeading,
  MenuItem,
  MenuItems,
  MenuSection,
  MenuSeparator,
} from '@headlessui/react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, Bell, CheckCheck } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { errorMessage, errorToastText } from '../lib/errors';
import { cn } from '../lib/utils';
import { useNow } from '../features/resources/hooks';
import {
  BELL_LIMIT,
  bellLabel,
  isInAppPath,
  isUnread,
  notificationKeys,
  unreadBadgeText,
  unreadCountOf,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '../features/notifications/api';
import { notificationView } from '../features/notifications/components/notificationView';

// The header bell (frontend.md §7 NotificationBell, §6.2 /notifications): the unread count from
// GET /notifications/unread-count, polled every 30 s while signed in and the tab is visible, and a
// menu button (Headless UI Menu: arrow keys, Home / End, type-ahead, Esc returns focus to the
// bell) whose menu holds the latest 5, "Mark all read" and "See all". Choosing a notification
// marks it read (optimistically) and opens its in-app link.

const itemClass =
  'w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-md border-2 border-transparent ' +
  'data-focus:bg-[#ede8df] data-focus:border-[#1a1a1a] data-disabled:opacity-60 data-disabled:cursor-default';

const footerItemClass =
  'flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] rounded-md border-2 ' +
  'border-[#1a1a1a] bg-white text-xs font-bold data-focus:bg-[#ede8df] data-focus:ring-2 ' +
  'data-focus:ring-[#c0392b] data-disabled:opacity-50 data-disabled:cursor-not-allowed';

// One status line in the menu (loading, empty, failed). A disabled item, because a menu may hold
// only items, groups and separators; screen readers still read it, and arrow keys skip it.
function StatusItem({ children, tone = 'muted' }) {
  return (
    <MenuItem disabled>
      <div
        className={cn(
          'px-3 py-3 text-xs leading-relaxed',
          tone === 'error' ? 'text-[#c0392b] font-bold' : 'text-[#1a1a1a]/70'
        )}
      >
        {children}
      </div>
    </MenuItem>
  );
}

/**
 * The menu's contents: the latest 5 notifications (fetched each time the menu opens, as it mounts
 * then) and the footer actions. Exported for the tests, which render it inside a static Menu.
 * unread: the bell count; onSelect(notification), onMarkAll(): what the bell does.
 */
export function BellPanel({ unread = 0, onSelect, onMarkAll, markingAll = false }) {
  const now = useNow();
  const latest = useNotifications({ page: 1, limit: BELL_LIMIT });
  const items = Array.isArray(latest.data?.data)
    ? latest.data.data.filter((n) => n && typeof n === 'object')
    : [];

  return (
    <>
      <MenuSection>
        <MenuHeading className="px-3 pt-3 pb-1 flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-widest font-bold text-[#1a1a1a]/70">
          <span>Latest notifications</span>
          <span className="normal-case tracking-normal">{unread > 0 ? `${unread} unread` : 'All read'}</span>
        </MenuHeading>
        {latest.isPending && <StatusItem>Loading your notifications…</StatusItem>}
        {latest.isError && !latest.data && (
          <StatusItem tone="error">
            Couldn&apos;t load your notifications. {errorMessage(latest.error)}
            {latest.error?.requestId && (
              <span className="block font-normal text-[#1a1a1a]/70 break-all">
                ref: {latest.error.requestId}
              </span>
            )}
          </StatusItem>
        )}
        {latest.isSuccess && items.length === 0 && (
          <StatusItem>No notifications yet. Updates about your bookings and badges appear here.</StatusItem>
        )}
        {items.map((notification) => {
          const view = notificationView(notification, now);
          const Icon = view.icon;
          return (
            <MenuItem key={view.id}>
              <button type="button" onClick={() => onSelect?.(notification)} className={itemClass}>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 w-8 h-8 shrink-0 rounded-md border-2 border-[#1a1a1a] flex items-center justify-center',
                    view.unread ? 'bg-[#f1c40f]' : 'bg-white'
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {view.unread && (
                      <span aria-hidden="true" className="w-2 h-2 shrink-0 rounded-full bg-[#c0392b]" />
                    )}
                    <span className={cn('text-xs break-words', view.unread ? 'font-black' : 'font-bold')}>
                      {view.title}
                    </span>
                  </span>
                  {view.unread && <span className="sr-only">Unread. </span>}
                  {view.body && (
                    <span className="block text-[11px] text-[#1a1a1a]/80 line-clamp-2 break-words">
                      {view.body}
                    </span>
                  )}
                  {view.when && (
                    <span className="block text-[10px] text-[#1a1a1a]/70 mt-0.5">
                      {view.area} · {view.when}
                    </span>
                  )}
                </span>
              </button>
            </MenuItem>
          );
        })}
      </MenuSection>
      <MenuSeparator className="my-1 h-0.5 bg-[#1a1a1a]/15" />
      <MenuSection className="flex gap-2 p-2">
        <MenuItem disabled={unread <= 0 || markingAll}>
          <button type="button" onClick={() => onMarkAll?.()} className={footerItemClass}>
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        </MenuItem>
        <MenuItem>
          <Link to="/notifications" className={cn(footerItemClass, 'bg-[#183d2d] text-white data-focus:bg-[#0f2a1e]')}>
            See all
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </MenuItem>
      </MenuSection>
    </>
  );
}

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signedIn = useAuthStore((s) => Boolean(s.accessToken));
  const countQuery = useUnreadCount({ enabled: signedIn });
  const count = unreadCountOf(countQuery.data);
  const unread = count ?? 0;
  // At the bell, not in the panel: the panel unmounts when the menu closes, and a request started
  // from it must still report its failure.
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  // A higher count means something new arrived: the cached lists (the dropdown, an open
  // /notifications page) are out of date, so refetch them. A lower count (read elsewhere) changes
  // nothing they show that the next fetch won't.
  const previous = useRef(null);
  useEffect(() => {
    if (count !== null && previous.current !== null && count > previous.current) {
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists });
    }
    previous.current = count;
  }, [count, queryClient]);

  const select = (notification) => {
    if (isUnread(notification)) {
      markRead.mutate(notification._id, {
        onError: (err) => toast.error("Couldn't mark the notification read.", { description: errorToastText(err) }),
      });
    }
    if (isInAppPath(notification.link)) navigate(notification.link);
  };

  const readAll = () => {
    if (markAll.isPending) return;
    markAll.mutate(undefined, {
      onSuccess: (result) => {
        const updated = Number(result?.data?.updated) || 0;
        toast.success(
          updated === 1 ? 'Marked 1 notification read.' : `Marked ${updated} notifications read.`
        );
      },
      onError: (err) => toast.error("Couldn't mark your notifications read.", { description: errorToastText(err) }),
    });
  };

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label={bellLabel(unread)}
        className="relative p-2 rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] hover:bg-[#ede8df] transition-all shadow-[2px_2px_0_#1a1a1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2 data-open:bg-[#ede8df]"
      >
        <Bell className="w-4 h-4" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full border-2 border-[#1a1a1a] bg-[#c0392b] text-white text-[10px] font-black leading-none flex items-center justify-center"
          >
            {unreadBadgeText(unread)}
          </span>
        )}
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-50 w-80 max-w-[calc(100vw-2rem)] [--anchor-gap:8px] bg-white border-2 border-[#1a1a1a] rounded-xl shadow-[4px_4px_0_#1a1a1a] font-mono text-[#1a1a1a] p-1 focus:outline-none"
      >
        <BellPanel unread={unread} onSelect={select} onMarkAll={readAll} markingAll={markAll.isPending} />
      </MenuItems>
    </Menu>
  );
}
