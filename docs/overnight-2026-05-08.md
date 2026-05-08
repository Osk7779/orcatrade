# Overnight build · 2026-05-08 → 2026-05-09

> Autonomous overnight run. Each iteration ends with a commit + push so the
> sequence is fully reviewable in `git log` after the fact.

## Mission

Ship the programmatic SEO sprint end-to-end. The platform has unique
calculator-grounded data (5 countries × 8 categories sourcing, sea/rail/air
corridors, ~50 HS chapters × 27 EU destinations, 6 EU 3PL hubs). Each
combination is a long-tail keyword cluster. Generating static SEO landing
pages from the existing data turns "the data IS the content" into hundreds
of indexable pages with no extra writing.

## Iterations

| # | Title | Status |
|---|-------|--------|
| 1 | Page generator + 40 sourcing pages | started |
| 2 | Routing corridor pages | pending |
| 3 | Customs landed-cost pages | pending |
| 4 | Warehouse hub pages | pending |
| 5 | SEO infrastructure (sitemap, JSON-LD, OG, robots.txt) | pending |
| 6 | Conversion CTAs + cross-linking | pending |
| 7 | PL localisations | pending |
| 8 | DE localisations | pending |
| 9 | Tests for generator | pending |
| 10 | Morning summary | pending |

## Progress log

Each iteration appends below.

### Iteration 1 — 2026-05-08 ~03:00

Started.

**Done:**
- Built `scripts/generate-seo-pages.js` — pure-JS generator using calculator data
- Generated 40 sourcing landing pages (5 countries × 8 categories) at `/guides/sourcing/`
- Plus sourcing index + guides root = 42 pages
- Per-page: SEO meta, canonical, JSON-LD, Open Graph, Twitter Card, country comparison table, sample suppliers, related-pages internal linking, sticky agent CTA
- Sitemap at `sitemap-guides.xml`
- 497/497 tests still passing
- `.claude/settings.local.json` added per user instruction so overnight tools don't stall

**Sample URL:** `/guides/sourcing/apparel-from-cn/` returns 200 with full content.

### Iteration 2 — 2026-05-08 ~03:30

**Done:**
- Extended `scripts/generate-seo-pages.js` with routing-page generator
- Generated 30 routing corridor pages: 5 origins (CN, VN, IN, HK, TR) × 6 destinations (DE, PL, NL, FR, IT, ES) at `/guides/routing/`
- Plus routing index = 31 new pages this iteration, **73 pages total**
- Per page: 4-mode comparison table (sea FCL / sea LCL / air / rail), per-band recommendations (200kg / 1t / 5t), rail-corridor explainer for CN-origin pages, "what's not in the cost" footnote
- Sticky agent CTA pre-fills the Logistics Agent with origin/destination
- Sitemap updated to 73 URLs
- Sample URL: `/guides/routing/cn-to-pl/` returns 200 with full rail-corridor section

### Iteration 3 — 2026-05-08 ~04:00

**Done:**
- Added customs landed-cost page generator: 6 SME-relevant HS chapters × 6 EU destinations = 36 pages at `/guides/customs/`
- Plus customs index = 37 new pages this iteration, **110 pages total**
- Per page: full duty + VAT + brokerage math line-by-line, anti-dumping warning for chapters 64/72/73/76 (CN-origin), Vietnam EVFTA preferential comparison showing exact duty saving, bonded warehouse alternative explainer, cross-destination comparison table
- Sticky CTA pre-fills the Compliance Agent with the chapter + destination context
- Sample URL: `/guides/customs/footwear-into-pl/` returns 200

### Iteration 4 — 2026-05-08 ~04:30

**Done:**
- Added warehouse hub generator: 6 hub pages (Rotterdam, Hamburg, Frankfurt, Poznań, Prague, Barcelona) at `/guides/warehouse/`
- Plus warehouse index = 7 new pages this iteration, **117 pages total**
- Per page: full pricing breakdown table, pros/cons, sample monthly cost for typical 1500-order SME profile, 6-hub comparison ranking, "what's not in the cost" footnote
- Sticky CTA pre-fills the Logistics Agent with the hub-comparison context
- **Bug fix:** slug function was stripping diacritics → `pozna-3pl` (broken). Now NFD-normalises and strips combining marks → `poznan-3pl` (correct). Future Polish/German/Czech additions will slug cleanly.

### Iteration 5 — 2026-05-08 ~05:00

**Done:**
- `robots.txt` at site root with both sitemaps declared, `/api/` disallowed (no SEO value, save crawl budget)
- Master `sitemap.xml` covering all 154 indexable URLs: homepage, /platform/, all 5 agents, all tool landing+quote pages, document forms, dashboard, existing pillar pages (sourcing/intelligence/finance/orcatrade), 117 generated guides, PL+DE locale roots
- Per-URL priority weighting: 1.0 homepage, 0.9 agents, 0.8 tool/agent landings, 0.7 guides, 0.6 forms, 0.5 dashboard
- Added "Guides" link to homepage nav secondary group (sits between Tools dropdown and Dashboard)
- All generated pages already had per-page JSON-LD structured data + Open Graph + Twitter Card from iter 1 (carried through iters 2-4)

### Iteration 6 — 2026-05-08 ~05:30

**Done:**
- 21-test generator test suite covering: slug helper (ASCII, diacritics, multi-word, edge cases), escapeHtml (XSS-safe), generated-page structural assertions (SEO meta, BreadcrumbList JSON-LD, anti-dumping conditional rendering, rail-corridor conditional rendering), sitemap content, robots.txt declarations, generator idempotence, and exact page-count check (40+30+36+6+5 = 117)
- **Two bug fixes caught by tests:**
  1. `escapeHtml` wasn't escaping single quotes — fixed (`'` → `&#39;`).
  2. `slug` was stripping `Ł` (Polish capital L with stroke) entirely because Unicode NFD doesn't decompose it. Added explicit override table: Ł/ł, Ø/ø, Đ/đ, Þ/þ, ß, Æ, Œ all map to ASCII equivalents.
- Full suite: **518 / 518 passing** (497 pre-existing + 21 new generator tests).

### Iteration 7 — 2026-05-08 ~06:00

**Done:**
- New `scripts/seo-pl-translations.js` — Polish dictionary: country names + genitive cases, region names, category labels + genitive forms + descriptions, risk-level labels, all UI strings
- Added Polish branch to generator: `generateSourcingPagePL`, `generateSourcingIndexPL`, `generateGuidesRootPL`
- All 40 sourcing × {country, category} pages now exist in Polish at `/pl/guides/sourcing/{slug}-z-{country}/`
- Plus `/pl/guides/sourcing/` index and `/pl/guides/` root
- **42 new Polish pages**, total now **159 guide pages**
- Master sitemap.xml updated to **196 indexable URLs**
- **hreflang tags wired across both EN and PL**: each page declares all available locales + x-default to EN. Google can now serve the right locale per searcher.
- Polish grammar correction: H1 changed from "Jak sourcować [genitive]" to "Sourcing [genitive]" (noun-phrase reads better than verb construct, also matches the keyword Polish founders actually search)
- Sample URL: `/pl/guides/sourcing/elektronika-z-vn/` returns 200 with correct Polish copy + hreflang
