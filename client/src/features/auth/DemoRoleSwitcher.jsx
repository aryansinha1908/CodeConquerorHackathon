import React, { useState } from 'react';
import { Zap } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { demoLogin } from './api';
import { toast } from 'sonner';

const ROLE_LABELS = {
  student: { label: 'Student', emoji: '🎓', color: 'bg-[#2980b9] hover:bg-[#1f6390]' },
  student2: { label: 'Student 2', emoji: '🎓', color: 'bg-[#2980b9] hover:bg-[#1f6390]' },
  faculty: { label: 'Faculty', emoji: '📚', color: 'bg-[#8e44ad] hover:bg-[#7d3c98]' },
  manager: { label: 'Manager', emoji: '🔑', color: 'bg-[#e67e22] hover:bg-[#d35400]' },
  admin: { label: 'Admin', emoji: '⚡', color: 'bg-[#c0392b] hover:bg-[#a93226]' },
};

/**
 * Demo role switcher — shown only when the API reports DEMO_MODE.
 * Calls POST /auth/demo-login and passes the token up.
 */
export function DemoRoleSwitcher({ roles, onLogin }) {
  const [loading, setLoading] = useState(null); // the role currently loading

  const handleDemoLogin = async (role) => {
    setLoading(role);
    try {
      const res = await demoLogin(role);
      onLogin(res.data.accessToken);
      toast.success(`Logged in as demo ${ROLE_LABELS[role]?.label ?? role}`);
    } catch (err) {
      toast.error(err.message ?? 'Demo login failed');
    } finally {
      setLoading(null);
    }
  };

  if (!roles?.length) return null;

  return (
    <div className="mb-6 p-4 rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d]/5 shadow-[3px_3px_0_#1a1a1a]">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={16} className="text-[#e67e22]" aria-hidden="true" />
        <p className="text-xs font-bold font-mono text-[#1a1a1a] tracking-wider uppercase">
          Demo mode — Try as
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => {
          const meta = ROLE_LABELS[role] ?? { label: role, emoji: '👤' };
          return (
            <button
              key={role}
              onClick={() => handleDemoLogin(role)}
              disabled={loading !== null}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-[#1a1a1a]',
                'text-xs font-bold font-mono text-white',
                'shadow-[2px_2px_0_#1a1a1a] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]',
                'transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                meta.color ?? 'bg-[#183d2d]',
              ].join(' ')}
              aria-label={`Try as ${meta.label}`}
            >
              <span aria-hidden="true">{meta.emoji}</span>
              {loading === role ? 'Loading…' : meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

