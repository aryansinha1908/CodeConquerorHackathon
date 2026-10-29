import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, MenuButton, MenuItem, MenuItems, MenuSection, MenuSeparator } from '@headlessui/react';
import { motion } from 'framer-motion';
import { IdCard, LogOut, Shield, UserRound } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useLogout } from '../features/auth/useLogout';
import { accountView } from '../features/profile/account';
import { menuIn } from '../lib/motion';
import { Badge } from './ui/Badge';
import { AccountButtonFace, Avatar, accountButtonClass } from './AccountFace';

// The header's account menu: the signed-in user's name opens Profile, ID verification, the Admin
// console (admins) and Log out (Headless UI Menu: arrow keys, Home / End, type-ahead, Esc returns
// focus to the button). Lazy-loaded like the bell (components/LazyPages.jsx), so the login page
// never downloads Headless UI; AppLayout shows UserMenuFallback meanwhile.

const itemClass =
  'w-full flex items-center gap-2.5 px-3 py-2.5 min-h-[44px] rounded-md border-2 border-transparent text-xs font-bold text-left ' +
  'data-focus:bg-[#ede8df] data-focus:border-[#1a1a1a]';

/**
 * The menu's contents: who is signed in, then Profile, ID verification (with its status), the Admin
 * console (admins) and Log out. Exported for the tests, which render it inside a static Menu.
 */
export function AccountPanel({ view, onLogout }) {
  return (
    <>
      {/* Not an item (a menu may hold only items, groups and separators): hidden from screen
          readers, which have the name from the button's label and the rest on /profile. */}
      <div aria-hidden="true" className="px-3 pt-3 pb-2 flex items-center gap-3">
        <Avatar initials={view.initials} size="md" />
        <div className="min-w-0">
          <p className="text-sm font-black truncate">{view.name}</p>
          <p className="text-[11px] text-[#1a1a1a]/70 truncate">{view.email}</p>
        </div>
      </div>
      <MenuSeparator className="my-1 h-0.5 bg-[#1a1a1a]/15" />
      <MenuSection>
        <MenuItem>
          <Link to="/profile" className={itemClass}>
            <UserRound className="w-4 h-4 shrink-0" aria-hidden="true" />
            Profile
          </Link>
        </MenuItem>
        <MenuItem>
          <Link to="/verification" className={itemClass}>
            <IdCard className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">ID verification</span>
            <Badge variant={view.verification.badge.variant} size="sm">
              {view.verification.badge.label}
            </Badge>
          </Link>
        </MenuItem>
        {view.isAdmin && (
          <MenuItem>
            <Link to="/admin" className={itemClass}>
              <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
              Admin console
            </Link>
          </MenuItem>
        )}
      </MenuSection>
      <MenuSeparator className="my-1 h-0.5 bg-[#1a1a1a]/15" />
      <MenuSection>
        <MenuItem>
          <button type="button" onClick={() => onLogout?.()} className={`${itemClass} text-[#a93226]`}>
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            Log out
          </button>
        </MenuItem>
      </MenuSection>
    </>
  );
}

export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const view = accountView(user);

  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label={`Account menu for ${view.name}`}
        className={`${accountButtonClass} hover:bg-[#ede8df] transition-all active:translate-x-[1px] active:translate-y-[1px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2 data-open:bg-[#ede8df]`}
      >
        <AccountButtonFace view={view} />
      </MenuButton>
      {/* As in the bell: MenuItems positions (and, from its anchor, scrolls), the inner panel looks
          and animates; the padding keeps the panel's offset shadow inside the scroll box. */}
      <MenuItems
        anchor="bottom end"
        className="z-50 w-72 max-w-[calc(100vw-2rem)] [--anchor-gap:2px] pt-1.5 pr-1.5 pb-1.5 focus:outline-none"
      >
        <motion.div
          {...menuIn}
          className="bg-white border-2 border-[#1a1a1a] rounded-xl shadow-[4px_4px_0_#1a1a1a] font-mono text-[#1a1a1a] p-1"
        >
          <AccountPanel view={view} onLogout={logout} />
        </motion.div>
      </MenuItems>
    </Menu>
  );
}
