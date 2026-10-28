import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Shield, UserCheck, Users, FileText, AlertCircle } from 'lucide-react';

export function AdminLayout() {
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
          <span className="text-[10px] uppercase font-bold text-[#c0392b] tracking-widest block">
            INSTITUTE ADMINISTRATION
          </span>
          <h1 className="text-xl font-black text-[#1a1a1a] tracking-tight">System Admin Console</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavLink to="/admin/verifications" className={subnavClass}>
            <UserCheck className="w-3.5 h-3.5" />
            Verification Queue
          </NavLink>
          <NavLink to="/admin/users" className={subnavClass}>
            <Users className="w-3.5 h-3.5" />
            Users & Roles
          </NavLink>
          <NavLink to="/admin/audit" className={subnavClass}>
            <FileText className="w-3.5 h-3.5" />
            Audit Log
          </NavLink>
          <NavLink to="/admin/incidents" className={subnavClass}>
            <AlertCircle className="w-3.5 h-3.5" />
            Escalations
          </NavLink>
        </div>
      </div>
      <Outlet />
    </div>
  );
}

