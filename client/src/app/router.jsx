import React, { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';

// Auth pages (eagerly loaded — they're the entry point)
import LoginPage from '../features/auth/LoginPage';
import RegisterPage from '../features/auth/RegisterPage';
import VerifyOtpPage from '../features/auth/VerifyOtpPage';

// Placeholder for future pages
const ExplorePage = lazy(() => import('../pages/ExplorePage'));

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f0e8]">
      <div className="w-8 h-8 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export const router = createBrowserRouter([
  // ── Public auth routes ──────────────────────────────────────────────────────
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/verify-otp', element: <VerifyOtpPage /> },

  // ── Protected placeholder (will be replaced with RequireAuth layout) ────────
  {
    path: '/explore',
    element: (
      <Suspense fallback={<PageFallback />}>
        <ExplorePage />
      </Suspense>
    ),
  },

  // ── Default redirect ────────────────────────────────────────────────────────
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '*', element: <Navigate to="/login" replace /> },
]);

