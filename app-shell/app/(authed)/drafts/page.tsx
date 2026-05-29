'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  apiGet,
  apiPost,
  AuthError,
  type DocType,
  type Draft,
  type DraftWithHtml,
  type SavedPlan,
  type DraftStatus,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice } from '@/components/States';

function StatusPill({ status }: { status: DraftStatus }) {
  const tone =
    status === 'approved'
      ? 'bg-[var(--color-positive)]/12 text-[var(--color-positive)]'
      : status === 'rejected'
      ? 'bg-[var(--color-critical)]/12 text-[var(--color-critical)]'
      : 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]';
  const label = status === 'pending_approval' ? 'pending approval' : status;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tabular-nums tracking-tight ${tone}`}
    >
      {label}
    </span>
  );
}

export default function DraftsPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [types, setTypes] = useState<DocType[]>([]);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [picked, setPicked] = useState<{ type?: string; planId?: string; label: string }>({
    label: '',
  });
  const [current, setCurrent] = useState<{ draft: Draft; html: string } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await apiGet<{ ok: boolean; drafts: Draft[] }>('/documents?action=list-mine');
    setDrafts(list.drafts || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [t, p, l] = await Promise.all([
          apiGet<{ types: DocType[] }>('/documents'),
          apiGet<{ ok: boolean; plans: SavedPlan[] }>('/plans'),
          apiGet<{ ok: boolean; drafts: Draft[] }>('/documents?action=list-mine'),
        ]);
        setTypes(t.types || []);
        setPlans(p.plans || []);
        setDrafts(l.drafts || []);
        if (p.plans?.length) setPicked((c) => ({ ...c, planId: p.plans[0].id }));
        setState('ready');
      } catch (e) {
        setState(e instanceof AuthError ? 'auth' : 'error');
      }
    })();
  }, []);

  async function draftIt() {
    if (!picked.type || !picked.planId || busy) return;
    setBusy(true);
    setErr(null);
    setCurrent(null);
    try {
      const r = await apiPost<DraftWithHtml>('/documents', {
        action: 'save',
        type: picked.type,
        fromPlanId: picked.planId,
        label: picked.label || undefined,
      });
      setCurrent({ draft: r.draft, html: r.html });
      setDecisionNotes('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not draft.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!current || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiPost<DraftWithHtml>('/documents', {
        action: decision,
        id: current.draft.id,
        notes: decisionNotes || undefined,
      });
      setCurrent((cur) => (cur ? { ...cur, draft: r.draft } : cur));
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }

  async function openDraft(id: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiGet<DraftWithHtml>(
        `/documents?action=get&id=${encodeURIComponent(id)}`,
      );
      setCurrent({ draft: r.draft, html: r.html });
      setDecisionNotes(r.draft.decisionNotes || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load draft.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <LoadingNotice label="Loading drafts…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to draft documents." />;
  if (state === 'error') return <ErrorNotice label="Could not load the drafts tool." />;

  return (
    <div className="max-w-[1000px]">
      <PageHeader
        kicker="Drafts"
        title="Draft and approve."
        sub="Pre-fill an artifact from one of your saved plans, preview it, and click approve or reject. The platform never sends, files, or wire-transfers on your behalf — this records the human decision."
      />

      {err && (
        <div className="mb-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
          <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
        </div>
      )}

      <section className="border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-6 md:p-8">
        <SectionHead kicker="New draft" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="block font-serif text-[13px] italic text-[var(--color-ivory-dim)] mb-2">
              Document type
            </span>
            <select
              value={picked.type || ''}
              onChange={(e) => setPicked((c) => ({ ...c, type: e.target.value || undefined }))}
              className="w-full border-b border-[var(--color-navy-line)] bg-transparent py-2.5 text-[14px] text-[var(--color-ivory)] focus:border-[var(--color-ivory-dim)] focus:outline-none [&>option]:bg-[var(--color-ink)]"
            >
              <option value="">— select a type —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {picked.type && (
              <span className="mt-2 block font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
                {types.find((t) => t.id === picked.type)?.description}
              </span>
            )}
          </label>
          <label className="block">
            <span className="block font-serif text-[13px] italic text-[var(--color-ivory-dim)] mb-2">
              From saved plan
            </span>
            <select
              value={picked.planId || ''}
              onChange={(e) =>
                setPicked((c) => ({ ...c, planId: e.target.value || undefined }))
              }
              className="w-full border-b border-[var(--color-navy-line)] bg-transparent py-2.5 text-[14px] text-[var(--color-ivory)] focus:border-[var(--color-ivory-dim)] focus:outline-none [&>option]:bg-[var(--color-ink)]"
            >
              <option value="">— select a plan —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || p.inputs?.productCategory || p.id} (
                  {p.inputs?.originCountry || '?'}→{p.inputs?.destinationCountry || '?'})
                </option>
              ))}
            </select>
            {!plans.length && (
              <span className="mt-2 block font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
                No saved plans yet —{' '}
                <a href="/start/" className="underline-offset-4 hover:text-[var(--color-ivory)] hover:underline">
                  build one
                </a>{' '}
                first.
              </span>
            )}
          </label>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            value={picked.label}
            onChange={(e) => setPicked((c) => ({ ...c, label: e.target.value }))}
            placeholder="Label (optional, e.g. CI for Q3 cotton order)"
            className="flex-1 border-b border-[var(--color-navy-line)] bg-transparent px-1 py-2.5 text-[14px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
          />
          <button
            disabled={busy || !picked.type || !picked.planId}
            onClick={draftIt}
            className="group inline-flex shrink-0 items-center gap-2 bg-[var(--color-ivory)] px-5 py-2.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Drafting…' : 'Draft'}
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
      </section>

      {current && (
        <section className="mt-8 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-6 md:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                Preview
              </span>
              <span className="truncate font-serif text-[14.5px] text-[var(--color-ivory)]">
                {current.draft.label || current.draft.type}
              </span>
              <StatusPill status={current.draft.status} />
            </div>
            <div className="font-mono text-[11px] tracking-tight text-[var(--color-ivory-mute)]">
              {current.draft.id}
            </div>
          </div>

          <iframe
            title="document preview"
            srcDoc={current.html}
            className="mt-5 h-[60vh] w-full border border-[var(--color-navy-line)] bg-white"
          />

          {current.draft.status === 'pending_approval' ? (
            <div className="mt-5">
              <textarea
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                rows={2}
                placeholder="Decision notes (optional)"
                className="w-full resize-none border border-[var(--color-navy-line)] bg-transparent p-3 text-[14px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  disabled={busy}
                  onClick={() => decide('approve')}
                  className="inline-flex items-center gap-2 border border-[var(--color-positive)]/40 bg-[var(--color-positive)]/10 px-5 py-2.5 text-[12.5px] font-medium text-[var(--color-positive)] transition-colors duration-300 hover:bg-[var(--color-positive)]/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Approve
                </button>
                <button
                  disabled={busy}
                  onClick={() => decide('reject')}
                  className="inline-flex items-center gap-2 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/10 px-5 py-2.5 text-[12.5px] font-medium text-[var(--color-critical)] transition-colors duration-300 hover:bg-[var(--color-critical)]/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reject
                </button>
                <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                  The click is the record — the human still does the send / file / wire.
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-5 font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
              Decision: <b className="not-italic">{current.draft.status}</b>
              {current.draft.decidedAt
                ? ` · ${String(current.draft.decidedAt).slice(0, 10)}`
                : ''}
              {current.draft.decisionNotes
                ? ` · “${current.draft.decisionNotes}”`
                : ''}
            </p>
          )}
        </section>
      )}

      <section className="mt-12">
        <SectionHead kicker="Recent drafts" />
        {!drafts.length ? (
          <p className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
            No drafts yet.
          </p>
        ) : (
          <div className="border border-[var(--color-navy-line)]">
            {drafts.map((d, i) => (
              <button
                key={d.id}
                onClick={() => openDraft(d.id)}
                className={`group flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-500 hover:bg-[var(--color-navy-soft)] md:px-6 ${
                  i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-serif text-[14.5px] text-[var(--color-ivory)]">
                      {d.label || d.type}
                    </span>
                    <StatusPill status={d.status} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                    {d.type} · {String(d.createdAt).slice(0, 10)}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10.5px] tracking-tight text-[var(--color-ivory-mute)]">
                  {d.id}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHead({ kicker }: { kicker: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3 border-b border-[var(--color-navy-line)] pb-3">
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
