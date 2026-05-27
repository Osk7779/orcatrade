'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type Org, type OrgDetail } from '@/lib/api';

function roleLabel(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TeamPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'empty' | 'ready' | 'error'>('loading');
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
      if (!list.orgs || list.orgs.length === 0) { setState('empty'); return; }
      await loadDetail(list.orgs[0].id);
    } catch (e) {
      if (e instanceof AuthError) setState('auth');
      else setState('error');
    }
  }, [loadDetail]);

  useEffect(() => { load(); }, [load]);

  async function mutate(fn: () => Promise<unknown>) {
    if (!detail) return;
    setBusy(true); setErr(null);
    try {
      await fn();
      await loadDetail(detail.org.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading team…</p>;
  if (state === 'auth') return (
    <div className="max-w-md"><h1 className="text-3xl mb-3">Sign in to manage your team</h1>
      <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a></div>
  );
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load your team.</p>;

  if (state === 'empty') {
    return (
      <div className="max-w-md">
        <h1 className="text-4xl mb-2">Team</h1>
        <p className="text-white/60 text-sm mb-6">You’re not part of an organisation yet. Create one to invite colleagues and assign roles.</p>
        <div className="flex gap-2">
          <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder="Organisation name"
            className="flex-1 bg-transparent border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm text-white" />
          <button
            disabled={busy || newOrgName.trim().length < 2}
            onClick={async () => {
              setBusy(true); setErr(null);
              try { await apiPost('/orgs', { name: newOrgName.trim() }); await load(); }
              catch (e) { setErr(e instanceof Error ? e.message : 'Could not create'); }
              finally { setBusy(false); }
            }}
            className="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm disabled:opacity-40"
          >Create</button>
        </div>
        {err && <p className="text-red-400 text-xs mt-3">{err}</p>}
      </div>
    );
  }

  if (!detail) return null;
  const { org, members, myRole, canManageMembers, assignableRoles } = detail;

  return (
    <div className="max-w-2xl">
      <h1 className="text-4xl mb-1">{org.name}</h1>
      <div className="font-mono text-xs text-white/45 mb-8">
        {members.length} member{members.length === 1 ? '' : 's'} · your role: {roleLabel(myRole)}
        {org.planTier ? ` · ${org.planTier} plan` : ''}
      </div>

      {err && <p className="text-red-400 text-sm mb-4">{err}</p>}

      <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)] mb-6">
        {members.map((m) => {
          const isOwner = m.role === 'owner';
          return (
            <div key={m.email} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="text-white/85 truncate">{m.email}{m.joinedAt ? '' : ' (invited)'}</span>
              <div className="flex items-center gap-2 shrink-0">
                {canManageMembers && !isOwner ? (
                  <>
                    <select
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => mutate(() => apiPost(`/orgs/${org.id}/role`, { email: m.email, role: e.target.value }))}
                      className="bg-[var(--color-ink)] border border-[var(--color-line)] text-white/85 text-xs px-2 py-1 rounded-sm"
                    >
                      {/* Keep the current role selectable even if it's the legacy 'member'. */}
                      {[...new Set([m.role, ...assignableRoles])].map((r) => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                    </select>
                    <button
                      disabled={busy}
                      onClick={() => mutate(() => apiPost(`/orgs/${org.id}/remove`, { email: m.email }))}
                      className="text-xs text-red-300/80 hover:text-red-300 px-2 py-1"
                    >Remove</button>
                  </>
                ) : (
                  <span className="font-mono text-xs text-white/55">{roleLabel(m.role)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canManageMembers && (
        <section className="border border-[var(--color-line)] px-5 py-5">
          <div className="text-[0.7rem] uppercase tracking-wider text-white/50 mb-3">Invite a colleague</div>
          <div className="flex gap-2">
            <input
              value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.com" type="email"
              className="flex-1 bg-transparent border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm text-white"
            />
            <select
              value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
              className="bg-[var(--color-ink)] border border-[var(--color-line)] text-white/85 text-sm px-2 rounded-sm"
            >
              {assignableRoles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
            <button
              disabled={busy || !inviteEmail.includes('@')}
              onClick={() => mutate(async () => {
                await apiPost(`/orgs/${org.id}/invite`, { email: inviteEmail.trim(), role: inviteRole });
                setInviteEmail('');
              })}
              className="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm disabled:opacity-40"
            >Invite</button>
          </div>
          <p className="text-white/40 text-xs mt-3">
            Roles set what a colleague can do. Only owners and admins can manage members; ownership transfers separately.
          </p>
        </section>
      )}
    </div>
  );
}
