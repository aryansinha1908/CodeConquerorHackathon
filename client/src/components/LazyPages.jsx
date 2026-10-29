import React, { lazy as reactLazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { enter, fadeUp } from '../lib/motion';
import { withStaleChunkReload } from '../lib/staleChunk';

// The code-split pages of app/router.jsx. They live here, in a file that exports only components,
// so the router module (which exports the router object) stays fast-refresh friendly. Add a page:
// one lazy() line here, then a route with `element: page(<NewPage />)`. Only the
// auth pages and the layouts load with the app (the layouts are small, and a lazy layout would
// make each page under it wait for the layout's file before asking for its own).

// React.lazy that, in a build, reloads the app once when a chunk is gone after a redeploy
// (lib/staleChunk.js). Not in dev, where a failed import is a code error to see as it is.
const lazy = (load) => reactLazy(import.meta.env.PROD ? withStaleChunkReload(load) : load);

export const HomePage = lazy(() => import('../pages/HomePage'));
export const ExplorePage = lazy(() => import('../pages/ExplorePage'));
export const ResourceDetailPage = lazy(() => import('../pages/ResourceDetailPage'));
export const VerificationPage = lazy(() => import('../features/verification/VerificationPage'));
export const VerificationQueuePage = lazy(() => import('../features/admin/VerificationQueuePage'));
export const MyBookingsPage = lazy(() => import('../features/bookings/MyBookingsPage'));
export const BookingDetailPage = lazy(() => import('../features/bookings/BookingDetailPage'));
export const HandoverPage = lazy(() => import('../features/bookings/HandoverPage'));
export const RequestsPage = lazy(() => import('../features/manage/RequestsPage'));
export const HandoversPage = lazy(() => import('../features/manage/HandoversPage'));
export const ScanPage = lazy(() => import('../features/manage/ScanPage'));
export const ReturnConfirmPage = lazy(() => import('../features/manage/ReturnConfirmPage'));
export const DashboardPage = lazy(() => import('../features/manage/DashboardPage'));
export const ResourcesPage = lazy(() => import('../features/manage/ResourcesPage'));
export const ResourceFormPage = lazy(() => import('../features/manage/ResourceFormPage'));
export const BadgeRequestsPage = lazy(() => import('../features/manage/BadgeRequestsPage'));
export const ReportIncidentPage = lazy(() => import('../features/incidents/ReportIncidentPage'));
export const IncidentDetailPage = lazy(() => import('../features/incidents/IncidentDetailPage'));
export const IncidentListPage = lazy(() => import('../features/incidents/IncidentListPage'));
export const AuditPage = lazy(() => import('../features/admin/AuditPage'));
export const NotificationsPage = lazy(() => import('../features/notifications/NotificationsPage'));
export const HowItWorksPage = lazy(() => import('../pages/HowItWorksPage'));
export const ProfilePage = lazy(() => import('../features/profile/ProfilePage'));
// /badges is the teammate's: their page replaces this line's import when it lands.
export const BadgesPage = lazy(() =>
  import('../pages/Placeholders').then((module) => ({ default: module.BadgesPlaceholder }))
);

// Not a page: the header bell. Its menu is Headless UI's, which nothing else on the first screen
// needs, so the login page never downloads it and a signed-in page fetches it alongside its own
// chunk. AppLayout shows a look-alike button (BellFallback) while it loads.
export const NotificationBell = lazy(() =>
  import('./NotificationBell').then((module) => ({ default: module.NotificationBell }))
);
// The header's account menu, for the same reason (AppLayout shows UserMenuFallback meanwhile).
export const UserMenu = lazy(() =>
  import('./UserMenu').then((module) => ({ default: module.UserMenu }))
);

export function PageFallback() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center font-mono" role="status">
      <div
        aria-hidden="true"
        className="w-8 h-8 border-4 border-[#183d2d] border-t-transparent rounded-full motion-safe:animate-spin mb-3"
      />
      <span className="text-xs font-bold text-[#1a1a1a]">LOADING MODULE...</span>
    </div>
  );
}

/**
 * A lazy page inside the shared loading fallback. The page rises in once its code has loaded: the
 * wrapper mounts with the page (a suspended render isn't committed), and each route has its own
 * LazyPage (app/router.jsx), so a navigation animates the new page and nothing else remounts.
 */
export function LazyPage({ children }) {
  return (
    <Suspense fallback={<PageFallback />}>
      <motion.div variants={fadeUp} {...enter}>
        {children}
      </motion.div>
    </Suspense>
  );
}
