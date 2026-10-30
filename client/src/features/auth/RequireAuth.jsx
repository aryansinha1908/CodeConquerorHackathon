import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { ensureSession } from './session';

export function RequireAuth({ children }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [checking, setChecking] = useState(() => !(accessToken && user));
  // A boot that failed for a reason other than 401 (503 while Redis is down, no network). The
  // server keeps the refresh cookie for that retry, so this is not a logout.
  const [bootError, setBootError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  // Runs once per mount, and again on Retry: a later setSession (login, refresh) must not start
  // another round trip.
  useEffect(() => {
    const { accessToken: token, user: current } = useAuthStore.getState();
    if (token && current) return undefined;

    let mounted = true;
    ensureSession()
      .catch((err) => {
        if (err?.status === 401) {
          // Not authenticated (or the account is gone): treat as logged out.
          useAuthStore.getState().clear();
        } else if (mounted) {
          setBootError(err ?? {});
        }
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, [attempt]);

  const next = encodeURIComponent(location.pathname + location.search);

  if (checking && !(accessToken && user)) {
    return (
      <div className="min-h-screen bg-[#f5f0e8] flex flex-col items-center justify-center font-mono">
        <div className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 shadow-[4px_4px_0_#1a1a1a] text-center max-w-sm w-full">
          <div className="w-10 h-10 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-bold text-[#1a1a1a]">VERIFYING SESSION</p>
          <p className="text-xs text-[#1a1a1a]/60 mt-1">Connecting to ShareX...</p>
        </div>
      </div>
    );
  }

  if (bootError && !accessToken) {
    const retry = () => {
      setBootError(null);
      setChecking(true);
      setAttempt((n) => n + 1);
    };
    return (
      <div className="min-h-screen bg-[#f5f0e8] flex flex-col items-center justify-center font-mono px-4">
        <div
          role="alert"
          className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 shadow-[4px_4px_0_#1a1a1a] text-center max-w-sm w-full"
        >
          <p className="text-sm font-bold text-[#1a1a1a]">CAN&apos;T REACH THE SERVER</p>
          <p className="text-xs text-[#1a1a1a]/60 mt-1">
            We couldn&apos;t check your session. Try again in a moment.
          </p>
          {bootError.requestId && (
            <p className="text-[10px] text-[#1a1a1a]/40 mt-2">ref: {bootError.requestId}</p>
          )}
          <div className="mt-5 flex flex-col gap-3">
            <Button variant="forest" size="md" onClick={retry} className="w-full">
              Retry
            </Button>
            <Link
              to={`/login?next=${next}`}
              replace
              className="text-xs font-bold text-[#c0392b] underline underline-offset-2 hover:text-[#a93226]"
            >
              Log in again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return children;
}
