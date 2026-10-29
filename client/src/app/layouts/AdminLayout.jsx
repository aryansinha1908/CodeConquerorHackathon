import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { UserCheck, FileText, AlertCircle } from 'lucide-react';

// The admin console's header and sub-nav (frontend.md §6.4). /admin itself redirects to the
// verification queue (app/router.jsx). /admin/users and /admin/org-units aren't built, so they
// have no tab.
export function AdminLayout() {
  // White on #c0392b is 5.4:1 (frontend.md §10.3 asks 4.5:1).
  const subnavClass = ({ isActive }) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold font-mono tracking-tight rounded-md border-2 transition-all ${
      isActive
        ? 'bg-[#c0392b] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
        : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/30 hover:border-[#1a1a1a]'
    }`;

  return (
    <div className="space-y-6">
      <div className="bg-[#ede8df] border-2 border-[#1a1a1a] rounded-xl p-4 shadow-[3px_3px_0_#1a1a1a] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          {/* #a93226 on the panel's #ede8df is 5.4:1; #c0392b would be 4.46:1. */}
          <span className="text-[10px] uppercase font-bold text-[#a93226] tracking-widest block">
            INSTITUTE ADMINISTRATION
          </span>
          <h1 className="text-xl font-black text-[#1a1a1a] tracking-tight">System Admin Console</h1>
        </div>
        <nav aria-label="Administration" className="flex flex-wrap gap-2">
          <NavLink to="/admin/verifications" className={subnavClass}>
            <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
            Verification Queue
          </NavLink>
          <NavLink to="/admin/audit" className={subnavClass}>
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            Audit Log
          </NavLink>
          <NavLink to="/admin/incidents" className={subnavClass}>
            <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
            Escalations
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
