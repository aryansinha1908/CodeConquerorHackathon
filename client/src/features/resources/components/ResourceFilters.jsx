import React from 'react';
import { Search, SlidersHorizontal, CheckSquare, Square, X, Filter } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';

export function ResourceFilters({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  dynamicCategories = [],
  riskLevel,
  onRiskLevelChange,
  approvalMode,
  onApprovalModeChange,
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
            placeholder="Search equipment, 3D printers, GPU clusters, lab gear..."
            className="w-full pl-10 pr-10 py-2.5 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-[#f5f0e8]/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
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
            className="w-full py-2.5 px-3 text-xs md:text-sm rounded-lg border-2 border-[#1a1a1a] bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
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

      {/* ── Dynamic Category Pills (computed from searched sample space) ── */}
      <div className="space-y-2 pt-1 border-t border-[#1a1a1a]/15">
        <div className="flex items-center justify-between text-[11px] font-bold text-[#1a1a1a]/70">
          <span className="flex items-center gap-1.5 uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-[#183d2d]" />
            Dynamic Categories ({dynamicCategories.length})
          </span>
          {search && (
            <span className="text-[10px] text-[#c0392b]">
              Filtered for &ldquo;{search}&rdquo;
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {dynamicCategories.map((cat) => {
            const active = category === cat.value;
            return (
              <button
                key={cat.value}
                onClick={() => onCategoryChange(cat.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold font-mono tracking-wider rounded-md border-2 transition-all ${
                  active
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                    : 'bg-[#ede8df] text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                }`}
              >
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                    active
                      ? 'bg-white text-[#183d2d]'
                      : 'bg-[#1a1a1a]/15 text-[#1a1a1a]'
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Secondary Attribute Filters (Risk, Approval, Eligibility) ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#1a1a1a]/15 text-xs">
        {/* Risk Level Filter */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#1a1a1a]/70 text-[11px] uppercase">
            Risk Filter:
          </span>
          <div className="flex items-center gap-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Med' },
              { value: 'high', label: 'High' },
            ].map((r) => (
              <button
                key={r.value}
                onClick={() => onRiskLevelChange(r.value)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                  riskLevel === r.value
                    ? 'bg-[#c0392b] text-white border-[#1a1a1a]'
                    : 'bg-[#f5f0e8] text-[#1a1a1a] border-[#1a1a1a]/30 hover:border-[#1a1a1a]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Approval Mode Filter */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#1a1a1a]/70 text-[11px] uppercase">
            Approval:
          </span>
          <div className="flex items-center gap-1">
            {[
              { value: 'all', label: 'All' },
              { value: 'auto', label: '⚡ Instant' },
              { value: 'manual', label: 'Review' },
            ].map((a) => (
              <button
                key={a.value}
                onClick={() => onApprovalModeChange(a.value)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors ${
                  approvalMode === a.value
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a]'
                    : 'bg-[#f5f0e8] text-[#1a1a1a] border-[#1a1a1a]/30 hover:border-[#1a1a1a]'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
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
          <span>Only what I can book</span>
        </label>
      </div>
    </div>
  );
}
