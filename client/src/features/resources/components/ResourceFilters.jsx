import React from 'react';
import { Search, SlidersHorizontal, CheckSquare, Square, X } from 'lucide-react';

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: '3d_printer', label: '3D Printers' },
  { value: 'computing', label: 'Computing & AI' },
  { value: 'workshop', label: 'Workshop & Fab' },
  { value: 'testing', label: 'Testing & Materials' },
  { value: 'electronics', label: 'Electronics Lab' },
];

export function ResourceFilters({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  orgUnit,
  onOrgUnitChange,
  orgUnits = [],
  onlyEligible,
  onToggleEligible,
  onReset,
}) {
  return (
    <div className="bg-white border-2 border-[#1a1a1a] rounded-xl p-4 shadow-[4px_4px_0_#1a1a1a] space-y-4 font-mono">
      {/* ── Search Input & OrgUnit Selector ── */}
      <div className="flex flex-col md:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#1a1a1a]/50">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search equipment, 3D printers, GPU clusters, workshop gear..."
            className="w-full pl-10 pr-10 py-2 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-[#f5f0e8]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#1a1a1a]/50 hover:text-[#c0392b]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* OrgUnit filter */}
        <div className="w-full md:w-64">
          <select
            value={orgUnit}
            onChange={(e) => onOrgUnitChange(e.target.value)}
            className="w-full py-2 px-3 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
          >
            <option value="all">All Campus Units</option>
            {orgUnits.map((u) => (
              <option key={u._id} value={u._id}>
                {u.code ? `[${u.code}] ` : ''}
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Category pills & Eligible Toggle ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#1a1a1a]/15">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => {
            const active = category === cat.value;
            return (
              <button
                key={cat.value}
                onClick={() => onCategoryChange(cat.value)}
                className={`px-3 py-1 text-xs font-bold font-mono uppercase tracking-wider rounded-md border-2 transition-all ${
                  active
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                    : 'bg-[#ede8df] text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Checkbox: Only show eligible */}
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold font-mono text-[#1a1a1a]">
          <input
            type="checkbox"
            checked={onlyEligible}
            onChange={(e) => onToggleEligible(e.target.checked)}
            className="hidden"
          />
          <div
            className={`w-4 h-4 rounded border-2 border-[#1a1a1a] flex items-center justify-center transition-colors ${
              onlyEligible ? 'bg-[#183d2d] text-white' : 'bg-white'
            }`}
          >
            {onlyEligible && <span className="text-[10px] leading-none">✓</span>}
          </div>
          <span>Only show what I can book</span>
        </label>
      </div>
    </div>
  );
}

