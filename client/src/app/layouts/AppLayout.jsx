import React, { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '../../stores/auth';
import {
  AlertCircle,
  Award,
  BookOpen,
  Bell,
  CalendarCheck,
  Compass,
  Home,
  IdCard,
  Layers,
  LogOut,
  Menu,
  Shield,
  UserRound,
  X,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { NotificationBell, UserMenu } from '../../components/LazyPages';
import { TourButton } from '../../features/tour/TourButton';
import { AccountButtonFace, Avatar, accountButtonClass } from '../../components/AccountFace';
import { useLogout } from '../../features/auth/useLogout';
import { accountView } from '../../features/profile/account';
import { spring } from '../../lib/motion';
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

/**
 * The account button while UserMenu's code loads: the same face, so nothing shifts when the real
 * menu button replaces it, but not a control (as BellFallback).
 */
export function UserMenuFallback() {
  const view = accountView(useAuthStore((s) => s.user));
  return (
    <span role="img" aria-label={`Account: ${view.name}`} className={accountButtonClass}>
      <AccountButtonFace view={view} />
    </span>
  );
}

// The main sections. Profile, ID verification and the Admin console live in the account menu (the
// name at the right of the header) and on /profile.
const SECTIONS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/bookings', label: 'Bookings', icon: CalendarCheck },
  { to: '/badges', label: 'Badges', icon: Award },
  { to: '/manage', label: 'Manage', icon: Layers, staff: true },
];

/**
 * One section link. `boxed`: the active link draws its own green box (the mobile menu); otherwise
 * DesktopNav's sliding indicator draws it behind the link.
 */
function SectionLink({ to, icon: Icon, label, onClick, boxed = false, end = false }) {
  return (
    <NavLink
      end={end || to === '/'}
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `relative inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2 ${
          boxed ? 'w-full min-h-[44px]' : ''
        } ${
          isActive
            ? boxed
              ? 'text-white bg-[#183d2d] border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
              : 'text-white border-transparent'
            : 'text-[#1a1a1a] border-transparent hover:border-[#1a1a1a] hover:bg-white/80'
        }`
      }
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </NavLink>
  );
}

const isUnder = (pathname, to) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

/**
 * The desktop section links, with a green box that slides to the active one. The box is placed from
 * the link's offset inside the nav (offsetLeft / offsetWidth), not from page coordinates: the header
 * is sticky, and a navigation that changes the scroll (a long page to a short one) would otherwise
 * fly the box in from where the page was scrolled. Re-measured when the nav resizes (web fonts).
 */
function DesktopNav({ sections }) {
  const { pathname } = useLocation();
  const navRef = useRef(null);
  const [box, setBox] = useState(null);
  const activeTo = sections.find((section) => isUnder(pathname, section.to))?.to ?? null;

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const measure = () => {
      const link = activeTo ? nav.querySelector(`a[href="${activeTo}"]`) : null;
      setBox(link ? { x: link.offsetLeft, width: link.offsetWidth } : null);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [activeTo, sections.length]);

  return (
    <nav ref={navRef} aria-label="Main" className="hidden lg:flex relative isolate items-center gap-1">
      {box && (
        <motion.span
          aria-hidden="true"
          initial={false}
          animate={{ x: box.x, width: box.width }}
          transition={spring}
          className="absolute left-0 top-0 bottom-0 -z-10 rounded-md border-2 border-[#1a1a1a] bg-[#183d2d] shadow-[2px_2px_0_#1a1a1a]"
        />
      )}
      {sections.map((section) => (
        <SectionLink key={section.to} {...section} />
      ))}
    </nav>
  );
}

const accountLinkClass =
  'w-full min-h-[44px] inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 border-transparent hover:border-[#1a1a1a] hover:bg-[#f5f0e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b]';

