import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getResources, getOrgUnits } from '../features/resources/api';
import { ResourceCard } from '../features/resources/components/ResourceCard';
import { ResourceFilters } from '../features/resources/components/ResourceFilters';
import { ResourceCardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Sparkles, Compass, Cpu, Layers, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/auth';

export default function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [category, setCategory] = useState(searchParams.get('cat') || 'all');
  const [orgUnit, setOrgUnit] = useState(searchParams.get('unit') || 'all');
  const [onlyEligible, setOnlyEligible] = useState(false);

  // Fetch org units
  const { data: orgUnitsRes } = useQuery({
    queryKey: ['org-units'],
    queryFn: getOrgUnits,
    staleTime: 5 * 60 * 1000,
  });
  const orgUnits = orgUnitsRes?.data || [];

  // Fetch resources
  const {
    data: resourcesRes,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['resources', { q: search, category, orgUnit }],
    queryFn: () => getResources({ q: search, category, orgUnit }),
    staleTime: 60 * 1000,
  });

  const allResources = resourcesRes?.data?.resources || [];

  // Filter eligible if toggled
  const resources = allResources.filter((res) => {
    if (!onlyEligible) return true;
    const memberType = user?.memberType || 'UG';
    const dept = user?.department?.code || user?.department?.name || 'CSE';
    const allowedTiers = res.eligibility?.memberTypes || [];
    const allowedDepts = res.eligibility?.departments || [];

    const tierOk = allowedTiers.length === 0 || allowedTiers.includes(memberType);
    const deptOk = allowedDepts.length === 0 || allowedDepts.includes(dept);
    return tierOk && deptOk;
  });

  const handleResetFilters = () => {
    setSearch('');
    setCategory('all');
    setOrgUnit('all');
    setOnlyEligible(false);
  };

  return (
    <div className="space-y-8 font-mono">
      {/* ── Hacktoberfest Hero Banner ────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d] text-white p-6 md:p-8 shadow-[6px_6px_0_#1a1a1a]">
        {/* Pixel deco blocks */}
        <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none select-none opacity-20">
          <div className="absolute top-3 right-3 w-6 h-6 bg-[#c0392b]" />
          <div className="absolute top-3 right-11 w-6 h-6 bg-white" />
          <div className="absolute top-11 right-3 w-6 h-6 bg-[#f1c40f]" />
        </div>

        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2.5 py-0.5 rounded border border-white/40 bg-[#c0392b] text-[10px] font-black tracking-widest uppercase">
              CAMPUS CATALOGUE // 2026
            </span>
            <span className="text-xs text-[#1abc9c] font-bold">
              ● REAL-TIME AVAILABILITY
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight leading-tight mb-3">
            CENTRALIZED CAMPUS RESOURCE INVENTORY
          </h1>

          <p className="text-xs sm:text-sm text-white/80 leading-relaxed mb-6">
            Reserve FDM/resin 3D printers, GPU deep-learning nodes, materials testing machines, and
            specialized electronics stations across NIT Jamshedpur with clear eligibility guidelines.
          </p>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold">
            <div className="px-3 py-1.5 rounded-lg border border-white/30 bg-white/10 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-[#f1c40f]" />
              <span>DIC + CENTRAL WORKSHOP + CSE LABS</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg border border-white/30 bg-white/10 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#1abc9c]" />
              <span>TRANSPARENT ELIGIBILITY FIX LINKS</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Filters ──────────────────────────────────────────────────────────── */}
      <ResourceFilters
        search={search}
        onSearchChange={setSearch}
        category={category}
        onCategoryChange={setCategory}
        orgUnit={orgUnit}
        onOrgUnitChange={setOrgUnit}
        orgUnits={orgUnits}
        onlyEligible={onlyEligible}
        onToggleEligible={setOnlyEligible}
        onReset={handleResetFilters}
      />

      {/* ── Resource Grid ────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-[#1a1a1a]/70">
          <span>
            SHOWING <strong>{resources.length}</strong> ACTIVE CAMPUS RESOURCES
          </span>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 hover:text-[#c0392b] font-bold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            REFRESH CATALOG
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <ResourceCardSkeleton />
            <ResourceCardSkeleton />
            <ResourceCardSkeleton />
          </div>
        ) : resources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {resources.map((res) => (
              <ResourceCard key={res._id} resource={res} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching campus gear found"
            description="No active resources matched your current search and filters. Try clearing some filters or searching for alternative equipment."
            actionLabel="Reset All Filters"
            onAction={handleResetFilters}
          />
        )}
      </div>
    </div>
  );
}
