import React from 'react';
import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-[#1a1a1a]/10 border-2 border-dashed border-[#1a1a1a]/20',
        className
      )}
      {...props}
    />
  );
}

export function ResourceCardSkeleton() {
  return (
    <div className="rounded-xl border-2 border-[#1a1a1a] p-6 bg-white shadow-[4px_4px_0_#1a1a1a] flex flex-col gap-4 font-mono">
      <div className="flex justify-between items-start">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="pt-4 border-t-2 border-[#1a1a1a]/10 mt-auto flex justify-between items-center">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}

