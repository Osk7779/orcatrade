import { cn } from '@/lib/utils';

// Two slowly-drifting radial gradients in navy tones. No hue shift — depth
// only. Sits behind the hero. Reduced-motion users get a static version
// (animation is overridden by the global media query).
export function Aurora({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
    >
      {/* Two atmospheric layers, deliberately almost imperceptible. Money
          likes silence: this is depth, not animation. */}
      <div
        className="absolute -inset-[25%] opacity-[0.18] will-change-transform"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 28% 32%, rgba(18, 38, 76, 0.6), transparent 62%)',
          animation: 'aurora-drift 72s ease-in-out infinite',
        }}
      />
      <div
        className="absolute -inset-[25%] opacity-[0.12] will-change-transform"
        style={{
          background:
            'radial-gradient(ellipse 50% 60% at 72% 60%, rgba(26, 50, 96, 0.5), transparent 65%)',
          animation: 'aurora-drift 96s ease-in-out infinite reverse',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.02] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='a'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23a)'/%3E%3C/svg%3E\")",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--color-ink)] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[var(--color-ink)] to-transparent" />
    </div>
  );
}
