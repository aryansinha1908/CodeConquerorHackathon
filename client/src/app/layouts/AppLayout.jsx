import React, { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { logout as apiLogout } from '../../features/auth/api';
import { queryClient } from '../queryClient';
import { toast } from 'sonner';
import {
  Bell,
  Compass,
  IdCard,
  CalendarCheck,
  Award,
  Layers,
  Shield,
  LogOut,
  Menu,
  X,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { NotificationBell } from '../../components/LazyPages';
import {
  bellLabel,
  unreadBadgeText,
  unreadCountOf,
  useUnreadCount,
} from '../../features/notifications/api';

/**
 * The bell while its code loads (components/LazyPages.jsx): the same look, label and badge as
 * NotificationBell's menu button, but not a control, so there is nothing to tab to or press that
 * does nothing, and no focus to lose to <body> when the real button replaces it. It only reads the
 * cached count (enabled: false); the real bell fetches and polls it, so there is no second request.
 */
export function BellFallback() {
  const unread = unreadCountOf(useUnreadCount({ enabled: false }).data) ?? 0;
  return (
    <span
      role="img"
      aria-label={bellLabel(unread)}
      className="relative inline-block p-2 rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]"
    >
      <Bell className="w-4 h-4" aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full border-2 border-[#1a1a1a] bg-[#c0392b] text-white text-[10px] font-black leading-none flex items-center justify-center"
        >
          {unreadBadgeText(unread)}
        </span>
      )}
    </span>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clear } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const roles = Array.isArray(user?.roles)
    ? user.roles
    : user?.role
      ? [user.role]
      : ['member'];

  const isManager = roles.includes('manager') || roles.includes('admin');
  const isAdmin = roles.includes('admin');
  const isVerified = user?.verification?.status === 'approved' || isManager || isAdmin;
  const isPending = user?.verification?.status === 'pending';

  // frontend.md §8.1 step 4. POST /auth/logout always answers 200 and clears the cookie. The refresh
  // cookie is httpOnly, so only the server can end the session: if the call fails (network, 5xx), the
  // next visit would sign straight back in, so the user stays signed in here and is told so. On
  // success, leave the guarded routes first (flushSync commits the navigation before clear(), so
  // RequireAuth never sees the empty store and adds ?next=), then drop the token and every cached query.
  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch (err) {
      toast.error("Couldn't reach the server, so you're still signed in.", {
        description: err?.requestId ? `ref: ${err.requestId}` : 'Check your connection and try again.',
        action: { label: 'Retry', onClick: () => handleLogout() },
      });
      return;
    }
    await navigate('/login', { replace: true, flushSync: true });
    clear();
    queryClient.clear();
    toast.success('Logged out successfully');
  };

  const navLinkClass = ({ isActive }) =>
    `inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 transition-all duration-150 ${
      isActive
        ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
        : 'bg-transparent text-[#1a1a1a] border-transparent hover:border-[#1a1a1a] hover:bg-white/80'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f0e8] text-[#1a1a1a] font-mono selection:bg-[#c0392b] selection:text-white">
      {/* Skip to main content link for a11y */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-[#f5f0e8] border-b-2 border-[#1a1a1a] shadow-[0_2px_0_rgba(26,26,26,0.08)]">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <Link to="/explore" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 bg-[#c0392b] border-2 border-[#1a1a1a] rounded-lg shadow-[2px_2px_0_#1a1a1a] flex items-center justify-center font-black text-white text-base transition-transform group-hover:-translate-y-0.5">
                CC
              </div>
              <div className="hidden sm:block">
                <span className="text-xs tracking-widest text-[#1a1a1a]/60 uppercase block leading-none">
                  NIT Jamshedpur
                </span>
                <span className="text-base font-black text-[#1a1a1a] tracking-tight block">
                  CampusCommons
                </span>
              </div>
            </Link>

            <span className="hidden md:inline-block text-[#1a1a1a]/30 font-bold ml-1">/</span>

            {/* Quick role badge */}
            <div className="hidden md:flex items-center gap-1.5">
              <Badge variant="outline" size="sm" className="bg-white/80">
                {roles[0]?.toUpperCase() || 'MEMBER'}
              </Badge>
              {isVerified ? (
                <Badge variant="forest" size="sm" className="hidden lg:inline-flex">
                  VERIFIED
                </Badge>
              ) : (
                <Link to="/verification">
                  <Badge variant={isPending ? 'amber' : 'red'} size="sm">
                    {isPending ? 'VERIFY PENDING' : 'UNVERIFIED'}
                  </Badge>
                </Link>
              )}
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/explore" className={navLinkClass}>
              <Compass className="w-3.5 h-3.5" />
              Explore
            </NavLink>
            <NavLink to="/verification" className={navLinkClass}>
              <IdCard className="w-3.5 h-3.5" />
              Verification
            </NavLink>
            <NavLink to="/bookings" className={navLinkClass}>
              <CalendarCheck className="w-3.5 h-3.5" />
              Bookings
            </NavLink>
            <NavLink to="/badges" className={navLinkClass}>
              <Award className="w-3.5 h-3.5" />
              Badges
            </NavLink>
            {isManager && (
              <NavLink to="/manage" className={navLinkClass}>
                <Layers className="w-3.5 h-3.5" />
                Manage
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin" className={navLinkClass}>
                <Shield className="w-3.5 h-3.5" />
                Admin
              </NavLink>
            )}
          </nav>

          {/* User actions */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-bold text-[#1a1a1a] truncate max-w-[140px]">
                {user?.name || user?.email?.split('@')[0] || 'User'}
              </span>
              <span className="text-[10px] text-[#1a1a1a]/60">
                {user?.department?.name || user?.memberType || 'NIT JSR'}
              </span>
            </div>

            {/* frontend.md §7: the unread count and the latest 5, on every page of the app shell. */}
            <Suspense fallback={<BellFallback />}>
              <NotificationBell />
            </Suspense>

            <button
              onClick={handleLogout}
              title="Logout"
              className="p-2 rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] hover:bg-[#c0392b] hover:text-white transition-all shadow-[2px_2px_0_#1a1a1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
              aria-label="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a]"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t-2 border-[#1a1a1a] bg-white px-4 py-4 space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#1a1a1a]/15 text-xs">
              <span className="text-[#1a1a1a]/70">{user?.email}</span>
              <Badge variant={isVerified ? 'forest' : 'amber'} size="sm">
                {isVerified ? 'VERIFIED' : 'UNVERIFIED'}
              </Badge>
            </div>
            <div className="flex flex-col gap-1.5 pt-2">
              <NavLink
                to="/explore"
                onClick={() => setMobileMenuOpen(false)}
                className={navLinkClass}
              >
                <Compass className="w-4 h-4" />
                Explore Resources
              </NavLink>
              <NavLink
                to="/verification"
                onClick={() => setMobileMenuOpen(false)}
                className={navLinkClass}
              >
                <IdCard className="w-4 h-4" />
                ID Card Verification
              </NavLink>
              <NavLink
                to="/bookings"
                onClick={() => setMobileMenuOpen(false)}
                className={navLinkClass}
              >
                <CalendarCheck className="w-4 h-4" />
                My Bookings
              </NavLink>
              <NavLink
                to="/badges"
                onClick={() => setMobileMenuOpen(false)}
                className={navLinkClass}
              >
                <Award className="w-4 h-4" />
                Badges & Certifications
              </NavLink>
              {isManager && (
                <NavLink
                  to="/manage"
                  onClick={() => setMobileMenuOpen(false)}
                  className={navLinkClass}
                >
                  <Layers className="w-4 h-4" />
                  Management Console
                </NavLink>
              )}
              {isAdmin && (
                <NavLink
                  to="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className={navLinkClass}
                >
                  <Shield className="w-4 h-4" />
                  Admin Console
                </NavLink>
              )}
            </div>
          </div>
        )}

        {/* Global verification banner */}
        {!isVerified && !isManager && !isAdmin && location.pathname !== '/verification' && (
          <div className="bg-[#f39c12]/20 border-t border-[#1a1a1a] px-4 py-1.5 text-xs text-[#1a1a1a] flex items-center justify-center gap-2 font-mono">
            <AlertCircle className="w-4 h-4 text-[#e67e22] shrink-0" />
            <span>
              {isPending
                ? 'Your ID card is being reviewed by the administration. Equipment reservations will unlock shortly.'
                : 'Account unverified: ID card submission is required to place equipment reservations.'}
            </span>
            <Link
              to="/verification"
              className="font-bold underline text-[#183d2d] hover:text-[#c0392b] ml-1"
            >
              {isPending ? 'View Status' : 'Upload ID Now'}
            </Link>
          </div>
        )}
      </header>

      {/* ── MAIN CONTENT ────────────────────────────────────────────────────── */}
      <main id="main-content" className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer className="border-t-2 border-[#1a1a1a] bg-[#183d2d] text-white py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1abc9c] animate-pulse inline-block" />
            <span className="tracking-widest uppercase font-bold text-white/90">
              CAMPUSCOMMONS // NIT JAMSHEDPUR
            </span>
          </div>
          <div className="text-white/60 text-center md:text-right">
            <span>UNITS: DIC · CENTRAL WORKSHOP · CSE LABS · MECH LABS</span>
            <span className="mx-2 text-white/30">|</span>
            <span className="text-[#f1c40f]">IST TIME ENGINE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
