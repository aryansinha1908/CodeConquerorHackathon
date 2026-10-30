import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { StaggerItem, StaggerList } from '../../components/Motion';
import { useResources } from '../resources/api';
import { ResourceCard } from '../resources/components/ResourceCard';
import { CATEGORY_OPTIONS } from '../resources/format';

// Six resources from the live catalogue, with a category switch. Signed-in visitors only: the
// catalogue needs an account, and the landing page is open to everyone. Anyone else gets a sign-in
// panel, and nothing is fetched.

const pillClass = (active) =>
  `px-3 py-1.5 min-h-[40px] rounded-md text-xs font-bold transition-all border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] ${
    active
      ? 'bg-[#183d2d] text-white border-[#1a1a1a] shadow-[2px_2px_0_#1a1a1a]'
      : 'bg-white text-[#1a1a1a] border-[#1a1a1a]/40 hover:border-[#1a1a1a]'
  }`;

const actionClass =
  'inline-flex items-center justify-center px-4 py-2 min-h-[40px] rounded-md border-2 border-[#1a1a1a] text-xs font-bold shadow-[2px_2px_0_#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0392b] focus-visible:ring-offset-2';

export function InventorySection({ user }) {
  const [activeCategory, setActiveCategory] = useState('');
  const resourcesQuery = useResources({ category: activeCategory || undefined, limit: 6 }, { enabled: Boolean(user) });
  const items = Array.isArray(resourcesQuery.data?.data) ? resourcesQuery.data.data : [];

  return (
    <section aria-labelledby="featured-resources-heading" className="space-y-4">
      <div className="flex flex-col justify-between gap-3 border-b-2 border-[#1a1a1a]/15 pb-3 sm:flex-row sm:items-end">
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-widest text-[#c0392b]">Live campus inventory</span>
          <h2 id="featured-resources-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
            A few resources to start with
          </h2>
        </div>
        {user && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" aria-pressed={!activeCategory} onClick={() => setActiveCategory('')} className={pillClass(!activeCategory)}>
              All Types
            </button>
            {CATEGORY_OPTIONS.slice(0, 4).map((cat) => (
              <button
                key={cat.value}
                type="button"
                aria-pressed={activeCategory === cat.value}
                onClick={() => setActiveCategory(activeCategory === cat.value ? '' : cat.value)}
                className={pillClass(activeCategory === cat.value)}
              >
                {cat.label}
              </button>
            ))}
            <Link to="/explore" className="ml-2 inline-flex min-h-[40px] shrink-0 items-center text-xs font-bold text-[#c0392b] underline hover:text-[#a93226]">
              All in Explore →
            </Link>
          </div>
        )}
      </div>

      {!user && (
        <div className="flex flex-col justify-between gap-4 rounded-xl border-2 border-[#1a1a1a] bg-white p-6 shadow-[4px_4px_0_#1a1a1a] sm:flex-row sm:items-center sm:p-8">
          <div className="space-y-1">
            <p className="text-sm font-black">Sign in to see what you can book</p>
            <p className="max-w-xl text-xs text-[#1a1a1a]/75">
              Live availability, the rules for each resource and what you still need are shown to members. Sign up
              with your @nitjsr.ac.in email.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link to="/login" className={`${actionClass} bg-white`}>
              Log in
            </Link>
            <Link to="/register" className={`${actionClass} bg-[#c0392b] text-white`}>
              Create an account
            </Link>
          </div>
        </div>
      )}

      {user && resourcesQuery.isPending && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          <span className="sr-only">Loading resources…</span>
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-64 animate-pulse space-y-3 rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a]">
              <div className="h-4 w-1/3 rounded bg-[#ede8df]" />
              <div className="h-6 w-3/4 rounded bg-[#ede8df]" />
              <div className="h-4 w-1/2 rounded bg-[#ede8df]" />
              <div className="mt-4 h-20 w-full rounded bg-[#ede8df]" />
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <StaggerList className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((resource) => (
            <StaggerItem key={resource._id}>
              <ResourceCard resource={resource} />
            </StaggerItem>
          ))}
        </StaggerList>
      )}

      {user && resourcesQuery.isSuccess && items.length === 0 && (
        <div className="space-y-2 rounded-xl border-2 border-[#1a1a1a] bg-white p-8 text-center shadow-[4px_4px_0_#1a1a1a]">
          <p className="text-sm font-bold">Nothing listed in this category yet.</p>
          {activeCategory && (
            <Button variant="outline" size="sm" onClick={() => setActiveCategory('')}>
              Show every category
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
