import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Award,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Compass,
  Cpu,
  FileCheck,
  Flame,
  Layers,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { FadeUp, StaggerItem, StaggerList } from '../components/Motion';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { useAuthStore } from '../stores/auth';
import { useResources } from '../features/resources/api';
import { ResourceCard } from '../features/resources/components/ResourceCard';
import { CATEGORY_OPTIONS } from '../features/resources/format';

// Quick search suggestions that take the user directly into Explore with a query or category
const QUICK_SEARCH_TAGS = [
  { label: '3D Printers', q: '3D Printer' },
  { label: 'CNC Mills', q: 'CNC' },
  { label: 'Oscilloscopes', q: 'Oscilloscope' },
  { label: 'Laser Cutters', q: 'Laser' },
  { label: 'Compute Clusters', category: 'computing' },
  { label: 'Robotics Bench', q: 'Robotics' },
];

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Search & Pre-Verify',
    desc: 'Instant auto-check against your department roll, student tier, and safety certifications with zero waiting.',
    icon: Search,
  },
  {
    step: '02',
    title: 'Pick Exact IST Slots',
    desc: 'Conflict-free 7-day calendar matrix with real-time slot concurrency locks and waitlist positioning.',
    icon: Clock,
  },
  {
    step: '03',
    title: 'Instant or 1-Click Approval',
    desc: 'Autonomous booking confirmation for standard lab benches; transparent manager queue for heavy machinery.',
    icon: Zap,
  },
  {
    step: '04',
    title: 'Photo-Proof Handover',
    desc: 'Mobile-friendly inspection checklist with camera verification at check-in and check-out to eliminate disputes.',
    icon: FileCheck,
  },
];

