import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { queryClient } from '../../app/queryClient';
import { useAuthStore } from '../../stores/auth';
import { logout as apiLogout } from './api';

/**
 * Log out (frontend.md §8.1 step 4), for the account menu, the mobile menu and /profile.
 *
 * POST /auth/logout always answers 200 and clears the cookie. The refresh cookie is httpOnly, so
 * only the server can end the session: if the call fails (network, 5xx), the next visit would sign
 * straight back in, so the user stays signed in here and is told so. On success, leave the guarded
 * routes first (flushSync commits the navigation before clear(), so RequireAuth never sees the
 * empty store and adds ?next=), then drop the token and every cached query.
 */
export function useLogout() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);

  return useCallback(() => {
    // A named inner function, so the toast's Retry can run it again.
    async function run() {
      try {
        await apiLogout();
      } catch (err) {
        toast.error("Couldn't reach the server, so you're still signed in.", {
          description: err?.requestId ? `ref: ${err.requestId}` : 'Check your connection and try again.',
          action: { label: 'Retry', onClick: () => run() },
        });
        return;
      }
      await navigate('/login', { replace: true, flushSync: true });
      clear();
      queryClient.clear();
      toast.success('Logged out successfully');
    }
    return run();
  }, [navigate, clear]);
}
