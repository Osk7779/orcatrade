// Ambient star field around the globe. Barely visible — peak opacity is
// ~0.32, so these read as flickers at the edge of perception, not as a
// proper starscape. Each star has its own duration and delay so they
// twinkle out of sync, the way real stars do.
//
// Server component — pure CSS keyframes, no React state. Deterministic
// seed so SSR and CSR render identical positions.

const STARS = [
  { x: 6, y: 14, size: 1.5, dur: 4.2, delay: 0 },
  { x: 12, y: 38, size: 2.0, dur: 5.6, delay: 1.4 },
  { x: 18, y: 64, size: 1.5, dur: 3.8, delay: 0.6 },
  { x: 22, y: 86, size: 1.8, dur: 4.8, delay: 2.2 },
  { x: 28, y: 22, size: 2.4, dur: 6.0, delay: 0.9 },
  { x: 33, y: 52, size: 1.5, dur: 4.4, delay: 3.1 },
  { x: 38, y: 8, size: 1.8, dur: 5.2, delay: 1.7 },
  { x: 42, y: 78, size: 2.0, dur: 4.0, delay: 2.4 },
  { x: 48, y: 30, size: 1.5, dur: 5.8, delay: 0.3 },
  { x: 54, y: 62, size: 1.8, dur: 4.6, delay: 1.1 },
  { x: 60, y: 16, size: 2.2, dur: 5.4, delay: 2.8 },
  { x: 66, y: 44, size: 1.5, dur: 3.6, delay: 0.8 },
  { x: 71, y: 72, size: 1.8, dur: 5.0, delay: 1.6 },
  { x: 76, y: 26, size: 1.5, dur: 4.4, delay: 3.4 },
  { x: 82, y: 56, size: 2.0, dur: 5.8, delay: 0.5 },
  { x: 87, y: 12, size: 1.5, dur: 4.0, delay: 2.0 },
  { x: 91, y: 82, size: 1.8, dur: 5.6, delay: 1.2 },
  { x: 95, y: 40, size: 2.2, dur: 4.8, delay: 2.6 },
  { x: 4, y: 50, size: 1.5, dur: 6.2, delay: 1.9 },
  { x: 50, y: 92, size: 1.8, dur: 4.4, delay: 0.4 },
  { x: 50, y: 4, size: 2.0, dur: 5.2, delay: 3.0 },
  { x: 16, y: 4, size: 1.5, dur: 4.6, delay: 1.3 },
  { x: 84, y: 96, size: 1.5, dur: 5.4, delay: 2.5 },
  { x: 8, y: 76, size: 1.8, dur: 3.8, delay: 0.7 },
];

export function GlobeStars({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
    >
      {STARS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[var(--color-ivory)]"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            opacity: 0,
            animation: `star-fade ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
