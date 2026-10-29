import React from 'react';
import { CheckCircle2, Clock, Eye, XCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import {
  departmentFromHints,
  formatEmailHints,
  memberTypeFromHints,
  memberTypeLabel,
} from '../../verification/api';
import { formatIstDateTime } from '../../../lib/time';

// Never colour alone (frontend.md §1, principle 2): every status has an icon and a label too. Gold,
// not amber, for pending: white on amber is under the 4.5:1 contrast of frontend.md §10.3.
const QUEUE_STATUS_BADGES = {
  pending: { variant: 'gold', icon: Clock, label: 'Pending' },
  approved: { variant: 'forest', icon: CheckCircle2, label: 'Approved' },
  rejected: { variant: 'red', icon: XCircle, label: 'Rejected' },
};

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/70">{label}</dt>
      <dd className="text-xs font-bold text-[#1a1a1a] break-words">{children}</dd>
    </div>
  );
}

// Where the email hints disagree with what the user chose: worth a second look at the card.
function Differs({ children }) {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-[#a04000]">
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * One row of GET /admin/verifications: { user: { _id, name, email, emailHints, memberType,
 * department }, status, submittedAt, reviewedAt, reason, hasIdCard }. units: GET /org-units data.
 */
export function QueueItem({ item, units, isSelf, onView, onDecide }) {
  const { user } = item;
  const badge = QUEUE_STATUS_BADGES[item.status] ?? QUEUE_STATUS_BADGES.pending;
  const hints = formatEmailHints(user.emailHints);
  const hintedType = memberTypeFromHints(user.emailHints);
  // Only a branch that resolves to a real department is a hint (architecture.md §8): "cese" (a PG
  // specialisation) or "ca" isn't a unit code, so it can't disagree with anything. No units, no flag.
  const hintedDept = departmentFromHints(user.emailHints, units)?.code ?? null;
  const typeDiffers = Boolean(hintedType && user.memberType && hintedType !== user.memberType);
  const deptDiffers = Boolean(
    hintedDept && user.department?.code && hintedDept !== user.department.code
  );
  const submitted = formatIstDateTime(item.submittedAt);
  const reviewed = formatIstDateTime(item.reviewedAt);
  const canDecide = item.status === 'pending' && !isSelf;
  const noCardId = `queue-${user._id}-no-card`;

  return (
    <li>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-black tracking-tight text-[#1a1a1a] break-words">
              {user.name}
            </h3>
            <p className="text-xs text-[#1a1a1a]/70 break-all">{user.email}</p>
          </div>
          <Badge variant={badge.variant} icon={badge.icon} className="self-start shrink-0">
            {badge.label}
          </Badge>
        </div>

        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">
          <Field label="Email hints">{hints ?? 'None'}</Field>
          <Field label="Member type">
            {memberTypeLabel(user.memberType)}
            {typeDiffers && <Differs>Email says {hintedType.toUpperCase()}</Differs>}
          </Field>
          <Field label="Department">
            {user.department
              ? `${user.department.name}${user.department.code ? ` (${user.department.code.toUpperCase()})` : ''}`
              : 'Not set'}
            {deptDiffers && <Differs>Email says {hintedDept.toUpperCase()}</Differs>}
          </Field>
          <Field label="Submitted">{submitted ?? 'Not recorded'}</Field>
          {reviewed && <Field label="Reviewed">{reviewed}</Field>}
          {item.reason && (
            <div className="sm:col-span-2 lg:col-span-3 min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-[#1a1a1a]/70">Reason</dt>
              <dd className="text-xs text-[#1a1a1a] break-words">“{item.reason}”</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 pt-3 border-t-2 border-[#1a1a1a]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-white min-h-[36px]"
              disabled={!item.hasIdCard}
              aria-describedby={item.hasIdCard ? undefined : noCardId}
              onClick={() => onView(item)}
            >
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              View ID
            </Button>
            {!item.hasIdCard && (
              <span id={noCardId} className="text-[11px] text-[#1a1a1a]/70">
                {item.status === 'pending'
                  ? 'No ID image on file'
                  : 'Image deleted after the decision'}
              </span>
            )}
          </div>
          {item.status === 'pending' &&
            (canDecide ? (
              <div className="flex gap-2">
                <Button
                  variant="forest"
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => onDecide(item, 'approve')}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="min-h-[36px]"
                  onClick={() => onDecide(item, 'reject')}
                >
                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  Reject
                </Button>
              </div>
            ) : (
              <span className="text-[11px] font-bold text-[#1a1a1a]/70">
                Another administrator must review your own verification.
              </span>
            ))}
        </div>
      </Card>
    </li>
  );
}
