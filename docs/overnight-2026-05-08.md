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
