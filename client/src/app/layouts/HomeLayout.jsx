import React, { useEffect } from 'react';
import { useAuthStore } from '../../stores/auth';
import { ensureSession } from '../../features/auth/session';
import { AppLayout } from './AppLayout';
import { PublicLayout } from './PublicLayout';

// The landing page's shell (`/`): open to everyone. A signed-in visitor gets the app's layout (nav,
// bell, account menu); anyone else the public one (Log in, Sign up). On a fresh visit the session is
// looked for once, the same boot as RequireAuth but never a redirect; the public layout shows
// meanwhile, so a slow or sleeping server never holds the landing page back.

export function HomeLayout() {
  const signedIn = useAuthStore((s) => Boolean(s.accessToken && s.user));

  useEffect(() => {
    const { accessToken, user } = useAuthStore.getState();
    if (accessToken && user) return;
    ensureSession().catch((err) => {
      // Not signed in: stay on the public layout. Any other failure (no network, 503) too.
      if (err?.status === 401) useAuthStore.getState().clear();
    });
  }, []);

  return signedIn ? <AppLayout /> : <PublicLayout />;
}
