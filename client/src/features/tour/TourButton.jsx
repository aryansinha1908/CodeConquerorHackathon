import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { HelpCircle } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { accountView } from '../profile/account';
import { runTour, stopTour } from './runTour';
import { tourFor } from './tours';

// The header's "?" button: the guided tour of the current page (tours.js). On a role's first visit to a
// page that has a tour, a toast offers it once; that it was offered is remembered in localStorage,
// which can be missing or blocked, so every access is guarded and a failure just means the offer
// shows again.

const OFFERED = 'cc-tour-offered';

function wasOffered(role) {
  try {
    return localStorage.getItem(`${OFFERED}:${role}`) === '1';
  } catch {
    return false;
  }
}

function markOffered(role) {
  try {
    localStorage.setItem(`${OFFERED}:${role}`, '1');
  } catch {
    // Private mode or blocked storage: the offer may come back next time, which is harmless.
  }
}

async function start(tour) {
  try {
    if (!(await runTour(tour))) toast.info('Nothing to show on this page yet. Try again once it has loaded.');
  } catch {
    toast.error("The tour couldn't start. Reload the page and try again.");
  }
}

export function TourButton() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const tour = tourFor(pathname);
  const role = accountView(user).isAdmin ? 'admin' : accountView(user).isManager ? 'manager' : 'member';
  const offeredHere = useRef(false);
  const offerToast = useRef(null);

  // A navigation ends a tour in progress (a highlighted link was followed, or Back), and withdraws an
  // offer made for the previous page.
  useEffect(
    () => () => {
      stopTour();
      if (offerToast.current !== null) toast.dismiss(offerToast.current);
      offerToast.current = null;
    },
    [pathname],
  );

  // Offer the tour once per role, a moment after the page has rendered, on a page that has one.
  useEffect(() => {
    if (!tour || !user || offeredHere.current || wasOffered(role)) return undefined;
    const timer = setTimeout(() => {
      offeredHere.current = true;
      markOffered(role);
      offerToast.current = toast('New here? Take a one-minute tour of this page.', {
        action: {
          label: 'Start the tour',
          // The page now, not the one the offer was made on: the button may be pressed after a navigation.
          onClick: () => {
            const current = tourFor(window.location.pathname);
            if (current) start(current);
          },
        },
        duration: 10_000,
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [tour, user, role]);

  return (
    <button
      type="button"
      data-tour="header-tour"
      onClick={() => (tour ? start(tour) : toast.info('This page has no tour. Explore, a resource, your bookings and the consoles do.'))}
      aria-label={tour ? `Take the tour of ${tour.title}` : 'Take a tour'}
      title={tour ? `Tour: ${tour.title}` : 'Tour'}
      className="p-2 rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a] hover:bg-[#ede8df] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
    >
      <HelpCircle className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}
