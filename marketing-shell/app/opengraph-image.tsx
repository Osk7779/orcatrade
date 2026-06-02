import { ImageResponse } from 'next/og';

// Default Open Graph image for the marketing-shell. Editorial card —
// fleuron + wordmark + tagline + cities + date stamp. Rendered at build
// time as a 1200×630 PNG via @vercel/og. Subroute pages can override
// with their own opengraph-image at the route level.

export const runtime = 'edge';

export const alt = 'OrcaTrade Group — import operations, on autopilot';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#050507',
          color: '#fafaf7',
          padding: '80px 96px',
          fontFamily: 'serif',
        }}
      >
        {/* Top hairline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 80, height: 1, backgroundColor: 'rgba(250,250,247,0.4)' }} />
          <span
            style={{
              fontSize: 18,
              fontStyle: 'italic',
              color: 'rgba(250,250,247,0.55)',
              letterSpacing: '0.04em',
            }}
          >
            On principle
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 28,
            marginTop: 'auto',
            marginBottom: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 96,
              lineHeight: 1.02,
              letterSpacing: '-0.022em',
              fontWeight: 600,
              maxWidth: '20ch',
            }}
          >
            <span>Import operations,</span>
            <span>on autopilot.</span>
          </div>
          <div
            style={{
              fontSize: 28,
              fontStyle: 'italic',
              color: 'rgba(201, 204, 211, 1)',
              maxWidth: '52ch',
              lineHeight: 1.4,
            }}
          >
            Calculator-grounded trade compliance for European businesses sourcing from Asia.
          </div>
        </div>

        {/* Footer hairline */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            paddingTop: 28,
            borderTop: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.022em' }}>
              OrcaTrade
            </span>
            <span
              style={{
                fontSize: 24,
                fontStyle: 'italic',
                color: 'rgba(201, 204, 211, 0.7)',
              }}
            >
              Group
            </span>
          </div>
          <div
            style={{
              fontSize: 18,
              fontStyle: 'italic',
              color: 'rgba(201, 204, 211, 0.7)',
            }}
          >
            London · Warsaw · Hong Kong · MMXXVI
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
