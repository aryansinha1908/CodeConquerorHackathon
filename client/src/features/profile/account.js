import { memberTypeLabel } from '../verification/api';

// What the header, the account menu and /profile show about the signed-in user (the server's user
// view, stores/auth.js). Pure, so the three read the same roles and verification wording.

const VERIFICATION = {
  approved: { label: 'Verified', variant: 'forest' },
  pending: { label: 'Pending review', variant: 'amber' },
  rejected: { label: 'Rejected', variant: 'red' },
  unsubmitted: { label: 'Not verified', variant: 'red' },
};

/** "Ananya Rao" → "AR"; one word → its first two letters; nothing → "?". */
export function initialsOf(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

export function accountView(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : user?.role ? [user.role] : ['member'];
  const isAdmin = roles.includes('admin');
  const isManager = isAdmin || roles.includes('manager');
  const status = VERIFICATION[user?.verification?.status] ? user.verification.status : 'unsubmitted';
  // Staff accounts work without an ID card (the guards treat a manager or admin as verified).
  const verified = status === 'approved' || isManager;
  const name = user?.name || user?.email?.split('@')[0] || 'User';
  // Ids (api.md "User view"); /profile names them from the org-unit list.
  const managedUnitIds = Array.isArray(user?.managedOrgUnits)
    ? user.managedOrgUnits.map((unit) => (unit && typeof unit === 'object' ? unit._id : unit)).filter(Boolean)
    : [];
  return {
    name,
    initials: initialsOf(name),
    email: user?.email ?? '',
    roles,
    isManager,
    isAdmin,
    verified,
    verification: {
      status,
      ...VERIFICATION[status],
      reason: status === 'rejected' ? user?.verification?.reason || null : null,
      // The menu's badge: a manager or admin with no approved card is staff, not "Not verified".
      badge:
        isManager && status !== 'approved'
          ? { label: 'Staff', variant: 'neutral' }
          : { label: VERIFICATION[status].label, variant: VERIFICATION[status].variant },
    },
    memberType: user?.memberType ? memberTypeLabel(user.memberType) : null,
    department: user?.department?.name ?? null,
    // The line under the name in the header: the department, else the member type, else the role.
    subtitle: user?.department?.name || (user?.memberType ? memberTypeLabel(user.memberType) : null) || roles[0],
    managedUnitIds,
    strikes: Number(user?.strikes) || 0,
    suspendedUntil: user?.suspendedUntil ?? null,
    suspensionReason: user?.suspensionReason ?? null,
  };
}

/** The role's display name for badges: "admin" → "Admin". */
export function roleLabel(role) {
  const text = String(role ?? '');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}
