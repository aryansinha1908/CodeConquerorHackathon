import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  Award,
  Layers,
  Search,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { StaggerList } from '../../components/Motion';
import { LinkButton } from '../manage/components/Bits';
import { EvidenceDialog } from '../manage/badges/EvidenceDialog';
import {
  getBadgeEvidenceUrl,
  useActiveOrgUnits,
  useBadgesCatalogue,
  useMyBadges,
} from './api';
import {
  BADGE_TABS,
  filterBadges,
  mapUserBadgesByBadgeId,
  myBadgeRows,
} from './badgeView';
import { BadgeCatalogueCard } from './components/BadgeCatalogueCard';
import { MyBadgeCard } from './components/MyBadgeCard';
import { RequestBadgeDialog } from './components/RequestBadgeDialog';

export default function BadgesPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();

  // URL state
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam === 'mine' ? 'mine' : 'catalogue';
  const requestCode = searchParams.get('request');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [myBadgesFilter, setMyBadgesFilter] = useState('all'); // all | active | requested | expired | rejected

  // Dialog states
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [selectedUserBadge, setSelectedUserBadge] = useState(null);
  const [viewingEvidenceRow, setViewingEvidenceRow] = useState(null);

  // Queries
  const catalogueQuery = useBadgesCatalogue();
  const myBadgesQuery = useMyBadges();
  const orgUnitsQuery = useActiveOrgUnits();

  const allBadges = Array.isArray(catalogueQuery.data?.data)
    ? catalogueQuery.data.data
    : Array.isArray(catalogueQuery.data)
      ? catalogueQuery.data
      : [];

  const myRows = myBadgeRows(myBadgesQuery.data);
  const userBadgesMap = mapUserBadgesByBadgeId(myRows);

  const activeHoldingsCount = myRows.filter(
    (r) => r.state === 'active' || r.status === 'active'
  ).length;
  const pendingRequestsCount = myRows.filter(
    (r) => r.state === 'requested' || r.status === 'requested'
  ).length;

  const isManagerOrAdmin =
    user?.roles?.includes('manager') || user?.roles?.includes('admin');

  // Deep-link: If ?request=<code> is in URL, automatically open request dialog for that badge
  useEffect(() => {
    if (requestCode && allBadges.length > 0 && !selectedBadge) {
      const match =
        allBadges.find((b) => b.code === requestCode || b._id === requestCode);
      if (match) {
        const existingRow = userBadgesMap.get(String(match._id)) || null;
        setSelectedBadge(match);
        setSelectedUserBadge(existingRow);
      }
    }
  }, [requestCode, allBadges, userBadgesMap, selectedBadge]);

  const switchTab = (nextTab) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (nextTab === 'catalogue') p.delete('tab');
      else p.set('tab', nextTab);
      return p;
    });
  };

  const openRequestDialog = (badge, userBadgeRow = null) => {
    setSelectedBadge(badge);
    setSelectedUserBadge(userBadgeRow);
  };

  const closeRequestDialog = () => {
    setSelectedBadge(null);
    setSelectedUserBadge(null);
    if (requestCode) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.delete('request');
        return p;
      });
    }
  };

  // Evidence viewing mutation
  const evidenceMutation = useMutation({
    mutationFn: (id) => getBadgeEvidenceUrl(id),
  });

  const openEvidence = (row) => {
    setViewingEvidenceRow(row);
    evidenceMutation.reset();
    evidenceMutation.mutate(row._id);
  };

  const closeEvidence = () => {
    setViewingEvidenceRow(null);
    evidenceMutation.reset();
  };

  // Filtered catalogue
  const filteredCatalogue = filterBadges(allBadges, {
    search: searchQuery,
    orgUnit: selectedUnit,
  });

  // Filtered my badges
  const filteredMyBadges = myRows.filter((row) => {
    if (myBadgesFilter === 'all') return true;
    const st = row.state || row.status;
    return st === myBadgesFilter;
  });

  const activeUnitsList = Array.isArray(orgUnitsQuery.data?.data)
    ? orgUnitsQuery.data.data
    : Array.isArray(orgUnitsQuery.data)
      ? orgUnitsQuery.data
      : [];

  return (
    <div className="space-y-6 font-mono text-[#1a1a1a]">
      {/* Page Header */}
      <div className="border-b-2 border-[#1a1a1a] pb-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-xs uppercase font-bold text-[#e67e22] tracking-widest block">
            SAFETY & TRAINING CREDENTIALS
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-[#1a1a1a] tracking-tight mt-1">
            Badges & Certifications
          </h1>
          <p className="text-xs text-[#1a1a1a]/75 mt-1.5 max-w-2xl leading-relaxed">
            Campus resources with safety considerations (3D printers, laser cutters, HPC Slurm clusters, UTM machines)
            require certified training badges. Request credentials here or browse the department catalogues.
          </p>
        </div>

        {/* Quick status summary and manage shortcut */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#1a1a1a] bg-white shadow-[2px_2px_0_#1a1a1a] text-xs">
            <span className="w-2 h-2 rounded-full bg-[#183d2d]" aria-hidden="true" />
            <span className="font-bold">{activeHoldingsCount}</span>
            <span className="text-[#1a1a1a]/70">Active</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-[#1a1a1a] bg-white shadow-[2px_2px_0_#1a1a1a] text-xs">
            <span className="w-2 h-2 rounded-full bg-[#e67e22]" aria-hidden="true" />
            <span className="font-bold">{pendingRequestsCount}</span>
            <span className="text-[#1a1a1a]/70">Requested</span>
          </div>

          {isManagerOrAdmin && (
            <LinkButton to="/manage/badges" variant="forest" size="sm" className="min-h-[38px]">
              <Layers className="w-4 h-4" aria-hidden="true" />
              Manage Queue
            </LinkButton>
          )}
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1a1a1a]/20 pb-2">
        <div role="tablist" aria-label="Badges navigation" className="flex gap-2">
          {BADGE_TABS.map((tab) => {
            const active = activeTab === tab.id;
            const count =
              tab.id === 'catalogue' ? allBadges.length : myRows.length;
            return (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => switchTab(tab.id)}
                className={`px-4 py-2 min-h-[44px] text-xs font-bold uppercase tracking-wider rounded-lg border-2 transition-all flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-1 ${
                  active
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[3px_3px_0_#1a1a1a]'
                    : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    active ? 'bg-white/20 text-white' : 'bg-[#1a1a1a]/10 text-[#1a1a1a]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Informative text */}
        <p className="text-xs text-[#1a1a1a]/60">
          {activeTab === 'catalogue'
            ? `${filteredCatalogue.length} badges in catalogue`
            : `${filteredMyBadges.length} records in your account`}
        </p>
      </div>

      {/* ── CATALOGUE TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'catalogue' && (
        <div className="space-y-5">
          {/* Filter Bar */}
          <div className="p-4 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[3px_3px_0_#1a1a1a] flex flex-col md:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#1a1a1a]/50"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder="Search badges by title, code, or safety equipment..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border-2 border-[#1a1a1a] bg-white placeholder:text-[#1a1a1a]/40 text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
                aria-label="Search badge catalogue"
              />
            </div>

            <div className="w-full md:w-64">
              <select
                value={selectedUnit}
                onChange={(e) => setSelectedUnit(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#c0392b]"
                aria-label="Filter by issuing department"
              >
                <option value="">All Issuing Units</option>
                {activeUnitsList.map((unit) => (
                  <option key={unit._id} value={unit._id}>
                    {unit.name} ({unit.code})
                  </option>
                ))}
              </select>
            </div>

            {(searchQuery || selectedUnit) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedUnit('');
                }}
                className="shrink-0 text-xs py-2"
              >
                Clear filters
              </Button>
            )}
          </div>

          {/* Loading state */}
          {catalogueQuery.isPending && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border-2 border-[#1a1a1a] p-5 bg-white shadow-[3px_3px_0_#1a1a1a] space-y-3"
                >
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {catalogueQuery.isError && (
            <ErrorState
              error={catalogueQuery.error}
              title="Could not load badge catalogue"
              onRetry={() => catalogueQuery.refetch()}
              retrying={catalogueQuery.isFetching}
            />
          )}

          {/* Empty state */}
          {catalogueQuery.isSuccess && filteredCatalogue.length === 0 && (
            <EmptyState
              icon={Award}
              title={
                searchQuery || selectedUnit
                  ? 'No matching badges found'
                  : 'No badges listed yet'
              }
              description={
                searchQuery || selectedUnit
                  ? 'Try clearing the search text or selecting a different issuing unit.'
                  : 'Check back later as lab managers publish new training qualifications.'
              }
            />
          )}

          {/* Catalogue Grid */}
          {catalogueQuery.isSuccess && filteredCatalogue.length > 0 && (
            <StaggerList
              aria-label="Available safety badges"
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {filteredCatalogue.map((badge) => (
                <BadgeCatalogueCard
                  key={badge._id}
                  badge={badge}
                  userBadge={userBadgesMap.get(String(badge._id))}
                  onRequest={(b, ub) => openRequestDialog(b, ub)}
                  onSelectTab={(tab) => switchTab(tab)}
                />
              ))}
            </StaggerList>
          )}
        </div>
      )}

      {/* ── MY BADGES TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'mine' && (
        <div className="space-y-5">
          {/* Status Sub-Filters */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'All Records' },
              { id: 'active', label: 'Active' },
              { id: 'requested', label: 'Requested' },
              { id: 'expired', label: 'Expired' },
              { id: 'rejected', label: 'Rejected' },
            ].map((f) => {
              const active = myBadgesFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMyBadgesFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-bold uppercase rounded-md border-2 transition-all ${
                    active
                      ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                      : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/30 hover:border-[#1a1a1a]'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Loading state */}
          {myBadgesQuery.isPending && (
            <div className="space-y-3" aria-busy="true">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border-2 border-[#1a1a1a] p-5 bg-white shadow-[3px_3px_0_#1a1a1a] space-y-3"
                >
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-60" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          )}

          {/* Error state */}
          {myBadgesQuery.isError && (
            <ErrorState
              error={myBadgesQuery.error}
              title="Could not load your badges"
              onRetry={() => myBadgesQuery.refetch()}
              retrying={myBadgesQuery.isFetching}
            />
          )}

          {/* Empty state */}
          {myBadgesQuery.isSuccess && filteredMyBadges.length === 0 && (
            <div className="p-8 text-center max-w-xl mx-auto space-y-4 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a]">
              <div className="w-14 h-14 rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d]/10 text-[#183d2d] flex items-center justify-center mx-auto shadow-[2px_2px_0_#1a1a1a]">
                <Award className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-black text-[#1a1a1a]">
                {myBadgesFilter === 'all'
                  ? 'No badges earned or requested yet'
                  : `No ${myBadgesFilter} badge records`}
              </h3>
              <p className="text-xs text-[#1a1a1a]/70 leading-relaxed">
                {myBadgesFilter === 'all'
                  ? 'Browse the department catalogues to see what safety qualifications you can obtain to unlock specialized lab equipment.'
                  : `You have no badge requests or credentials matching the "${myBadgesFilter}" filter.`}
              </p>
              <Button
                type="button"
                variant="forest"
                size="md"
                onClick={() => {
                  setMyBadgesFilter('all');
                  switchTab('catalogue');
                }}
              >
                Browse Badge Catalogue
              </Button>
            </div>
          )}

          {/* List of My Badges */}
          {myBadgesQuery.isSuccess && filteredMyBadges.length > 0 && (
            <StaggerList aria-label="My badges list" className="space-y-4">
              {filteredMyBadges.map((row) => (
                <MyBadgeCard
                  key={row._id}
                  row={row}
                  onRequest={(badge, ub) => openRequestDialog(badge, ub)}
                  onViewEvidence={(row) => openEvidence(row)}
                />
              ))}
            </StaggerList>
          )}
        </div>
      )}

      {/* Request Badge Modal Dialog */}
      <RequestBadgeDialog
        open={Boolean(selectedBadge)}
        onClose={closeRequestDialog}
        badge={selectedBadge}
        user={user}
        userBadgeRow={selectedUserBadge}
      />

      {/* Evidence Viewer Dialog */}
      <EvidenceDialog
        row={viewingEvidenceRow}
        request={evidenceMutation}
        onClose={closeEvidence}
        onRetry={() => viewingEvidenceRow && evidenceMutation.mutate(viewingEvidenceRow._id)}
      />
    </div>
  );
}
