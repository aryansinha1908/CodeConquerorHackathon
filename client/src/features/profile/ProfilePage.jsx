import React from 'react';
import {
  AlertTriangle,
  Award,
  ClipboardCheck,
  FileSearch,
  IdCard,
  Layers,
  LogOut,
  Shield,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { Avatar } from '../../components/AccountFace';
import { StaggerItem, StaggerList } from '../../components/Motion';
import { Field, LinkButton } from '../manage/components/Bits';
import { useOrgUnits } from '../resources/api';
import { useNow } from '../resources/hooks';
import { useLogout } from '../auth/useLogout';
import { formatIstDate } from '../../lib/time';
import { useAuthStore } from '../../stores/auth';
import { accountView, roleLabel } from './account';
import { badgeStateView, myBadgeRows, useFreshUser, useMyBadges } from './api';

// /profile (frontend.md §6.2): who you are, your ID verification, your badges, the consoles your
// roles open, and Log out. The header's account menu links here. The user is re-read from
// GET /auth/me on opening, so a decision made since sign-in (an approved ID card, a new role) shows.

const cardClass =
  'rounded-xl border-2 border-[#1a1a1a] bg-white p-5 shadow-[4px_4px_0_#1a1a1a] font-mono text-[#1a1a1a]';

function Section({ icon: Icon, title, children, className = '' }) {
  return (
    <StaggerItem as="section" className={`${cardClass} ${className}`}>
      <h2 className="text-base font-black tracking-tight flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-[#a93226]" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </StaggerItem>
  );
}

function VerificationSection({ view }) {
  const { status, reason, badge } = view.verification;
  // A manager or admin books without a card (the guards treat staff as verified), so a missing,
  // pending or rejected card isn't something they must fix: say so instead of asking for an upload.
  const staff = view.isManager && status !== 'approved';
  const text = staff
    ? "Managers and admins can book without an ID card. You can still upload one on the verification page."
    : {
        approved: 'Your ID card is approved, so you can book resources and request badges.',
        pending: 'An admin is reviewing your ID card. Bookings unlock once it is approved.',
        rejected: 'Your ID card was rejected. Upload a clearer photo or scan to try again.',
        unsubmitted: 'Upload your institute ID card. An admin checks it before you can book.',
      }[status];
  const needsUpload = !staff && (status === 'unsubmitted' || status === 'rejected');
  return (
    <Section icon={IdCard} title="ID verification">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Badge variant={badge.variant} size="md">
          {badge.label}
        </Badge>
      </div>
      <p className="text-sm leading-relaxed">{text}</p>
      {reason && (
        <p className="mt-2 text-sm p-3 rounded-lg border-2 border-[#c0392b] bg-[#fff5f5]">
          <span className="font-bold">Reason: </span>
          {reason}
        </p>
      )}
      <LinkButton to="/verification" variant={needsUpload ? 'primary' : 'outline'} className="mt-4">
        <IdCard className="w-4 h-4" aria-hidden="true" />
        {needsUpload ? 'Upload your ID card' : 'View verification'}
      </LinkButton>
    </Section>
  );
}

function BadgesSection() {
  const badges = useMyBadges();
  const rows = myBadgeRows(badges.data);
  return (
    <Section icon={Award} title="My badges">
      {badges.isPending && <p className="text-sm text-[#1a1a1a]/75">Loading your badges…</p>}
      {badges.isError && !badges.data && (
        <ErrorState
          error={badges.error}
          title="Couldn't load your badges"
          onRetry={() => badges.refetch()}
          retrying={badges.isFetching}
        />
      )}
      {badges.isSuccess && rows.length === 0 && (
        <p className="text-sm text-[#1a1a1a]/75">
          No badges yet. Some resources need one: their page links to it.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const state = badgeStateView(row.state);
            const expires = row.state === 'active' && row.expiresAt ? formatIstDate(row.expiresAt, { year: true }) : null;
            return (
              <li
                key={row._id}
                className="flex items-start justify-between gap-3 p-2.5 rounded-lg border border-[#1a1a1a]/25 bg-[#f5f0e8]"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold break-words">{row.badge.name}</p>
                  <p className="text-[11px] text-[#1a1a1a]/75">
                    {row.badge.orgUnit?.name ?? 'Campus'}
                    {expires ? ` · valid until ${expires}` : ''}
                  </p>
                </div>
                <Badge variant={state.variant} size="sm" className="shrink-0">
                  {state.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      <LinkButton to="/badges" variant="outline" className="mt-4">
        <Award className="w-4 h-4" aria-hidden="true" />
        All badges
      </LinkButton>
    </Section>
  );
}

function ConsolesSection({ view }) {
  return (
    <Section icon={Layers} title="Consoles">
      <p className="text-sm leading-relaxed mb-3">Your roles open these.</p>
      <div className="flex flex-wrap gap-3">
        {view.isManager && (
          <LinkButton to="/manage" variant="forest">
            <Layers className="w-4 h-4" aria-hidden="true" />
            Manage console
          </LinkButton>
        )}
        {view.isAdmin && (
          <>
            <LinkButton to="/admin/verifications" variant="outline">
              <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
              ID verifications
            </LinkButton>
            <LinkButton to="/admin/audit" variant="outline">
              <FileSearch className="w-4 h-4" aria-hidden="true" />
              Audit log
            </LinkButton>
            <LinkButton to="/admin/incidents" variant="outline">
              <Shield className="w-4 h-4" aria-hidden="true" />
              All incidents
            </LinkButton>
          </>
        )}
      </div>
    </Section>
  );
}

/** The page body for a user view. Exported for the tests. */
export function Profile({ user, now, unitNames = new Map(), onLogout }) {
  const view = accountView(user);
  const managed = view.managedUnitIds.map((id) => unitNames.get(String(id))).filter(Boolean);
  // `now`: the page's ticking clock (useNow), so a suspension that ends while the page is open goes.
  const suspended = Boolean(view.suspendedUntil && now && new Date(view.suspendedUntil).getTime() > Number(now));

  return (
    <StaggerList as="div" className="space-y-6 font-mono text-[#1a1a1a]">
      <StaggerItem as="div" className={`${cardClass} flex flex-col sm:flex-row sm:items-center gap-4`}>
        <Avatar initials={view.initials} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest font-bold text-[#a93226]">Your profile</p>
          <h1 className="text-2xl font-black tracking-tight break-words">{view.name}</h1>
          <p className="text-sm text-[#1a1a1a]/75 break-all">{view.email}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Roles">
            {view.roles.map((role) => (
              <li key={role}>
                <Badge variant={role === 'admin' ? 'dark' : role === 'manager' ? 'forest' : 'outline'} size="sm">
                  {roleLabel(role)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
        {onLogout && (
          <Button type="button" variant="outline" size="md" className="self-start sm:self-center" onClick={onLogout}>
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Log out
          </Button>
        )}
      </StaggerItem>

      {(view.strikes > 0 || suspended) && (
        <StaggerItem
          as="div"
          role="note"
          className="rounded-xl border-2 border-[#c0392b] bg-[#fff5f5] p-4 flex items-start gap-3 shadow-[4px_4px_0_#1a1a1a]"
        >
          {suspended ? (
            <ShieldAlert className="w-5 h-5 text-[#c0392b] shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-[#c0392b] shrink-0" aria-hidden="true" />
          )}
          <div className="text-sm leading-relaxed">
            {suspended && (
              <p className="font-bold">
                Your account is suspended until {formatIstDate(view.suspendedUntil, { year: true })}
                {view.suspensionReason ? `: ${view.suspensionReason}` : '.'}
              </p>
            )}
            {view.strikes > 0 && (
              <p>
                You have {view.strikes} {view.strikes === 1 ? 'strike' : 'strikes'} from resolved incidents.
              </p>
            )}
          </div>
        </StaggerItem>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <StaggerList as="div" className="space-y-6">
          <Section icon={UserRound} title="Details">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email">{view.email || 'Not set'}</Field>
              <Field label="Member type">{view.memberType ?? 'Not set'}</Field>
              <Field label="Department">{view.department ?? 'Not set'}</Field>
              <Field label="Roles">{view.roles.map(roleLabel).join(', ')}</Field>
              {managed.length > 0 && (
                <Field label="Manages" className="sm:col-span-2">
                  {managed.join(', ')}
                </Field>
              )}
            </dl>
          </Section>
          <VerificationSection view={view} />
        </StaggerList>
        <StaggerList as="div" className="space-y-6" delay={0.05}>
          <BadgesSection />
          {view.isManager && <ConsolesSection view={view} />}
        </StaggerList>
      </div>
    </StaggerList>
  );
}

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const now = useNow();
  // Re-read the user; the page shows the stored one meanwhile, and keeps it if the read fails.
  useFreshUser();
  const units = useOrgUnits();
  const list = Array.isArray(units.data?.data) ? units.data.data : [];
  const unitNames = new Map(list.map((unit) => [String(unit._id), unit.name]));
  return <Profile user={user} now={now} unitNames={unitNames} onLogout={logout} />;
}
