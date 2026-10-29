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
import ForgotPasswordPage from '../features/auth/ForgotPasswordPage';
import ResetPasswordPage from '../features/auth/ResetPasswordPage';
import HomePage from '../pages/HomePage';

// Lazy loaded pages (declared in components/LazyPages.jsx, a components-only module)
import {
  AuditPage,
  BadgeRequestsPage,
  BadgesPage,
  BookingDetailPage,
  DashboardPage,
  ExplorePage,
  HandoverPage,
  HandoversPage,
  IncidentDetailPage,
  IncidentListPage,
  LazyPage,
  MyBookingsPage,
  NotificationsPage,
  ProfilePage,
  ReportIncidentPage,
  RequestsPage,
  ResourceDetailPage,
  ResourceFormPage,
  ResourcesPage,
  ReturnConfirmPage,
  VerificationPage,
  VerificationQueuePage,
} from '../components/LazyPages';

// A lazy page inside the shared loading fallback, with a boundary of its own (a key per route).
// React Router renders each navigation in a transition, and a transition keeps an already-shown
// boundary's old page up while the next page's chunk loads: between sibling routes sharing one
// boundary, the click would look ignored, the old tab still current. A newly mounted boundary
// shows its fallback. The same route with other params (/resources/a → b) keeps its boundary.
let pageKey = 0;
const page = (element) => <LazyPage key={`page-${++pageKey}`}>{element}</LazyPage>;

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
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
  {
    path: '/forgot-password',
    element: <ErrorBoundary><ForgotPasswordPage /></ErrorBoundary>,
  },
  {
    path: '/reset-password',
    element: <ErrorBoundary><ResetPasswordPage /></ErrorBoundary>,
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
      { path: '/', element: page(<HomePage />) },
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

      { path: '/badges', element: page(<BadgesPage />) },

      // ── Incidents (frontend.md §6.2) and notifications ───────────────────
      { path: '/incidents/new', element: page(<ReportIncidentPage />) },
      { path: '/incidents/:id', element: page(<IncidentDetailPage />) },
      { path: '/notifications', element: page(<NotificationsPage />) },
      // The account menu's Profile (frontend.md §6.2): details, verification, badges, consoles.
      { path: '/profile', element: page(<ProfilePage />) },

      // ── Manager sub-routes ────────────────────────────────────────────────
      {
        path: '/manage',
        element: (
          <RequireRole roles={['manager', 'admin']}>
            <ManageLayout />
          </RequireRole>
        ),
        children: [
          { index: true, element: page(<DashboardPage />) },
          { path: 'requests', element: page(<RequestsPage />) },
          { path: 'handovers', element: page(<HandoversPage />) },
          { path: 'returns/:bookingId', element: page(<ReturnConfirmPage />) },
          { path: 'resources', element: page(<ResourcesPage />) },
          { path: 'resources/new', element: page(<ResourceFormPage key="new" mode="new" />) },
          { path: 'resources/:id/edit', element: page(<ResourceFormPage key="edit" mode="edit" />) },
          { path: 'incidents', element: page(<IncidentListPage key="manage" scope="manage" />) },
          { path: 'incidents/:id', element: page(<IncidentDetailPage />) },
          { path: 'badges', element: page(<BadgeRequestsPage />) },
          // An unknown page of the console: its dashboard.
          { path: '*', element: <Navigate to="/manage" replace /> },
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
        // No admin dashboard: /admin, and any page of the console that isn't built (frontend.md
        // §6.4's /admin/users and /admin/org-units), open the verification queue.
        children: [
          { index: true, element: <Navigate to="/admin/verifications" replace /> },
          { path: 'verifications', element: page(<VerificationQueuePage />) },
          { path: 'audit', element: page(<AuditPage />) },
          { path: 'incidents', element: page(<IncidentListPage key="admin" scope="admin" />) },
          { path: 'incidents/:id', element: page(<IncidentDetailPage />) },
          { path: '*', element: <Navigate to="/admin/verifications" replace /> },
        ],
      },
    ],
  },

  // ── Fallback redirects ──────────────────────────────────────────────────────
  { path: '*', element: <Navigate to="/explore" replace /> },
]);
