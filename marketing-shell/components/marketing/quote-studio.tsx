'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// Quote Studio. Internal team tool — supplier PDF in, OrcaTrade-branded
// quote PDF out. Margin is folded silently per the team-only convention.
// Auth gate at the top; below it the upload + lines + margin selector.
//
// The form-shape POSTs to /api/quote-rebrand (root project), the same
// endpoint the existing static tool uses. In dev-only marketing-shell
// runs the upload will fail at the network boundary; we surface the
// error and offer the existing /tools/quote-rebrand link as a fallback.

interface Line {
  id: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  currency: string;
}

const MARGIN_OPTIONS = [
  { value: 8, label: '8%' },
  { value: 10, label: '10%' },
  { value: 12, label: '12%' },
  { value: 15, label: '15%' },
  { value: 20, label: '20%' },
];

export function QuoteStudio() {
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [margin, setMargin] = useState(10);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'ready' | 'generating' | 'done' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === 'application/pdf') handleFile(f);
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setStatus('parsing');
    setErrorMessage('');
    try {
      const fd = new FormData();
      fd.append('pdf', f);
      const res = await fetch('/api/quote-rebrand/parse', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      if (!res.ok) throw new Error(`Parse endpoint returned ${res.status}`);
      const data = await res.json();
      const parsed: Line[] = Array.isArray(data?.lines) ? data.lines : [];
      setLines(parsed);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const updateLine = (id: string, patch: Partial<Line>) => {
    setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const removeLine = (id: string) => setLines((p) => p.filter((l) => l.id !== id));

  const generate = async () => {
    setStatus('generating');
    setErrorMessage('');
    try {
      const res = await fetch('/api/quote-rebrand/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lines, margin }),
      });
      if (!res.ok) throw new Error(`Generate endpoint returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orcatrade-quote-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (!authed) {
    return (
      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[680px] px-6">
          <div className="border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-8 md:p-12">
            <div className="flex items-center gap-4">
              <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">❦</span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                Team-only tool
              </span>
            </div>
            <h2
              className="mt-6 font-serif text-[clamp(1.6rem,2.2vw+0.4rem,2rem)] leading-[1.1] tracking-[-0.018em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Gated to the operations team.
            </h2>
            <p className="mt-5 max-w-[58ch] text-[14.5px] leading-[1.7] text-[var(--color-ivory-dim)]">
              The Quote Studio rebrands supplier quotes onto OrcaTrade letterhead with a
              folded margin. It is intended for internal operations use only. Enter the
              shared token to continue.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) setAuthed(true);
              }}
              className="mt-8 flex flex-col gap-4"
            >
              <label htmlFor="studioToken" className="flex flex-col gap-2">
                <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
                  Shared access token
                </span>
                <input
                  id="studioToken"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="paste the shared token"
                  autoComplete="off"
                  className="border-b border-[var(--color-navy-line)] bg-transparent py-2.5 font-mono text-[14px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                  No token? Ask your founder for the team passphrase.
                </span>
                <button
                  type="submit"
                  className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
                >
                  Enter the studio
                  <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-[var(--color-ink)] py-20 md:py-28">
      <div className="mx-auto max-w-[1040px] px-6">
        {/* Panel 1 — Upload */}
        <Panel
          numeral="I"
          title="Drop the supplier PDF."
          active={!file || status === 'parsing' || status === 'error'}
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-3 border border-dashed bg-[var(--color-ink)] px-8 py-16 text-center transition-colors duration-500',
              dragOver
                ? 'border-[var(--color-ivory-dim)] bg-[var(--color-navy-soft)]'
                : 'border-[var(--color-navy-line)] hover:border-[var(--color-ivory-dim)]/60 hover:bg-[var(--color-navy-soft)]',
            )}
          >
            <span aria-hidden className="font-serif text-[2rem] text-[var(--color-ivory-dim)]/60">❦</span>
            <span
              className="font-serif text-[1.2rem] italic leading-[1.2] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
            >
              Drop a supplier PDF here
            </span>
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
              or click to browse · single PDF, up to 20 MB
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          {file && (
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-[var(--color-navy-line)] pt-5">
              <span className="font-mono text-[13px] text-[var(--color-ivory)]">{file.name}</span>
              <span
                className={cn(
                  'font-serif text-[12.5px] italic',
                  status === 'parsing' && 'text-[var(--color-ivory-dim)]',
                  status === 'ready' && 'text-[var(--color-positive)]',
                  status === 'error' && 'text-[var(--color-critical)]',
                )}
              >
                {status === 'parsing' && 'parsing…'}
                {status === 'ready' && `parsed — ${lines.length} line${lines.length === 1 ? '' : 's'}`}
                {status === 'error' && 'parse failed'}
              </span>
            </div>
          )}
        </Panel>

        {/* Panel 2 — Lines */}
        <Panel
          numeral="II"
          title="Confirm the lines."
          active={status === 'ready' || status === 'generating' || status === 'done'}
        >
          {lines.length === 0 ? (
            <p className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
              No lines yet. Drop a PDF in step I to parse line items.
            </p>
          ) : (
            <div className="border border-[var(--color-navy-line)]">
              <div className="grid grid-cols-[1fr_80px_80px_120px_120px_40px] gap-px bg-[var(--color-navy-line)]">
                <div className="bg-[var(--color-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-tight text-[var(--color-ivory-mute)]">Description</div>
                <div className="bg-[var(--color-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-tight text-[var(--color-ivory-mute)]">Qty</div>
                <div className="bg-[var(--color-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-tight text-[var(--color-ivory-mute)]">Unit</div>
                <div className="bg-[var(--color-ink)] px-4 py-3 text-right font-mono text-[11px] uppercase tracking-tight text-[var(--color-ivory-mute)]">Unit price</div>
                <div className="bg-[var(--color-ink)] px-4 py-3 text-right font-mono text-[11px] uppercase tracking-tight text-[var(--color-ivory-mute)]">Line total</div>
                <div className="bg-[var(--color-ink)] px-4 py-3" />

                {lines.map((line) => (
                  <LineRow key={line.id} line={line} onChange={updateLine} onRemove={removeLine} />
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* Panel 3 — Margin */}
        <Panel
          numeral="III"
          title="Fold the margin."
          active={lines.length > 0}
        >
          <div className="grid grid-cols-2 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] sm:grid-cols-5">
            {MARGIN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMargin(opt.value)}
                className={cn(
                  'flex flex-col items-center gap-1 bg-[var(--color-ink)] px-6 py-6 transition-colors duration-300',
                  margin === opt.value
                    ? 'bg-[var(--color-navy-soft)] text-[var(--color-ivory)]'
                    : 'text-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]/50',
                )}
              >
                <span
                  className="font-serif text-[1.6rem] leading-tight tracking-[-0.018em]"
                  style={{
                    fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                    fontWeight: margin === opt.value ? 600 : 500,
                  }}
                >
                  {opt.label}
                </span>
                <span className="font-serif text-[11.5px] italic text-[var(--color-ivory-mute)]">
                  {margin === opt.value ? 'selected' : 'margin'}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-4 font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
            Folded silently into the per-line rate on the output PDF. Supplier currency
            is preserved — no FX conversion in v1.
          </p>
        </Panel>

        {/* Panel 4 — Generate */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-navy-line)] pt-8">
          <button
            type="button"
            onClick={() => {
              setAuthed(false);
              setFile(null);
              setLines([]);
              setToken('');
              setStatus('idle');
            }}
            className="inline-flex items-center gap-2 font-serif text-[13px] italic text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
          >
            <span aria-hidden>←</span> Sign out of the studio
          </button>

          <button
            type="button"
            onClick={generate}
            disabled={lines.length === 0 || status === 'generating'}
            className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === 'generating' ? 'Generating the PDF…' : status === 'done' ? 'Generate again' : 'Generate the OrcaTrade quote'}
            <span
              aria-hidden
              className="transition-transform duration-500 group-hover:translate-x-0.5"
            >
              →
            </span>
          </button>
        </div>

        {status === 'error' && (
          <div className="mt-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-5">
            <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">
              {errorMessage || 'Something went wrong.'} If this is a network reachability
              issue with the studio API, fall back to the existing tool at{' '}
              <Link
                href="/tools/quote-rebrand/"
                className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
              >
                /tools/quote-rebrand/
              </Link>
              .
            </p>
          </div>
        )}

        {status === 'done' && (
          <div className="mt-6 border border-[var(--color-positive)]/40 bg-[var(--color-positive)]/5 p-5">
            <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">
              Quote generated. The PDF has downloaded to your machine.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Panel({
  numeral,
  title,
  active,
  children,
}: {
  numeral: string;
  title: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mt-8 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-8 transition-opacity duration-500 md:p-10',
        !active && 'opacity-40',
      )}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-[12.5px] italic text-[var(--color-ivory)]">
          § {numeral}
        </span>
        <h3
          className="font-serif text-[1.35rem] leading-tight tracking-[-0.016em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          {title}
        </h3>
      </div>
      <div className="mt-7">{children}</div>
    </div>
  );
}

function LineRow({
  line,
  onChange,
  onRemove,
}: {
  line: Line;
  onChange: (id: string, patch: Partial<Line>) => void;
  onRemove: (id: string) => void;
}) {
  const total = line.qty * line.unitPrice;
  return (
    <>
      <div className="bg-[var(--color-ink)] px-4 py-3">
        <input
          type="text"
          value={line.description}
          onChange={(e) => onChange(line.id, { description: e.target.value })}
          className="w-full bg-transparent font-mono text-[13px] text-[var(--color-ivory)] focus:outline-none"
        />
      </div>
      <div className="bg-[var(--color-ink)] px-4 py-3">
        <input
          type="number"
          value={line.qty}
          onChange={(e) => onChange(line.id, { qty: Number(e.target.value) })}
          className="w-full bg-transparent font-mono text-[13px] tabular-nums text-[var(--color-ivory)] focus:outline-none"
        />
      </div>
      <div className="bg-[var(--color-ink)] px-4 py-3">
        <input
          type="text"
          value={line.unit}
          onChange={(e) => onChange(line.id, { unit: e.target.value })}
          className="w-full bg-transparent font-mono text-[13px] text-[var(--color-ivory-dim)] focus:outline-none"
        />
      </div>
      <div className="bg-[var(--color-ink)] px-4 py-3 text-right">
        <input
          type="number"
          step="0.01"
          value={line.unitPrice}
          onChange={(e) => onChange(line.id, { unitPrice: Number(e.target.value) })}
          className="w-full bg-transparent text-right font-mono text-[13px] tabular-nums text-[var(--color-ivory)] focus:outline-none"
        />
      </div>
      <div className="bg-[var(--color-ink)] px-4 py-3 text-right font-mono text-[13px] tabular-nums text-[var(--color-ivory-dim)]">
        {line.currency} {total.toFixed(2)}
      </div>
      <button
        type="button"
        onClick={() => onRemove(line.id)}
        className="grid place-items-center bg-[var(--color-ink)] px-4 py-3 text-[var(--color-ivory-mute)] transition-colors duration-300 hover:bg-[var(--color-critical)]/10 hover:text-[var(--color-critical)]"
        aria-label="Remove line"
      >
        <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
          <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" />
          <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </>
  );
}
