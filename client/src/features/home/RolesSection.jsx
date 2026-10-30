import React from 'react';
import { Check } from 'lucide-react';
import { HoverEffect } from '../../components/aceternity/HoverEffect';
import { ROLES } from './homeContent';

// Who ShareX is for, one card per role, with Aceternity's sliding hover block.

function RoleCard({ role }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a]">
      <span className="h-1.5 w-10 rounded-full" style={{ backgroundColor: role.color }} aria-hidden="true" />
      <h3 className="text-base font-black tracking-tight">{role.role}</h3>
      <p className="text-xs leading-relaxed text-[#1a1a1a]/80">{role.summary}</p>
      <ul className="mt-auto space-y-1.5 pt-2">
        {role.points.map((point) => (
          <li key={point} className="flex items-start gap-1.5 text-xs">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: role.color }} aria-hidden="true" />
            {point}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function RolesSection() {
  return (
    <section aria-labelledby="roles-heading" className="space-y-4">
      <div className="max-w-2xl space-y-1">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-[#2471a3]">For everyone on campus</span>
        <h2 id="roles-heading" className="text-2xl font-black tracking-tight sm:text-3xl">
          One place for borrowers and the units that lend
        </h2>
      </div>
      <HoverEffect className="-mx-2" items={ROLES} getKey={(role) => role.role} renderItem={(role) => <RoleCard role={role} />} />
    </section>
  );
}
