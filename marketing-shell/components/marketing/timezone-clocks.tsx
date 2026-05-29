'use client';

import { useEffect, useState } from 'react';

const CLOCKS = [
  { city: 'London', short: 'LDN', tz: 'Europe/London' },
  { city: 'Warsaw', short: 'WAW', tz: 'Europe/Warsaw' },
  { city: 'Hong Kong', short: 'HKG', tz: 'Asia/Hong_Kong' },
];

// Pull hour + minute for a timezone via Intl.formatToParts — no string
// parsing of locale-formatted strings.
function getTimeInTz(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).formatToParts(date);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return {
    h,
    m,
    display: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
  };
}

// Tiny analog clock face — hairline circle, single 12 o'clock tick, hour
// and minute hands. Sized for inline display next to the city name.
function AnalogClock({ hours, minutes }: { hours: number; minutes: number }) {
  // Hour hand: 30° per hour + 0.5° per minute (drifts smoothly between hours)
  const hourAngle = ((hours % 12) + minutes / 60) * 30;
  // Minute hand: 6° per minute
  const minuteAngle = minutes * 6;

  // Hand endpoints — 0° points up (12 o'clock), then we sweep clockwise.
  const hourX = 12 + Math.sin((hourAngle * Math.PI) / 180) * 4.5;
  const hourY = 12 - Math.cos((hourAngle * Math.PI) / 180) * 4.5;
  const minuteX = 12 + Math.sin((minuteAngle * Math.PI) / 180) * 7;
  const minuteY = 12 - Math.cos((minuteAngle * Math.PI) / 180) * 7;

  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[15px] shrink-0 text-[var(--color-ivory)]"
      aria-hidden
    >
      {/* Outer dial */}
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.32"
        strokeWidth="1"
      />
      {/* 12 o'clock tick */}
      <line
        x1="12"
        y1="2.2"
        x2="12"
        y2="3.8"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Hour hand */}
      <line
        x1="12"
        y1="12"
        x2={hourX}
        y2={hourY}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        style={{ transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
      />
      {/* Minute hand */}
      <line
        x1="12"
        y1="12"
        x2={minuteX}
        y2={minuteY}
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        style={{ transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
      />
      {/* Centre cap */}
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

// Live trading-floor clocks. Three city readouts, each with a tiny analog
// dial and the digital time in tabular Plex Mono. Hydration-safe via a
// null placeholder rendered server-side.
export function TimezoneClocks() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      {CLOCKS.map((c, i) => {
        const time = now ? getTimeInTz(now, c.tz) : { h: 0, m: 0, display: '——:——' };
        return (
          <span key={c.tz} className="flex items-center gap-2 text-[12px] sm:gap-2.5">
            <AnalogClock hours={time.h} minutes={time.m} />
            <span className="font-serif italic text-[var(--color-ivory-mute)]">
              <span className="sm:hidden">{c.short}</span>
              <span className="hidden sm:inline">{c.city}</span>
            </span>
            <span className="font-mono font-medium tabular-nums text-[var(--color-ivory)]">
              {time.display}
            </span>
            {i < CLOCKS.length - 1 && (
              <span
                aria-hidden
                className="ml-0.5 text-[var(--color-navy-line)] sm:ml-1"
              >
                ·
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
