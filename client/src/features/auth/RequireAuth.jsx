import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { refreshToken, getMe } from './api';

export function RequireAuth({ children }) {
  const { accessToken, user, setSession, setUser } = useAuthStore();
  const location = useLocation();
  const [checking, setChecking] = useState(!accessToken);

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      if (accessToken && user) {
        setChecking(false);
        return;
      }

      try {
        let token = accessToken;
        if (!token) {
          const res = await refreshToken();
          token = res?.data?.accessToken;
          if (token) setSession(token);
        }

        if (token && !user) {
          const meRes = await getMe();
          if (meRes?.data) setUser(meRes.data);
        }
      } catch (err) {
        // Not authenticated
      } finally {
        if (mounted) setChecking(false);
      }
    }

    initAuth();
    return () => {
      mounted = false;
    };
  }, [accessToken, user, setSession, setUser]);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#f5f0e8] flex flex-col items-center justify-center font-mono">
        <div className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 shadow-[4px_4px_0_#1a1a1a] text-center max-w-sm w-full">
          <div className="w-10 h-10 border-4 border-[#183d2d] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-bold text-[#1a1a1a]">VERIFYING SESSION</p>
          <p className="text-xs text-[#1a1a1a]/60 mt-1">Connecting to CampusCommons...</p>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  return children;
}

