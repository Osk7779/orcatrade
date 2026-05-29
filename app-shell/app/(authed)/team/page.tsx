'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  apiGet,
  apiPost,
  apiDelete,
  AuthError,
  type Org,
  type OrgDetail,
  type ScimStatus,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice } from '@/components/States';

function roleLabel(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TeamPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'empty' | 'ready' | 'error'>(
    'loading',
  );
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [newOrgName, setNewOrgName] = useState('');

  const loadDetail = useCallback(async (orgId: string) => {
    const d = await apiGet<OrgDetail>(`/orgs/${orgId}`);
    setDetail(d);
    setInviteRole(d.assignableRoles[d.assignableRoles.length - 1] || 'viewer');
    setState('ready');
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await apiGet<{ ok: boolean; orgs: Org[] }>('/orgs');
      if (!list.orgs || list.orgs.length === 0) {
        setState('empty');
        return;
      }
      await loadDetail(list.orgs[0].id);
    } catch (e) {
      if (e instanceof AuthError) setState('auth');
      else setState('error');
    }
  }, [loadDetail]);

  useEffect(() => {
    load();
  }, [load]);

  async function mutate(fn: () => Promise<unknown>) {
    if (!detail) return;
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await loadDetail(detail.org.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <LoadingNotice label="Loading team…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to manage your team." />;
  if (state === 'error') return <ErrorNotice />;

  if (state === 'empty') {
    return (
      <div className="max-w-[600px]">
        <PageHeader
          kicker="Team"
          title="Create your organisation."
          sub="You are not part of an organisation yet. Create one to invite colleagues and assign roles."
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            placeholder="Organisation name"
            className="flex-1 border-b border-[var(--color-navy-line)] bg-transparent px-1 py-3 text-[15px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
          />
          <button
            disabled={busy || newOrgName.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await apiPost('/orgs', { name: newOrgName.trim() });
                await load();
              } catch (e) {
                setErr(e instanceof Error ? e.message : 'Could not create');
              } finally {
                setBusy(false);
              }
            }}
            className="group inline-flex shrink-0 items-center gap-2 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Creating…' : 'Create'}
            {!busy && (
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                →
              </span>
            )}
          </button>
        </div>
        {err && (
          <p className="mt-4 font-serif text-[13.5px] italic text-[var(--color-critical)]">
            {err}
          </p>
        )}
      </div>
    );
  }

  if (!detail) return null;
  const { org, members, myRole, canManageMembers, assignableRoles } = detail;

  return (
    <div className="max-w-[820px]">
      <PageHeader
        kicker="Team"
        title={org.name}
        meta={
          <>
            {members.length} member{members.length === 1 ? '' : 's'} · your role:{' '}
            {roleLabel(myRole)}
            {org.planTier ? ` · ${org.planTier} plan` : ''}
          </>
        }
      />

      {err && (
        <div className="mb-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
          <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
        </div>
      )}

      <SectionHead kicker="Members" />
      <div className="border border-[var(--color-navy-line)]">
        {members.map((m, i) => {
          const isOwner = m.role === 'owner';
          return (
            <div
              key={m.email}
              className={`flex flex-col items-start gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6 ${
                i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
              }`}
            >
              <span className="truncate font-serif text-[14.5px] text-[var(--color-ivory)]">
                {m.email}
                {!m.joinedAt && (
                  <span className="ml-2 font-serif italic text-[var(--color-ivory-mute)]">
                    (invited)
                  </span>
                )}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {canManageMembers && !isOwner ? (
                  <>
                    <select
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        mutate(() =>
                          apiPost(`/orgs/${org.id}/role`, { email: m.email, role: e.target.value }),
                        )
                      }
                      className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] px-3 py-1.5 text-[12.5px] text-[var(--color-ivory)] focus:border-[var(--color-ivory-dim)] focus:outline-none [&>option]:bg-[var(--color-ink)] [&>option]:text-[var(--color-ivory)]"
                    >
                      {[...new Set([m.role, ...assignableRoles])].map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={busy}
                      onClick={() =>
                        mutate(() => apiPost(`/orgs/${org.id}/remove`, { email: m.email }))
                      }
                      className="px-3 py-1.5 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-critical)] transition-colors duration-300 hover:bg-[var(--color-critical)]/10"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                    {roleLabel(m.role)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canManageMembers && (
        <section className="mt-10 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-6 md:p-8">
          <SectionHead kicker="Invite a colleague" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              type="email"
              className="flex-1 border-b border-[var(--color-navy-line)] bg-transparent px-1 py-2.5 text-[14.5px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="border border-[var(--color-navy-line)] bg-transparent px-3 py-2.5 text-[14px] text-[var(--color-ivory)] focus:border-[var(--color-ivory-dim)] focus:outline-none [&>option]:bg-[var(--color-ink)] [&>option]:text-[var(--color-ivory)]"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <button
              disabled={busy || !inviteEmail.includes('@')}
              onClick={() =>
                mutate(async () => {
                  await apiPost(`/orgs/${org.id}/invite`, {
                    email: inviteEmail.trim(),
                    role: inviteRole,
                  });
                  setInviteEmail('');
                })
              }
              className="group inline-flex shrink-0 items-center gap-2 bg-[var(--color-ivory)] px-5 py-2.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Invite
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                →
              </span>
            </button>
          </div>
          <p className="mt-4 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
            Roles set what a colleague can do. Only owners and admins can manage members;
            ownership transfers separately.
          </p>
        </section>
      )}

      {myRole === 'owner' && <ScimPanel orgId={org.id} />}
    </div>
  );
}

function SectionHead({ kicker }: { kicker: string }) {
  return (
    <div className="mb-5 flex items-baseline gap-3 border-b border-[var(--color-navy-line)] pb-3">
      <span aria-hidden className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60">
        ❦
      </span>
      <span
        className="font-serif text-[1rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {kicker}
      </span>
    </div>
  );
}

function ScimPanel({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<ScimStatus | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    apiGet<ScimStatus>(`/orgs/${orgId}/scim`).then(setStatus).catch(() => {});
  }, [orgId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function mint() {
    setBusy(true);
    try {
      const r = await apiPost<ScimStatus>(`/orgs/${orgId}/scim`, {});
      if (r.token) setMinted(r.token);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    try {
      await apiDelete(`/orgs/${orgId}/scim`);
      setMinted(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-6 md:p-8">
      <SectionHead kicker="Automated provisioning (SCIM / SSO)" />
      <p className="max-w-[60ch] text-[13.5px] leading-[1.6] text-[var(--color-ivory-dim)]">
        Connect your identity provider (Okta, Entra ID) to auto-provision members and map
        IdP groups to roles.
      </p>

      <div className="mt-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
          {status?.configured ? (
            <>
              SCIM token active
              {status.lastUsedAt
                ? ` · last used ${String(status.lastUsedAt).slice(0, 10)}`
                : ' · not yet used'}
            </>
          ) : (
            'No SCIM token yet'
          )}
        </span>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={mint}
            className="inline-flex items-center gap-2 bg-[var(--color-ivory)] px-4 py-2 text-[12px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status?.configured ? 'Rotate token' : 'Generate token'}
          </button>
          {status?.configured && (
            <button
              disabled={busy}
              onClick={revoke}
              className="px-3 py-2 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-critical)] transition-colors duration-300 hover:bg-[var(--color-critical)]/10"
            >
              Revoke
            </button>
          )}
        </div>
      </div>

      {minted && (
        <div className="mt-5 border border-[var(--color-ivory-dim)]/40 bg-[var(--color-navy)]/30 p-4">
          <div className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
            Copy now — shown once
          </div>
          <code className="mt-2 block break-all font-mono text-[12.5px] font-medium tracking-tight text-[var(--color-ivory)]">
            {minted}
          </code>
        </div>
      )}

      {status?.endpoint && (
        <div className="mt-4 font-mono text-[11px] tracking-tight text-[var(--color-ivory-mute)]">
          SCIM base URL: {status.endpoint} · Bearer auth
        </div>
      )}
    </section>
  );
}
