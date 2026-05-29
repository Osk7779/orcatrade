# Deployment plan — marketing-shell + app-shell

> Written 2026-05-29 at the end of the design redesign branch.
> Use this to wire the three Vercel projects together when you ship.

## The three Vercel projects

| # | Project | Repo root dir | Owns these paths in production |
|---|---|---|---|
| 1 | **orcatrade-root** (existing, deployed) | `/` (repo root) | `/api/*` (the consolidated function) · the 561 generated SEO guides under `/guides/...` and `/pl/...` and `/de/...` (still served as static HTML until Phase 3 templates fully replace them) · any legacy static page not yet ported |
| 2 | **orcatrade-app-shell** (existing, deployed) | `/app-shell/` | Authenticated cockpit at `/app/*`. Already proxied from root via `vercel.json` rewrite. `basePath: '/app'` set in `next.config.mjs`. |
| 3 | **orcatrade-marketing-shell** (new — needs to be created in Vercel) | `/marketing-shell/` | The whole public marketing surface: `/`, the editorial pages, the pillar pages, the guide hubs, the matrix-template deep guides, the wizard at `/start`, the Quote Studio, the tools, the sign-in page. |

Same repo, three Vercel projects, three independent build pipelines.

## One-time wiring on Vercel

1. **Create the marketing-shell project**: Add New Project → import this repo → Root Directory = `marketing-shell` → framework auto-detects Next.js → deploy. Note the production URL (e.g. `orcatrade-marketing.vercel.app`).

2. **Update root `vercel.json` rewrites** so the right URLs go to the right project. Replace the rewrites block in `/vercel.json` with:

   ```jsonc
   {
     "rewrites": [
       // ── EXISTING ──
       // App shell at /app/*
       {
         "source": "/app/:path*",
         "destination": "https://orcatrade-c2i5.vercel.app/app/:path*"
       },
       // RSS / share / API
       { "source": "/feed.xml",    "destination": "/api/feed?format=rss" },
       { "source": "/atom.xml",    "destination": "/api/feed?format=atom" },
       { "source": "/share/:code", "destination": "/api/share/:code" },
       { "source": "/api/:path+",  "destination": "/api/[...path]" },

       // ── NEW (point at marketing-shell) ──
       // Public marketing pages — homepage, pillars, hubs, deep guides,
       // editorial pages, the wizard, the tools, the lead-gen tools,
       // the sign-in page. Anything that should render in the editorial
       // aesthetic.
       { "source": "/",                                "destination": "https://orcatrade-marketing.vercel.app/" },
       { "source": "/start/:path*",                    "destination": "https://orcatrade-marketing.vercel.app/start/:path*" },
       { "source": "/tools/:path*",                    "destination": "https://orcatrade-marketing.vercel.app/tools/:path*" },
       { "source": "/contact",                         "destination": "https://orcatrade-marketing.vercel.app/contact" },
       { "source": "/founding/:path*",                 "destination": "https://orcatrade-marketing.vercel.app/founding/:path*" },
       { "source": "/trust/:path*",                    "destination": "https://orcatrade-marketing.vercel.app/trust/:path*" },
       { "source": "/changelog/:path*",                "destination": "https://orcatrade-marketing.vercel.app/changelog/:path*" },
       { "source": "/regulations/:path*",              "destination": "https://orcatrade-marketing.vercel.app/regulations/:path*" },
       { "source": "/docs/orcatrade-shareholder-brief","destination": "https://orcatrade-marketing.vercel.app/docs/orcatrade-shareholder-brief" },
       { "source": "/signin",                          "destination": "https://orcatrade-marketing.vercel.app/signin" },
       { "source": "/agents",                          "destination": "https://orcatrade-marketing.vercel.app/agents" },
       { "source": "/buyer-verification",              "destination": "https://orcatrade-marketing.vercel.app/buyer-verification" },
       { "source": "/factory-risk",                    "destination": "https://orcatrade-marketing.vercel.app/factory-risk" },
       { "source": "/analysis",                        "destination": "https://orcatrade-marketing.vercel.app/analysis" },

       // Pillar pages
       { "source": "/search",       "destination": "https://orcatrade-marketing.vercel.app/search" },
       { "source": "/sourcing",     "destination": "https://orcatrade-marketing.vercel.app/sourcing" },
       { "source": "/intelligence", "destination": "https://orcatrade-marketing.vercel.app/intelligence" },
       { "source": "/logistics",    "destination": "https://orcatrade-marketing.vercel.app/logistics" },
       { "source": "/finance",      "destination": "https://orcatrade-marketing.vercel.app/finance" },
       { "source": "/process",      "destination": "https://orcatrade-marketing.vercel.app/process" },

       // Examples
       { "source": "/examples",         "destination": "https://orcatrade-marketing.vercel.app/examples" },
       { "source": "/examples/:slug*",  "destination": "https://orcatrade-marketing.vercel.app/examples/:slug*" },

       // Guides — hubs and the new template-driven deep pages take over
       // the same URLs the existing generators produced. The static HTML
       // at root keeps serving for any slug marketing-shell does not yet
       // resolve (Next.js falls through on 404 to the catch-all below).
       { "source": "/guides",                 "destination": "https://orcatrade-marketing.vercel.app/guides" },
       { "source": "/guides/customs/:slug*",  "destination": "https://orcatrade-marketing.vercel.app/guides/customs/:slug*" },
       { "source": "/guides/sourcing/:slug*", "destination": "https://orcatrade-marketing.vercel.app/guides/sourcing/:slug*" },
       { "source": "/guides/routing/:slug*",  "destination": "https://orcatrade-marketing.vercel.app/guides/routing/:slug*" },
       { "source": "/guides/warehouse/:slug*","destination": "https://orcatrade-marketing.vercel.app/guides/warehouse/:slug*" },
       { "source": "/guides/compliance/:slug*","destination": "https://orcatrade-marketing.vercel.app/guides/compliance/:slug*" },
       { "source": "/guides/preferential-origin/:slug*", "destination": "https://orcatrade-marketing.vercel.app/guides/preferential-origin/:slug*" },
       { "source": "/guides/trade-defence/:slug*",       "destination": "https://orcatrade-marketing.vercel.app/guides/trade-defence/:slug*" }
     ]
   }
   ```