export function AppLayout() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMenu = () => setMobileMenuOpen(false);
  // Any navigation closes the mobile menu: its own links, the account menu, the bell, Back.
  const [menuPath, setMenuPath] = useState(location.pathname);
  if (menuPath !== location.pathname) {
    setMenuPath(location.pathname);
    setMobileMenuOpen(false);
  }

  const view = accountView(user);
  const isPending = view.verification.status === 'pending';
  const sections = SECTIONS.filter((section) => !section.staff || view.isManager);

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f0e8]/85 text-[#1a1a1a] font-mono selection:bg-[#c0392b] selection:text-white">
      {/* Skip to main content link for a11y */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-[#f5f0e8] border-b-2 border-[#1a1a1a] shadow-[0_2px_0_rgba(26,26,26,0.08)]">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
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

          {/* Desktop nav: from lg, where every link fits on one line beside the account button */}
          <DesktopNav sections={sections} />

          {/* User actions */}
          <div className="flex items-center gap-2">
            {/* frontend.md §7: the unread count and the latest 5, on every page of the app shell. */}
            {/* The guided tour of this page (features/tour). */}
            <TourButton />

            <div data-tour="header-bell">
              <Suspense fallback={<BellFallback />}>
                <NotificationBell />
              </Suspense>
            </div>

            <div data-tour="header-account">
              <Suspense fallback={<UserMenuFallback />}>
                <UserMenu />
              </Suspense>
            </div>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="lg:hidden p-2 rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2"
              aria-label={mobileMenuOpen ? 'Close the menu' : 'Open the menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu: the sections, then the account (what the account menu holds on desktop) */}
        <AnimatePresence initial={false}>
          {mobileMenuOpen && (
            <motion.div
              id="mobile-menu"
              key="mobile-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="lg:hidden overflow-hidden border-t-2 border-[#1a1a1a] bg-white"
            >
              <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
                <nav aria-label="Main" className="flex flex-col gap-1.5">
                  {sections.map((section) => (
                    <SectionLink key={section.to} {...section} onClick={closeMenu} boxed />
                  ))}
                </nav>
                <div className="pt-3 border-t-2 border-[#1a1a1a]/15 space-y-1.5">
                  <div className="flex items-center gap-3 pb-2">
                    <Avatar initials={view.initials} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black truncate">{view.name}</p>
                      <p className="text-[11px] text-[#1a1a1a]/70 truncate">{view.email}</p>
                    </div>
                    <Badge variant={view.verification.badge.variant} size="sm">
                      {view.verification.badge.label}
                    </Badge>
                  </div>
                  <Link to="/profile" onClick={closeMenu} className={accountLinkClass}>
                    <UserRound className="w-4 h-4" aria-hidden="true" />
                    Profile
                  </Link>
                  <Link to="/verification" onClick={closeMenu} className={accountLinkClass}>
                    <IdCard className="w-4 h-4" aria-hidden="true" />
                    ID verification
                  </Link>
                  <Link to="/how-it-works" onClick={closeMenu} className={accountLinkClass}>
                    <BookOpen className="w-4 h-4" aria-hidden="true" />
                    How it works
                  </Link>
                  {view.isAdmin && (
                    <Link to="/admin" onClick={closeMenu} className={accountLinkClass}>
                      <Shield className="w-4 h-4" aria-hidden="true" />
                      Admin console
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      logout();
                    }}
                    className={`${accountLinkClass} text-[#a93226]`}
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    Log out
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global verification banner */}
        {!view.verified && location.pathname !== '/verification' && (
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
            <Link to="/how-it-works" className="font-bold text-white underline hover:text-[#f1c40f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-sm">
              HOW IT WORKS
            </Link>
            <span className="mx-2 text-white/30">|</span>
            <span>UNITS: DIC · CENTRAL WORKSHOP · CSE LABS · MECH LABS</span>
            <span className="mx-2 text-white/30">|</span>
            <span className="text-[#f1c40f]">IST TIME ENGINE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