const CAMPUS_FACILITIES = [
  {
    code: 'DIC',
    name: 'Design Innovation Centre',
    focus: 'Rapid prototyping, stereolithography & multi-material 3D printing, laser cutters, CAD/CAM.',
    badge: 'Open Access',
  },
  {
    code: 'CWS',
    name: 'Central Workshop',
    focus: 'Heavy conventional & CNC lathes, 5-axis milling, precision grinding, foundry & sheet metal.',
    badge: 'Safety Badge Required',
  },
  {
    code: 'CSE',
    name: 'High-Performance Computing Lab',
    focus: 'NVIDIA GPU clusters, neural network training nodes, simulation & parallel computing benches.',
    badge: 'Tier Verified',
  },
  {
    code: 'ECE',
    name: 'Advanced Electronics & Signal Lab',
    focus: 'GHz spectrum analyzers, high-bandwidth DSOs, RF signal generators, SMD rework stations.',
    badge: 'Slot Managed',
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');

  // Fetch featured resources (top 6 resources on campus)
  const resourcesQuery = useResources({
    category: activeCategory || undefined,
    limit: 6,
  });

  const featuredItems = Array.isArray(resourcesQuery.data?.data)
    ? resourcesQuery.data.data
    : [];

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      navigate(`/explore?q=${encodeURIComponent(query)}`);
    } else {
      navigate('/explore');
    }
  };

  const handleQuickTagClick = (tag) => {
    if (tag.category) {
      navigate(`/explore?category=${encodeURIComponent(tag.category)}`);
    } else if (tag.q) {
      navigate(`/explore?q=${encodeURIComponent(tag.q)}`);
    }
  };

  const isVerified = user?.verification?.status === 'approved';

  return (
    <div className="space-y-12 font-mono text-[#1a1a1a] pb-8">
      {/* ── 1. HERO SECTION ─────────────────────────────────────────────────── */}
      <FadeUp as="section" className="relative rounded-2xl border-2 border-[#1a1a1a] bg-[#183d2d] text-white p-6 sm:p-10 shadow-[6px_6px_0_#1a1a1a] overflow-hidden">
        {/* Subtle decorative geometric grid corner accent */}
        <div aria-hidden="true" className="absolute -top-12 -right-12 w-48 h-48 pointer-events-none select-none opacity-20">
          <div className="absolute top-4 right-4 w-10 h-10 bg-[#c0392b]" />
          <div className="absolute top-4 right-16 w-10 h-10 bg-white" />
          <div className="absolute top-16 right-4 w-10 h-10 bg-[#f1c40f]" />
          <div className="absolute top-16 right-16 w-10 h-10 bg-[#1abc9c]" />
        </div>

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 rounded-md border border-white/30 bg-[#c0392b] text-[10px] sm:text-xs font-black tracking-widest uppercase text-white shadow-[2px_2px_0_#1a1a1a]">
              NIT Jamshedpur Central Facility Hub
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/20 bg-white/10 text-[10px] font-bold text-white/90">
              <span className="w-2 h-2 rounded-full bg-[#1abc9c] animate-pulse" />
              Live IST Engine
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight text-white">
            Shared Lab Facilities, Equipment &amp; High-End Machinery.
          </h1>

          <p className="text-xs sm:text-sm md:text-base text-white/85 leading-relaxed">
            Reserve CNC machinery, 3D printers, precision lab instruments, GPU clusters, and specialized workshops across NIT Jamshedpur with zero delays, automatic prerequisites verification, and real-time collision prevention.
          </p>

          {/* ── Blazing Fast Search Box ── */}
          <form onSubmit={handleSearchSubmit} role="search" className="pt-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search
                  className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#1a1a1a]/60 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Instant search: '3D Printer', 'Oscilloscope', 'DIC Lathe'..."
                  className="w-full pl-10 pr-10 py-3 text-sm rounded-lg border-2 border-[#1a1a1a] bg-white text-[#1a1a1a] font-mono placeholder:text-[#1a1a1a]/50 focus:outline-none focus:ring-2 focus:ring-[#f1c40f] shadow-[3px_3px_0_#1a1a1a] [&::-webkit-search-cancel-button]:hidden"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search input"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#1a1a1a]/60 hover:text-[#1a1a1a]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="shrink-0 min-h-[46px] px-6 text-sm"
              >
                Find &amp; Book
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </form>

          {/* ── Fast Search Pills (Zero Latency Shortcut) ── */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
            <span className="text-white/70 text-[11px] font-bold">Quick queries:</span>
            {QUICK_SEARCH_TAGS.map((tag) => (
              <button
                key={tag.label}
                type="button"
                onClick={() => handleQuickTagClick(tag)}
                className="px-2.5 py-1 rounded border border-white/25 bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold transition-colors cursor-pointer"
              >
                {tag.label}
              </button>
            ))}
          </div>
        </div>
      </FadeUp>

      {/* ── 2. INSTANT ACTION SHORTCUTS (NO TIME WASTING) ───────────────────── */}
      <section aria-labelledby="shortcuts-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-heading" className="text-sm font-black uppercase tracking-wider text-[#1a1a1a]/70 flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#e67e22]" />
            Fast-Track Workflows
          </h2>
          <span className="text-[11px] text-[#1a1a1a]/60">One-click jump</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link
            to="/explore"
            className="group p-4 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:-translate-x-[2px] hover:-translate-y-[2px] transition-all flex items-start gap-3.5"
          >
            <div className="p-2.5 rounded-lg border-2 border-[#1a1a1a] bg-[#183d2d] text-white shrink-0 group-hover:scale-105 transition-transform">
              <Compass className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black tracking-tight text-[#1a1a1a] flex items-center justify-between">
                Browse Catalog
                <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#c0392b]" />
              </h3>
              <p className="text-xs text-[#1a1a1a]/70 mt-0.5 line-clamp-2">
                All 40+ laboratory devices, workshop tooling &amp; rooms with live filters.
              </p>
            </div>
          </Link>

          <Link
            to="/bookings"
            className="group p-4 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:-translate-x-[2px] hover:-translate-y-[2px] transition-all flex items-start gap-3.5"
          >
            <div className="p-2.5 rounded-lg border-2 border-[#1a1a1a] bg-[#2980b9] text-white shrink-0 group-hover:scale-105 transition-transform">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black tracking-tight text-[#1a1a1a] flex items-center justify-between">
                Active Bookings
                <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#2980b9]" />
              </h3>
              <p className="text-xs text-[#1a1a1a]/70 mt-0.5 line-clamp-2">
                Upcoming reservations, mobile check-ins, and waitlist position tracker.
              </p>
            </div>
          </Link>

          <Link
            to="/verification"
            className="group p-4 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:-translate-x-[2px] hover:-translate-y-[2px] transition-all flex items-start gap-3.5"
          >
            <div className="p-2.5 rounded-lg border-2 border-[#1a1a1a] bg-[#e67e22] text-white shrink-0 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black tracking-tight text-[#1a1a1a] flex items-center justify-between">
                ID Verification
                <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#e67e22]" />
              </h3>
              <p className="text-xs text-[#1a1a1a]/70 mt-0.5 line-clamp-2">
                {isVerified ? 'Status: Confirmed verified · Ready to reserve.' : 'Upload student/staff card to unlock bookings.'}
              </p>
            </div>
          </Link>

          <Link
            to="/badges"
            className="group p-4 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a] hover:shadow-[6px_6px_0_#1a1a1a] hover:-translate-x-[2px] hover:-translate-y-[2px] transition-all flex items-start gap-3.5"
          >
            <div className="p-2.5 rounded-lg border-2 border-[#1a1a1a] bg-[#8e44ad] text-white shrink-0 group-hover:scale-105 transition-transform">
              <Award className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black tracking-tight text-[#1a1a1a] flex items-center justify-between">
                Safety Badges
                <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#8e44ad]" />
              </h3>
              <p className="text-xs text-[#1a1a1a]/70 mt-0.5 line-clamp-2">
                Training certificates &amp; unit approvals needed for high-risk equipment.
              </p>
            </div>
          </Link>
        </div>
      </section>

      {/* ── 3. FEATURED / POPULAR EQUIPMENT (LIVE API PREVIEW) ──────────────── */}
      <section aria-labelledby="featured-resources-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b-2 border-[#1a1a1a]/15 pb-3">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#c0392b] block">
              Live Campus Inventory
            </span>
            <h2 id="featured-resources-heading" className="text-xl font-black tracking-tight text-[#1a1a1a]">
              Popular &amp; High-Demand Resources
            </h2>
          </div>

          {/* Interactive Fast Category Switcher */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveCategory('')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border-2 ${
                !activeCategory
                  ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                  : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
              }`}
            >
              All Types
            </button>
            {CATEGORY_OPTIONS.slice(0, 4).map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setActiveCategory(activeCategory === cat.value ? '' : cat.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border-2 ${
                  activeCategory === cat.value
                    ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
                    : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
                }`}
              >
                {cat.label}
              </button>
            ))}
            <Link
              to="/explore"
              className="text-xs font-bold underline text-[#c0392b] hover:text-[#a93226] ml-2 shrink-0 flex items-center gap-1"
            >
              All in Explore →
            </Link>
          </div>
        </div>

        {/* Live Equipment Grid */}
        {resourcesQuery.isPending && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-64 rounded-xl border-2 border-[#1a1a1a] bg-white p-5 animate-pulse shadow-[4px_4px_0_#1a1a1a] space-y-3"
              >
                <div className="h-4 bg-[#ede8df] rounded w-1/3" />
                <div className="h-6 bg-[#ede8df] rounded w-3/4" />
                <div className="h-4 bg-[#ede8df] rounded w-1/2" />
                <div className="h-20 bg-[#ede8df] rounded w-full mt-4" />
              </div>
            ))}
          </div>
        )}

        {featuredItems.length > 0 && (
          <StaggerList className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredItems.map((resource) => (
              <StaggerItem key={resource._id}>
                <ResourceCard resource={resource} />
              </StaggerItem>
            ))}
          </StaggerList>
        )}

        {resourcesQuery.isSuccess && featuredItems.length === 0 && (
          <div className="p-8 text-center bg-white rounded-xl border-2 border-[#1a1a1a] shadow-[4px_4px_0_#1a1a1a] space-y-2">
            <p className="text-sm font-bold">No items found under this filter category.</p>
            <Button variant="outline" size="sm" onClick={() => setActiveCategory('')}>
              Clear Category Filter
            </Button>
          </div>
        )}
      </section>

      {/* ── 4. HOW IT WORKS (ZERO-FRICTION CAMPUS WORKFLOW) ─────────────────── */}
      <section aria-labelledby="how-it-works-heading" className="space-y-6">
        <div className="text-center max-w-xl mx-auto space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-widest text-[#c0392b] block">
            Streamlined Architecture
          </span>
          <h2 id="how-it-works-heading" className="text-xl sm:text-2xl font-black tracking-tight text-[#1a1a1a]">
            How CampusCommons Eliminates Booking Friction
          </h2>
          <p className="text-xs text-[#1a1a1a]/70">
            No paper forms, no manual approval bottlenecks, and no scheduling collisions.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {WORKFLOW_STEPS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className="p-5 rounded-xl border-2 border-[#1a1a1a] bg-white shadow-[4px_4px_0_#1a1a1a] flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-black text-[#c0392b]">{item.step}</span>
                    <div className="w-8 h-8 rounded-md border-2 border-[#1a1a1a] bg-[#f5f0e8] flex items-center justify-center text-[#183d2d]">
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <h3 className="text-sm font-black tracking-tight text-[#1a1a1a] pt-1">
                    {item.title}
                  </h3>
                  <p className="text-xs text-[#1a1a1a]/75 leading-relaxed">
                    {item.desc}
                  </p>
                </div>

                <div className="pt-2 border-t border-[#1a1a1a]/15 text-[10px] font-bold text-[#183d2d] flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Verified in real time
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 5. CAMPUS UNITS & PARTICIPATING CENTRES ─────────────────────────── */}
      <section aria-labelledby="facilities-heading" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b-2 border-[#1a1a1a]/15 pb-2">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-[#e67e22] block">
              Multi-Department Hub
            </span>
            <h2 id="facilities-heading" className="text-xl font-black tracking-tight text-[#1a1a1a]">
              Participating NIT Jamshedpur Units
            </h2>
          </div>
          <span className="text-xs text-[#1a1a1a]/60">Centralized governance · Single login</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CAMPUS_FACILITIES.map((facility) => (
            <div
              key={facility.code}
              className="p-5 rounded-xl border-2 border-[#1a1a1a] bg-[#ede8df]/60 shadow-[4px_4px_0_#1a1a1a] flex flex-col justify-between gap-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black px-2 py-0.5 rounded border border-[#1a1a1a] bg-white text-[#183d2d]">
                    {facility.code}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#1a1a1a]/30 bg-white/70 text-[#1a1a1a]">
                    {facility.badge}
                  </span>
                </div>
                <h3 className="text-sm font-black tracking-tight text-[#1a1a1a] pt-1">
                  {facility.name}
                </h3>
                <p className="text-xs text-[#1a1a1a]/80 leading-relaxed">
                  {facility.focus}
                </p>
              </div>

              <div className="pt-2 flex items-center justify-between text-xs">
                <Link
                  to={`/explore?q=${encodeURIComponent(facility.code)}`}
                  className="font-bold underline text-[#183d2d] hover:text-[#c0392b] flex items-center gap-1"
                >
                  View unit equipment →
                </Link>
                <span className="text-[11px] text-[#1a1a1a]/60 font-semibold">NIT JSR Campus</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 6. STATS & RELIABILITY BANNER ───────────────────────────────────── */}
      <section className="rounded-xl border-2 border-[#1a1a1a] bg-white p-6 shadow-[4px_4px_0_#1a1a1a] grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
        <div>
          <div className="text-2xl sm:text-3xl font-black text-[#c0392b]">40+</div>
          <div className="text-xs font-bold text-[#1a1a1a]/70 uppercase tracking-wider mt-1">
            Lab Devices
          </div>
        </div>
        <div>
          <div className="text-2xl sm:text-3xl font-black text-[#183d2d]">100%</div>
          <div className="text-xs font-bold text-[#1a1a1a]/70 uppercase tracking-wider mt-1">
            Slot Collisions Prevented
          </div>
        </div>
        <div>
          <div className="text-2xl sm:text-3xl font-black text-[#2980b9]">&lt; 60s</div>
          <div className="text-xs font-bold text-[#1a1a1a]/70 uppercase tracking-wider mt-1">
            Search to Reserve
          </div>
        </div>
        <div>
          <div className="text-2xl sm:text-3xl font-black text-[#e67e22]">24/7</div>
          <div className="text-xs font-bold text-[#1a1a1a]/70 uppercase tracking-wider mt-1">
            IST Calendar Engine
          </div>
        </div>
      </section>
    </div>
  );
}

