import React from 'react';

/**
 * Placeholder Explore page — will be fleshed out as F-05.
 * For now just confirms auth is working.
 */
export default function ExplorePage() {
  return (
    <div className="min-h-screen bg-[#f5f0e8] flex items-center justify-center p-8">
      <div className="bg-white border-2 border-[#1a1a1a] rounded-xl p-8 shadow-[4px_4px_0_#1a1a1a] max-w-md w-full text-center font-mono">
        <div className="text-4xl mb-4">🏫</div>
        <h1 className="text-2xl font-black text-[#1a1a1a] mb-2">Explore</h1>
        <p className="text-sm text-[#1a1a1a]/60">
          Resource discovery coming soon (F-05).
        </p>
      </div>
    </div>
  );
}

