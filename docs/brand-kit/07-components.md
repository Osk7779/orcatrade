# 07 · Components

The OrcaTrade design system has a small set of reusable components that show up across the site. Reusing them keeps everything coherent; reinventing them fragments the brand.

The canonical implementations live in [`css/styles.css`](../../css/styles.css). This file is the human-readable index.

## Aurora background

A slow-drifting set of three soft accent blobs rendered behind the page. Used on every Tier 1 / Tier 2 / agent landing page.

```html
<div class="aurora" aria-hidden="true">
  <div class="aurora-blob b1"></div>
  <div class="aurora-blob b2"></div>
  <div class="aurora-blob b3"></div>
</div>
```

The blobs drift on cycles of 38s / 46s / 60s. Don't speed this up — slow motion is the point.

**Use when:** building any new long-form landing page or unit page.
**Don't use when:** building a calculator-only page (the form is the focus, the aurora is distraction). Inside the agent chat shell (the chat is the focus).

## Cursor spotlight

Soft glow that follows the cursor on group cards, tier cards, and tool cards. Defined as `.spotlight` in styles. Layered behind the card content.

**Use when:** displaying a grid of feature cards or service tiers where you want hover state to feel alive.
**Don't use when:** display would have more than 12 cards on screen — the effect becomes noisy.

## Card patterns

### Feature card

```html
<div class="feature-card">
  <div class="feature-num">01</div>
  <div class="feature-title">Name of the thing</div>
  <div class="feature-desc">Two sentences explaining it. Specific, numeric, no adjectives.</div>
</div>
```

Used on landing pages for explainer grids (4-up usually). The number plate (`feature-num`) is in Cormorant Garant 700, gold accent.

### Service / pricing card (`.card.spotlight`)

```html
<article class="card spotlight">
  <div class="card-tag">Tier 1 · Live</div>
  <h3 class="card-title">Service name</h3>
  <p class="card-body">Two sentences.</p>
  <ul class="card-list"><li>Bullet one</li><li>Bullet two</li></ul>
</article>
```

Used on `/pricing/`, `/platform/`, and Tier 1 / Tier 2 landing pages. Hosts the cursor-spotlight effect.

### Hub card (`.hub-card`)

Used on `/agents/` for the agent-hub grid. Has a CTA at the bottom and 2–3 deep-link prompt buttons inside.

### Module card (`.module-card`)

Used in the PDF reports (light theme). Card-tag / module-title / paragraph / file-path footer.

## Stat tiles (`.stat-grid` + `.stat`)

```html
<div class="stat-grid">
  <div class="stat">
    <div class="num">25</div>
    <div class="label">Tools across 4 domains</div>
  </div>
  ...
</div>
```

Used on hero sections and PDF reports to anchor numerical claims. Number in Cormorant 700, label in Geist Sans 8pt uppercase letter-spaced 0.16em.

**Rule:** never more than 4 stats in one row. Five becomes a wall.

## Buttons

| Class | Visual | Use |
|-------|--------|-----|
| `.btn-primary` | Filled gold (`--gold`) on dark, dark text | Primary action — "Run the calculator", "Open the Orchestrator" |
| `.btn-ghost` | Outline gold on dark, gold text | Secondary action — "Learn more", "See the spec" |
| `.suggestion-btn` | Outline subtle, body-coloured text | Demo prompt buttons in agent chat suggestions row |

Hover states: brightness +8%, translateY -1px, ~180ms.

## Section labels (kicker)

```html
<div class="kicker">Sekcja 02</div>
<h2>Section title</h2>
```

Or in Polish: `<p class="kicker">Operations · Tier 2</p>`.

The kicker is the brand's signature device — every major section starts with one. Geist Sans uppercase, letter-spacing 0.16–0.22em, gold colour. Always above the heading, never below.

## Tool-call trace (agent UIs)

The `.tool-trace` block renders inside an agent message bubble, showing each tool invocation as a row with ✓/✗ indicator. Used in the agent chat shell — don't reuse elsewhere.

## Citation chip

```html
<span class="cite" title="cbam-art-26">cbam-art-26</span>
```

Used in agent responses to mark a citation against the regulation corpus. The `js/markdown-renderer.js` produces these automatically when it sees `[chunk-id]` patterns.

## Don't invent

When you need something this kit doesn't have:

1. Check whether a near-match exists. Use that.
2. If you genuinely need new, propose it in the Friday retro. #6 reviews and either adds it to this file or rejects with reasoning.
3. Never publish a one-off component on a public-facing page. Inconsistency multiplies; one rogue card today becomes seven by Q4.

---

**Section version:** 1.0 · 2026-05-08 · Sourced from `css/styles.css` and live agent CSS.
