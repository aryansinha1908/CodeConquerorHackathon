import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

// Layouts & Guards
import { AppLayout } from './layouts/AppLayout';
import { ManageLayout } from './layouts/ManageLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { RequireAuth } from '../features/auth/RequireAuth';
import { RequireRole } from '../features/auth/RequireRole';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

// Auth pages (eagerly loaded)
import LoginPage from '../features/auth/LoginPage';
import RegisterPage from '../features/auth/RegisterPage';
import VerifyOtpPage from '../features/auth/VerifyOtpPage';

// Lazy loaded pages (declared in components/LazyPages.jsx, a components-only module)
import {
  BookingDetailPage,
  ExplorePage,
  HandoverPage,
  HandoversPage,
  LazyPage,
  MyBookingsPage,
  RequestsPage,
  ResourceDetailPage,
  ReturnConfirmPage,
  VerificationPage,
  VerificationQueuePage,
} from '../components/LazyPages';
import {
  AdminPlaceholder,
  BadgesPlaceholder,
  IncidentPlaceholder,
  ManagePlaceholder,
  PagePlaceholder,
} from '../pages/Placeholders';

// A lazy page inside the shared loading fallback.
const page = (element) => <LazyPage>{element}</LazyPage>;

export const router = createBrowserRouter([
  // ── Public auth routes ──────────────────────────────────────────────────────
  {
    path: '/login',
    element: (
      <ErrorBoundary>
        <LoginPage />
      </ErrorBoundary>
    ),
  },
  {
    path: '/register',
    element: (
      <ErrorBoundary>
        <RegisterPage />
      </ErrorBoundary>
    ),
  },
  {
    path: '/verify-otp',
    element: (
      <ErrorBoundary>
        <VerifyOtpPage />
      </ErrorBoundary>
    ),
  },

  // ── Authenticated App Shell ─────────────────────────────────────────────────
  {
    element: (
      <ErrorBoundary>
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      </ErrorBoundary>
    ),
    children: [
      { path: '/explore', element: page(<ExplorePage />) },
      { path: '/resources/:id', element: page(<ResourceDetailPage />) },
      { path: '/verification', element: page(<VerificationPage />) },

      // ── Bookings (frontend.md §6.2) ───────────────────────────────────────
      { path: '/bookings', element: page(<MyBookingsPage />) },
      { path: '/bookings/:id', element: page(<BookingDetailPage />) },
      // One wizard for both handovers, the phase from the route. Keyed by phase, so going from
      // check-in to check-out starts a fresh form instead of reusing the previous one's state.
      {
        path: '/bookings/:id/check-in',
        element: page(<HandoverPage key="check_in" phase="check_in" />),
      },
      {
        path: '/bookings/:id/check-out',
        element: page(<HandoverPage key="check_out" phase="check_out" />),
      },

      { path: '/badges', element: page(<BadgesPlaceholder />) },

      // ── Incidents (frontend.md §6.2), not built yet ───────────────────────
      // "Report an issue" and the history's "Open the incident" link here; without these routes
      // they fell through to the catch-all and landed on Explore without a word.
      { path: '/incidents/new', element: page(<IncidentPlaceholder kind="report" />) },
      { path: '/incidents/:id', element: page(<IncidentPlaceholder kind="detail" />) },

      // ── Manager sub-routes ────────────────────────────────────────────────
      {
        path: '/manage',
        element: (
          <RequireRole roles={['manager', 'admin']}>
            <ManageLayout />
          </RequireRole>
        ),
        children: [
          // No dashboard yet (frontend.md §6.3): open the review queue.
          { index: true, element: <Navigate to="requests" replace /> },
          { path: 'requests', element: page(<RequestsPage />) },
          { path: 'handovers', element: page(<HandoversPage />) },
          { path: 'returns/:bookingId', element: page(<ReturnConfirmPage />) },
          {
            path: 'resources',
            element: page(
              <PagePlaceholder
                level={2}
                eyebrow="Unit resources"
                title="Your unit's resources"
                description="Adding and editing the resources of your units, their rules and closures."
                backTo="/manage/requests"
                backLabel="Back to the review queue"
              />
            ),
          },
          {
            path: 'incidents/*',
            element: page(
              <PagePlaceholder
                level={2}
                eyebrow="Incidents"
                title="Incidents"
                description="Incidents in your units, with their threads and the resolve dialog."
                backTo="/manage/handovers"
                backLabel="Back to handovers"
              />
            ),
          },
          {
            path: '*',
            element: <ManagePlaceholder />,
          },
        ],
      },

      // ── Admin sub-routes ──────────────────────────────────────────────────
      {
        path: '/admin',
        element: (
          <RequireRole roles={['admin']}>
            <AdminLayout />
          </RequireRole>
        ),
        children: [
          {
            index: true,
            element: <AdminPlaceholder />,
          },
          { path: 'verifications', element: page(<VerificationQueuePage />) },
          {
            path: '*',
            element: <AdminPlaceholder />,
          },
        ],
      },
    ],
  },

  // ── Fallback redirects ──────────────────────────────────────────────────────
  { path: '/', element: <Navigate to="/explore" replace /> },
  { path: '*', element: <Navigate to="/explore" replace /> },
]);
