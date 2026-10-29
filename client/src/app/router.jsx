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
  AuditPage,
  BadgeRequestsPage,
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
  ReportIncidentPage,
  RequestsPage,
  ResourceDetailPage,
  ResourceFormPage,
  ResourcesPage,
  ReturnConfirmPage,
  VerificationPage,
  VerificationQueuePage,
} from '../components/LazyPages';
import { AdminPlaceholder, BadgesPlaceholder, ManagePlaceholder } from '../pages/Placeholders';

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

      // ── Incidents (frontend.md §6.2) and notifications ───────────────────
      { path: '/incidents/new', element: page(<ReportIncidentPage />) },
      { path: '/incidents/:id', element: page(<IncidentDetailPage />) },
      { path: '/notifications', element: page(<NotificationsPage />) },

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
          { path: 'audit', element: page(<AuditPage />) },
          { path: 'incidents', element: page(<IncidentListPage key="admin" scope="admin" />) },
          { path: 'incidents/:id', element: page(<IncidentDetailPage />) },
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
