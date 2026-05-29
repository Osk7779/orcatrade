// Overhead lamp cone. A single soft ivory beam descends from the top
// edge, illuminating whatever sits beneath. Used at the FinalCTA as the
// dramatic close of the page — the curtain light on the last act.
//
// Adapted from Aceternity UI's Lamp effect, tuned to be navy-and-ivory
// only (no rainbow gradients) and softened so it feels like atmosphere
// rather than a spot.
export function Lamp({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] overflow-hidden ${className ?? ''}`}
    >
      {/* Wide outer cone — soft atmospheric spread */}
      <div
        className="absolute left-1/2 top-[-6rem] -translate-x-1/2"
        style={{
          width: 'min(64rem, 110%)',
          height: '28rem',
          background:
            'radial-gradient(ellipse 50% 60% at center top, rgba(250,250,247,0.16), transparent 65%)',
          filter: 'blur(36px)',
        }}
      />
      {/* Tighter inner cone — concentrates the light */}
      <div
        className="absolute left-1/2 top-[-3rem] -translate-x-1/2"
        style={{
          width: 'min(38rem, 80%)',
          height: '16rem',
          background:
            'radial-gradient(ellipse 50% 70% at center top, rgba(250,250,247,0.24), transparent 70%)',
          filter: 'blur(18px)',
        }}
      />
      {/* Bright hairline at the source — the bulb */}
      <div
        className="absolute left-1/2 top-0 -translate-x-1/2"
        style={{
          width: '24rem',
          height: '2px',
          background:
            'linear-gradient(to right, transparent, rgba(250,250,247,0.55), transparent)',
        }}
      />
      {/* Two faint diagonal flares to suggest the cone edges */}
      <div
        className="absolute left-1/2 top-0 -translate-x-1/2"
        style={{
          width: 'min(48rem, 90%)',
          height: '22rem',
          background:
            'conic-gradient(from 180deg at 50% 0%, transparent 75deg, rgba(250,250,247,0.06) 90deg, rgba(250,250,247,0.06) 90deg, transparent 105deg)',
          filter: 'blur(8px)',
        }}
      />
    </div>
  );
}
