import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { FadeUp } from '../../components/Motion';
import { Spotlight } from '../../components/aceternity/Spotlight';
import { GridPattern } from '../../components/magicui/GridPattern';
import { ShimmerLink } from '../../components/magicui/ShimmerLink';
import { useMotionPause } from './motionPause';

// The closing call to action: sign up (or explore, when signed in).

const secondaryClass =
  'inline-flex min-h-[44px] items-center justify-center rounded-md border-2 border-white bg-transparent px-5 py-2.5 text-sm font-bold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f1c40f]';

export function CtaSection({ user }) {
  const { paused } = useMotionPause();
  return (
    <FadeUp
      as="section"
      aria-labelledby="cta-heading"
      className="relative isolate overflow-hidden rounded-2xl border-2 border-[#1a1a1a] bg-[#1a1a1a] px-6 py-12 text-center text-white shadow-[6px_6px_0_#c0392b] sm:px-12"
    >
      <GridPattern className="text-white/[0.06]" size={24} />
      <Spotlight className="-top-32 left-1/4" fill="#c0392b" />
      <div className="relative z-10 mx-auto max-w-2xl space-y-4">
        <h2 id="cta-heading" className="text-2xl font-black tracking-tight sm:text-4xl">
          Ready when your project is.
        </h2>
        <p className="text-sm text-white/80">
          {user
            ? 'Find what you need, check you can book it, and pick a slot.'
            : 'Sign up with your @nitjsr.ac.in email, get your ID card verified, and book what your department and the central facilities share.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {user ? (
            <>
              <ShimmerLink to="/explore" paused={paused}>
                Explore resources
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ShimmerLink>
              <Link to="/bookings" className={secondaryClass}>
                My bookings
              </Link>
            </>
          ) : (
            <>
              <ShimmerLink to="/register" paused={paused}>
                Create your account
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ShimmerLink>
              <Link to="/login" className={secondaryClass}>
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </FadeUp>
  );
}
