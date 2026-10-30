import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { CtaSection } from '../features/home/CtaSection';
import { FactsSection, UnitMarquee } from '../features/home/FactsSection';
import { FaqSection } from '../features/home/FaqSection';
import { FeaturesSection } from '../features/home/FeaturesSection';
import { HeroSection } from '../features/home/HeroSection';
import { MotionPauseContext } from '../features/home/motionPause';
import { InventorySection } from '../features/home/InventorySection';
import { LifecycleSection } from '../features/home/LifecycleSection';
import { RolesSection } from '../features/home/RolesSection';
import { ShortcutsSection } from '../features/home/ShortcutsSection';
import { UnitsSection, UseCasesSection } from '../features/home/UnitsSection';

// `/`, the landing page, open to everyone (app/layouts/HomeLayout.jsx picks the layout). The sections
// live in features/home/ and their copy in features/home/homeContent.js. Animations come from
// framer-motion and from JavaScript versions of Magic UI and Aceternity UI components
// (components/magicui, components/aceternity), all still under prefers-reduced-motion. Whatever loops
// can also be stopped with the "Pause animations" button in the units strip (features/home/motionPause.js).
//
// Signed out, nothing here calls the API: the live inventory shows a sign-in panel instead, and the
// links into the app ask for a login first.

export default function HomePage() {
  const user = useAuthStore((s) => s.user);
  const [paused, setPaused] = useState(false);
  const motionPause = useMemo(() => ({ paused, setPaused }), [paused]);
  return (
    <MotionPauseContext.Provider value={motionPause}>
    <div className="space-y-16 pb-8 font-mono text-[#1a1a1a]">
      <div className="space-y-6">
        <HeroSection user={user} />
        <UnitMarquee />
      </div>
      <FactsSection />
      <ShortcutsSection user={user} />
      <InventorySection user={user} />
      <FeaturesSection />
      <LifecycleSection />
      <RolesSection />
      <UnitsSection />
      <UseCasesSection />
      <FaqSection />
      <CtaSection user={user} />
    </div>
    </MotionPauseContext.Provider>
  );
}
