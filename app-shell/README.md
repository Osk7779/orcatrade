# OrcaTrade — App Shell (Pillar IV / Foundation F5)

The authenticated product surface, as a **Next.js 15 App Router** app (React 19,
TypeScript strict, Tailwind v4). It is intentionally **isolated** from the repo
root: the marketing site (744 static pages incl. the 658 SEO guides) and the
`/api` function in the root project are untouched and keep deploying exactly as
before. This subtree is a *separate Vercel project*.

## How it composes with the existing site

- Served under **`/app`** (`basePath: '/app'` in `next.config.mjs`).
- The main site already rewrites `/app/:path*` → this project (see root
  `vercel.json`). So `orcatrade.pl/app/dashboard` renders this app.
- Because it's the **same origin**, client calls to `/api/...` hit the existing
  repo-root handlers and the magic-link **session cookie is sent automatically**
  — no CORS, no second auth system, no backend rewrite.

## Local dev

```bash
cd app-shell
npm install
npm run dev          # http://localhost:3000/app/dashboard
```

(For local API calls, run the root project too, or point a dev proxy at prod.)

## Deploy (one-time wiring)

Create a **new Vercel project** whose **Root Directory = `app-shell`**:

1. Vercel → Add New Project → import the same repo.
2. Set **Root Directory** to `app-shell` (Framework auto-detects Next.js).
3. Deploy. Note its production URL (e.g. `orcatrade-app-shell.vercel.app`).
4. In the root `vercel.json`, point the `/app/:path*` rewrite at that URL
   (it currently targets a placeholder), then redeploy the root project.

After that, every push builds both projects independently.

## Status / roadmap

Shipped (slice 1): scaffold, design tokens, sidebar shell, **Dashboard** wired
to `GET /api/account/overview` (auth-gated, with a sign-in state).

Next slices port each account surface into native React routes (replacing the
interim `<a href="/account/…">` links in the sidebar): Plans, Portfolios,
Monitoring alerts, Compliance calendar, Documents, Screening.
