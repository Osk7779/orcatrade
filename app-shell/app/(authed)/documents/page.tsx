'use client';

import { useEffect, useState } from 'react';
import {
  apiGet,
  apiPost,
  type AuditResult,
  type AuditFinding,
  type SavedPlan,
  type Severity,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

const DOC_TYPES = [
  { id: 'commercial_invoice', label: 'Commercial invoice' },
  { id: 'proforma_invoice', label: 'Proforma invoice' },
  { id: 'packing_list', label: 'Packing list' },
  { id: 'certificate_of_origin', label: 'Certificate of origin' },
];

const VERDICT: Record<string, { label: string; tone: string; rule: string }> = {
  blocking_issues: {
    label: 'Blocking issues',
    tone: 'text-[var(--color-critical)]',
    rule: 'before:bg-[var(--color-critical)]',
  },
  review_needed: {
    label: 'Review needed',
    tone: 'text-[var(--color-warning)]',
    rule: 'before:bg-[var(--color-warning)]',
  },
  minor_issues: {
    label: 'Minor issues',
    tone: 'text-[var(--color-ivory-dim)]',
    rule: 'before:bg-[var(--color-ivory-dim)]',
  },
  consistent: {
    label: 'Consistent',
    tone: 'text-[var(--color-positive)]',
    rule: 'before:bg-[var(--color-positive)]',
  },
};

const SEV_TEXT: Record<Severity, string> = {
  critical: 'text-[var(--color-critical)]',
  high: 'text-[var(--color-warning)]',
  medium: 'text-[var(--color-ivory-dim)]',
  low: 'text-[var(--color-ivory-mute)]',
  info: 'text-[var(--color-info)]',
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
    apiGet<{ plans: SavedPlan[] }>('/plans')
      .then((d) => setPlans(d.plans || []))
      .catch(() => {});
  }, []);

  async function audit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr('');
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        action: 'audit',
        documentType: docType,
        text: text.trim(),
      };
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
    <div className="max-w-[920px]">
      <PageHeader
        kicker="Documents"
        title="Document audit."
        sub="Paste a commercial invoice, packing list or certificate of origin. We extract the fields and check them — optionally against one of your saved plans — for HS / origin / value mismatches, arithmetic errors, undervaluation risk, missing preference evidence and CBAM/EUDR documentation."
      />

      <form onSubmit={audit} className="flex flex-col gap-5 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-6 md:p-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormSelect
            id="docType"
            label="Document type"
            value={docType}
            onChange={setDocType}
            options={DOC_TYPES.map((d) => ({ value: d.id, label: d.label }))}
          />
          <FormSelect
            id="planId"
            label="Compare against"
            value={planId}
            onChange={setPlanId}
            options={[
              { value: '', label: 'No plan — extract only' },
              ...plans.map((p) => ({ value: p.id, label: p.label || p.id })),
            ]}
          />
        </div>

        <label htmlFor="docText" className="flex flex-col gap-2">
          <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
            Document text
          </span>
          <textarea
            id="docText"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder={'Paste the document text here…\n\ne.g.\nCommercial Invoice\nOrigin: China\nHS code: 8712 00 30\nTotal: EUR 40,000'}
            className="resize-y border border-[var(--color-navy-line)] bg-transparent p-3.5 font-mono text-[13px] leading-[1.65] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
          />
        </label>

        <div className="flex justify-end">
          <button
            disabled={busy || !text.trim()}
            className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Auditing…' : 'Audit document'}
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
      </form>

      {err && (
        <div className="mt-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
          <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
        </div>
      )}

      {result && v && (
        <div
          className={`relative mt-8 bg-[var(--color-ink)] p-6 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] md:p-7 ${v.rule}`}
          style={{ border: '1px solid var(--color-navy-line)' }}
        >
          <div className="font-mono text-[11px] font-medium uppercase tracking-tight">
            <span className="text-[var(--color-ivory-mute)]">Verdict:</span>{' '}
            <span className={v.tone}>{v.label}</span>
          </div>

          {result.extraction && (
            <div className="mt-3 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
              extracted {result.extraction.extractedFields?.length || 0} field
              {(result.extraction.extractedFields?.length || 0) === 1 ? '' : 's'} ·
              confidence {result.extraction.confidence}
              {result.extraction.missingFields?.length
                ? ` · missing: ${result.extraction.missingFields.join(', ')}`
                : ''}
            </div>
          )}

          {result.findings?.length ? (
            <ul className="mt-5 flex flex-col gap-3">
              {result.findings.map((f: AuditFinding, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-3 text-[14px] leading-[1.6] text-[var(--color-ivory-dim)]"
                >
                  <span
                    className={`font-mono text-[10.5px] font-medium uppercase tabular-nums ${
                      SEV_TEXT[f.severity] || 'text-[var(--color-ivory-mute)]'
                    }`}
                  >
                    {f.severity}
                  </span>
                  <span>{f.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
              No issues found against the provided inputs.
            </p>
          )}

          {result.advisory && (
            <p className="mt-5 max-w-[60ch] font-serif text-[12.5px] italic leading-[1.55] text-[var(--color-ivory-mute)]">
              {result.advisory}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FormSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-b border-[var(--color-navy-line)] bg-transparent py-2.5 text-[14px] text-[var(--color-ivory)] focus:border-[var(--color-ivory-dim)] focus:outline-none [&>option]:bg-[var(--color-ink)] [&>option]:text-[var(--color-ivory)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
