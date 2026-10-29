import React, { lazy, Suspense } from 'react';

// The code-split pages of app/router.jsx. They live here, in a file that exports only components,
// so the router module (which exports the router object) stays fast-refresh friendly. Add a page:
// one lazy() line here, then a route with `element: <LazyPage><NewPage /></LazyPage>`.

export const ExplorePage = lazy(() => import('../pages/ExplorePage'));
export const ResourceDetailPage = lazy(() => import('../pages/ResourceDetailPage'));
export const VerificationPage = lazy(() => import('../features/verification/VerificationPage'));
export const VerificationQueuePage = lazy(() => import('../features/admin/VerificationQueuePage'));
export const MyBookingsPage = lazy(() => import('../features/bookings/MyBookingsPage'));
export const BookingDetailPage = lazy(() => import('../features/bookings/BookingDetailPage'));
export const HandoverPage = lazy(() => import('../features/bookings/HandoverPage'));
export const RequestsPage = lazy(() => import('../features/manage/RequestsPage'));
export const HandoversPage = lazy(() => import('../features/manage/HandoversPage'));
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

/** A lazy page inside the shared loading fallback. */
export function LazyPage({ children }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}
