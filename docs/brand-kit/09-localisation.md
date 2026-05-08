# 09 · Localisation

The site ships in EN, PL, and DE. The brand voice has one identity but three native registers.

## Languages

| Locale | URL prefix | Audience | Maintenance owner |
|--------|------------|----------|-------------------|
| EN | `/` (root) | Default; international, English-speaking SMEs, global investor / partner audience | #1 (Content Strategist) |
| PL | `/pl/` | Polish e-commerce founders (ICP 1) | #1 with native Polish reviewer |
| DE | `/de/` | German Mittelstand (ICP 2) | #1 with native German reviewer |

## What translates · what doesn't

### Always translate

- Hero copy, headings, body paragraphs.
- CTAs and button text.
- Email body, transactional templates, error messages.
- SEO metadata: `<title>`, `<meta description>`, OG tags.
- Form labels and validation strings.

### Never translate (keep in English)

- Product names: **OrcaTrade**, **Operations Orchestrator**, **Compliance Agent**, **Sourcing Agent**, etc.
- Code-like artefacts: HS codes, ISO country codes (CN, VN, DE, PL), Incoterms (FOB, CIF, DDP), regulation references (CBAM, EUDR, REACH, CE).
- Brand line: **Find it · Verify it · Ship it · Finance it** — translates as poetry, not as marketing copy. Decision: keep in English everywhere.
- File / format names (HTML, JSON, PDF, XLS).
- The `kicker` slug above section headings if it's a code-like reference (e.g., "Tier 1", "Sekcja 01" — translate the word, keep the structure).

### Translate carefully

- "Compliance" — *zgodność (regulacyjna)* in PL, *Compliance* (loanword now standard) or *Konformität* in DE.
- "Trade" — *handel* in PL, *Handel* in DE, but only where it's commerce-trade. "Trade-credit insurance" stays as-is in B2B.
- "Importer" — *importer* in PL, *Importeur* in DE.
- Currency: never translate "EUR" → "Euro" in body; reserve for spelled-out hero copy ("hundred-euro service fee") only.

## Numerical and date formats

| | EN | PL | DE |
|---|---|---|---|
| Decimal | `1,250.00` | `1 250,00` | `1.250,00` |
| Currency | `€1,250` | `1 250 €` | `1.250 €` (or `1.250,00 €`) |
| Date | `7 May 2026` | `7 maja 2026` | `7. Mai 2026` |
| Address | Street, City, Country | ul. Street, Postcode City | Street No., Postcode City |
| Phone | `+44 20 7946 0958` | `+48 22 123 45 67` | `+49 30 12345678` |

In code (`Intl.NumberFormat`), use:
- EN: `'en-IE'` (uses €, comma decimals, EU layout)
- PL: `'pl-PL'`
- DE: `'de-DE'`

## Voice register adjustments per locale

Same brand voice, native register.

### Polish (PL)

- **Use "Pan/Pani" formal address in marketing copy.** First-person plural ("My") for OrcaTrade voice.
- Avoid Anglicisms in body copy where a Polish word is natural (*procent* not *procent CTA*, *finansowanie* not *funding*).
- Use Polish em-dash spacing convention: word — word (with spaces, like German).

### German (DE)

- **Sie-form by default in marketing copy.** Du-form only in informal social posts (LinkedIn casual, never formal).
- Don't compound for the sake of it. "Asien-Europa-Importplattform" is correct German but reads as bureaucratic — prefer "Importplattform für Asien-Europa-Handel".
- Compound nouns: capitalise (German rule), but avoid stacking three+ in a single hero.

### English (EN)

- **British English** as the master variant (Polish + German native readers see UK English as more "European" than US English).
- Decisions: *organise* not *organize*, *centre* not *center*, *colour* not *color*. The site already uses UK throughout.
- Avoid US-only idioms ("hit a home run", "ballpark figure", "gas mileage").

## Hreflang & SEO

Every page has its localised siblings. Use `hreflang` tags on every page:

```html
<link rel="alternate" hreflang="en" href="https://orcatrade.pl/" />
<link rel="alternate" hreflang="pl" href="https://orcatrade.pl/pl/" />
<link rel="alternate" hreflang="de" href="https://orcatrade.pl/de/" />
<link rel="alternate" hreflang="x-default" href="https://orcatrade.pl/" />
```

This is critical for the programmatic SEO long tail (factory pages × 3 languages = 3× the indexed surface).

## Translation workflow

1. #1 (Content Strategist) drafts in EN.
2. Translation:
   - **PL:** native-speaker translator (founder review by Oskar — native Polish speaker).
   - **DE:** native-speaker translator (vetted contractor); founder review by an in-house DE speaker once hired.
3. #6 (Brand Director) reviews for voice consistency across locales.
4. #2 (SEO Engineer) checks meta + hreflang + URL structure.
5. Publish.

Avoid machine translation for marketing copy. The voice difference between an LLM-translated PL and a native-translated PL is large enough to matter on conversion. AI translation is fine for first-draft scaffolding only.

## Common pitfalls (caught in audits)

- Hardcoded English in a localised page (button labels, error messages, alt text).
- Missing diacritics in Polish (ą ć ę ł ń ó ś ź ż).
- US date format (`05/07/2026`) on a PL/DE page.
- "$" in place of "€" anywhere.
- English regulation-name expansions on PL/DE pages — keep the acronyms as-is, but the full name when first used should be the German/Polish full name.

---

**Section version:** 1.0 · 2026-05-08
