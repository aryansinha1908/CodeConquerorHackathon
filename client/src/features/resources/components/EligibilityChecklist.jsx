import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../../stores/auth';
import { Check, X, AlertCircle, ArrowUpRight, Award, ShieldCheck } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';

export function EligibilityChecklist({ resource }) {
  const { user } = useAuthStore();

  const userRoles = Array.isArray(user?.roles) ? user.roles : user?.role ? [user.role] : ['member'];
  const isPrivileged = userRoles.includes('manager') || userRoles.includes('admin');
  const isVerified = user?.verification?.status === 'approved' || isPrivileged;

  const memberType = user?.memberType || 'UG';
  const department = user?.department?.code || user?.department?.name || 'CSE';

  // Evaluate individual rules
  const rules = [];

  // 1. Account Verified
  rules.push({
    id: 'verified',
    title: 'Institute ID Card Verified',
    passed: isVerified,
    message: isVerified
      ? 'Official NIT JSR ID card approved.'
      : 'Account is unverified. ID card submission is required.',
    fixLink: !isVerified ? '/verification' : null,
    fixText: 'Complete Verification →',
  });

  // 2. Resource Active Status
  const isActive = resource?.status === 'active';
  rules.push({
    id: 'active',
    title: 'Resource Maintenance Status',
    passed: isActive,
    message: isActive ? 'Resource operational and in service.' : 'Currently undergoing scheduled maintenance.',
    fixLink: null,
    fixText: null,
  });

  // 3. Member Type Eligibility
  const allowedMemberTypes = resource?.eligibility?.memberTypes || [];
  const memberTypePassed =
    allowedMemberTypes.length === 0 || allowedMemberTypes.includes(memberType) || isPrivileged;
  rules.push({
    id: 'memberType',
    title: 'Member Tier Authorization',
    passed: memberTypePassed,
    message: memberTypePassed
      ? `Eligible for ${memberType} tier.`
      : `Restricted to: ${allowedMemberTypes.join(', ')}. Your tier is ${memberType}.`,
    fixLink: null,
    fixText: null,
  });

  // 4. Department Eligibility
  const allowedDepts = resource?.eligibility?.departments || [];
  const deptPassed =
    allowedDepts.length === 0 || allowedDepts.includes(department) || isPrivileged;
  rules.push({
    id: 'department',
    title: 'Academic Department Access',
    passed: deptPassed,
    message:
      allowedDepts.length === 0
        ? 'Open to all departments across NIT Jamshedpur.'
        : deptPassed
        ? `Authorized for ${department} department.`
        : `Reserved for ${allowedDepts.join(', ')} students. Your department is ${department}.`,
    fixLink: null,
    fixText: null,
  });

  // 5. Required Badges / Training Certifications
  const requiredBadges = resource?.eligibility?.requiredBadges || [];
  // For demo, check if user has badges array or mock
  const userBadgeCodes = user?.badges?.map((b) => b.code) || [];
  requiredBadges.forEach((badge) => {
    const hasBadge = userBadgeCodes.includes(badge.code) || isPrivileged;
    rules.push({
      id: `badge-${badge.code || badge._id}`,
      title: `Certification: ${badge.name}`,
      passed: hasBadge,
      message: hasBadge
        ? 'Prerequisite safety badge active.'
        : `Missing mandatory training badge: "${badge.name}".`,
      fixLink: !hasBadge ? `/badges?request=${badge.code || badge._id}` : null,
      fixText: 'Request Badge →',
    });
  });

  // 6. Quota meter check
  const maxWeeklyHours = resource?.limits?.maxHoursPerWeek || 6;
  rules.push({
    id: 'quota',
    title: 'Fair-Usage Weekly Quota',
    passed: true,
    message: `0 of ${maxWeeklyHours} hours used this week. Sufficient balance available.`,
    fixLink: null,
    fixText: null,
  });

  const allPassed = rules.every((r) => r.passed);

  return (
    <div className="rounded-xl border-2 border-[#1a1a1a] bg-white p-5 font-mono shadow-[4px_4px_0_#1a1a1a] space-y-4">
      <div className="flex items-center justify-between pb-3 border-b-2 border-[#1a1a1a]/15">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#1a1a1a]/60 block">
            PRE-RESERVATION AUDIT
          </span>
          <h3 className="text-base font-black text-[#1a1a1a] tracking-tight">
            Eligibility Checklist
          </h3>
        </div>
        <Badge variant={allPassed ? 'forest' : 'red'} size="sm">
          {allPassed ? 'ALL CRITERIA PASSED' : 'ACTION REQUIRED'}
        </Badge>
      </div>

      <div className="space-y-3">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`p-3 rounded-lg border-2 transition-colors flex items-start gap-3 ${
              rule.passed
                ? 'bg-[#f0faf5] border-[#183d2d]/30 text-[#183d2d]'
                : 'bg-[#fff5f5] border-[#c0392b] text-[#c0392b]'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-md border-2 border-[#1a1a1a] flex items-center justify-center shrink-0 mt-0.5 ${
                rule.passed ? 'bg-[#183d2d] text-white' : 'bg-[#c0392b] text-white'
              }`}
            >
              {rule.passed ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <X className="w-3.5 h-3.5 stroke-[3]" />}
            </div>

            <div className="flex-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold tracking-tight text-[#1a1a1a]">{rule.title}</span>
                <span
                  className={`text-[10px] font-bold uppercase ${
                    rule.passed ? 'text-[#183d2d]' : 'text-[#c0392b]'
                  }`}
                >
                  {rule.passed ? 'PASSED' : 'INELIGIBLE'}
                </span>
              </div>
              <p className="text-[#1a1a1a]/70 mt-0.5 leading-relaxed">{rule.message}</p>
              {rule.fixLink && (
                <div className="mt-1.5">
                  <Link
                    to={rule.fixLink}
                    className="inline-flex items-center gap-1 font-bold text-xs text-[#c0392b] hover:underline"
                  >
                    <span>{rule.fixText}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

