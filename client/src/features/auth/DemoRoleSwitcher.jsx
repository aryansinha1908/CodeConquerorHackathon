import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { enter, fadeUp, press, stagger } from '../../lib/motion';
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
 * Demo role switcher — shown only when GET /auth/demo-config reports demoMode.
 * Calls POST /auth/demo-login and passes the session ({ accessToken, user }) up.
 */
export function DemoRoleSwitcher({ roles, onLogin }) {
  const [loading, setLoading] = useState(null); // the role currently loading

  const handleDemoLogin = async (role) => {
    setLoading(role);
    try {
      const res = await demoLogin(role);
      const { accessToken, user } = res.data;
      onLogin(accessToken, user);
      toast.success(`Logged in as demo ${ROLE_LABELS[role]?.label ?? role}`);
    } catch (err) {
      // 404 "Run npm run seed" when the demo users are missing; 429 from the demo limiter.
      toast.error(err.message ?? 'Demo login failed', {
        description: err.requestId ? `ref: ${err.requestId}` : undefined,
      });
    } finally {
      setLoading(null);
    }
  };

  if (!roles?.length) return null;

  // Split into row 1 (student, student 2, faculty) and row 2 (manager, admin centered)
  const row1Roles = roles.filter((r) => ['student', 'student2', 'faculty'].includes(r));
  const row2Roles = roles.filter((r) => ['manager', 'admin'].includes(r));
  const otherRoles = roles.filter((r) => !['student', 'student2', 'faculty', 'manager', 'admin'].includes(r));
  const finalRow1 = [...row1Roles, ...otherRoles];

  const renderRoleButton = (role) => {
    const meta = ROLE_LABELS[role] ?? { label: role, emoji: '👤' };
    return (
      <motion.button
        key={role}
        variants={fadeUp}
        {...press}
        onClick={() => handleDemoLogin(role)}
        disabled={loading !== null}
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border-2 border-[#1a1a1a]',
          'text-xs font-bold font-mono text-white',
          'shadow-[2px_2px_0_#1a1a1a] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]',
          'transition-[box-shadow,translate,background-color,opacity] disabled:opacity-50 disabled:cursor-not-allowed',
          meta.color ?? 'bg-[#183d2d]',
        ].join(' ')}
        aria-label={`Try as ${meta.label}`}
      >
        <span aria-hidden="true">{meta.emoji}</span>
        {loading === role ? 'Loading…' : meta.label}
      </motion.button>
    );
  };

  return (
    <div className="mb-6 p-4 rounded-xl border-2 border-[#1a1a1a] bg-[#183d2d]/5 shadow-[3px_3px_0_#1a1a1a]">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={16} className="text-[#e67e22]" aria-hidden="true" />
        <p className="text-xs font-bold font-mono text-[#1a1a1a] tracking-wider uppercase">
          Demo mode — Try as
        </p>
      </div>
      {/* The role buttons come in one after another once demo-config answers. */}
      <motion.div variants={stagger(0.05, 0.1)} {...enter} className="flex flex-col gap-2">
        {/* Row 1: Student, Student 2, Faculty keep their exact positions */}
        <div className="flex flex-wrap gap-2">
          {finalRow1.map(renderRoleButton)}
        </div>

        {/* Row 2: Manager and Admin centered in the same line */}
        {row2Roles.length > 0 && (
          <div className="flex flex-wrap justify-center items-center gap-2">
            {row2Roles.map(renderRoleButton)}
          </div>
        )}
      </motion.div>
    </div>
  );
}
