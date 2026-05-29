# OrcaTrade — Marketing Shell

The public-facing marketing surface, as a **Next.js 15 App Router** app
(React 19, TypeScript strict, Tailwind v4). Sibling to `app-shell/` which
owns the authenticated cockpit at `/app/*`.

Together, the three projects compose the site:

| Surface                              | Lives in           | Vercel project                    |
|--------------------------------------|--------------------|-----------------------------------|
| Marketing (`/`, `/start`, `/tools/*`) | `marketing-shell/` | (new — third project)             |
| Authenticated cockpit (`/app/*`)     | `app-shell/`       | `orcatrade-c2i5.vercel.app`       |
| API + 658 SEO guides + everything else | repo root        | main project (`orcatrade.pl`)     |

## Design system

Monochrome — navy + ivory only, **no gold**. Hierarchy is built from
weight, scale and spacing. State colours (positive, warning, critical,
info) exist but are used only when status *is* the message, never as
decoration. Tokens live in [`app/globals.css`](app/globals.css) and mirror
the `app-shell/app/globals.css` palette so the two surfaces share one
identity.

Type: Inter (sans), Cormorant Garamond (display), JetBrains Mono (mono).
Sharp corners everywhere (no border-radius except inside `rounded-full`
status dots). Whitespace generous; density medium.

## Component layer

A small set of motion components powers the dynamic surface
(`components/marketing/`):

- **Aurora** — slow drifting navy gradient behind the hero
- **Globe** — Cobe WebGL globe with 12 origin/destination markers
- **AnimatedBeam** — SVG-only animated beam between two DOM refs, used in
  the StoryBeam section to fan origins → hub → destinations
- **BentoGrid / BentoCard** — asymmetric grid for the Five Pillars; the
  flagship pillar spans two cells
- **SparklesText** — sparing twinkle on the hero accent word
- **NumberTicker** — count-up on scroll-into-view for the hero stat row

All inspired by the [21st.dev](https://21st.dev) / Magic UI / Aceternity UI
catalogues, ported here against the OrcaTrade palette and aesthetic.

## Local dev

```bash
cd marketing-shell
npm install
npm run dev   # http://localhost:3000
```

For local API calls, run the root project too (so `/api/*` resolves), or
point a dev proxy at production.

## Deploy (one-time wiring)

Create a **new Vercel project** with **Root Directory = `marketing-shell`**:

1. Vercel → Add New Project → import the same repo.
2. Set **Root Directory** to `marketing-shell` (framework auto-detects Next.js).
3. Deploy. Note the production URL (e.g. `orcatrade-marketing.vercel.app`).
4. In the root `vercel.json`, add rewrites so the relevant paths proxy to
   the new project, keeping the 658 SEO guides at root untouched:

```jsonc
{
  "rewrites": [
    // app-shell (already in place)
    { "source": "/app/:path*", "destination": "https://orcatrade-c2i5.vercel.app/app/:path*" },

    // marketing-shell (new)
    { "source": "/",            "destination": "https://orcatrade-marketing.vercel.app/" },
    { "source": "/start",       "destination": "https://orcatrade-marketing.vercel.app/start" },
    { "source": "/start/:path*", "destination": "https://orcatrade-marketing.vercel.app/start/:path*" },
    { "source": "/tools/:path*", "destination": "https://orcatrade-marketing.vercel.app/tools/:path*" },

    // existing rewrites (API, feed, share) stay in place
    { "source": "/feed.xml",    "destination": "/api/feed?format=rss" },
    { "source": "/atom.xml",    "destination": "/api/feed?format=atom" },
    { "source": "/share/:code", "destination": "/api/share/:code" },
    { "source": "/api/:path+",  "destination": "/api/[...path]" }
  ]
}
```

The 658 SEO guides under `/guides/*`, `/examples/*`, `/pl/*`, `/de/*` are
**not** rewritten — they keep being served by the root project as static
HTML. The acquisition moat is preserved verbatim.

The CSP in root `vercel.json` may need an update once this is wired:
the marketing-shell assets will load from `*.vercel.app` (already allowed
in `connect-src`), and Next.js inlines hashes scripts (allowed via the
existing `'unsafe-inline'`).

## Status

Slice 1 (this commit): scaffold + the new homepage with Hero (Aurora +
Globe + Sparkles + Number Ticker), StoryBeam (Animated Beam), and
Five-Pillars Bento.

Next slices:
- Port `/start` Import Plan Builder
- Port `/tools/quote-rebrand` Quote Studio
- Add Marquee social-proof strip when there are real logos to show
- Floating Dock for long-page in-page nav
