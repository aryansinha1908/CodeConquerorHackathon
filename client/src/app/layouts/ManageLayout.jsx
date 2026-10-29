import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Layers, ClipboardList, Clock, AlertTriangle, Award } from 'lucide-react';

export function ManageLayout() {
  // Dark text on the amber tab (6.1:1): white on #e67e22 is 2.85:1, under frontend.md §10.3's 4.5:1.
  const subnavClass = ({ isActive }) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold font-mono tracking-tight rounded-md border-2 transition-all ${
      isActive
        ? 'bg-[#e67e22] text-[#1a1a1a] border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
        : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/30 hover:border-[#1a1a1a]'
    }`;

  return (
    <div className="space-y-6">
      <div className="bg-[#ede8df] border-2 border-[#1a1a1a] rounded-xl p-4 shadow-[3px_3px_0_#1a1a1a] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] uppercase font-bold text-[#a04000] tracking-widest block">
            FACILITY MANAGER PORTAL
          </span>
          <h1 className="text-xl font-black text-[#1a1a1a] tracking-tight">Management Console</h1>
        </div>
        <nav aria-label="Management" className="flex flex-wrap gap-2">
          {/* end: active on /manage itself, not on every page under it. */}
          <NavLink to="/manage" end className={subnavClass}>
            <LayoutDashboard className="w-3.5 h-3.5" aria-hidden="true" />
            Dashboard
          </NavLink>
          <NavLink to="/manage/requests" className={subnavClass}>
            <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
            Review Queue
          </NavLink>
          <NavLink to="/manage/handovers" className={subnavClass}>
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            Handovers
          </NavLink>
          <NavLink to="/manage/resources" className={subnavClass}>
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            Unit Resources
          </NavLink>
          <NavLink to="/manage/badges" className={subnavClass}>
            <Award className="w-3.5 h-3.5" aria-hidden="true" />
            Badges
          </NavLink>
          <NavLink to="/manage/incidents" className={subnavClass}>
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            Incidents
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