3. **Redirects** for the orphaned pages. Add a `redirects` block to root `vercel.json`:

   ```jsonc
   {
     "redirects": [
       // Legacy auth → new signin page in marketing-shell
       { "source": "/account",                         "destination": "/signin",                       "permanent": false },
       { "source": "/account/",                        "destination": "/signin",                       "permanent": false },

       // Legacy duplicate marketing pages → new pillar pages
       { "source": "/intelligence.html",               "destination": "/intelligence",                 "permanent": true },
       { "source": "/sourcing.html",                   "destination": "/sourcing",                     "permanent": true },
       { "source": "/finance.html",                    "destination": "/finance",                      "permanent": true },
       { "source": "/search.html",                     "destination": "/search",                       "permanent": true },
       { "source": "/process.html",                    "destination": "/process",                      "permanent": true },
       { "source": "/services.html",                   "destination": "/process",                      "permanent": true },
       { "source": "/orcatrade.html",                  "destination": "/",                             "permanent": true },
       { "source": "/contact.html",                    "destination": "/contact",                      "permanent": true },

       // Legacy /account/* settings → cockpit equivalents
       { "source": "/account/plans/:path*",            "destination": "/app/plans/:path*",             "permanent": false },
       { "source": "/account/portfolios/:path*",       "destination": "/app/portfolios/:path*",        "permanent": false },
       { "source": "/account/alerts/:path*",           "destination": "/app/alerts/:path*",            "permanent": false },
       { "source": "/account/calendar/:path*",         "destination": "/app/calendar/:path*",          "permanent": false },
       { "source": "/account/documents/:path*",        "destination": "/app/documents/:path*",         "permanent": false },
       { "source": "/account/preferences/:path*",      "destination": "/app/preferences/:path*",       "permanent": false },
       { "source": "/account/billing/:path*",          "destination": "/app/billing/:path*",           "permanent": false },
       { "source": "/account/security/:path*",         "destination": "/app/security/:path*",          "permanent": false },
       { "source": "/account/privacy/:path*",          "destination": "/app/privacy/:path*",           "permanent": false },
       { "source": "/account/activity/:path*",         "destination": "/app/activity/:path*",          "permanent": false },
       { "source": "/account/screen/:path*",           "destination": "/app/screening/:path*",         "permanent": false },
       { "source": "/account/orgs/:path*",             "destination": "/app/orgs/:path*",              "permanent": false },

       // Old per-agent landings → new /agents overview
       { "source": "/agent/:path*",                    "destination": "/agents",                       "permanent": true },

       // Old admin/ops dashboard → cockpit
       { "source": "/dashboard/:path*",                "destination": "/app/dashboard",                "permanent": false }
     ]
   }
   ```

4. **Add the production domain alias** to the marketing-shell project on Vercel. Once the rewrites point at it, you can move the apex/wildcard there later if you want marketing-shell to own the canonical domain entirely.

## Deploy order

1. Push `feat/marketing-shell` to GitHub.
2. Open a PR against `main`. The root project preview deploy will not work for marketing-shell URLs yet — that's expected; the marketing-shell project doesn't exist on Vercel yet.
3. Once the marketing-shell project is created, deploy it from the same branch. Note the production URL.
4. Edit `vercel.json` on root to point at that URL (rewrites + redirects above).
5. Re-deploy the root project.
6. Walk every URL above as a smoke test.

## What survives unchanged

- The single Vercel function at `/api/[...path].js` and its ~50 endpoints.
- The 561 generated SEO guides at the root project — they keep serving any slug that marketing-shell does not yet handle. Over time the template-driven deep guides in marketing-shell take over the same URLs.
- The app-shell at `/app/*` (already deployed, unchanged).
- All calculators, agents, sanctions engine, RAG, audit chain. Not touched.

## Safety net

The branch carries 18 checkpoint commits. The `live-pre-redesign` tag points at `6950a081` — the exact production state of orcatrade.pl before this work began. To roll back at any time:

```bash
# To exactly what's live today:
git checkout live-pre-redesign

# Or in a separate worktree without losing your branch:
git worktree add ../orcatrade-live live-pre-redesign

# Or revert specific commits while preserving the rest:
git revert <commit-hash>
```
