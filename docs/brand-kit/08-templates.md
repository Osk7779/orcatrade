# 08 · Templates by channel

Templates are the day-to-day output of the brand kit. They're what the team actually uses. This file is the index — concrete files live alongside it as we ship them.

## Index

| Channel | Template | Status |
|---------|----------|--------|
| Blog | Hero block (kicker + H1 + lead paragraph + CTA row) | Spec below; design file pending |
| Blog | Section divider + body grid | Spec below |
| Blog | Quote pull-out | Spec below |
| LinkedIn | Profile banner (1584×396) | Pending design |
| LinkedIn | Square post (1080×1080) | Spec below |
| LinkedIn | Carousel slide (1080×1350, 10 slides) | Spec below |
| LinkedIn | Article hero (1200×627) | Spec below |
| Meta / Instagram | Square (1080×1080) | Spec below |
| Meta / Instagram | Tall (1080×1350) | Spec below |
| Meta / Instagram | Story / Reel (1080×1920) | Spec below |
| Google Search | Responsive ad (15 headlines × 4 descriptions) | Spec below |
| Google Display | 1200×628 + 300×250 + 320×100 | Pending |
| Email | Header + footer + signature | Spec below; HTML in `lib/handlers/contact.js` Resend output |
| Email | Newsletter layout | Spec below |
| Email | Transactional layout | Spec below |
| Slide deck | Cover + title + content + section divider + closing | Pending design |

## Blog

### Hero block

```
[KICKER · uppercase, gold, 0.74rem, letter-spaced 0.22em]
[H1, Cormorant Garant 600, clamp(2rem, 4vw + 0.5rem, 3rem), max 24ch]
[Lead paragraph, Geist Sans 1rem, max 60ch, 1.7 line height]
[CTA row: btn-primary + btn-ghost]
```

Specifically: every long-form post starts with a kicker. Don't break this pattern.

### Quote pull-out

```html
<blockquote class="hero-quote">
  <p>The pull quote in Cormorant Garant 600, italic, max 30ch per line.</p>
  <cite>Source — context after an em dash.</cite>
</blockquote>
```

Background: subtle gold gradient panel. Use sparingly — one per long-form post maximum.

## LinkedIn

### Square post (1080×1080)

Layout grid (default):
- Top-left 80×80 — OrcaTrade glyph
- Hero zone — Cormorant Garant 700 / 96pt, navy on ivory or ivory on navy
- Bottom-right 200×40 — gold accent block + CTA "Read the analysis →"

For numerical posts: switch the hero zone to a single Cormorant 700 / 240pt number, with a small Geist Sans label below.

### Carousel slide (1080×1350)

10-slide standard:
- **1** Cover: hook + glyph
- **2** Problem statement (one sentence)
- **3–8** Six expansion slides (one idea each, ~12–18 words)
- **9** "What this means for you" — actionable
- **10** CTA: visit the agent at orcatrade.com/agent/...

Each slide carries a slide number bottom-right (Geist Mono 14pt, gold, "1 / 10" format).

### Article hero (1200×627)

```
[Background image — Infrastructure or Operations photography from §06]
[Navy overlay 25% opacity]
[Centre-left text block, ivory typography]
  [Kicker — gold uppercase 14pt]
  [Headline — Cormorant Garant 600 / 48pt, max 24 chars per line]
  [Author — Geist Sans 14pt, "By Oskar Klepuszewski · OrcaTrade Group"]
[Bottom-right glyph]
```

## Meta / Instagram

Same square format as LinkedIn (1080×1080). Distinct on tall (1080×1350): we lean slightly more visual on Meta because feed scroll is faster — a stronger photographic background, less text density.

For Stories / Reels (1080×1920):
- Headline in the top third (out of safe zones for caption / engagement bars).
- Big visual centre.
- CTA + brand glyph in the bottom 15%.

## Google Search ads

Headline templates (15 variants — Google rotates):
1. CBAM Compliance for SME Importers
2. AI Trade Compliance · CBAM · EUDR
3. Asia → EU Routing in 60 Seconds
4. Polish Importer? Try OrcaTrade
5. Six EU 3PL Hubs · Side-by-Side
6. Sea, Rail or Air? · Free Calculator
7. China-Europe Rail · 70% Cheaper
8. Cited Against EUR-Lex
9. HK Office · Real Verification
10. Trade Operations Platform · €99
11. Five AI Agents · One Platform
12. Bonded Warehouse Calculator
13. Customs Duty + VAT Estimator
14. Supplier Verification · 17 Jurisdictions
15. Find Suppliers · CN VN IN BD TR

Description templates (4 variants):
1. Sourcing, compliance, logistics, finance — five AI agents that cite EUR-Lex on every claim.
2. Calculator-grounded recommendations. HK boots on the ground. Built for Polish/German SMEs.
3. Compliance Agent runs CBAM, EUDR, REACH, CE checks with audit-ready citations.
4. Free agents, transparent pricing, no chatbot fluff. Designed for serious operators.

## Email

### Newsletter layout

```
[Header: 600px wide, navy background, ivory logo, "OrcaTrade · Issue {n}"]
[Hero: kicker + H1 + 2-paragraph lead]
[Section 1: 1 long-form essay link with 80-word teaser]
[Section 2: 3 quick links — agent demos, calculator updates, partner news]
[Section 3: 1 number worth knowing this week]
[Footer: company info, unsubscribe, RESEND_FROM address]
```

### Transactional layout

Already implemented via Resend in `lib/handlers/contact.js`. Keep the existing template; only the brand director may modify.

```
[Logo top-left]
[Single H2 — what happened, plain]
[2-paragraph body, Geist Sans, no marketing language]
[Single primary CTA — "Open report →" or similar]
[Footer with unsubscribe + company info]
```

## Slide deck

5-slide template family pending design. Anchor on `docs/raport-orcatrade.html` and `docs/orcatrade-progress-report.html` as the print equivalents — same colour, type, kicker pattern.

## Localisation considerations

Every template must ship in EN / PL / DE variants. See [09-localisation.md](09-localisation.md) for the rules. Common pitfalls:
- German compound words break tight headlines (60-character heroes can become 90 in DE).
- Polish needs diacritics (ą, ć, ę, ł, ń, ó, ś, ź, ż) — verify font subsets include them. Geist + Cormorant Garant both do.
- Numerical formats: `€1,250.00` (EN) vs `1 250,00 €` (PL/DE).

---

**Section version:** 1.0 · 2026-05-08 · Specs only; concrete design files to follow as #6 commissions them.
