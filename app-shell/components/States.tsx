// Shared loading / auth / error / empty notices for the cockpit. Use these
// instead of one-off paragraphs so every page lands the same vocabulary
// for the same state.

import { PageHeader } from './PageHeader';

export function LoadingNotice({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
      <span
        aria-hidden
        className="inline-block size-2 animate-pulse bg-[var(--color-ivory-dim)]/60"
      />
      {label}
    </div>
  );
}

export function ErrorNotice({ label }: { label?: string }) {
  return (
    <div className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-5">
      <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">
        {label ?? 'Something went wrong. Please retry shortly.'}
      </p>
    </div>
  );
}

export function AuthNotice({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div className="max-w-[520px]">
      <PageHeader
        kicker="Sign in required"
        title={title}
        sub={
          sub ??
          'Your plans, monitoring alerts and compliance deadlines live here. Sign in with a magic link to continue.'
        }
      />
      <a
        href="/account/"
        className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
      >
        Sign in
        <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">
          →
        </span>
      </a>
    </div>
  );
}

export function EmptyState({
  body,
  ctaLabel,
  ctaHref,
}: {
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="border border-dashed border-[var(--color-navy-line)] p-8 text-center">
      <p className="font-serif text-[14.5px] italic text-[var(--color-ivory-dim)]">{body}</p>
      {ctaLabel && ctaHref && (
        <a
          href={ctaHref}
          className="mt-5 inline-flex items-center gap-2 border border-[var(--color-ivory-dim)]/40 px-5 py-2.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
        >
          {ctaLabel}
          <span aria-hidden>→</span>
        </a>
      )}
    </div>
  );
}
