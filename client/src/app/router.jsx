import React, { lazy, Suspense } from 'react';
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

// Lazy loaded feature pages
const ExplorePage = lazy(() => import('../pages/ExplorePage'));
const ResourceDetailPage = lazy(() => import('../pages/ResourceDetailPage'));
const VerificationPage = lazy(() => import('../features/verification/VerificationPage'));
const MyBookingsPage = lazy(() => import('../features/bookings/MyBookingsPage'));
const BookingDetailPage = lazy(() => import('../features/bookings/BookingDetailPage').then(m => ({ default: m.BookingDetailPage })));
const CheckInOutWizard = lazy(() => import('../features/bookings/components/CheckInOutWizard').then(m => ({ default: m.CheckInOutWizard })));
const ReviewQueuePage = lazy(() => import('../features/manage/ReviewQueuePage'));

import {
  BadgesPlaceholder,
  ManagePlaceholder,
  AdminPlaceholder,
} from '../pages/Placeholders';

function PageFallback() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center font-mono">
      <div className="w-8 h-8 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin mb-3" />
      <span className="text-xs font-bold text-[#1a1a1a]">LOADING MODULE...</span>
    </div>
  );
}

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
      {
        path: '/explore',
        element: (
          <Suspense fallback={<PageFallback />}>
            <ExplorePage />
          </Suspense>
        ),
      },
      {
        path: '/resources/:id',
        element: (
          <Suspense fallback={<PageFallback />}>
            <ResourceDetailPage />
          </Suspense>
        ),
      },
      {
        path: '/verification',
        element: (
          <Suspense fallback={<PageFallback />}>
            <VerificationPage />
          </Suspense>
        ),
      },
      {
        path: '/bookings',
        element: (
          <Suspense fallback={<PageFallback />}>
            <MyBookingsPage />
          </Suspense>
        ),
      },
      {
        path: '/bookings/:id',
        element: (
          <Suspense fallback={<PageFallback />}>
            <BookingDetailPage />
          </Suspense>
        ),
      },
      {
        path: '/bookings/:id/check-in',
        element: (
          <Suspense fallback={<PageFallback />}>
            <CheckInOutWizard mode="check-in" />
          </Suspense>
        ),
      },
      {
        path: '/bookings/:id/check-out',
        element: (
          <Suspense fallback={<PageFallback />}>
            <CheckInOutWizard mode="check-out" />
          </Suspense>
        ),
      },
      {
        path: '/badges',
        element: (
          <Suspense fallback={<PageFallback />}>
            <BadgesPlaceholder />
          </Suspense>
        ),
      },

      // ── Manager sub-routes ────────────────────────────────────────────────
      {
        path: '/manage',
        element: (
          <RequireRole roles={['manager', 'admin']}>
            <ManageLayout />
          </RequireRole>
        ),
        children: [
          {
            index: true,
            element: <Navigate to="/manage/requests" replace />,
          },
          {
            path: 'requests',
            element: (
              <Suspense fallback={<PageFallback />}>
                <ReviewQueuePage />
              </Suspense>
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
