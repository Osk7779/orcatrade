'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, type AuditResult, type AuditFinding, type SavedPlan, type Severity } from '@/lib/api';

const DOC_TYPES = [
  { id: 'commercial_invoice', label: 'Commercial invoice' },
  { id: 'proforma_invoice', label: 'Proforma invoice' },
  { id: 'packing_list', label: 'Packing list' },
  { id: 'certificate_of_origin', label: 'Certificate of origin' },
];

const VERDICT: Record<string, { label: string; cls: string }> = {
  blocking_issues: { label: 'Blocking issues', cls: 'text-red-400 border-l-red-500' },
  review_needed: { label: 'Review needed', cls: 'text-amber-400 border-l-amber-500' },
  minor_issues: { label: 'Minor issues', cls: 'text-white/70 border-l-white/30' },
  consistent: { label: 'Consistent', cls: 'text-emerald-300 border-l-emerald-500' },
};

const SEV_TEXT: Record<Severity, string> = {
  critical: 'text-red-400', high: 'text-amber-400', medium: 'text-white/70', low: 'text-white/55', info: 'text-sky-400',
};

export default function DocumentsPage() {
  const [docType, setDocType] = useState('commercial_invoice');
  const [text, setText] = useState('');
  const [planId, setPlanId] = useState('');
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiGet<{ plans: SavedPlan[] }>('/plans').then((d) => setPlans(d.plans || [])).catch(() => {});
  }, []);

  async function audit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const body: Record<string, unknown> = { action: 'audit', documentType: docType, text: text.trim() };
      if (planId) body.fromPlanId = planId;
      setResult(await apiPost<AuditResult>('/documents', body));
    } catch {
      setErr('Audit failed. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  const v = result?.verdict ? VERDICT[result.verdict] : null;

  return (
    <div className="max-w-3xl">
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Documents</div>
      <h1 className="text-4xl mb-2">Document audit</h1>
      <p className="text-white/60 text-sm mb-7 leading-relaxed">
        Paste a commercial invoice, packing list or certificate of origin. We extract the fields and check them —
        optionally against one of your saved plans — for HS / origin / value mismatches, arithmetic errors, undervaluation
        risk, missing preference evidence and CBAM/EUDR documentation.
      </p>

      <form onSubmit={audit} className="flex flex-col gap-3 mb-6">
        <div className="flex gap-3 flex-wrap">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="bg-white/[0.04] border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm">
            {DOC_TYPES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="bg-white/[0.04] border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm">
            <option value="">Compare against: (no plan)</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
          </select>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={'Paste the document text here…\n\ne.g.\nCommercial Invoice\nOrigin: China\nHS code: 8712 00 30\nTotal: EUR 40,000'}
          className="bg-white/[0.04] border border-[var(--color-line)] px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:border-white/30"
        />
        <button disabled={busy || !text.trim()} className="self-start px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm disabled:opacity-40">
          {busy ? 'Auditing…' : 'Audit document'}
        </button>
      </form>

      {err && <p className="text-red-400 text-sm">{err}</p>}

      {result && v && (
        <div className={`border border-[var(--color-line)] border-l-2 ${v.cls} px-5 py-4`}>
          <div className={`font-mono text-[0.7rem] uppercase tracking-wider mb-2 ${v.cls.split(' ')[0]}`}>Verdict: {v.label}</div>
          {result.extraction && (
            <div className="text-white/45 text-xs mb-3 font-mono">
              extracted {result.extraction.extractedFields?.length || 0} field(s) · confidence {result.extraction.confidence}
              {result.extraction.missingFields?.length ? ` · missing: ${result.extraction.missingFields.join(', ')}` : ''}
            </div>
          )}
          {result.findings?.length ? (
            <ul className="flex flex-col gap-2">
              {result.findings.map((f: AuditFinding, i) => (
                <li key={i} className="text-sm">
                  <span className={`font-mono text-[0.62rem] uppercase mr-2 ${SEV_TEXT[f.severity] || 'text-white/50'}`}>{f.severity}</span>
                  <span className="text-white/80">{f.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-white/60 text-sm">No issues found against the provided inputs.</p>
          )}
          {result.advisory && <p className="text-white/40 text-xs mt-4 leading-relaxed">{result.advisory}</p>}
        </div>
      )}
    </div>
  );
}
