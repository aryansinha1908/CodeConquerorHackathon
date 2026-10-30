import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { LogIn, UserPlus } from 'lucide-react';
import { Brand, SiteFooter } from './SiteChrome';

// The shell of the landing page (`/`) for visitors who aren't signed in: the brand, How it works,
// Log in and Sign up, and the app's footer. Nothing here calls the API, so nothing sends a signed-out
// visitor to the login page.

const linkClass =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-md border-2 border-[#1a1a1a] text-xs font-bold ' +
  'shadow-[2px_2px_0_#1a1a1a] hover:shadow-[1px_1px_0_#1a1a1a] hover:translate-x-[1px] hover:translate-y-[1px] transition-all ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2';

export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-[#f5f0e8]/85 text-[#1a1a1a] font-mono selection:bg-[#c0392b] selection:text-white">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 bg-[#f5f0e8] border-b-2 border-[#1a1a1a] shadow-[0_2px_0_rgba(26,26,26,0.08)]">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <Brand />
          <nav aria-label="Get started" className="flex items-center gap-2">
            <Link
              to="/how-it-works"
              className="hidden sm:inline-flex px-2 py-2 min-h-[40px] items-center text-xs font-bold underline underline-offset-2 hover:text-[#c0392b] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]"
            >
              How it works
            </Link>
            <Link to="/login" className={`${linkClass} bg-white text-[#1a1a1a]`}>
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              Log in
            </Link>
            <Link to="/register" className={`${linkClass} bg-[#c0392b] text-white`}>
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  );
}
