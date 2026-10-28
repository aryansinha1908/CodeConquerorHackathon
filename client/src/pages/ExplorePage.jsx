import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getResources, getOrgUnits } from '../features/resources/api';
import { ResourceCard } from '../features/resources/components/ResourceCard';
import { ResourceFilters } from '../features/resources/components/ResourceFilters';
import { ResourceCardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Sparkles, Cpu, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/auth';

const CATEGORY_NAMES = {
  '3d_printer': '3D Printers',
  computing: 'Computing & AI',
  workshop: 'Workshop & Fab',
  testing: 'Testing & Materials',
  electronics: 'Electronics Lab',
};

export default function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [category, setCategory] = useState(searchParams.get('cat') || 'all');
  const [riskLevel, setRiskLevel] = useState('all');
  const [approvalMode, setApprovalMode] = useState('all');
  const [orgUnit, setOrgUnit] = useState(searchParams.get('unit') || 'all');
  const [onlyEligible, setOnlyEligible] = useState(false);

  // Fetch org units
  const { data: orgUnitsRes } = useQuery({
    queryKey: ['org-units'],
    queryFn: getOrgUnits,
    staleTime: 5 * 60 * 1000,
  });
  const orgUnits = orgUnitsRes?.data || [];

  // Fetch all base resources
  const {
    data: resourcesRes,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['resources'],
    queryFn: () => getResources(),
    staleTime: 60 * 1000,
  });

  const allResources = resourcesRes?.data?.resources || [];

  // 1. Calculate the Searched Sample Space (based on search query and orgUnit)
  const searchedSampleSpace = useMemo(() => {
    return allResources.filter((res) => {
      // Org unit filter
      if (orgUnit !== 'all' && res.orgUnit?._id !== orgUnit && res.orgUnit?.code !== orgUnit) {
        return false;
      }
      // Text search
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const titleMatch = res.title?.toLowerCase().includes(q);
      const descMatch = res.description?.toLowerCase().includes(q);
      const locMatch = res.location?.toLowerCase().includes(q);
      const catMatch = res.categoryLabel?.toLowerCase().includes(q) || res.category?.toLowerCase().includes(q);
      const badgeMatch = res.eligibility?.requiredBadges?.some((b) =>
        b.name?.toLowerCase().includes(q) || b.code?.toLowerCase().includes(q)
      );

      return titleMatch || descMatch || locMatch || catMatch || badgeMatch;
    });
  }, [allResources, search, orgUnit]);

  // 2. Derive dynamic categories from the current searched sample space
  const dynamicCategories = useMemo(() => {
    const counts = {};
    searchedSampleSpace.forEach((item) => {
      const cat = item.category || 'other';
      counts[cat] = (counts[cat] || 0) + 1;
    });

    const categoriesList = [
      { value: 'all', label: 'All', count: searchedSampleSpace.length },
    ];

    Object.keys(counts).forEach((catKey) => {
      categoriesList.push({
        value: catKey,
        label: CATEGORY_NAMES[catKey] || catKey.toUpperCase(),
        count: counts[catKey],
      });
    });

    return categoriesList;
  }, [searchedSampleSpace]);

  // 3. Filter the searched sample space according to applied filters
  // Requirement: "If a filter is applied and a catalog item does not have that attribute, then show it as well."
  const finalFilteredResources = useMemo(() => {
    return searchedSampleSpace.filter((item) => {
      // Category filter
      if (category !== 'all') {
        // If item doesn't have a category attribute, show it as well; otherwise must match
        if (item.category && item.category !== category) {
          return false;
        }
      }

      // Risk level filter
      if (riskLevel !== 'all') {
        // If item doesn't have riskLevel attribute, show it as well; otherwise must match
        if (item.riskLevel && item.riskLevel !== riskLevel) {
          return false;
        }
      }

      // Approval mode filter
      if (approvalMode !== 'all') {
        // If item doesn't have approvalMode attribute, show it as well; otherwise must match
        if (item.approvalMode && item.approvalMode !== approvalMode) {
          return false;
        }
      }

      // Only eligible filter
      if (onlyEligible) {
        const memberType = user?.memberType || 'UG';
        const dept = user?.department?.code || user?.department?.name || 'CSE';
        const allowedTiers = item.eligibility?.memberTypes;
        const allowedDepts = item.eligibility?.departments;

        // If no eligibility attribute or empty array, open to all (show as well)
        const tierOk = !allowedTiers || allowedTiers.length === 0 || allowedTiers.includes(memberType);
        const deptOk = !allowedDepts || allowedDepts.length === 0 || allowedDepts.includes(dept);

        if (!tierOk || !deptOk) return false;
      }

      return true;
    });
  }, [searchedSampleSpace, category, riskLevel, approvalMode, onlyEligible, user]);

  const handleResetFilters = () => {
    setSearch('');
    setCategory('all');
    setRiskLevel('all');
    setApprovalMode('all');
    setOrgUnit('all');
    setOnlyEligible(false);
  };

  return (
    <div className="space-y-8 font-mono">
      {/* ── Hacktoberfest Hero Banner ────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d] text-white p-6 md:p-8 shadow-[6px_6px_0_#1a1a1a]">
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
              <span>DYNAMIC FILTERS & CONFLICT-AWARE SLOTS</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Dynamic Filters Component ── */}
      <ResourceFilters
        search={search}
        onSearchChange={(val) => {
          setSearch(val);
          // If searching, keep category or reset to all if current category not in new results
          setCategory('all');
        }}
        category={category}
        onCategoryChange={setCategory}
        dynamicCategories={dynamicCategories}
        riskLevel={riskLevel}
        onRiskLevelChange={setRiskLevel}
        approvalMode={approvalMode}
        onApprovalModeChange={setApprovalMode}
        orgUnit={orgUnit}
        onOrgUnitChange={setOrgUnit}
        orgUnits={orgUnits}
        onlyEligible={onlyEligible}
        onToggleEligible={setOnlyEligible}
        onReset={handleResetFilters}
      />

      {/* ── Resource Grid ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-[#1a1a1a]/70">
          <span>
            SHOWING <strong>{finalFilteredResources.length}</strong> OF{' '}
            <strong>{allResources.length}</strong> ACTIVE CAMPUS RESOURCES
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
        ) : finalFilteredResources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {finalFilteredResources.map((res) => (
              <ResourceCard key={res._id} resource={res} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching campus gear found"
            description="No active resources matched your search and dynamic filters. Try clearing your filters or searching for alternative gear."
            actionLabel="Reset All Filters"
            onAction={handleResetFilters}
          />
        )}
      </div>
    </div>
  );
}
