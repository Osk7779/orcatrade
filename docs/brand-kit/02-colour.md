# 02 · Colour

## Live tokens (canonical)

These values are the **single source of truth**. They live in [`css/styles.css`](../../css/styles.css) as CSS custom properties, and are mirrored here for non-engineering reference.

| Token | Hex | RGB | Role |
|-------|-----|-----|------|
| `--navy` | `#050507` | `5, 5, 7` | Primary background, deep panels |
| `--navy-soft` | `#080910` | `8, 9, 16` | Secondary background, card body |
| `--cream` | `#ececec` | `236, 236, 236` | Primary text on dark |
| `--cream-soft` | `#b6b8bf` | `182, 184, 191` | Secondary text on dark |
| `--gold` | `#b8bec8` | `184, 190, 200` | Accent — links, focus states, brand highlights |
| `--gold-soft` | `#6f7783` | `111, 119, 131` | Muted accent — borders, disabled states |
| `--error` | `#e15c5c` | `225, 92, 92` | Errors only — destructive actions, validation |
| `--panel` | `rgba(8, 11, 19, 0.82)` | — | Translucent overlay panel |
| `--panel-strong` | `rgba(10, 14, 24, 0.94)` | — | Heavy translucent panel |
| `--line` | `rgba(255, 255, 255, 0.09)` | — | Hairline dividers |
| `--glow` | `rgba(152, 160, 176, 0.16)` | — | Aurora background blob fill |

## Brand-document palette (extended, for print + decks)

For surfaces outside the CSS variable system (PDFs, decks, ads):

| Name | Hex | Use |
|------|-----|-----|
| Deep Navy | `#0a1628` | Cover pages, formal documents — replaces `--navy` for non-web |
| Mid Navy | `#0f2540` | Section dividers in long docs |
| Ivory | `#f5efe2` | Document background — warmer than pure white, less harsh than `--cream` |
| Brand Gold | `#c8a85a` | Featured/heritage brand highlight — used on PDF reports + hero accents (different from `--gold` which is the cooler web link colour) |
| Light Gold | `#d4b97a` | Brand Gold lighter pair — gradients, hover states |

These warmer values appear in `docs/raport-orcatrade.html` and `docs/orcatrade-progress-report.html` (the printed reports). They stay distinct from the cooler web `--gold` (`#b8bec8`) because print needs more contrast.

## Accessibility pairs

Always check contrast against [WCAG AA](https://www.w3.org/WAI/WCAG21/quickref/#contrast-minimum) (4.5:1 for body text, 3:1 for large text and UI components).

| Foreground | Background | Ratio | Pass |
|------------|------------|-------|------|
| `--cream` `#ececec` | `--navy` `#050507` | 16.8 : 1 | AAA |
| `--cream-soft` `#b6b8bf` | `--navy` `#050507` | 9.6 : 1 | AAA |
| `--gold` `#b8bec8` | `--navy` `#050507` | 9.9 : 1 | AAA |
| `--gold-soft` `#6f7783` | `--navy` `#050507` | 4.6 : 1 | AA |
| Brand Gold `#c8a85a` | Deep Navy `#0a1628` | 5.4 : 1 | AA |
| Brand Gold `#c8a85a` | Ivory `#f5efe2` | 2.5 : 1 | **fails AA — do not use Brand Gold on Ivory for body text** |

## Do

- Default to dark backgrounds (`--navy`) with light text. The site is built for that.
- Use `--gold` sparingly — accents only. It's a signal, not a fill.
- Use Brand Gold (`#c8a85a`) for printed assets and hero ad creative. Use `--gold` (`#b8bec8`) for web/UI.

## Don't

- Use red anywhere except for `--error` states. No "alert" or "warning" oranges either — minimalism preserves the regulatory-precise tone.
- Stack `--gold-soft` borders on `--navy-soft` cards (insufficient contrast).
- Introduce new accent colours without updating this file first.

---

**Section version:** 1.0 · 2026-05-08 · Sourced from `css/styles.css` :root.
