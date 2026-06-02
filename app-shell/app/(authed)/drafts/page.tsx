'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type DocType, type Draft, type DraftWithHtml, type SavedPlan, type DraftStatus } from '@/lib/api';

function StatusPill({ status }: { status: DraftStatus }) {
  const colour = status === 'approved'
    ? 'text-emerald-300 bg-emerald-500/10'
    : status === 'rejected'
      ? 'text-red-300 bg-red-500/10'
      : 'text-amber-300 bg-amber-500/10';
  const label = status === 'pending_approval' ? 'pending approval' : status;
  return <span className={`font-mono text-[0.66rem] uppercase tracking-wider px-2 py-0.5 rounded-sm ${colour}`}>{label}</span>;
}

export default function DraftsPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [types, setTypes] = useState<DocType[]>([]);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const [picked, setPicked] = useState<{ type?: string; planId?: string; label: string }>({ label: '' });
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
    setBusy(true); setErr(null); setCurrent(null);
    try {
      const r = await apiPost<DraftWithHtml>('/documents', {
        action: 'save', type: picked.type, fromPlanId: picked.planId, label: picked.label || undefined,
      });
      setCurrent({ draft: r.draft, html: r.html });
      setDecisionNotes('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not draft.');
    } finally { setBusy(false); }
  }

  async function decide(decision: 'approve' | 'reject') {
    if (!current || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<DraftWithHtml>('/documents', {
        action: decision, id: current.draft.id, notes: decisionNotes || undefined,
      });
      setCurrent((cur) => (cur ? { ...cur, draft: r.draft } : cur));
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Decision failed.');
    } finally { setBusy(false); }
  }

  async function openDraft(id: string) {
    setBusy(true); setErr(null);
    try {
      const r = await apiGet<DraftWithHtml>(`/documents?action=get&id=${encodeURIComponent(id)}`);
      setCurrent({ draft: r.draft, html: r.html });
      setDecisionNotes(r.draft.decisionNotes || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load draft.');
    } finally { setBusy(false); }
  }

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading drafts…</p>;
  if (state === 'auth') return (
    <div className="max-w-md"><h1 className="text-3xl mb-3">Sign in to draft documents</h1>
      <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a></div>
  );
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load the drafts tool.</p>;

  return (
    <div className="max-w-4xl">
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Drafts</div>
      <h1 className="text-4xl mb-2">Draft &amp; approve</h1>
      <p className="text-white/60 text-sm mb-8">
        Pre-fill an artifact from one of your saved plans, preview it, and click approve or reject. The platform never sends, files, or wire-transfers on your behalf — this records the human decision.
      </p>

      {err && <p className="text-red-400 text-sm mb-4">{err}</p>}

      <section className="border border-[var(--color-line)] px-5 py-5 mb-6">
        <div className="text-[0.7rem] uppercase tracking-wider text-white/50 mb-3">New draft</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="block text-xs text-white/55 mb-1">Document type</span>
            <select value={picked.type || ''} onChange={(e) => setPicked((c) => ({ ...c, type: e.target.value || undefined }))}
              className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] text-white/85 text-sm px-3 py-2 rounded-sm">
              <option value="">— select a type —</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {picked.type && (
              <span className="block mt-1.5 text-[0.7rem] text-white/45">{types.find((t) => t.id === picked.type)?.description}</span>
            )}
          </label>
          <label className="block">
            <span className="block text-xs text-white/55 mb-1">From saved plan</span>
            <select value={picked.planId || ''} onChange={(e) => setPicked((c) => ({ ...c, planId: e.target.value || undefined }))}
              className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] text-white/85 text-sm px-3 py-2 rounded-sm">
              <option value="">— select a plan —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || p.inputs?.productCategory || p.id} ({p.inputs?.originCountry || '?'}→{p.inputs?.destinationCountry || '?'})
                </option>
              ))}
            </select>
            {!plans.length && (
              <span className="block mt-1.5 text-[0.7rem] text-white/45">No saved plans yet — <a href="/start/" className="underline">build one</a> first.</span>
            )}
          </label>
        </div>
        <div className="flex gap-2">
          <input value={picked.label} onChange={(e) => setPicked((c) => ({ ...c, label: e.target.value }))}
            placeholder="Label (optional, e.g. 'CI for Q3 cotton order')"
            className="flex-1 bg-transparent border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm text-white" />
          <button disabled={busy || !picked.type || !picked.planId} onClick={draftIt}
            className="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm disabled:opacity-40">
            Draft
          </button>
        </div>
      </section>

      {current && (
        <section className="border border-[var(--color-line)] px-5 py-5 mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[0.7rem] uppercase tracking-wider text-white/50">Preview</span>
              <span className="text-white/85 text-sm truncate">{current.draft.label || current.draft.type}</span>
              <StatusPill status={current.draft.status} />
            </div>
            <div className="font-mono text-[0.65rem] text-white/35">{current.draft.id}</div>
          </div>
          <iframe
            title="document preview"
            srcDoc={current.html}
            className="w-full h-[60vh] border border-[var(--color-line)] bg-white"
          />
          {current.draft.status === 'pending_approval' ? (
            <div className="mt-3">
              <textarea
                value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)}
                rows={2} placeholder="Decision notes (optional)"
                className="w-full bg-transparent border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm text-white"
              />
              <div className="flex gap-2 mt-2">
                <button disabled={busy} onClick={() => decide('approve')}
                  className="px-4 py-2 text-sm font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 rounded-sm hover:bg-emerald-500/30 disabled:opacity-40">
                  Approve
                </button>
                <button disabled={busy} onClick={() => decide('reject')}
                  className="px-4 py-2 text-sm font-medium bg-red-500/15 text-red-200 border border-red-500/40 rounded-sm hover:bg-red-500/25 disabled:opacity-40">
                  Reject
                </button>
                <span className="self-center text-white/40 text-xs">The click is the record — the human still does the send / file / wire.</span>
              </div>
            </div>
          ) : (
            <p className="text-white/55 text-xs mt-3">
              Decision: <b>{current.draft.status}</b>
              {current.draft.decidedAt ? ` · ${String(current.draft.decidedAt).slice(0, 10)}` : ''}
              {current.draft.decisionNotes ? ` · “${current.draft.decisionNotes}”` : ''}
            </p>
          )}
        </section>
      )}

      <h2 className="text-xl mb-3">Recent drafts</h2>
      {!drafts.length ? (
        <p className="text-white/55 text-sm">No drafts yet.</p>
      ) : (
        <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
          {drafts.map((d) => (
            <button key={d.id} onClick={() => openDraft(d.id)}
              className="w-full text-left flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-white/[0.02]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-ivory truncate">{d.label || d.type}</span>
                  <StatusPill status={d.status} />
                </div>
                <div className="font-mono text-[0.65rem] text-white/35 mt-0.5">{d.type} · {String(d.createdAt).slice(0, 10)}</div>
              </div>
              <span className="font-mono text-[0.65rem] text-white/30 shrink-0">{d.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
