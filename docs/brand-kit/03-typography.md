# 03 · Typography

OrcaTrade's typographic identity is two faces working together — a serif that signals seriousness without stuffiness, and a clean grotesque that anchors the body.

## Live stack (canonical)

| Role | Family | Weights | Source |
|------|--------|---------|--------|
| **Display + headings** | Cormorant Garant | 400, 500, 600, 700 | Google Fonts |
| **Body + UI** | Geist Sans | 400, 500, 600, 700 | jsdelivr CDN |
| **Code, data, monospace** | Geist Mono | 400, 500 | Google Fonts |

These are loaded on every site page via:

```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@400;500;600;700&family=Geist+Mono&display=swap" rel="stylesheet"/>
<link href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css" rel="stylesheet"/>
```

## Type scale

Based on the live homepage and unit pages.

| Token | Size | Weight | Family | Use |
|-------|------|--------|--------|-----|
| Hero | `clamp(2.4rem, 5vw + 0.5rem, 3.8rem)` | 600 | Cormorant Garant | Page hero / cover |
| H1 | `clamp(2rem, 4vw + 0.5rem, 3rem)` | 600 | Cormorant Garant | Section heading |
| H2 | `1.4–1.8rem` | 600 | Cormorant Garant | Sub-section heading |
| H3 | `1.05–1.3rem` | 600 | Cormorant Garant | Card title |
| Section label | `0.7–0.74rem` letter-spacing 0.16–0.22em | 600 | Geist Sans **uppercase** | Kickers above headings |
| Body | `0.92–1rem` | 400 | Geist Sans | Paragraph |
| Caption | `0.78–0.85rem` | 400 | Geist Sans | Footer, supporting text |
| Code / data | `0.72–0.85rem` | 400 | Geist Mono | Numbers, technical references, citation chips |
| Stat number | `1.7–2rem` | 700 | Cormorant Garant | Stat tiles in feature grids |

## Style rules

### Cormorant Garant (display)

- Use for page heroes, section headings, stat numbers, card titles, brand voice quotes.
- **Italic** is reserved for the accent word in a hero — e.g. "One agent. *Every domain.*"
- Negative letter-spacing on hero (`-0.02em`) to tighten the silhouette.
- Never bold. Use weight 600 maximum. The serif gives the gravity; bold cheapens it.
- Never set Cormorant below 1rem — it stops feeling editorial and starts feeling broken.

### Geist Sans (body)

- Use for everything that's not a heading or a stat.
- Line height 1.55–1.7 in body. Tighter (1.18) in tabular contexts only.
- Sentence case for buttons. Title Case is reserved for navigation labels.
- Letter-spacing 0.04–0.18em on uppercase section labels (kickers). Tighter sounds like jewellery; looser sounds like a defence contractor — find the middle.

### Geist Mono (technical)

- Use for: numbers in stat tiles, currency figures (€179,100), HS codes, file paths, inline code, citation chips, tool-call traces in agent UIs.
- Never use Geist Mono for body copy. It signals "data" — using it elsewhere dilutes that signal.

## Do

- Pair Cormorant Garant headings with Geist Sans body. They were chosen together.
- Use `font-feature-settings: "tnum"` (tabular numbers) when numbers need to align in tables — Cormorant has this; Geist Sans needs the explicit setting.
- Use the section-label kicker treatment (uppercase Geist, letter-spaced) above every major hero or section heading. It's the brand's signature device.

## Don't

- Substitute Cormorant Garant with another serif (Playfair, Garamond, Source Serif). The character widths and italic feel diverge meaningfully.
- Use Geist Mono for marketing copy. It reads as a system font, not a brand voice.
- Set body copy below 0.92rem on web. It becomes hard work for German readers (longer compound words) and Polish readers (diacritics).
- Mix cases inside one heading ("Sea, Rail, OR Air?"). Use sentence case throughout headings.

---

**Section version:** 1.0 · 2026-05-08 · Sourced from agent and tool page CSS.
