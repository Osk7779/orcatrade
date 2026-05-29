'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type Org } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice, EmptyState } from '@/components/States';

function roleLabel(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface OrgWithRole extends Org {
  myRole?: string;
  memberCount?: number;
  current?: boolean;
}

export default function OrgsPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [orgs, setOrgs] = useState<OrgWithRole[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const d = await apiGet<{ ok: boolean; orgs: OrgWithRole[] }>('/orgs');
      setOrgs(d.orgs || []);
      setState('ready');
    } catch (e) {
      setState(e instanceof AuthError ? 'auth' : 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (newName.trim().length < 2 || busy) return;
    setBusy(true);
    setErr('');
    try {
      await apiPost('/orgs', { name: newName.trim() });
      setNewName('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create organisation');
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(orgId: string) {
    setBusy(true);
    setErr('');
    try {
      await apiPost('/orgs/switch', { id: orgId });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not switch organisation');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <LoadingNotice label="Loading your organisations…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to see your organisations." />;
  if (state === 'error') return <ErrorNotice />;

  return (
    <div className="max-w-[760px]">
      <PageHeader
        kicker="Account · organisations"
        title="Your organisations."
        sub="Every organisation you belong to. The current organisation drives the cockpit — your plans, alerts, deadlines and team members are scoped to it."
      />

      {err && (
        <div className="mb-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
          <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
        </div>
      )}

      {orgs.length === 0 ? (
        <EmptyState
          body="You are not a member of any organisation yet."
          ctaLabel="Open Team to create one"
          ctaHref="/team"
        />
      ) : (
        <div className="border border-[var(--color-navy-line)]">
          {orgs.map((o, i) => (
            <article
              key={o.id}
              className={`flex flex-col gap-3 px-5 py-4 transition-colors duration-500 md:flex-row md:items-center md:justify-between md:gap-6 md:px-6 md:py-5 ${
                i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
              } ${o.current ? 'bg-[var(--color-positive)]/[0.04]' : 'hover:bg-[var(--color-navy-soft)]'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span
                    className="truncate font-serif text-[1.05rem] leading-tight text-[var(--color-ivory)]"
                    style={{
                      fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                      fontWeight: 550,
                    }}
                  >
                    {o.name}
                  </span>
                  {o.current && (
                    <span className="inline-flex items-center gap-1 bg-[var(--color-positive)]/12 px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tabular-nums tracking-tight text-[var(--color-positive)]">
                      current
                    </span>
                  )}
                </div>
                <div className="mt-1.5 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                  {typeof o.memberCount === 'number'
                    ? `${o.memberCount} member${o.memberCount === 1 ? '' : 's'}`
                    : ''}
                  {o.myRole ? `${typeof o.memberCount === 'number' ? ' · ' : ''}${roleLabel(o.myRole)}` : ''}
                  {o.planTier ? ` · ${o.planTier} plan` : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!o.current && (
                  <button
                    type="button"
                    onClick={() => switchTo(o.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-4 py-2 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory)] transition-all duration-300 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Switch to this
                  </button>
                )}
                <Link
                  href="/team"
                  className="inline-flex items-center gap-1.5 font-serif text-[12.5px] italic text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
                >
                  Open
                  <span aria-hidden>→</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Create new */}
      <section className="mt-10 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-6 md:p-8">
        <div className="mb-5 flex items-baseline gap-3">
          <span aria-hidden className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60">
            ❦
          </span>
          <span
            className="font-serif text-[1rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
          >
            Create a new organisation
          </span>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Organisation name"
            className="flex-1 border-b border-[var(--color-navy-line)] bg-transparent px-1 py-2.5 text-[14.5px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
          />
          <button
            type="button"
            onClick={create}
            disabled={busy || newName.trim().length < 2}
            className="group inline-flex shrink-0 items-center gap-2 bg-[var(--color-ivory)] px-5 py-2.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
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
        <p className="mt-4 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
          You become the owner. Invite colleagues from the Team page once it is created.
        </p>
      </section>
    </div>
  );
}
