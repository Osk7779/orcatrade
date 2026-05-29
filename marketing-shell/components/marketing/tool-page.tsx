'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EditorialHeader } from './editorial-header';
import { Aurora } from './aurora';
import { FadeUp } from './fade-up';
import { ChapterRule } from './chapter-rule';

// Shared template for the small lead-gen tools — buyer verification,
// factory risk, analysis. Each is a single-input form that POSTs to the
// matching API endpoint on the root project (which already exists and
// already handles rate limiting, sanctions screening and report
// generation). The visual shell is identical across the tools so the
// editorial language stays cohesive.

export interface ToolPageProps {
  kicker: string;
  title: React.ReactNode;
  lead: string;
  meta?: string;
  inputLabel: string;
  inputPlaceholder: string;
  inputName: string;
  submitLabel: string;
  endpoint: string;
  why: string;
  whyTitle?: string;
  steps?: { title: string; body: string }[];
  closingTitle: React.ReactNode;
  closingLead: string;
}

export function ToolPage(props: ToolPageProps) {
  const {
    kicker,
    title,
    lead,
    meta,
    inputLabel,
    inputPlaceholder,
    inputName,
    submitLabel,
    endpoint,
    why,
    whyTitle,
    steps,
    closingTitle,
    closingLead,
  } = props;

  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setState('submitting');
    setErr('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [inputName]: value.trim() }),
      });
      if (!res.ok) throw new Error(`Endpoint returned ${res.status}`);
      setState('sent');
    } catch (e) {
      setState('error');
      setErr(e instanceof Error ? e.message : 'Could not submit.');
    }
  }

  return (
    <>
      <EditorialHeader kicker={kicker} title={title} lead={lead} meta={meta} />

      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[720px] px-6">
          {state === 'sent' ? (
            <div className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-8 text-center md:p-10">
              <div className="flex items-center justify-center gap-3">
                <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/65">
                  ❦
                </span>
                <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                  Brief received
                </span>
              </div>
              <h2
                className="mx-auto mt-6 max-w-[24ch] font-serif text-[clamp(1.8rem,3vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
              >
                A founder will come back within one business day.
              </h2>
              <p className="mx-auto mt-5 max-w-[44ch] font-serif text-[15px] italic leading-[1.55] text-[var(--color-ivory-dim)]">
                We have the brief. The report includes calculator-grounded findings
                with citations and recommended next steps.
              </p>
              <Link
                href="/start"
                className="mt-8 inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
              >
                Build a full import plan while you wait
                <span aria-hidden>→</span>
              </Link>
            </div>
          ) : (
            <FadeUp>
              <form
                onSubmit={submit}
                className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-7 md:p-10"
              >
                <label htmlFor="tool-input" className="flex flex-col gap-3">
                  <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
                    {inputLabel}
                  </span>
                  <input
                    id="tool-input"
                    type="text"
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={inputPlaceholder}
                    className="border-b border-[var(--color-navy-line)] bg-transparent px-1 py-3 text-[15px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
                  />
                </label>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-navy-line)] pt-6">
                  <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                    No payment to submit · response within one business day
                  </span>
                  <button
                    type="submit"
                    disabled={state === 'submitting' || !value.trim()}
                    className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {state === 'submitting' ? 'Sending the brief…' : submitLabel}
                    {state !== 'submitting' && (
                      <span
                        aria-hidden
                        className="transition-transform duration-500 group-hover:translate-x-0.5"
                      >
                        →
                      </span>
                    )}
                  </button>
                </div>

                {state === 'error' && err && (
                  <div className="mt-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
                    <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">
                      {err}
                    </p>
                  </div>
                )}
              </form>
            </FadeUp>
          )}
        </div>
      </section>

      <ChapterRule numeral="§" label={whyTitle ?? 'Why ask'} />

      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[820px] px-6">
          <FadeUp>
            <p
              className="font-serif text-[clamp(1.4rem,2vw+0.4rem,1.8rem)] italic leading-[1.4] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
            >
              {why}
            </p>
          </FadeUp>
        </div>
      </section>

      {steps && steps.length > 0 && (
        <>
          <ChapterRule numeral="§" label="How it goes" />
          <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28">
            <div className="mx-auto max-w-[1100px] px-6">
              <ol className="flex flex-col gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)]">
                {steps.map((s, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-3 bg-[var(--color-ink)] p-8 md:flex-row md:gap-10 md:p-10"
                  >
                    <span
                      className="font-serif text-[1.4rem] italic text-[var(--color-ivory)] md:w-[60px]"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
                    >
                      № {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1">
                      <h3
                        className="font-serif text-[1.2rem] leading-[1.15] tracking-[-0.016em] text-[var(--color-ivory)]"
                        style={{
                          fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                          fontWeight: 550,
                        }}
                      >
                        {s.title}
                      </h3>
                      <p className="mt-2 max-w-[58ch] text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                        {s.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </>
      )}

      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] py-24 md:py-36">
        <Aurora />
        <div className="relative mx-auto max-w-[860px] px-6 text-center">
          <FadeUp>
            <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
              Next stage
            </span>
            <h2
              className="mx-auto mt-6 max-w-[22ch] font-serif text-[clamp(2.4rem,5vw+0.4rem,3.8rem)] leading-[1.05] tracking-[-0.024em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              {closingTitle}
            </h2>
            <p className="mx-auto mt-6 max-w-[58ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
              {closingLead}
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/start"
                className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
              >
                Build my import plan
                <span
                  aria-hidden
                  className="transition-transform duration-500 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
              >
                Talk to a person
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
