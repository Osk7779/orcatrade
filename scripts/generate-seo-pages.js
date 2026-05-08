#!/usr/bin/env node
// Programmatic SEO page generator.
//
// Reads the calculator data in lib/intelligence/* and emits static HTML
// landing pages under /guides/. Each page targets a long-tail keyword
// cluster the search engines see as informational + buyer-intent.
//
// Run: node scripts/generate-seo-pages.js
// Output: /guides/{sourcing|routing|customs|warehouse}/{slug}/index.html
//          + sitemap-guides.xml at root
//
// Idempotent: re-runnable. Overwrites existing pages from previous runs.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sourcing = require(path.join(ROOT, 'lib/intelligence/sourcing-quote'));
const routing = require(path.join(ROOT, 'lib/intelligence/routing-quote'));
const customs = require(path.join(ROOT, 'lib/intelligence/customs-quote'));
const warehouse = require(path.join(ROOT, 'lib/intelligence/warehouse-quote'));

const SITE_URL = 'https://orcatrade.pl';
const TODAY = new Date().toISOString().slice(0, 10);

const pl = require('./seo-pl-translations');
const de = require('./seo-de-translations');

// ── Helpers ────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Map Latin-script letters that don't decompose under NFD to ASCII equivalents.
// (Ł is U+0141, a precomposed Polish letter that NFD leaves intact; same for ß, æ, etc.)
const SLUG_OVERRIDES = {
  'Ł': 'L', 'ł': 'l',
  'Ø': 'O', 'ø': 'o',
  'Đ': 'D', 'đ': 'd',
  'Ð': 'D', 'ð': 'd',
  'Þ': 'Th', 'þ': 'th',
  'ß': 'ss',
  'Æ': 'Ae', 'æ': 'ae',
  'Œ': 'Oe', 'œ': 'oe',
};

function slug(s) {
  let str = String(s);
  for (const [ch, repl] of Object.entries(SLUG_OVERRIDES)) {
    str = str.split(ch).join(repl);
  }
  return str
    .normalize('NFD')                       // decompose accented chars (Poznań → Poznan + combining ́)
    .replace(/[̀-ͯ]/g, '')        // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writePage(relativePath, html) {
  const dir = path.join(ROOT, relativePath);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

// ── Page shell ─────────────────────────────────────────────

// Cross-link helper — re-resolved from disk so the path stays portable.
const { findRelatedH0, renderRelatedH0Aside } = require('./find-related-h0');

function pageShell({ title, description, canonical, jsonLd, body, locale = 'en', hreflangAlternates = [], relatedH0LinksHtml = '', linkContext = null }) {
  // If linkContext is supplied, compute related-H0 links from it. This is the
  // ergonomic path used by every generator. Pre-rendered relatedH0LinksHtml
  // remains supported for cases where the generator wants to override.
  if (linkContext && !relatedH0LinksHtml) {
    relatedH0LinksHtml = renderRelatedH0Aside(findRelatedH0({ ...linkContext, locale }), locale);
  }
  const ogImage = `${SITE_URL}/orcatrade_logo.png`;
  const hreflangTags = hreflangAlternates.map(a =>
    `<link rel="alternate" hreflang="${a.lang}" href="${a.href}" />`
  ).join('\n  ');
  const wizardHref = locale === 'en' ? '/start/' : `/${locale}/start/`;
  const planCta = {
    en: { kicker: 'Build your full plan', heading: "Don't just read — get a personalised plan in 60 seconds.", body: 'Six questions, all four calculators (sourcing, routing, customs, warehouse) compose your specific landed cost and recommendations. Free, calculator-grounded, no newsletter.', button: 'Build my plan →', backLink: 'Back to OrcaTrade Group', rights: 'All rights reserved.' },
    pl: { kicker: 'Zbuduj pełny plan',   heading: 'Nie tylko czytaj — otrzymaj spersonalizowany plan w 60 sekund.', body: 'Sześć pytań, cztery kalkulatory (sourcing, transport, odprawa, magazyn) skomponują Twój konkretny koszt landed i rekomendacje. Bezpłatnie, w oparciu o kalkulatory, bez newslettera.', button: 'Zbuduj mój plan →', backLink: 'Powrót do OrcaTrade Group', rights: 'Wszelkie prawa zastrzeżone.' },
    de: { kicker: 'Vollständigen Plan erstellen', heading: 'Nicht nur lesen — personalisierten Plan in 60 Sekunden erhalten.', body: 'Sechs Fragen, vier Kalkulatoren (Sourcing, Transport, Zoll, Lager) erstellen Ihre spezifischen Landed Costs und Empfehlungen. Kostenlos, kalkulator-basiert, kein Newsletter.', button: 'Plan erstellen →', backLink: 'Zurück zu OrcaTrade Group', rights: 'Alle Rechte vorbehalten.' },
  }[locale] || null;
  const cta = planCta || { kicker: 'Build your full plan', heading: "Don't just read — get a personalised plan in 60 seconds.", body: 'Six questions, all four calculators compose your specific landed cost.', button: 'Build my plan →', backLink: 'Back to OrcaTrade Group', rights: 'All rights reserved.' };
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonical}" />
  ${hreflangTags}
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${ogImage}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garant:wght@400;500;600;700&family=Geist+Mono&display=swap" rel="stylesheet"/>
  <link href="https://cdn.jsdelivr.net/npm/geist@1.3.0/dist/fonts/geist-sans/style.css" rel="stylesheet"/>
  <link rel="stylesheet" href="/css/styles.css">
  <style>
    .guide-shell { max-width: 920px; margin: 0 auto; padding: 3rem 1.5rem 6rem; position: relative; z-index: 1; }
    .guide-breadcrumb { font-size: 0.74rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 1.4rem; }
    .guide-breadcrumb a { color: rgba(255,255,255,0.55); text-decoration: none; }
    .guide-breadcrumb a:hover { color: rgba(255,255,255,0.95); }
    .guide-hero h1 { font-family: 'Cormorant Garant', Georgia, serif; font-size: clamp(2rem, 4vw + 0.5rem, 3rem); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; margin-bottom: 1rem; color: rgba(255,255,255,0.97); max-width: 24ch; }
    .guide-hero .lead { font-size: 1rem; line-height: 1.7; color: rgba(255,255,255,0.72); max-width: 60ch; }
    .guide-hero .kicker { font-family: 'Cormorant Garant', Georgia, serif; font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.22em; color: var(--accent-color, #b8bec8); margin-bottom: 1rem; }

    .guide-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.07); margin: 2rem 0; }
    @media (max-width: 700px) { .guide-stats { grid-template-columns: repeat(2, 1fr); } }
    .guide-stat { background: #0d0f14; padding: 1.1rem 1.2rem; }
    .guide-stat .num { font-family: 'Cormorant Garant', serif; font-size: 1.6rem; font-weight: 700; color: rgba(255,255,255,0.97); line-height: 1; letter-spacing: -0.02em; }
    .guide-stat .label { font-family: 'Geist Mono', monospace; font-size: 0.7rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-top: 0.4rem; }

    .guide-section { margin-top: 3rem; }
    .guide-section h2 { font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.01em; color: rgba(255,255,255,0.97); margin-bottom: 0.6rem; }
    .guide-section p { font-size: 0.95rem; line-height: 1.7; color: rgba(255,255,255,0.78); margin-bottom: 0.8em; max-width: 70ch; }
    .guide-section ul { font-size: 0.95rem; line-height: 1.7; color: rgba(255,255,255,0.78); padding-left: 1.4rem; max-width: 68ch; }
    .guide-section ul li { margin-bottom: 0.3em; }
    .guide-section strong { color: rgba(255,255,255,0.97); }

    .specialty-block, .caution-block { padding: 1rem 1.3rem; margin: 1.2rem 0; }
    .specialty-block { background: rgba(111, 166, 111, 0.06); border-left: 2px solid rgba(111, 166, 111, 0.5); }
    .caution-block { background: rgba(201, 80, 80, 0.06); border-left: 2px solid rgba(201, 80, 80, 0.5); }
    .specialty-block .label, .caution-block .label { font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; margin-bottom: 0.3rem; }
    .specialty-block .label { color: rgba(111, 166, 111, 0.95); }
    .caution-block .label { color: rgba(201, 80, 80, 0.85); }

    .data-table { width: 100%; border-collapse: collapse; margin: 1.2rem 0; font-size: 0.9rem; }
    .data-table th, .data-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.07); color: rgba(255,255,255,0.78); }
    .data-table th { background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.92); font-weight: 600; font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; }
    .data-table tr:nth-child(even) td { background: rgba(255,255,255,0.015); }
    .data-table .num { font-family: 'Geist Mono', monospace; }

    .related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.07); margin-top: 2rem; }
    @media (max-width: 700px) { .related-grid { grid-template-columns: 1fr; } }
    .related-card { background: #0d0f14; padding: 1rem 1.2rem; text-decoration: none; transition: background 0.15s; }
    .related-card:hover { background: rgba(184, 190, 200, 0.05); }
    .related-card .related-tag { font-size: 0.66rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-color, #b8bec8); margin-bottom: 0.3rem; }
    .related-card h3 { font-family: 'Cormorant Garant', serif; font-size: 0.98rem; font-weight: 600; color: rgba(255,255,255,0.94); margin-bottom: 0.2rem; line-height: 1.3; }
    .related-card .related-desc { font-size: 0.78rem; color: rgba(255,255,255,0.6); line-height: 1.5; }

    .agent-cta {
      position: sticky; bottom: 1.5rem; margin: 2.5rem 0 0;
      padding: 1.4rem 1.6rem;
      background: linear-gradient(135deg, rgba(184,190,200,0.1), rgba(184,190,200,0.02));
      border: 1px solid rgba(184,190,200,0.4);
      display: flex; align-items: center; justify-content: space-between; gap: 1.2rem;
      flex-wrap: wrap;
    }
    .agent-cta .cta-text { flex: 1; min-width: 240px; }
    .agent-cta .cta-text h3 { font-family: 'Cormorant Garant', serif; font-size: 1.15rem; font-weight: 600; margin-bottom: 0.3rem; color: rgba(255,255,255,0.97); }
    .agent-cta .cta-text p { font-size: 0.86rem; color: rgba(255,255,255,0.7); margin: 0; line-height: 1.5; }
    .agent-cta a { padding: 0.7rem 1.2rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; transition: filter 0.18s, transform 0.18s; flex-shrink: 0; }
    .agent-cta a:hover { filter: brightness(1.08); transform: translateY(-1px); }
  </style>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <div class="aurora" aria-hidden="true">
    <div class="aurora-blob b1"></div>
    <div class="aurora-blob b2"></div>
    <div class="aurora-blob b3"></div>
  </div>

  <div class="page">
    <header data-site-header></header>

    <main>
      <article class="guide-shell">
        ${body}
        ${relatedH0LinksHtml}
        <aside style="margin-top: 3rem; padding: 1.6rem 1.8rem; background: linear-gradient(135deg, rgba(184,168,114,0.08), rgba(184,190,200,0.03)); border: 1px solid rgba(200, 168, 90, 0.3); text-align: center;">
          <div style="font-family: 'Geist Mono', monospace; font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(200, 168, 90, 0.95); margin-bottom: 0.4rem; font-weight: 600;">${cta.kicker}</div>
          <h3 style="font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.25rem; font-weight: 600; color: rgba(255,255,255,0.97); margin: 0 0 0.4rem;">${cta.heading}</h3>
          <p style="font-size: 0.88rem; color: rgba(255,255,255,0.7); margin: 0 auto 1rem; max-width: 50ch; line-height: 1.6;">${cta.body}</p>
          <a href="${wizardHref}" style="display: inline-block; padding: 0.7rem 1.3rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none;">${cta.button}</a>
        </aside>
      </article>
    </main>

    <footer style="position: relative; z-index: 1;">
      <div class="footer-inner">
        <span>© <span id="year"></span> OrcaTrade Group. ${cta.rights}</span>
        <span><a href="/">${cta.backLink}</a></span>
      </div>
    </footer>
  </div>

  <script src="/js/cache-preferences.js"></script>
  <script src="/js/site-nav.js"></script>
  <script src="/js/main.js"></script>
  <script>document.getElementById('year').textContent = new Date().getFullYear();</script>
</body>
</html>`;
}

// ── Sourcing pages — Polish ─────────────────────────────────

function generateSourcingPagePL(country, categoryKey) {
  const countryInfo = sourcing.COUNTRIES[country];
  const category = sourcing.CATEGORIES[categoryKey];
  const profile = category.countryProfiles[country];
  if (!profile) return null;

  const countryNamePL = pl.COUNTRY_PL[country] || countryInfo.name;
  const countryGenPL = pl.COUNTRY_PL_GENITIVE[country] || countryNamePL;
  const cat = pl.CATEGORY_PL[categoryKey];
  if (!cat) return null;
  const regionPL = pl.REGION_PL[countryInfo.region] || countryInfo.region;
  const L = pl.LABEL_PL;

  const slugUrl = `${slug(categoryKey)}-z-${slug(country)}`;
  const title = `${cat.label} z ${countryGenPL} — koszt FOB · MOQ · czas dostawy | OrcaTrade`;
  const description = `Sourcing ${cat.genitive} z ${countryGenPL}: wskaźnik FOB ${profile.fobIndex}× względem Chin, ${profile.leadTimeWeeks} tyg. produkcji + ${countryInfo.seaTransitWeeks} tyg. transport morski, MOQ ${profile.minMoq}–${profile.typicalMoq}. Ryzyko jakości: ${pl.RISK_LABEL_PL[profile.qualityRisk]}, ryzyko IP: ${pl.RISK_LABEL_PL[profile.ipRisk]}.`.slice(0, 300);
  const canonical = `${SITE_URL}/pl/guides/sourcing/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/sourcing/${slug(categoryKey)}-from-${slug(country)}/`;
  const totalLeadTimeWeeks = profile.leadTimeWeeks + countryInfo.seaTransitWeeks;

  const samples = sourcing.SAMPLE_SUPPLIERS[country]?.[categoryKey] || [];

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title,
        description,
        datePublished: TODAY,
        dateModified: TODAY,
        inLanguage: 'pl',
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/pl/guides/` },
          { '@type': 'ListItem', position: 2, name: L.sourcingBreadcrumb, item: `${SITE_URL}/pl/guides/sourcing/` },
          { '@type': 'ListItem', position: 3, name: `${cat.label} z ${countryGenPL}`, item: canonical },
        ],
      },
    ],
  });

  const allCountries = Object.keys(sourcing.COUNTRIES).filter(c => c !== country);
  const related = allCountries
    .filter(c => category.countryProfiles[c])
    .sort((a, b) => category.countryProfiles[a].fobIndex - category.countryProfiles[b].fobIndex)
    .slice(0, 3);

  const samplesSection = samples.length > 0 ? `
    <section class="guide-section">
      <h2>${L.sampleSuppliers}</h2>
      <p>Anonimizowane przykłady z portfolio biura HK OrcaTrade. Realne wprowadzenia i raporty audytowe dostępne na żądanie partnerstwa.</p>
      <table class="data-table">
        <thead><tr><th>${L.city}</th><th>${L.specialty}</th><th>${L.sampleLeadTimeCol}</th><th>${L.minMoq}</th></tr></thead>
        <tbody>
          ${samples.map(s => `<tr><td>${escapeHtml(s.city)}</td><td>${escapeHtml(s.specialty)}</td><td>${escapeHtml(s.sampleLeadTime)}</td><td class="num">${s.minMoq}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · <a href="/pl/guides/sourcing/">${L.sourcingBreadcrumb}</a> · ${escapeHtml(cat.label)} z ${escapeHtml(countryGenPL)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">${L.sourcingGuide} · ${escapeHtml(regionPL)}</p>
      <h1>Sourcing ${escapeHtml(cat.genitive)} z ${escapeHtml(countryGenPL)}</h1>
      <p class="lead">${escapeHtml(cat.description)}. Poniżej: realny koszt FOB względem chińskiej linii bazowej, pełny czas dostawy łącznie z frachtem morskim do Rotterdamu, minimalne ilości zamówienia, oraz dyscyplina audytowa, której wymaga ta kombinacja kraju i kategorii przed pierwszym PO.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${profile.fobIndex}×</div><div class="label">${L.fobIndex}</div></div>
      <div class="guide-stat"><div class="num">${totalLeadTimeWeeks} ${L.weeks}</div><div class="label">${L.totalLeadTime}</div></div>
      <div class="guide-stat"><div class="num">${profile.minMoq}</div><div class="label">${L.minMoq}</div></div>
      <div class="guide-stat"><div class="num">${pl.RISK_LABEL_PL[profile.qualityRisk]}</div><div class="label">${L.qualityRisk}</div></div>
    </div>

    <section class="guide-section">
      <h2>${L.costAndLeadAtAGlance}</h2>
      <p>Dla ${escapeHtml(cat.genitive)} sourcowanych z ${escapeHtml(countryGenPL)}, benchmark OrcaTrade to <strong>wskaźnik FOB ${profile.fobIndex}</strong> względem chińskiej fabryki tier-2 (CN = 1,00). Oznacza to, że jednostka kupowana za 10 € FOB w Chinach kosztuje typowo ${(10 * profile.fobIndex).toFixed(2).replace('.', ',')} € w ${escapeHtml(countryGenPL)} — przed cłem, frachtem i ewentualnymi roszczeniami z tytułu preferencyjnego pochodzenia.</p>
      <p>Produkcja zajmuje ${profile.leadTimeWeeks} tygodni w fabryce; fracht morski z ${escapeHtml(countryGenPL)} do Rotterdamu dodaje <strong>${countryInfo.seaTransitWeeks} ${profile.leadTimeWeeks > 1 ? 'tygodnie' : 'tygodni'}</strong>. Łącznie od portu nadania do magazynu w EU: <strong>${totalLeadTimeWeeks} ${L.weeks}</strong>. Fracht lotniczy oszczędza 3-4 tygodnie przy znacznym narzucie kosztowym; dla zakresu 200-5000 kg z Chin kolej przez Małaszewicze jest 10-15 dni szybsza od morza.</p>
      <p>Zakresy MOQ: minimum to około <strong>${profile.minMoq}</strong> jednostek, typowe zamówienia to <strong>${profile.typicalMoq}</strong> jednostek. Poniżej minimum fabryki często deprioritetyzują małe zamówienia i dodają 1+ tydzień do terminu.</p>
    </section>

    <section class="guide-section">
      <h2>Specjalność i profil ryzyka</h2>
      <div class="specialty-block">
        <div class="label">${L.whereExcels}: ${escapeHtml(countryNamePL)}</div>
        <p style="margin: 0; color: rgba(255,255,255,0.85);">${escapeHtml(profile.specialty)}</p>
      </div>
      <div class="caution-block">
        <div class="label">${L.whereWatch}</div>
        <p style="margin: 0; color: rgba(255,255,255,0.85);">${escapeHtml(profile.caution)}</p>
      </div>
    </section>

    ${samplesSection}

    <section class="guide-section">
      <h2>${L.compareWithOthers}</h2>
      <p>Dla tej samej kategorii — ${escapeHtml(cat.genitive)} — w benchmarku OrcaTrade:</p>
      <table class="data-table">
        <thead><tr><th>Kraj</th><th>${L.fobIndex}</th><th>${L.productionLeadTime}</th><th>${L.seaTransit}</th><th>${L.totalLeadTime}</th><th>${L.qualityRisk}</th></tr></thead>
        <tbody>
          ${Object.keys(sourcing.COUNTRIES).map(c => {
            const ci = sourcing.COUNTRIES[c];
            const cp = category.countryProfiles[c];
            if (!cp) return '';
            const isCurrent = c === country;
            return `<tr${isCurrent ? ' style="background: rgba(184, 190, 200, 0.06);"' : ''}>
              <td>${escapeHtml(pl.COUNTRY_PL[c] || ci.name)}${isCurrent ? ' <span style="opacity:0.6;font-size:0.78em;">(ten przewodnik)</span>' : ''}</td>
              <td class="num">${cp.fobIndex}×</td>
              <td class="num">${cp.leadTimeWeeks} ${L.weeks}</td>
              <td class="num">${ci.seaTransitWeeks} ${L.weeks}</td>
              <td class="num">${cp.leadTimeWeeks + ci.seaTransitWeeks} ${L.weeks}</td>
              <td>${pl.RISK_LABEL_PL[cp.qualityRisk]}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${L.runComparison}</h3>
        <p>${L.runComparisonText}</p>
      </div>
      <a href="/agent/sourcing/?prompt=Szukam%20${encodeURIComponent(cat.genitive)}%20z%20${encodeURIComponent(countryNamePL)}.%20Por%C3%B3wnaj%20z%20innymi%20krajami%20pod%20k%C4%85tem%20kosztu%2C%20czasu%20dostawy%20i%20ryzyka%20IP.">Sourcing Agent →</a>
    </aside>

    <section class="guide-section">
      <h2>Powiązane przewodniki</h2>
      <div class="related-grid">
        ${related.map(c => {
          const ci = sourcing.COUNTRIES[c];
          const cp = category.countryProfiles[c];
          return `<a class="related-card" href="/pl/guides/sourcing/${slug(categoryKey)}-z-${slug(c)}/">
            <div class="related-tag">${escapeHtml(pl.REGION_PL[ci.region] || ci.region)}</div>
            <h3>${escapeHtml(cat.label)} z ${escapeHtml(pl.COUNTRY_PL_GENITIVE[c] || pl.COUNTRY_PL[c] || ci.name)}</h3>
            <div class="related-desc">FOB ${cp.fobIndex}× · ${cp.leadTimeWeeks + ci.seaTransitWeeks} ${L.weeks} · ryzyko jakości: ${pl.RISK_LABEL_PL[cp.qualityRisk]}</div>
          </a>`;
        }).join('')}
      </div>
    </section>
  `;

  const html = pageShell({
    title, description, canonical, jsonLd, body, locale: 'pl',
    hreflangAlternates: [
      { lang: 'en', href: enCanonical },
      { lang: 'pl', href: canonical },
      { lang: 'x-default', href: enCanonical },
    ],
    linkContext: { category: categoryKey, origin: country, pageType: 'sourcing' },
  });

  return { path: `pl/guides/sourcing/${slugUrl}`, canonical, html };
}

function generateSourcingIndexPL() {
  const L = pl.LABEL_PL;
  const title = 'Przewodniki sourcing — Azja → Europa według kraju i kategorii | OrcaTrade';
  const description = '40 przewodników sourcing pokrywających 5 krajów (Chiny / Wietnam / Indie / Bangladesz / Turcja) × 8 kategorii produktów. Koszt FOB, czas dostawy, MOQ, ryzyko jakości i IP dla każdej kombinacji.';
  const canonical = `${SITE_URL}/pl/guides/sourcing/`;
  const enCanonical = `${SITE_URL}/guides/sourcing/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    inLanguage: 'pl',
    url: canonical,
  });

  const sections = Object.keys(sourcing.CATEGORIES).map(catKey => {
    const cat = pl.CATEGORY_PL[catKey];
    if (!cat) return '';
    const links = Object.keys(sourcing.COUNTRIES).map(country => {
      const ci = sourcing.COUNTRIES[country];
      const cp = sourcing.CATEGORIES[catKey].countryProfiles[country];
      if (!cp) return '';
      const cnPL = pl.COUNTRY_PL_GENITIVE[country] || pl.COUNTRY_PL[country] || ci.name;
      return `<a class="related-card" href="/pl/guides/sourcing/${slug(catKey)}-z-${slug(country)}/">
        <div class="related-tag">${escapeHtml(pl.COUNTRY_PL[country] || ci.name)}</div>
        <h3>${escapeHtml(cat.label)} z ${escapeHtml(cnPL)}</h3>
        <div class="related-desc">FOB ${cp.fobIndex}× · ${cp.leadTimeWeeks + ci.seaTransitWeeks} tyg. · ${pl.RISK_LABEL_PL[cp.qualityRisk]}</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>${escapeHtml(cat.label)}</h2><p>${escapeHtml(cat.description)}</p><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · ${L.sourcingBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Przewodniki sourcing</p>
      <h1>Skąd sourcować. Według kraju i kategorii.</h1>
      <p class="lead">40 przewodników pokrywających pięć głównych azjatyckich rynków sourcingowych (Chiny, Wietnam, Indie, Bangladesz, Turcja) w ośmiu kategoriach produktowych. Każdy przewodnik niesie benchmark OrcaTrade dla wskaźnika FOB, czasu dostawy, zakresu MOQ, ryzyka jakości i IP.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Użyj Sourcing Agenta dla porównania na Twoich danych</h3>
        <p>Pomiń przeglądanie — opisz swój produkt, docelowe FOB, MOQ i pilność. Agent porówna pięć krajów na Twoim konkretnym briefie.</p>
      </div>
      <a href="/agent/sourcing/">Sourcing Agent →</a>
    </aside>
  `;

  return {
    path: 'pl/guides/sourcing',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body, locale: 'pl',
      hreflangAlternates: [
        { lang: 'en', href: enCanonical },
        { lang: 'pl', href: canonical },
        { lang: 'x-default', href: enCanonical },
      ],
    }),
  };
}

function generateGuidesRootPL() {
  const title = 'OrcaTrade — przewodniki dla importerów Azja-Europa';
  const description = 'Długie formy treści dla europejskich MŚP importujących z Azji. Porównania krajów sourcingowych, wybór trybu transportu, kalkulacje kosztów celnych, benchmark hubów 3PL w UE. Oparte na deterministycznych kalkulatorach.';
  const canonical = `${SITE_URL}/pl/guides/`;
  const enCanonical = `${SITE_URL}/guides/`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    inLanguage: 'pl',
    url: canonical,
  });

  const body = `
    <nav class="guide-breadcrumb"><a href="/pl/">Strona główna</a> · Przewodniki</nav>
    <header class="guide-hero">
      <p class="kicker">Przewodniki OrcaTrade</p>
      <h1>Przewodniki oparte na kalkulatorach dla handlu Azja–Europa.</h1>
      <p class="lead">Bez treści wypełniającej. Każdy przewodnik jest zakotwiczony w deterministycznych kalkulatorach OrcaTrade dla sourcingu, routingu, ceł i magazynowania — więc liczby, które czytasz, to te same liczby, które otrzymałbyś od agenta. Przeglądaj według domeny.</p>
    </header>

    <section class="guide-section">
      <h2>Sourcing</h2>
      <p>Skąd sourcować — porównania krajów dla Chin / Wietnamu / Indii / Bangladeszu / Turcji w ośmiu kategoriach produktów.</p>
      <a href="/pl/guides/sourcing/" style="display:inline-block; margin-top: 0.4rem; padding: 0.6rem 1rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.78rem; text-decoration: none;">Przeglądaj 40 przewodników →</a>
    </section>
  `;

  return {
    path: 'pl/guides',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body, locale: 'pl',
      hreflangAlternates: [
        { lang: 'en', href: enCanonical },
        { lang: 'pl', href: canonical },
        { lang: 'x-default', href: enCanonical },
      ],
    }),
  };
}

// ── Sourcing pages — German ─────────────────────────────────

function generateSourcingPageDE(country, categoryKey) {
  const countryInfo = sourcing.COUNTRIES[country];
  const category = sourcing.CATEGORIES[categoryKey];
  const profile = category.countryProfiles[country];
  if (!profile) return null;

  const countryNameDE = de.COUNTRY_DE[country] || countryInfo.name;
  const countryDativeDE = de.COUNTRY_DE_DATIVE[country] || `aus ${countryNameDE}`;
  const cat = de.CATEGORY_DE[categoryKey];
  if (!cat) return null;
  const regionDE = de.REGION_DE[countryInfo.region] || countryInfo.region;
  const L = de.LABEL_DE;

  const slugUrl = `${slug(categoryKey)}-${slug(country)}`;
  const title = `${cat.label} ${countryDativeDE} — FOB · MOQ · Lieferzeit | OrcaTrade`;
  const description = `Sourcing von ${cat.accusative} ${countryDativeDE}: FOB-Index ${profile.fobIndex}× gegenüber China-Basis, ${profile.leadTimeWeeks} Wochen Produktion + ${countryInfo.seaTransitWeeks} Wo. Seefracht, MOQ ${profile.minMoq}–${profile.typicalMoq}. Qualitätsrisiko: ${de.RISK_LABEL_DE[profile.qualityRisk]}, IP-Risiko: ${de.RISK_LABEL_DE[profile.ipRisk]}.`.slice(0, 300);
  const canonical = `${SITE_URL}/de/guides/sourcing/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/sourcing/${slug(categoryKey)}-from-${slug(country)}/`;
  const plCanonical = `${SITE_URL}/pl/guides/sourcing/${slug(categoryKey)}-z-${slug(country)}/`;
  const totalLeadTimeWeeks = profile.leadTimeWeeks + countryInfo.seaTransitWeeks;

  const samples = sourcing.SAMPLE_SUPPLIERS[country]?.[categoryKey] || [];

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title,
        description,
        datePublished: TODAY,
        dateModified: TODAY,
        inLanguage: 'de',
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/de/guides/` },
          { '@type': 'ListItem', position: 2, name: L.sourcingBreadcrumb, item: `${SITE_URL}/de/guides/sourcing/` },
          { '@type': 'ListItem', position: 3, name: `${cat.label} ${countryDativeDE}`, item: canonical },
        ],
      },
    ],
  });

  const allCountries = Object.keys(sourcing.COUNTRIES).filter(c => c !== country);
  const related = allCountries
    .filter(c => category.countryProfiles[c])
    .sort((a, b) => category.countryProfiles[a].fobIndex - category.countryProfiles[b].fobIndex)
    .slice(0, 3);

  const samplesSection = samples.length > 0 ? `
    <section class="guide-section">
      <h2>${L.sampleSuppliers}</h2>
      <p>Anonymisierte Beispiele aus dem OrcaTrade-Hongkong-Portfolio. Echte Vorstellungen und Audit-Daten auf Anfrage über das Partnernetzwerk.</p>
      <table class="data-table">
        <thead><tr><th>${L.city}</th><th>${L.specialty}</th><th>${L.sampleLeadTimeCol}</th><th>${L.minMoq}</th></tr></thead>
        <tbody>
          ${samples.map(s => `<tr><td>${escapeHtml(s.city)}</td><td>${escapeHtml(s.specialty)}</td><td>${escapeHtml(s.sampleLeadTime)}</td><td class="num">${s.minMoq}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · <a href="/de/guides/sourcing/">${L.sourcingBreadcrumb}</a> · ${escapeHtml(cat.label)} ${escapeHtml(countryDativeDE)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">${L.sourcingGuide} · ${escapeHtml(regionDE)}</p>
      <h1>Sourcing: ${escapeHtml(cat.accusative)} ${escapeHtml(countryDativeDE)}</h1>
      <p class="lead">${escapeHtml(cat.description)}. Im Folgenden: realer FOB-Kostenindex gegenüber der chinesischen Basislinie, vollständige Lieferzeit inklusive Seefracht nach Rotterdam, realistische Mindestbestellmengen, sowie die Audit-Disziplin, die diese Land-Kategorie-Kombination vor der ersten PO erfordert.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${profile.fobIndex}×</div><div class="label">${L.fobIndex}</div></div>
      <div class="guide-stat"><div class="num">${totalLeadTimeWeeks} ${L.weeks}</div><div class="label">${L.totalLeadTime}</div></div>
      <div class="guide-stat"><div class="num">${profile.minMoq}</div><div class="label">${L.minMoq}</div></div>
      <div class="guide-stat"><div class="num">${de.RISK_LABEL_DE[profile.qualityRisk]}</div><div class="label">${L.qualityRisk}</div></div>
    </div>

    <section class="guide-section">
      <h2>${L.costAndLeadAtAGlance}</h2>
      <p>Für ${escapeHtml(cat.accusative)} ${escapeHtml(countryDativeDE)} liegt der OrcaTrade-Benchmark bei einem <strong>FOB-Index von ${profile.fobIndex}</strong> gegenüber einer chinesischen Tier-2-Fabrik (CN = 1,00). Eine Einheit, die in China zu 10 € FOB eingekauft wird, kostet ${countryDativeDE} typischerweise ${(10 * profile.fobIndex).toFixed(2).replace('.', ',')} € — vor Zoll, Fracht und etwaigen präferenziellen Ursprungsansprüchen.</p>
      <p>Die Produktion in der Fabrik dauert ${profile.leadTimeWeeks} Wochen; die Seefracht ${escapeHtml(countryDativeDE)} nach Rotterdam fügt <strong>${countryInfo.seaTransitWeeks} ${countryInfo.seaTransitWeeks === 1 ? 'Woche' : 'Wochen'}</strong> hinzu. Gesamt von Tor zu Tor: <strong>${totalLeadTimeWeeks} ${L.weeks}</strong>. Luftfracht spart 3–4 Wochen mit erheblichem Kostenaufschlag; für 200–5000 kg aus China ist die Schiene über Małaszewicze 10–15 Tage schneller als die See.</p>
      <p>MOQ-Bandbreiten: Mindestens akzeptabel sind etwa <strong>${profile.minMoq}</strong> Einheiten, typische Aufträge umfassen <strong>${profile.typicalMoq}</strong> Einheiten. Unter dem Minimum priorisieren Fabriken kleine Aufträge oft niedriger und addieren mindestens 1 Woche zur Lieferzeit.</p>
    </section>

    <section class="guide-section">
      <h2>Spezialität und Risikoprofil</h2>
      <div class="specialty-block">
        <div class="label">${L.whereExcels}: ${escapeHtml(countryNameDE)}</div>
        <p style="margin: 0; color: rgba(255,255,255,0.85);">${escapeHtml(profile.specialty)}</p>
      </div>
      <div class="caution-block">
        <div class="label">${L.whereWatch}</div>
        <p style="margin: 0; color: rgba(255,255,255,0.85);">${escapeHtml(profile.caution)}</p>
      </div>
    </section>

    ${samplesSection}

    <section class="guide-section">
      <h2>${L.compareWithOthers}</h2>
      <p>Für die gleiche Kategorie — ${escapeHtml(cat.accusative)} — im OrcaTrade-Benchmark:</p>
      <table class="data-table">
        <thead><tr><th>Land</th><th>${L.fobIndex}</th><th>${L.productionLeadTime}</th><th>${L.seaTransit}</th><th>${L.totalLeadTime}</th><th>${L.qualityRisk}</th></tr></thead>
        <tbody>
          ${Object.keys(sourcing.COUNTRIES).map(c => {
            const ci = sourcing.COUNTRIES[c];
            const cp = category.countryProfiles[c];
            if (!cp) return '';
            const isCurrent = c === country;
            return `<tr${isCurrent ? ' style="background: rgba(184, 190, 200, 0.06);"' : ''}>
              <td>${escapeHtml(de.COUNTRY_DE[c] || ci.name)}${isCurrent ? ' <span style="opacity:0.6;font-size:0.78em;">(dieser Leitfaden)</span>' : ''}</td>
              <td class="num">${cp.fobIndex}×</td>
              <td class="num">${cp.leadTimeWeeks} ${L.weeks}</td>
              <td class="num">${ci.seaTransitWeeks} ${L.weeks}</td>
              <td class="num">${cp.leadTimeWeeks + ci.seaTransitWeeks} ${L.weeks}</td>
              <td>${de.RISK_LABEL_DE[cp.qualityRisk]}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${L.runComparison}</h3>
        <p>${L.runComparisonText}</p>
      </div>
      <a href="/agent/sourcing/?prompt=Ich%20suche%20${encodeURIComponent(cat.accusative)}%20${encodeURIComponent(countryDativeDE)}.%20Vergleichen%20Sie%20mit%20anderen%20Herkunftsl%C3%A4ndern%20bei%20Kosten%2C%20Lieferzeit%20und%20IP-Risiko.">Sourcing Agent →</a>
    </aside>

    <section class="guide-section">
      <h2>${L.related}</h2>
      <div class="related-grid">
        ${related.map(c => {
          const ci = sourcing.COUNTRIES[c];
          const cp = category.countryProfiles[c];
          return `<a class="related-card" href="/de/guides/sourcing/${slug(categoryKey)}-${slug(c)}/">
            <div class="related-tag">${escapeHtml(de.REGION_DE[ci.region] || ci.region)}</div>
            <h3>${escapeHtml(cat.label)} ${escapeHtml(de.COUNTRY_DE_DATIVE[c] || `aus ${de.COUNTRY_DE[c] || ci.name}`)}</h3>
            <div class="related-desc">FOB ${cp.fobIndex}× · ${cp.leadTimeWeeks + ci.seaTransitWeeks} ${L.weeks} · Qualitätsrisiko: ${de.RISK_LABEL_DE[cp.qualityRisk]}</div>
          </a>`;
        }).join('')}
      </div>
    </section>
  `;

  const html = pageShell({
    title, description, canonical, jsonLd, body, locale: 'de',
    hreflangAlternates: [
      { lang: 'en', href: enCanonical },
      { lang: 'pl', href: plCanonical },
      { lang: 'de', href: canonical },
      { lang: 'x-default', href: enCanonical },
    ],
    linkContext: { category: categoryKey, origin: country, pageType: 'sourcing' },
  });

  return { path: `de/guides/sourcing/${slugUrl}`, canonical, html };
}

function generateSourcingIndexDE() {
  const L = de.LABEL_DE;
  const title = 'Sourcing-Leitfäden — Asien → Europa nach Land und Kategorie | OrcaTrade';
  const description = '40 Sourcing-Leitfäden zu 5 Ländern (China / Vietnam / Indien / Bangladesch / Türkei) × 8 Produktkategorien. FOB-Kosten, Lieferzeit, MOQ, Qualitäts- und IP-Risiko pro Kombination.';
  const canonical = `${SITE_URL}/de/guides/sourcing/`;
  const enCanonical = `${SITE_URL}/guides/sourcing/`;
  const plCanonical = `${SITE_URL}/pl/guides/sourcing/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    inLanguage: 'de',
    url: canonical,
  });

  const sections = Object.keys(sourcing.CATEGORIES).map(catKey => {
    const cat = de.CATEGORY_DE[catKey];
    if (!cat) return '';
    const links = Object.keys(sourcing.COUNTRIES).map(country => {
      const ci = sourcing.COUNTRIES[country];
      const cp = sourcing.CATEGORIES[catKey].countryProfiles[country];
      if (!cp) return '';
      const cnDE = de.COUNTRY_DE_DATIVE[country] || `aus ${de.COUNTRY_DE[country] || ci.name}`;
      return `<a class="related-card" href="/de/guides/sourcing/${slug(catKey)}-${slug(country)}/">
        <div class="related-tag">${escapeHtml(de.COUNTRY_DE[country] || ci.name)}</div>
        <h3>${escapeHtml(cat.label)} ${escapeHtml(cnDE)}</h3>
        <div class="related-desc">FOB ${cp.fobIndex}× · ${cp.leadTimeWeeks + ci.seaTransitWeeks} Wo. · ${de.RISK_LABEL_DE[cp.qualityRisk]}</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>${escapeHtml(cat.label)}</h2><p>${escapeHtml(cat.description)}</p><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · ${L.sourcingBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Sourcing-Leitfäden</p>
      <h1>Wo Sie sourcen sollten. Nach Land, nach Kategorie.</h1>
      <p class="lead">40 Leitfäden zu den fünf wichtigsten asiatischen Sourcing-Märkten (China, Vietnam, Indien, Bangladesch, Türkei) in acht Produktkategorien. Jeder Leitfaden enthält den OrcaTrade-Benchmark für FOB-Index, Lieferzeit, MOQ-Bandbreite sowie Qualitäts- und IP-Risiko.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Sourcing Agent für einen maßgeschneiderten Vergleich</h3>
        <p>Beschreiben Sie Ihr Produkt, FOB-Ziel, MOQ und Dringlichkeit. Der Agent vergleicht alle fünf Länder anhand Ihres konkreten Briefings.</p>
      </div>
      <a href="/agent/sourcing/">Sourcing Agent →</a>
    </aside>
  `;

  return {
    path: 'de/guides/sourcing',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body, locale: 'de',
      hreflangAlternates: [
        { lang: 'en', href: enCanonical },
        { lang: 'pl', href: plCanonical },
        { lang: 'de', href: canonical },
        { lang: 'x-default', href: enCanonical },
      ],
    }),
  };
}

function generateGuidesRootDE() {
  const title = 'OrcaTrade Leitfäden — Sourcing, Routing, Zoll, Lager für Importeure aus Asien';
  const description = 'Ausführliche Leitfäden für europäische KMU, die aus Asien importieren. Länder-Sourcing-Vergleiche, Transportmodus-Auswahl, Zoll-Landed-Cost-Berechnungen, EU-3PL-Hub-Benchmarks. Calculator-fundiert.';
  const canonical = `${SITE_URL}/de/guides/`;
  const enCanonical = `${SITE_URL}/guides/`;
  const plCanonical = `${SITE_URL}/pl/guides/`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    inLanguage: 'de',
    url: canonical,
  });

  const body = `
    <nav class="guide-breadcrumb"><a href="/de/">Startseite</a> · Leitfäden</nav>
    <header class="guide-hero">
      <p class="kicker">OrcaTrade Leitfäden</p>
      <h1>Calculator-fundierte Leitfäden für den Asien–Europa-Handel.</h1>
      <p class="lead">Keine Füllinhalte. Jeder Leitfaden ist mit den deterministischen OrcaTrade-Calculatoren für Sourcing, Routing, Zoll und Lagerung verankert — die Zahlen, die Sie lesen, sind dieselben, die Sie vom Agenten erhalten würden. Durchsuchen Sie nach Domäne.</p>
    </header>

    <section class="guide-section">
      <h2>Sourcing</h2>
      <p>Wo zu sourcen — Ländervergleiche zu China / Vietnam / Indien / Bangladesch / Türkei in acht Produktkategorien.</p>
      <a href="/de/guides/sourcing/" style="display:inline-block; margin-top: 0.4rem; padding: 0.6rem 1rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.78rem; text-decoration: none;">40 Leitfäden ansehen →</a>
    </section>
  `;

  return {
    path: 'de/guides',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body, locale: 'de',
      hreflangAlternates: [
        { lang: 'en', href: enCanonical },
        { lang: 'pl', href: plCanonical },
        { lang: 'de', href: canonical },
        { lang: 'x-default', href: enCanonical },
      ],
    }),
  };
}

// ── Sourcing pages ──────────────────────────────────────────

function generateSourcingPage(country, categoryKey) {
  const countryInfo = sourcing.COUNTRIES[country];
  const category = sourcing.CATEGORIES[categoryKey];
  const profile = category.countryProfiles[country];

  const slugUrl = `${slug(categoryKey)}-from-${slug(country)}`;
  const title = `Source ${category.label} from ${countryInfo.name} | FOB cost · MOQ · lead time | OrcaTrade`;
  const description = `Sourcing ${category.label.toLowerCase()} from ${countryInfo.name}: FOB index ${profile.fobIndex}× CN baseline, ${profile.leadTimeWeeks}-week production + ${countryInfo.seaTransitWeeks}w sea transit, MOQ ${profile.minMoq}–${profile.typicalMoq}. ${profile.qualityRisk} quality risk, ${profile.ipRisk} IP risk.`.slice(0, 300);
  const canonical = `${SITE_URL}/guides/sourcing/${slugUrl}/`;
  const totalLeadTimeWeeks = profile.leadTimeWeeks + countryInfo.seaTransitWeeks;

  // Sample suppliers if curated
  const samples = sourcing.SAMPLE_SUPPLIERS[country]?.[categoryKey] || [];

  // JSON-LD structured data
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title,
        description,
        datePublished: TODAY,
        dateModified: TODAY,
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        publisher: {
          '@type': 'Organization',
          name: 'OrcaTrade Group',
          logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` },
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Guides', item: `${SITE_URL}/guides/` },
          { '@type': 'ListItem', position: 2, name: 'Sourcing', item: `${SITE_URL}/guides/sourcing/` },
          { '@type': 'ListItem', position: 3, name: `${category.label} from ${countryInfo.name}`, item: canonical },
        ],
      },
    ],
  });

  // Pull related pages: same category in other countries (top 3 cheapest)
  const allCountries = Object.keys(sourcing.COUNTRIES).filter(c => c !== country);
  const related = allCountries
    .filter(c => category.countryProfiles[c])
    .sort((a, b) => category.countryProfiles[a].fobIndex - category.countryProfiles[b].fobIndex)
    .slice(0, 3);

  const samplesSection = samples.length > 0 ? `
    <section class="guide-section">
      <h2>Sample suppliers</h2>
      <p>Anonymised portfolio examples from OrcaTrade's HK office. Real introductions and audit data are available via partner request.</p>
      <table class="data-table">
        <thead><tr><th>City</th><th>Specialty</th><th>Sample lead time</th><th>Min MOQ</th></tr></thead>
        <tbody>
          ${samples.map(s => `<tr><td>${escapeHtml(s.city)}</td><td>${escapeHtml(s.specialty)}</td><td>${escapeHtml(s.sampleLeadTime)}</td><td class="num">${s.minMoq}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/">Home</a> · <a href="/guides/">Guides</a> · <a href="/guides/sourcing/">Sourcing</a> · ${escapeHtml(category.label)} from ${escapeHtml(countryInfo.name)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">Sourcing guide · ${escapeHtml(countryInfo.region)}</p>
      <h1>How to source ${escapeHtml(category.label.toLowerCase())} from ${escapeHtml(countryInfo.name)}</h1>
      <p class="lead">${escapeHtml(category.description)}. Below: realistic FOB cost vs Chinese baseline, full lead time including sea freight to Rotterdam, minimum order quantities you'll actually negotiate with, and what audit discipline this country × category combination demands before signing your first PO.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${profile.fobIndex}×</div><div class="label">FOB cost vs CN baseline</div></div>
      <div class="guide-stat"><div class="num">${totalLeadTimeWeeks}w</div><div class="label">Production + sea transit</div></div>
      <div class="guide-stat"><div class="num">${profile.minMoq}</div><div class="label">Minimum MOQ</div></div>
      <div class="guide-stat"><div class="num">${profile.qualityRisk}</div><div class="label">Quality risk</div></div>
    </div>

    <section class="guide-section">
      <h2>Cost and lead time at a glance</h2>
      <p>For ${escapeHtml(category.label.toLowerCase())} sourced from ${escapeHtml(countryInfo.name)}, OrcaTrade's benchmark is <strong>FOB index ${profile.fobIndex}</strong> relative to a Chinese tier-2 factory baseline (CN = 1.00). This means a unit you'd buy at €10 FOB from China typically lands at €${(10 * profile.fobIndex).toFixed(2)} from ${escapeHtml(countryInfo.name)} — before duty, freight, and any preferential origin claims.</p>
      <p>Production runs ${profile.leadTimeWeeks} weeks at the factory; sea freight from ${escapeHtml(countryInfo.name)} to Rotterdam adds <strong>${countryInfo.seaTransitWeeks} weeks</strong>. Total door-to-warehouse: <strong>${totalLeadTimeWeeks} weeks</strong>. Air freight saves 3-4 weeks at significant cost premium; for the 200-5000 kg sweet spot from China, rail via Małaszewicze is faster than sea by 10-15 days.</p>
      <p>MOQ bands: minimum acceptable is around <strong>${profile.minMoq}</strong> units, typical orders are <strong>${profile.typicalMoq}</strong> units. Below the minimum, factories often deprioritise small orders and add 1+ week to the lead time.</p>
    </section>

    <section class="guide-section">
      <h2>Specialty and risk profile</h2>
      <div class="specialty-block">
        <div class="label">Where ${escapeHtml(countryInfo.name)} excels</div>
        <p style="margin: 0; color: rgba(255,255,255,0.85);">${escapeHtml(profile.specialty)}</p>
      </div>
      <div class="caution-block">
        <div class="label">Watch for</div>
        <p style="margin: 0; color: rgba(255,255,255,0.85);">${escapeHtml(profile.caution)}</p>
      </div>
    </section>

    <section class="guide-section">
      <h2>Country context</h2>
      <ul>${countryInfo.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </section>

    <section class="guide-section">
      <h2>Quality and IP risk</h2>
      <p><strong>Quality risk: ${escapeHtml(profile.qualityRisk)}.</strong> ${
        profile.qualityRisk === 'high' ? 'A third-party audit (SGS, Bureau Veritas, or Intertek) before contract signature is mandatory, plus AQL inspection on every shipment.' :
        profile.qualityRisk === 'medium' ? 'A factory inspection before the first order is recommended, with AQL on the first 3 shipments.' :
        'Pre-shipment AQL inspection is the standard. Full audit is optional except for high-value contracts.'
      }</p>
      <p><strong>IP risk: ${escapeHtml(profile.ipRisk)}.</strong> ${
        profile.ipRisk === 'high' ? 'For unique designs, custom moulds, or branded electronics, use NNN agreements (Non-Disclosure, Non-Use, Non-Circumvention) and partition tooling across two suppliers to limit exposure.' :
        profile.ipRisk === 'medium' ? 'Standard NDA + clear ownership clauses on tooling and design files in the master agreement.' :
        'Standard contractual protections sufficient for most categories. EU contract law prevails where the relationship is well-documented.'
      }</p>
    </section>

    ${samplesSection}

    <section class="guide-section">
      <h2>Compare with other origins</h2>
      <p>For the same category — ${escapeHtml(category.label.toLowerCase())} — across the OrcaTrade benchmark:</p>
      <table class="data-table">
        <thead><tr><th>Country</th><th>FOB index</th><th>Production lead</th><th>Sea transit</th><th>Total lead</th><th>Quality risk</th></tr></thead>
        <tbody>
          ${Object.keys(sourcing.COUNTRIES).map(c => {
            const ci = sourcing.COUNTRIES[c];
            const cp = category.countryProfiles[c];
            if (!cp) return '';
            const isCurrent = c === country;
            return `<tr${isCurrent ? ' style="background: rgba(184, 190, 200, 0.06);"' : ''}>
              <td>${escapeHtml(ci.name)}${isCurrent ? ' <span style="opacity:0.6;font-size:0.78em;">(this guide)</span>' : ''}</td>
              <td class="num">${cp.fobIndex}×</td>
              <td class="num">${cp.leadTimeWeeks}w</td>
              <td class="num">${ci.seaTransitWeeks}w</td>
              <td class="num">${cp.leadTimeWeeks + ci.seaTransitWeeks}w</td>
              <td>${cp.qualityRisk}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    <section class="guide-section">
      <h2>Next concrete step</h2>
      <p>If you're at the <em>"choose a sourcing country"</em> stage, run a free comparison through the OrcaTrade Sourcing Agent — it ranks all five countries on cost, quality, IP risk, and lead time for your specific MOQ and urgency. If you're at the <em>"need real supplier introductions"</em> stage, the OrcaTrade HK office runs a 2-4 week supplier-discovery sprint and returns a 5-supplier longlist with samples.</p>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Run the comparison</h3>
        <p>Sourcing Agent compares all 5 countries on cost, lead time, IP risk, and audit discipline for your category and MOQ.</p>
      </div>
      <a href="/agent/sourcing/?prompt=I%27m%20looking%20to%20source%20${encodeURIComponent(category.label.toLowerCase())}%20from%20${encodeURIComponent(countryInfo.name)}.%20Compare%20against%20other%20origins%20on%20cost%2C%20lead%20time%2C%20and%20IP%20risk.">Open Sourcing Agent →</a>
    </aside>

    <section class="guide-section">
      <h2>Related guides</h2>
      <div class="related-grid">
        ${related.map(c => {
          const ci = sourcing.COUNTRIES[c];
          const cp = category.countryProfiles[c];
          return `<a class="related-card" href="/guides/sourcing/${slug(categoryKey)}-from-${slug(c)}/">
            <div class="related-tag">${escapeHtml(ci.region)}</div>
            <h3>${escapeHtml(category.label)} from ${escapeHtml(ci.name)}</h3>
            <div class="related-desc">FOB index ${cp.fobIndex}× · ${cp.leadTimeWeeks + ci.seaTransitWeeks}w total · ${cp.qualityRisk} quality risk</div>
          </a>`;
        }).join('')}
      </div>
    </section>
  `;

  const plCanonical = `${SITE_URL}/pl/guides/sourcing/${slug(categoryKey)}-z-${slug(country)}/`;
  const deCanonical = `${SITE_URL}/de/guides/sourcing/${slug(categoryKey)}-${slug(country)}/`;
  return {
    path: `guides/sourcing/${slugUrl}`,
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: plCanonical },
        { lang: 'de', href: deCanonical },
        { lang: 'x-default', href: canonical },
      ],
      linkContext: { category: categoryKey, origin: country, pageType: 'sourcing' },
    }),
  };
}

// ── Routing pages ──────────────────────────────────────────

const ROUTING_ORIGINS = ['CN', 'VN', 'IN', 'HK', 'TR'];
const ROUTING_DESTINATIONS = ['DE', 'PL', 'NL', 'FR', 'IT', 'ES'];
const COUNTRY_NAMES = {
  CN: 'China', VN: 'Vietnam', IN: 'India', HK: 'Hong Kong', TR: 'Türkiye',
  DE: 'Germany', PL: 'Poland', NL: 'Netherlands', FR: 'France', IT: 'Italy', ES: 'Spain',
};

function generateRoutingPage(origin, destination) {
  const originName = COUNTRY_NAMES[origin];
  const destName = COUNTRY_NAMES[destination];

  // Compute representative quotes for three weight bands so the page has real data
  const bands = [
    { kg: 200, label: '200 kg' },
    { kg: 1000, label: '1,000 kg' },
    { kg: 5000, label: '5,000 kg' },
  ];
  const quotes = bands.map(b => ({
    band: b.label,
    weightKg: b.kg,
    quote: routing.calculateQuote({ weightKg: b.kg, volumeCbm: b.kg / 200, originCountry: origin, destinationCountry: destination }),
  }));

  const railViable = routing.isRailViable({ originCountry: origin, destinationCountry: destination });

  const slugUrl = `${slug(origin)}-to-${slug(destination)}`;
  const title = `Ship from ${originName} to ${destName} — sea, rail, air comparison | OrcaTrade`;
  const description = `Multi-modal freight comparison ${originName} → ${destName}: sea FCL, sea LCL, air, ${railViable ? 'and rail (China-Europe corridor) ' : ''}with cost, transit time, CO₂ per shipment band. Calculator-grounded.`.slice(0, 300);
  const canonical = `${SITE_URL}/guides/routing/${slugUrl}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title,
        description,
        datePublished: TODAY,
        dateModified: TODAY,
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Guides', item: `${SITE_URL}/guides/` },
          { '@type': 'ListItem', position: 2, name: 'Routing', item: `${SITE_URL}/guides/routing/` },
          { '@type': 'ListItem', position: 3, name: `${originName} → ${destName}`, item: canonical },
        ],
      },
    ],
  });

  // Build representative-quote table for a 1-tonne shipment
  const oneTonne = quotes.find(q => q.weightKg === 1000);
  const modeRows = oneTonne.quote.quotes.map(m => {
    if (!m.viable) {
      return `<tr><td>${escapeHtml(m.label)}</td><td colspan="4" style="opacity:0.6;font-style:italic;">${escapeHtml(m.viabilityReason || 'Not viable')}</td></tr>`;
    }
    return `<tr>
      <td>${escapeHtml(m.label)}</td>
      <td class="num">€${m.totalEur}</td>
      <td>${escapeHtml(m.transitDaysLabel)}</td>
      <td class="num">${m.chargeableWeightKg} kg</td>
      <td class="num">${m.co2kg} kg</td>
    </tr>`;
  }).join('');

  // Build per-band recommendation summary
  const bandRecommendations = quotes.map(q => {
    if (!q.quote.ok) return '';
    const rec = q.quote.recommendation;
    return `<tr><td><strong>${escapeHtml(q.band)}</strong></td><td>${escapeHtml(rec.primary.replace('_', ' ').toUpperCase())}</td><td style="font-size:0.85em;color:rgba(255,255,255,0.7);">${escapeHtml(rec.reasoning || '')}</td></tr>`;
  }).join('');

  const railSection = railViable ? `
    <section class="guide-section">
      <h2>The China-Europe rail corridor</h2>
      <p>${escapeHtml(originName)} → ${escapeHtml(destName)} is part of the <strong>China-Europe Railway Express</strong> corridor (rails into Małaszewicze, the largest rail border-crossing point on the EU's eastern frontier). For shipments in the 200-5000 kg sweet spot, rail beats sea on transit (10-15 days faster) and air on cost (around 70% cheaper). Most freight forwarders never propose it because their margins on sea are higher and rail capacity is lumpier.</p>
      <p>Rail is most useful when:</p>
      <ul>
        <li>Volume is too small to justify FCL but too time-sensitive for sea LCL.</li>
        <li>Air freight cost would erode product margin (rail saves ~70% vs air).</li>
        <li>You need predictable departures (multiple weekly services).</li>
      </ul>
      <p>Rail is wrong for:</p>
      <ul>
        <li>Sub-200 kg shipments (sea/air consolidation economics work better).</li>
        <li>Above 5000 kg (FCL becomes more cost-effective).</li>
        <li>Goods sensitive to rail-route temperature swings (high summer, deep winter).</li>
      </ul>
    </section>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/">Home</a> · <a href="/guides/">Guides</a> · <a href="/guides/routing/">Routing</a> · ${escapeHtml(originName)} → ${escapeHtml(destName)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">Routing guide · Asia → Europe</p>
      <h1>How to ship from ${escapeHtml(originName)} to ${escapeHtml(destName)}</h1>
      <p class="lead">Sea FCL, sea LCL, air, ${railViable ? 'and rail' : 'and (where viable) rail'} — all four modes with cost, transit, and CO₂ for the ${escapeHtml(originName)} → ${escapeHtml(destName)} corridor. Numbers come from OrcaTrade's deterministic routing calculator. Refreshed quarterly against forwarder rate cards.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'sea_fcl')?.totalEur || '—'}</div><div class="label">Sea FCL · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'sea_lcl')?.totalEur || '—'}</div><div class="label">Sea LCL · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'air')?.totalEur || '—'}</div><div class="label">Air · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'rail' && m.viable)?.totalEur || (railViable ? '—' : 'n/a')}</div><div class="label">Rail · 1 t</div></div>
    </div>

    <section class="guide-section">
      <h2>Cost and transit, side by side</h2>
      <p>For a 1-tonne shipment from ${escapeHtml(originName)} to ${escapeHtml(destName)}, here's how the four modes compare. Costs include base rate × chargeable weight × origin multiplier; CO₂ comes from g/tonne-km × corridor distance.</p>
      <table class="data-table">
        <thead><tr><th>Mode</th><th>Cost</th><th>Transit</th><th>Chargeable wt</th><th>CO₂</th></tr></thead>
        <tbody>${modeRows}</tbody>
      </table>
    </section>

    <section class="guide-section">
      <h2>Recommendation by shipment size</h2>
      <p>OrcaTrade's recommendation engine picks the right mode based on weight band, urgency, and cost priority. For ${escapeHtml(originName)} → ${escapeHtml(destName)}:</p>
      <table class="data-table">
        <thead><tr><th>Weight</th><th>Recommended mode</th><th>Why</th></tr></thead>
        <tbody>${bandRecommendations}</tbody>
      </table>
    </section>

    ${railSection}

    <section class="guide-section">
      <h2>What's not in the cost</h2>
      <p>The figures above cover transport. They do not include:</p>
      <ul>
        <li><strong>EU import duty + VAT</strong> — see the customs landed-cost calculator for HS-chapter-specific math.</li>
        <li><strong>Customs brokerage</strong> — typically €45 base + €8 per invoice line, capped at €250.</li>
        <li><strong>Cargo insurance</strong> — recommended above €5,000 declared value; ICC A/B/C clauses available.</li>
        <li><strong>Last-mile delivery</strong> — from EU port/rail terminus to your warehouse.</li>
      </ul>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Run the live comparison</h3>
        <p>The Logistics Agent compares all four modes on your specific weight, volume, and urgency — and composes a full plan with customs and warehouse if you ask.</p>
      </div>
      <a href="/agent/logistics/?prompt=I%27m%20shipping%20from%20${encodeURIComponent(originName)}%20to%20${encodeURIComponent(destName)}.%20Compare%20sea%2C%20rail%2C%20air%20for%20a%20typical%201-tonne%20shipment.">Open Logistics Agent →</a>
    </aside>
  `;

  const plCanonical = `${SITE_URL}/pl/guides/routing/${slug(origin)}-do-${slug(destination)}/`;
  const deCanonical = `${SITE_URL}/de/guides/routing/${slug(origin)}-${slug(destination)}/`;
  return {
    path: `guides/routing/${slugUrl}`,
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: plCanonical },
        { lang: 'de', href: deCanonical },
        { lang: 'x-default', href: canonical },
      ],
      linkContext: { origin, destination, pageType: 'routing' },
    }),
  };
}

// ── Routing pages — Polish ─────────────────────────────────

function generateRoutingPagePL(origin, destination) {
  const originName = pl.COUNTRY_PL[origin] || COUNTRY_NAMES[origin];
  const originGen  = pl.COUNTRY_PL_GENITIVE[origin] || originName;
  const destName   = pl.COUNTRY_PL[destination] || COUNTRY_NAMES[destination];
  const RL = pl.ROUTING_LABEL_PL;
  const L = pl.LABEL_PL;

  const bands = [
    { kg: 200, label: '200 kg' },
    { kg: 1000, label: '1 000 kg' },
    { kg: 5000, label: '5 000 kg' },
  ];
  const quotes = bands.map(b => ({
    band: b.label,
    weightKg: b.kg,
    quote: routing.calculateQuote({ weightKg: b.kg, volumeCbm: b.kg / 200, originCountry: origin, destinationCountry: destination }),
  }));
  const railViable = routing.isRailViable({ originCountry: origin, destinationCountry: destination });

  const slugUrl = `${slug(origin)}-do-${slug(destination)}`;
  const title = `Wysyłka z ${originGen} do ${destName} — porównanie morze, kolej, lotniczo | OrcaTrade`;
  const description = `Porównanie multimodalne fracht ${originName} → ${destName}: sea FCL, sea LCL, lotniczo${railViable ? ', kolej (korytarz Chiny–Europa) ' : ''}z kosztem, czasem transportu, CO₂ na pasmo wagowe. Oparte na kalkulatorach.`.slice(0, 300);
  const canonical = `${SITE_URL}/pl/guides/routing/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/routing/${slug(origin)}-to-${slug(destination)}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', headline: title, description, datePublished: TODAY, dateModified: TODAY, inLanguage: 'pl', author: { '@type': 'Organization', name: 'OrcaTrade Group' }, publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } }, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/pl/guides/` },
        { '@type': 'ListItem', position: 2, name: RL.routingBreadcrumb, item: `${SITE_URL}/pl/guides/routing/` },
        { '@type': 'ListItem', position: 3, name: `${originName} → ${destName}`, item: canonical },
      ]},
    ],
  });

  const oneTonne = quotes.find(q => q.weightKg === 1000);
  const modeRows = oneTonne.quote.quotes.map(m => {
    if (!m.viable) return `<tr><td>${escapeHtml(m.label)}</td><td colspan="4" style="opacity:0.6;font-style:italic;">${escapeHtml(m.viabilityReason || 'Niedostępne')}</td></tr>`;
    return `<tr><td>${escapeHtml(m.label)}</td><td class="num">${m.totalEur} €</td><td>${escapeHtml(m.transitDaysLabel)}</td><td class="num">${m.chargeableWeightKg} kg</td><td class="num">${m.co2kg} kg</td></tr>`;
  }).join('');

  const bandRecommendations = quotes.map(q => {
    if (!q.quote.ok) return '';
    const rec = q.quote.recommendation;
    return `<tr><td><strong>${escapeHtml(q.band)}</strong></td><td>${escapeHtml(rec.primary.replace('_', ' ').toUpperCase())}</td><td style="font-size:0.85em;color:rgba(255,255,255,0.7);">${escapeHtml(rec.reasoning || '')}</td></tr>`;
  }).join('');

  const railSection = railViable ? `
    <section class="guide-section">
      <h2>${RL.railCorridorTitle}</h2>
      <p>${escapeHtml(originName)} → ${escapeHtml(destName)} jest częścią korytarza <strong>China-Europe Railway Express</strong> (kolej do Małaszewicz, największego punktu granicznego kolejowego na wschodniej granicy UE). Dla przesyłek w paśmie 200-5000 kg kolej pokonuje morze pod względem czasu transportu (10-15 dni szybciej) i lotnictwo pod względem kosztu (około 70% taniej). Większość spedytorów nigdy tego nie proponuje, ponieważ ich marże na morzu są wyższe, a przepustowość kolei nieregularna.</p>
      <p>${RL.railUseful}</p>
      <ul>
        <li>Wolumen jest zbyt mały dla FCL ale zbyt pilny dla sea LCL.</li>
        <li>Koszt frachtu lotniczego pochłonąłby marżę produktu (kolej oszczędza ~70% vs lotnictwo).</li>
        <li>Potrzebujesz przewidywalnych odjazdów (kilka usług tygodniowo).</li>
      </ul>
      <p>${RL.railWrong}</p>
      <ul>
        <li>Przesyłki poniżej 200 kg (ekonomia konsolidacji morze/lot lepiej działa).</li>
        <li>Powyżej 5000 kg (FCL staje się bardziej opłacalne).</li>
      </ul>
    </section>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · <a href="/pl/guides/routing/">${RL.routingBreadcrumb}</a> · ${escapeHtml(originName)} → ${escapeHtml(destName)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">${RL.routingGuide} · ${RL.asiaToEurope}</p>
      <h1>Jak wysłać z ${escapeHtml(originGen)} do ${escapeHtml(destName)}</h1>
      <p class="lead">Sea FCL, sea LCL, fracht lotniczy${railViable ? ' i kolej' : ''} — wszystkie cztery tryby z kosztem, czasem transportu i CO₂ dla korytarza ${escapeHtml(originName)} → ${escapeHtml(destName)}. Liczby pochodzą z deterministycznego kalkulatora OrcaTrade. Odświeżane kwartalnie względem stawek spedytorów.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'sea_fcl')?.totalEur || '—'} €</div><div class="label">Sea FCL · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'sea_lcl')?.totalEur || '—'} €</div><div class="label">Sea LCL · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'air')?.totalEur || '—'} €</div><div class="label">Lotniczo · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'rail' && m.viable)?.totalEur || (railViable ? '—' : 'n/a')} €</div><div class="label">Kolej · 1 t</div></div>
    </div>

    <section class="guide-section">
      <h2>${RL.modeComparison}</h2>
      <p>Dla przesyłki 1-tonowej z ${escapeHtml(originGen)} do ${escapeHtml(destName)}, oto jak porównują się cztery tryby:</p>
      <table class="data-table">
        <thead><tr><th>${RL.modeColumn}</th><th>${RL.costColumn}</th><th>${RL.transitColumn}</th><th>${RL.chargeableColumn}</th><th>${RL.co2Column}</th></tr></thead>
        <tbody>${modeRows}</tbody>
      </table>
    </section>

    <section class="guide-section">
      <h2>${RL.recommendedMode} według wagi</h2>
      <table class="data-table">
        <thead><tr><th>${RL.weightBand}</th><th>${RL.recommendedMode}</th><th>${RL.reasoning}</th></tr></thead>
        <tbody>${bandRecommendations}</tbody>
      </table>
    </section>

    ${railSection}

    <section class="guide-section">
      <h2>${RL.whatNotIncluded}</h2>
      <ul>
        <li><strong>${RL.duty} + VAT</strong> — zobacz kalkulator celny dla matematyki specyficznej dla rozdziału HS.</li>
        <li><strong>${RL.brokerage}</strong> — typowo 45 € baza + 8 € za linię faktury, capped 250 €.</li>
        <li><strong>${RL.insurance}</strong> — zalecane powyżej 5000 € wartości deklarowanej; klauzule ICC A/B/C dostępne.</li>
        <li><strong>${RL.lastMile}</strong> — z portu/terminalu kolejowego do Twojego magazynu.</li>
      </ul>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${RL.runLiveComparison}</h3>
        <p>${RL.runLiveComparisonText}</p>
      </div>
      <a href="/agent/logistics/?prompt=Wysy%C5%82am%20z%20${encodeURIComponent(originName)}%20do%20${encodeURIComponent(destName)}.%20Por%C3%B3wnaj%20morze%2C%20kolej%2C%20lot%20dla%20typowej%20przesy%C5%82ki%201-tonowej.">Logistics Agent →</a>
    </aside>
  `;

  return { path: `pl/guides/routing/${slugUrl}`, canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'pl', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: canonical }, { lang: 'x-default', href: enCanonical }], linkContext: { origin, destination, pageType: 'routing' } }) };
}

function generateRoutingIndexPL() {
  const RL = pl.ROUTING_LABEL_PL;
  const L = pl.LABEL_PL;
  const title = 'Przewodniki routing — porównania korytarzy Azja → Europa | OrcaTrade';
  const description = '30 multimodalnych przewodników routingowych dla głównych korytarzy żeglugowych Azja-Europa. Porównania sea FCL, sea LCL, lotniczo, kolej z kosztem, czasem transportu, CO₂.';
  const canonical = `${SITE_URL}/pl/guides/routing/`;
  const enCanonical = `${SITE_URL}/guides/routing/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, inLanguage: 'pl', url: canonical });

  const sections = ROUTING_ORIGINS.map(origin => {
    const links = ROUTING_DESTINATIONS.map(dest => {
      const railHint = routing.isRailViable({ originCountry: origin, destinationCountry: dest }) ? ' · kolej dostępna' : '';
      return `<a class="related-card" href="/pl/guides/routing/${slug(origin)}-do-${slug(dest)}/">
        <div class="related-tag">${escapeHtml(pl.COUNTRY_PL[origin] || COUNTRY_NAMES[origin])} → ${escapeHtml(pl.COUNTRY_PL[dest] || COUNTRY_NAMES[dest])}</div>
        <h3>${escapeHtml(pl.COUNTRY_PL[origin] || COUNTRY_NAMES[origin])} → ${escapeHtml(pl.COUNTRY_PL[dest] || COUNTRY_NAMES[dest])}</h3>
        <div class="related-desc">Morze, lot${railHint}</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>Z ${escapeHtml(pl.COUNTRY_PL_GENITIVE[origin] || pl.COUNTRY_PL[origin] || COUNTRY_NAMES[origin])}</h2><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · ${RL.routingBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Przewodniki routing</p>
      <h1>Jak wysłać między Azją a Europą.</h1>
      <p class="lead">30 przewodników korytarzowych pokrywających główne szlaki żeglugowe Azja → Europa. Każdy porównuje sea FCL, sea LCL, fracht lotniczy oraz kolej (gdzie dostępna) z kosztem, czasem transportu i CO₂ dla każdego pasma wagowego.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text"><h3>${RL.runLiveComparison}</h3><p>${RL.runLiveComparisonText}</p></div>
      <a href="/agent/logistics/">Logistics Agent →</a>
    </aside>
  `;

  return { path: 'pl/guides/routing', canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'pl', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: canonical }, { lang: 'x-default', href: enCanonical }] }) };
}

// ── Routing pages — German ─────────────────────────────────

function generateRoutingPageDE(origin, destination) {
  const originName = de.COUNTRY_DE[origin] || COUNTRY_NAMES[origin];
  const originDative = de.COUNTRY_DE_DATIVE[origin] || `aus ${originName}`;
  const destName = de.COUNTRY_DE[destination] || COUNTRY_NAMES[destination];
  const RL = de.ROUTING_LABEL_DE;
  const L = de.LABEL_DE;

  const bands = [
    { kg: 200, label: '200 kg' },
    { kg: 1000, label: '1.000 kg' },
    { kg: 5000, label: '5.000 kg' },
  ];
  const quotes = bands.map(b => ({
    band: b.label,
    weightKg: b.kg,
    quote: routing.calculateQuote({ weightKg: b.kg, volumeCbm: b.kg / 200, originCountry: origin, destinationCountry: destination }),
  }));
  const railViable = routing.isRailViable({ originCountry: origin, destinationCountry: destination });

  const slugUrl = `${slug(origin)}-${slug(destination)}`;
  const title = `Versand ${originDative} nach ${destName} — Vergleich See, Schiene, Luft | OrcaTrade`;
  const description = `Multimodaler Frachtvergleich ${originName} → ${destName}: Sea FCL, Sea LCL, Luftfracht${railViable ? ', Schiene (China-Europa-Korridor) ' : ''}mit Kosten, Transitzeit, CO₂ pro Gewichtsband. Calculator-fundiert.`.slice(0, 300);
  const canonical = `${SITE_URL}/de/guides/routing/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/routing/${slug(origin)}-to-${slug(destination)}/`;
  const plCanonical = `${SITE_URL}/pl/guides/routing/${slug(origin)}-do-${slug(destination)}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', headline: title, description, datePublished: TODAY, dateModified: TODAY, inLanguage: 'de', author: { '@type': 'Organization', name: 'OrcaTrade Group' }, publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } }, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/de/guides/` },
        { '@type': 'ListItem', position: 2, name: RL.routingBreadcrumb, item: `${SITE_URL}/de/guides/routing/` },
        { '@type': 'ListItem', position: 3, name: `${originName} → ${destName}`, item: canonical },
      ]},
    ],
  });

  const oneTonne = quotes.find(q => q.weightKg === 1000);
  const modeRows = oneTonne.quote.quotes.map(m => {
    if (!m.viable) return `<tr><td>${escapeHtml(m.label)}</td><td colspan="4" style="opacity:0.6;font-style:italic;">${escapeHtml(m.viabilityReason || 'Nicht verfügbar')}</td></tr>`;
    return `<tr><td>${escapeHtml(m.label)}</td><td class="num">${m.totalEur} €</td><td>${escapeHtml(m.transitDaysLabel)}</td><td class="num">${m.chargeableWeightKg} kg</td><td class="num">${m.co2kg} kg</td></tr>`;
  }).join('');

  const bandRecommendations = quotes.map(q => {
    if (!q.quote.ok) return '';
    const rec = q.quote.recommendation;
    return `<tr><td><strong>${escapeHtml(q.band)}</strong></td><td>${escapeHtml(rec.primary.replace('_', ' ').toUpperCase())}</td><td style="font-size:0.85em;color:rgba(255,255,255,0.7);">${escapeHtml(rec.reasoning || '')}</td></tr>`;
  }).join('');

  const railSection = railViable ? `
    <section class="guide-section">
      <h2>${RL.railCorridorTitle}</h2>
      <p>${escapeHtml(originName)} → ${escapeHtml(destName)} ist Teil des Korridors <strong>China-Europa-Schienenexpress</strong> (Schiene nach Małaszewicze, dem größten Bahn-Grenzübergang an der EU-Ostgrenze). Für Sendungen im Bereich 200-5000 kg schlägt die Schiene die See bei der Transitzeit (10-15 Tage schneller) und die Luft beim Preis (rund 70% günstiger). Die meisten Spediteure schlagen sie nie vor, weil ihre Margen auf See höher sind und die Bahnkapazität unregelmäßig ist.</p>
      <p>${RL.railUseful}</p>
      <ul>
        <li>Volumen ist zu klein für FCL, aber zu zeitkritisch für Sea LCL.</li>
        <li>Luftfrachtkosten würden die Produktmarge auffressen (Schiene spart ~70% vs. Luft).</li>
        <li>Sie benötigen vorhersehbare Abfahrten (mehrere wöchentliche Verbindungen).</li>
      </ul>
      <p>${RL.railWrong}</p>
      <ul>
        <li>Sendungen unter 200 kg (Konsolidierungsökonomie See/Luft funktioniert besser).</li>
        <li>Über 5000 kg (FCL wird kosteneffektiver).</li>
      </ul>
    </section>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · <a href="/de/guides/routing/">${RL.routingBreadcrumb}</a> · ${escapeHtml(originName)} → ${escapeHtml(destName)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">${RL.routingGuide} · ${RL.asiaToEurope}</p>
      <h1>Versand ${escapeHtml(originDative)} nach ${escapeHtml(destName)}</h1>
      <p class="lead">Sea FCL, Sea LCL, Luftfracht${railViable ? ' und Schiene' : ''} — alle vier Modi mit Kosten, Transitzeit und CO₂ für den Korridor ${escapeHtml(originName)} → ${escapeHtml(destName)}. Zahlen aus dem deterministischen OrcaTrade-Routing-Calculator. Vierteljährlich gegen Spediteur-Tarifkarten aktualisiert.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'sea_fcl')?.totalEur || '—'} €</div><div class="label">Sea FCL · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'sea_lcl')?.totalEur || '—'} €</div><div class="label">Sea LCL · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'air')?.totalEur || '—'} €</div><div class="label">Luftfracht · 1 t</div></div>
      <div class="guide-stat"><div class="num">${oneTonne.quote.quotes.find(m => m.mode === 'rail' && m.viable)?.totalEur || (railViable ? '—' : 'n/v')} €</div><div class="label">Schiene · 1 t</div></div>
    </div>

    <section class="guide-section">
      <h2>${RL.modeComparison}</h2>
      <p>Für eine 1-Tonnen-Sendung ${escapeHtml(originDative)} nach ${escapeHtml(destName)}, hier vergleichen sich die vier Modi:</p>
      <table class="data-table">
        <thead><tr><th>${RL.modeColumn}</th><th>${RL.costColumn}</th><th>${RL.transitColumn}</th><th>${RL.chargeableColumn}</th><th>${RL.co2Column}</th></tr></thead>
        <tbody>${modeRows}</tbody>
      </table>
    </section>

    <section class="guide-section">
      <h2>${RL.recommendedMode} nach Sendungsgröße</h2>
      <table class="data-table">
        <thead><tr><th>${RL.weightBand}</th><th>${RL.recommendedMode}</th><th>${RL.reasoning}</th></tr></thead>
        <tbody>${bandRecommendations}</tbody>
      </table>
    </section>

    ${railSection}

    <section class="guide-section">
      <h2>${RL.whatNotIncluded}</h2>
      <ul>
        <li><strong>${RL.duty} + MwSt.</strong> — siehe Zoll-Calculator für HS-kapitelspezifische Mathematik.</li>
        <li><strong>${RL.brokerage}</strong> — typischerweise 45 € Basis + 8 € pro Rechnungszeile, gedeckelt bei 250 €.</li>
        <li><strong>${RL.insurance}</strong> — empfohlen ab 5.000 € deklariertem Wert; ICC A/B/C-Klauseln verfügbar.</li>
        <li><strong>${RL.lastMile}</strong> — vom EU-Hafen/Bahnterminal zu Ihrem Lager.</li>
      </ul>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${RL.runLiveComparison}</h3>
        <p>${RL.runLiveComparisonText}</p>
      </div>
      <a href="/agent/logistics/?prompt=Ich%20versende%20${encodeURIComponent(originDative)}%20nach%20${encodeURIComponent(destName)}.%20Vergleichen%20Sie%20See%2C%20Schiene%2C%20Luft%20f%C3%BCr%20eine%20typische%201-Tonnen-Sendung.">Logistics Agent →</a>
    </aside>
  `;

  return { path: `de/guides/routing/${slugUrl}`, canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'de', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: plCanonical }, { lang: 'de', href: canonical }, { lang: 'x-default', href: enCanonical }], linkContext: { origin, destination, pageType: 'routing' } }) };
}

function generateRoutingIndexDE() {
  const RL = de.ROUTING_LABEL_DE;
  const L = de.LABEL_DE;
  const title = 'Routing-Leitfäden — Asien → Europa Korridor-Vergleiche | OrcaTrade';
  const description = '30 multimodale Routing-Leitfäden für die wichtigsten Asien-Europa-Lieferkorridore. Vergleiche Sea FCL, Sea LCL, Luftfracht, Schiene mit Kosten, Transit, CO₂.';
  const canonical = `${SITE_URL}/de/guides/routing/`;
  const enCanonical = `${SITE_URL}/guides/routing/`;
  const plCanonical = `${SITE_URL}/pl/guides/routing/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, inLanguage: 'de', url: canonical });

  const sections = ROUTING_ORIGINS.map(origin => {
    const links = ROUTING_DESTINATIONS.map(dest => {
      const railHint = routing.isRailViable({ originCountry: origin, destinationCountry: dest }) ? ' · Schiene verfügbar' : '';
      return `<a class="related-card" href="/de/guides/routing/${slug(origin)}-${slug(dest)}/">
        <div class="related-tag">${escapeHtml(de.COUNTRY_DE[origin] || COUNTRY_NAMES[origin])} → ${escapeHtml(de.COUNTRY_DE[dest] || COUNTRY_NAMES[dest])}</div>
        <h3>${escapeHtml(de.COUNTRY_DE[origin] || COUNTRY_NAMES[origin])} → ${escapeHtml(de.COUNTRY_DE[dest] || COUNTRY_NAMES[dest])}</h3>
        <div class="related-desc">See, Luft${railHint}</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>${escapeHtml(de.COUNTRY_DE_DATIVE[origin] || `aus ${de.COUNTRY_DE[origin] || COUNTRY_NAMES[origin]}`)}</h2><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · ${RL.routingBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Routing-Leitfäden</p>
      <h1>Versand zwischen Asien und Europa.</h1>
      <p class="lead">30 Korridor-Leitfäden für die wichtigsten Asien → Europa-Lieferwege. Jeder vergleicht Sea FCL, Sea LCL, Luftfracht und Schiene (sofern verfügbar) mit calculator-fundierten Kosten, Transitzeiten und CO₂-Werten pro Gewichtsband.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text"><h3>${RL.runLiveComparison}</h3><p>${RL.runLiveComparisonText}</p></div>
      <a href="/agent/logistics/">Logistics Agent →</a>
    </aside>
  `;

  return { path: 'de/guides/routing', canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'de', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: plCanonical }, { lang: 'de', href: canonical }, { lang: 'x-default', href: enCanonical }] }) };
}

function generateRoutingIndex() {
  const title = 'Routing guides — Asia → Europe corridor comparisons | OrcaTrade';
  const description = '30 multi-modal routing guides for the major Asia-Europe shipping corridors. Sea FCL, sea LCL, air, rail comparisons with cost, transit, CO₂.';
  const canonical = `${SITE_URL}/guides/routing/`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
  });

  const sections = ROUTING_ORIGINS.map(origin => {
    const links = ROUTING_DESTINATIONS.map(dest => {
      const railHint = routing.isRailViable({ originCountry: origin, destinationCountry: dest }) ? ' · rail viable' : '';
      return `<a class="related-card" href="/guides/routing/${slug(origin)}-to-${slug(dest)}/">
        <div class="related-tag">${escapeHtml(COUNTRY_NAMES[origin])} → ${escapeHtml(COUNTRY_NAMES[dest])}</div>
        <h3>${escapeHtml(COUNTRY_NAMES[origin])} → ${escapeHtml(COUNTRY_NAMES[dest])}</h3>
        <div class="related-desc">Sea, air${railHint}</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>From ${escapeHtml(COUNTRY_NAMES[origin])}</h2><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/">Home</a> · <a href="/guides/">Guides</a> · Routing</nav>
    <header class="guide-hero">
      <p class="kicker">Routing guides</p>
      <h1>How to ship between Asia and Europe.</h1>
      <p class="lead">30 corridor guides covering the major Asia → Europe shipping lanes. Each compares sea FCL, sea LCL, air, and rail (where viable) with calculator-grounded cost, transit, and CO₂ per shipment band.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Run a tailored mode comparison</h3>
        <p>Logistics Agent compares all four modes for your specific weight, urgency, and origin/destination — plus composes the full landed-cost picture if you ask.</p>
      </div>
      <a href="/agent/logistics/">Open Logistics Agent →</a>
    </aside>
  `;

  return {
    path: 'guides/routing',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: `${SITE_URL}/pl/guides/routing/` },
        { lang: 'de', href: `${SITE_URL}/de/guides/routing/` },
        { lang: 'x-default', href: canonical },
      ],
    }),
  };
}

// ── Customs pages ──────────────────────────────────────────

// SME-relevant HS chapters with searcher-friendly slugs.
const CUSTOMS_CHAPTERS = [
  { code: '61', slug: 'knitted-apparel', name: 'Knitted apparel' },
  { code: '62', slug: 'woven-apparel', name: 'Woven apparel' },
  { code: '63', slug: 'home-textiles', name: 'Home textiles & made-up textile articles' },
  { code: '64', slug: 'footwear', name: 'Footwear' },
  { code: '85', slug: 'electronics', name: 'Electrical machinery & electronics' },
  { code: '94', slug: 'furniture', name: 'Furniture & lighting' },
];
const CUSTOMS_DESTINATIONS = ['DE', 'PL', 'NL', 'FR', 'IT', 'ES'];

function generateCustomsPage(chapter, destination) {
  const destInfo = customs.EU_VAT[destination];
  const chapterInfo = customs.HS_CHAPTER_DUTY[chapter.code];

  // Sample quote for €25,000 of CN-origin goods (most common SME volume)
  const sampleQuote = customs.calculateQuote({
    customsValueEur: 25000,
    hsCode: chapter.code,
    destinationCountry: destination,
    originCountry: 'CN',
    linesCount: 4,
  });

  // Comparison: same chapter from VN claiming preferential
  const vnPreferentialQuote = customs.calculateQuote({
    customsValueEur: 25000,
    hsCode: chapter.code,
    destinationCountry: destination,
    originCountry: 'VN',
    linesCount: 4,
    claimPreferential: true,
  });

  const slugUrl = `${chapter.slug}-into-${slug(destination)}`;
  const title = `Import ${chapter.name.toLowerCase()} into ${destInfo.name} — duty + VAT calculator | OrcaTrade`;
  const description = `Landed-cost calculation for HS chapter ${chapter.code} (${chapter.name.toLowerCase()}) imported into ${destInfo.name}. MFN duty rate, ${(destInfo.rate * 100).toFixed(0)}% VAT, brokerage fees, bonded warehouse alternative. Calculator-grounded.`.slice(0, 300);
  const canonical = `${SITE_URL}/guides/customs/${slugUrl}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title,
        description,
        datePublished: TODAY,
        dateModified: TODAY,
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Guides', item: `${SITE_URL}/guides/` },
          { '@type': 'ListItem', position: 2, name: 'Customs', item: `${SITE_URL}/guides/customs/` },
          { '@type': 'ListItem', position: 3, name: `${chapter.name} into ${destInfo.name}`, item: canonical },
        ],
      },
    ],
  });

  const standard = sampleQuote.quotes.find(q => q.routeKey === 'standard_clearance');
  const vnStandard = vnPreferentialQuote.ok ? vnPreferentialQuote.quotes.find(q => q.routeKey === 'standard_clearance') : null;

  const dutyDeltaEur = vnStandard ? Math.round(standard.dutyEur - vnStandard.dutyEur) : 0;

  // Anti-dumping note for chapters where it's relevant
  const antiDumpingChapters = ['72', '73', '76', '64'];
  const antiDumpingNote = antiDumpingChapters.includes(chapter.code) ? `
    <div class="caution-block">
      <div class="label">Anti-dumping risk · CN origin</div>
      <p style="margin:0;color:rgba(255,255,255,0.85);">Chinese-origin goods in chapter ${chapter.code} attract anti-dumping duties on top of the MFN rate. Always verify TARIC for the specific 8-digit code before commitment. The OrcaTrade customs calculator surfaces the overlay automatically.</p>
    </div>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/">Home</a> · <a href="/guides/">Guides</a> · <a href="/guides/customs/">Customs</a> · ${escapeHtml(chapter.name)} into ${escapeHtml(destInfo.name)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">Customs guide · HS ${escapeHtml(chapter.code)}</p>
      <h1>Import ${escapeHtml(chapter.name.toLowerCase())} into ${escapeHtml(destInfo.name)}: full landed cost</h1>
      <p class="lead">Working through the duty + VAT + brokerage on HS chapter ${escapeHtml(chapter.code)} (${escapeHtml(chapterInfo.label.toLowerCase())}) entering ${escapeHtml(destInfo.name)}. Numbers come from OrcaTrade's customs calculator — MFN duty rates, ${(destInfo.rate * 100).toFixed(1)}% national VAT, EU brokerage benchmarks, plus the bonded-warehouse alternative most SMEs don't price in.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${(chapterInfo.rate * 100).toFixed(2)}%</div><div class="label">MFN duty rate</div></div>
      <div class="guide-stat"><div class="num">${(destInfo.rate * 100).toFixed(1)}%</div><div class="label">${escapeHtml(destInfo.name)} VAT</div></div>
      <div class="guide-stat"><div class="num">€${standard?.totalEur || '—'}</div><div class="label">Total · €25k CN goods</div></div>
      <div class="guide-stat"><div class="num">€${standard ? Math.round(standard.totalEur - 25000) : '—'}</div><div class="label">Of which: tax + fees</div></div>
    </div>

    <section class="guide-section">
      <h2>The math, line by line</h2>
      <p>For a sample shipment of <strong>€25,000 customs value</strong> of HS ${escapeHtml(chapter.code)} from China to ${escapeHtml(destInfo.name)}, with 4 lines on the commercial invoice:</p>
      <table class="data-table">
        <thead><tr><th>Component</th><th>Calculation</th><th>Amount</th></tr></thead>
        <tbody>
          <tr><td>Customs value (CIF)</td><td>—</td><td class="num">€${standard?.customsValueEur.toLocaleString('en-IE')}</td></tr>
          <tr><td>Import duty</td><td class="num">${(standard?.dutyRate * 100).toFixed(2)}% × €${standard?.customsValueEur.toLocaleString('en-IE')}</td><td class="num">€${Math.round(standard?.dutyEur).toLocaleString('en-IE')}</td></tr>
          <tr><td>Import VAT</td><td class="num">${(standard?.vatRate * 100).toFixed(1)}% × (customs value + duty)</td><td class="num">€${Math.round(standard?.vatEur).toLocaleString('en-IE')}</td></tr>
          <tr><td>Brokerage</td><td>€45 base + €8 × 4 lines</td><td class="num">€${standard?.brokerageEur}</td></tr>
          <tr><td>ENS pre-arrival</td><td>flat</td><td class="num">€${standard?.entrySummaryDeclarationEur}</td></tr>
          <tr style="background: rgba(184,190,200,0.08);"><td><strong>Total cash out</strong></td><td>—</td><td class="num"><strong>€${standard?.totalEur.toLocaleString('en-IE')}</strong></td></tr>
        </tbody>
      </table>
      <p>VAT is recoverable for VAT-registered importers on the next return — effectively a cash-flow line, not a net cost. Duty is non-recoverable; that's the actual tariff cost of the import.</p>
    </section>

    ${antiDumpingNote}

    <section class="guide-section">
      <h2>Preferential origin alternative · Vietnam (EVFTA)</h2>
      <p>For HS chapter ${escapeHtml(chapter.code)} from Vietnam, the EU-Vietnam Free Trade Agreement (EVFTA) typically gives a 70% duty reduction with valid origin proof (REX or invoice declaration). For the same €25,000 shipment:</p>
      <table class="data-table">
        <thead><tr><th>Origin</th><th>Effective duty rate</th><th>Duty paid</th><th>Total cash out</th></tr></thead>
        <tbody>
          <tr><td>China (MFN)</td><td class="num">${standard?.dutyRate ? (standard.dutyRate * 100).toFixed(2) + '%' : '—'}</td><td class="num">€${Math.round(standard?.dutyEur || 0).toLocaleString('en-IE')}</td><td class="num">€${standard?.totalEur.toLocaleString('en-IE')}</td></tr>
          ${vnStandard ? `<tr style="background: rgba(111, 166, 111, 0.06);"><td>Vietnam (EVFTA preferential)</td><td class="num">${(vnStandard.dutyRate * 100).toFixed(2)}%</td><td class="num">€${Math.round(vnStandard.dutyEur).toLocaleString('en-IE')}</td><td class="num">€${vnStandard.totalEur.toLocaleString('en-IE')}</td></tr>` : ''}
        </tbody>
      </table>
      ${dutyDeltaEur > 100 ? `<p>The duty saving from sourcing in Vietnam with valid EVFTA proof: <strong>€${dutyDeltaEur.toLocaleString('en-IE')}</strong> on the same €25,000 shipment. For high-volume SKUs, this often justifies the supplier-switch cost.</p>` : ''}
    </section>

    <section class="guide-section">
      <h2>The bonded warehouse alternative</h2>
      <p>If the goods will sit longer than 30 days before sale (slow-moving stock, seasonal goods, anything possibly re-exported), bonded warehousing defers the duty + VAT — and avoids them entirely on re-export. For €25,000 of HS ${escapeHtml(chapter.code)}:</p>
      <ul>
        <li><strong>Standard clearance</strong> — pay duty + VAT + brokerage on day 1.</li>
        <li><strong>Bonded warehouse</strong> — €95 entry + €0.30/cbm/day storage + 1.2% bond fee + €65 exit. Duty + VAT paid only on release into free circulation, or never (if re-exported).</li>
      </ul>
      <p>Cash-flow benefit at 6% annual cost of capital × N days storage. Worth running the bonded scenario through the Customs Agent if your category has any re-export probability.</p>
    </section>

    <section class="guide-section">
      <h2>Other EU destinations · same chapter</h2>
      <p>For comparison, here's the same €25,000 CN-origin shipment of HS ${escapeHtml(chapter.code)} into different EU member states:</p>
      <table class="data-table">
        <thead><tr><th>Destination</th><th>VAT rate</th><th>Total landed cost</th></tr></thead>
        <tbody>
          ${CUSTOMS_DESTINATIONS.map(d => {
            const dInfo = customs.EU_VAT[d];
            const q = customs.calculateQuote({ customsValueEur: 25000, hsCode: chapter.code, destinationCountry: d, originCountry: 'CN', linesCount: 4 });
            const std = q.ok ? q.quotes.find(qq => qq.routeKey === 'standard_clearance') : null;
            const isCurrent = d === destination;
            return `<tr${isCurrent ? ' style="background: rgba(184,190,200,0.06);"' : ''}>
              <td>${escapeHtml(dInfo.name)}${isCurrent ? ' <span style="opacity:0.6;font-size:0.78em;">(this guide)</span>' : ` <a href="/guides/customs/${chapter.slug}-into-${slug(d)}/" style="font-size:0.85em; opacity:0.7;">[guide →]</a>`}</td>
              <td class="num">${(dInfo.rate * 100).toFixed(1)}%</td>
              <td class="num">€${std?.totalEur.toLocaleString('en-IE') || '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Run the calculator on your real numbers</h3>
        <p>Customs Agent works the math for any HS code, any EU destination, any origin (with anti-dumping overlays + preferential FTA detection).</p>
      </div>
      <a href="/agent/?prompt=Working%20out%20landed%20cost%20on%20a%20%E2%82%AC25k%20shipment%20of%20HS%20${chapter.code}%20goods%20from%20China%20to%20${encodeURIComponent(destInfo.name)}.%20Walk%20me%20through%20the%20duty%20%2B%20VAT%20%2B%20brokerage%20math%2C%20and%20flag%20whether%20bonded%20makes%20sense.">Open Customs Agent →</a>
    </aside>
  `;

  const plCanonical = `${SITE_URL}/pl/guides/customs/${(pl.CUSTOMS_CHAPTER_PL[chapter.code]?.slug || chapter.slug)}-do-${slug(destination)}/`;
  const deCanonical = `${SITE_URL}/de/guides/customs/${(de.CUSTOMS_CHAPTER_DE[chapter.code]?.slug || chapter.slug)}-${slug(destination)}/`;
  return {
    path: `guides/customs/${slugUrl}`,
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: plCanonical },
        { lang: 'de', href: deCanonical },
        { lang: 'x-default', href: canonical },
      ],
      linkContext: { hsChapter: chapter.code, destination, pageType: 'customs' },
    }),
  };
}

// ── Customs pages — Polish ─────────────────────────────────

function generateCustomsPagePL(chapter, destination) {
  const destInfo = customs.EU_VAT[destination];
  const chapterInfo = customs.HS_CHAPTER_DUTY[chapter.code];
  const destNamePL = pl.COUNTRY_PL[destination] || destInfo.name;
  const chPL = pl.CUSTOMS_CHAPTER_PL[chapter.code] || { name: chapter.name, slug: chapter.slug };
  const CL = pl.CUSTOMS_LABEL_PL;
  const L = pl.LABEL_PL;

  const sampleQuote = customs.calculateQuote({ customsValueEur: 25000, hsCode: chapter.code, destinationCountry: destination, originCountry: 'CN', linesCount: 4 });
  const vnPreferentialQuote = customs.calculateQuote({ customsValueEur: 25000, hsCode: chapter.code, destinationCountry: destination, originCountry: 'VN', linesCount: 4, claimPreferential: true });
  const standard = sampleQuote.quotes.find(q => q.routeKey === 'standard_clearance');
  const vnStandard = vnPreferentialQuote.ok ? vnPreferentialQuote.quotes.find(q => q.routeKey === 'standard_clearance') : null;

  const slugUrl = `${chPL.slug}-do-${slug(destination)}`;
  const title = `Import ${chPL.name.toLowerCase()} do ${destNamePL} — kalkulator cła + VAT | OrcaTrade`;
  const description = `Kalkulacja kosztu celnego dla rozdziału HS ${chapter.code} (${chPL.name.toLowerCase()}) importowanego do ${destNamePL}. Stawka cła MFN, VAT ${(destInfo.rate * 100).toFixed(0)}%, opłaty brokerage, alternatywa składu celnego. Oparte na kalkulatorach.`.slice(0, 300);
  const canonical = `${SITE_URL}/pl/guides/customs/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/customs/${chapter.slug}-into-${slug(destination)}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', headline: title, description, datePublished: TODAY, dateModified: TODAY, inLanguage: 'pl', author: { '@type': 'Organization', name: 'OrcaTrade Group' }, publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } }, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/pl/guides/` },
        { '@type': 'ListItem', position: 2, name: CL.customsBreadcrumb, item: `${SITE_URL}/pl/guides/customs/` },
        { '@type': 'ListItem', position: 3, name: `${chPL.name} do ${destNamePL}`, item: canonical },
      ]},
    ],
  });

  const dutyDeltaEur = vnStandard ? Math.round(standard.dutyEur - vnStandard.dutyEur) : 0;
  const antiDumpingChapters = ['72', '73', '76', '64'];
  const antiDumpingNote = antiDumpingChapters.includes(chapter.code) ? `
    <div class="caution-block">
      <div class="label">${CL.antiDumpingTitle}</div>
      <p style="margin:0;color:rgba(255,255,255,0.85);">Towary chińskiego pochodzenia w rozdziale ${chapter.code} przyciągają cła antydumpingowe na wierzch stawki MFN. Zawsze weryfikuj TARIC dla konkretnego kodu 8-cyfrowego przed zobowiązaniem.</p>
    </div>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · <a href="/pl/guides/customs/">${CL.customsBreadcrumb}</a> · ${escapeHtml(chPL.name)} do ${escapeHtml(destNamePL)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">${CL.customsGuide} · ${CL.hsChapter} ${escapeHtml(chapter.code)}</p>
      <h1>Import ${escapeHtml(chPL.name.toLowerCase())} do ${escapeHtml(destNamePL)}: pełny koszt celny</h1>
      <p class="lead">Pracujemy nad cłem + VAT + brokerage dla rozdziału HS ${escapeHtml(chapter.code)} (${escapeHtml(chapterInfo.label.toLowerCase())}) wjeżdżającego do ${escapeHtml(destNamePL)}. Liczby pochodzą z kalkulatora celnego OrcaTrade — stawki cła MFN, VAT krajowy ${(destInfo.rate * 100).toFixed(1)}%, benchmarki brokerage UE oraz alternatywa składu celnego, której większość MŚP nie wycenia.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${(chapterInfo.rate * 100).toFixed(2)}%</div><div class="label">${CL.mfnDutyRate}</div></div>
      <div class="guide-stat"><div class="num">${(destInfo.rate * 100).toFixed(1)}%</div><div class="label">${CL.vatRate} ${escapeHtml(destNamePL)}</div></div>
      <div class="guide-stat"><div class="num">${standard?.totalEur || '—'} €</div><div class="label">${CL.totalCnGoods}</div></div>
      <div class="guide-stat"><div class="num">${standard ? Math.round(standard.totalEur - 25000) : '—'} €</div><div class="label">${CL.taxAndFees}</div></div>
    </div>

    <section class="guide-section">
      <h2>${CL.mathLineByLine}</h2>
      <p>Dla przykładowej przesyłki <strong>25 000 € wartości celnej</strong> HS ${escapeHtml(chapter.code)} z Chin do ${escapeHtml(destNamePL)}, z 4 liniami na fakturze:</p>
      <table class="data-table">
        <thead><tr><th>Komponent</th><th>Obliczenie</th><th>Kwota</th></tr></thead>
        <tbody>
          <tr><td>${CL.customsValue}</td><td>—</td><td class="num">${standard?.customsValueEur.toLocaleString('pl-PL')} €</td></tr>
          <tr><td>${CL.importDuty}</td><td class="num">${(standard?.dutyRate * 100).toFixed(2)}% × ${standard?.customsValueEur.toLocaleString('pl-PL')} €</td><td class="num">${Math.round(standard?.dutyEur).toLocaleString('pl-PL')} €</td></tr>
          <tr><td>${CL.importVat}</td><td class="num">${(standard?.vatRate * 100).toFixed(1)}% × (wartość celna + cło)</td><td class="num">${Math.round(standard?.vatEur).toLocaleString('pl-PL')} €</td></tr>
          <tr><td>Brokerage</td><td>${CL.brokerageDesc}</td><td class="num">${standard?.brokerageEur} €</td></tr>
          <tr><td>${CL.ensFiling}</td><td>flat</td><td class="num">${standard?.entrySummaryDeclarationEur} €</td></tr>
          <tr style="background: rgba(184,190,200,0.08);"><td><strong>${CL.totalCashOut}</strong></td><td>—</td><td class="num"><strong>${standard?.totalEur.toLocaleString('pl-PL')} €</strong></td></tr>
        </tbody>
      </table>
      <p>VAT jest odliczalny dla importerów zarejestrowanych jako VAT przy następnym zwrocie — efektywnie linia cash-flow, nie koszt netto. Cło jest niemożliwe do odzyskania; to jest faktyczny koszt taryfowy importu.</p>
    </section>

    ${antiDumpingNote}

    <section class="guide-section">
      <h2>${CL.evftaTitle}</h2>
      <p>Dla rozdziału HS ${escapeHtml(chapter.code)} z Wietnamu, Umowa o Wolnym Handlu UE-Wietnam (EVFTA) typowo daje 70% redukcji cła z ważnym dowodem pochodzenia (REX lub deklaracja na fakturze). Dla tej samej przesyłki 25 000 €:</p>
      <table class="data-table">
        <thead><tr><th>Pochodzenie</th><th>Efektywna stawka cła</th><th>Cło zapłacone</th><th>${CL.totalCashOut}</th></tr></thead>
        <tbody>
          <tr><td>Chiny (MFN)</td><td class="num">${standard?.dutyRate ? (standard.dutyRate * 100).toFixed(2) + '%' : '—'}</td><td class="num">${Math.round(standard?.dutyEur || 0).toLocaleString('pl-PL')} €</td><td class="num">${standard?.totalEur.toLocaleString('pl-PL')} €</td></tr>
          ${vnStandard ? `<tr style="background: rgba(111, 166, 111, 0.06);"><td>Wietnam (preferencyjnie EVFTA)</td><td class="num">${(vnStandard.dutyRate * 100).toFixed(2)}%</td><td class="num">${Math.round(vnStandard.dutyEur).toLocaleString('pl-PL')} €</td><td class="num">${vnStandard.totalEur.toLocaleString('pl-PL')} €</td></tr>` : ''}
        </tbody>
      </table>
      ${dutyDeltaEur > 100 ? `<p>Oszczędność cła z sourcingu w Wietnamie z ważnym dowodem EVFTA: <strong>${dutyDeltaEur.toLocaleString('pl-PL')} €</strong> na tej samej przesyłce 25 000 €. Dla SKU o wysokim wolumenie często uzasadnia to koszt zmiany dostawcy.</p>` : ''}
    </section>

    <section class="guide-section">
      <h2>${CL.bondedTitle}</h2>
      <p>Jeśli towary będą leżały dłużej niż 30 dni przed sprzedażą, skład celny odracza cło + VAT — i unika ich całkowicie przy reeksporcie. Korzyść cash-flow przy 6% rocznym koszcie kapitału × N dni przechowywania.</p>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${CL.runOnRealNumbers}</h3>
        <p>${CL.runOnRealNumbersText}</p>
      </div>
      <a href="/agent/?prompt=Pracuj%C4%99%20nad%20landed%20cost%20dla%20przesy%C5%82ki%2025%20000%20%E2%82%AC%20HS%20${chapter.code}%20z%20Chin%20do%20${encodeURIComponent(destNamePL)}.">Compliance Agent →</a>
    </aside>
  `;

  const deCanonical = `${SITE_URL}/de/guides/customs/${(de.CUSTOMS_CHAPTER_DE[chapter.code]?.slug || chapter.slug)}-${slug(destination)}/`;
  return { path: `pl/guides/customs/${slugUrl}`, canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'pl', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: canonical }, { lang: 'de', href: deCanonical }, { lang: 'x-default', href: enCanonical }], linkContext: { hsChapter: chapter.code, destination, pageType: 'customs' } }) };
}

function generateCustomsIndexPL() {
  const CL = pl.CUSTOMS_LABEL_PL;
  const L = pl.LABEL_PL;
  const title = 'Przewodniki celne — kalkulacje landed cost dla importu UE | OrcaTrade';
  const description = '36 przewodników kalkulacji kosztu celnego dla głównych rozdziałów HS × kierunków UE. Stawki cła MFN, krajowy VAT, brokerage, alternatywy składu celnego. Oparte na kalkulatorach.';
  const canonical = `${SITE_URL}/pl/guides/customs/`;
  const enCanonical = `${SITE_URL}/guides/customs/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, inLanguage: 'pl', url: canonical });

  const sections = CUSTOMS_CHAPTERS.map(ch => {
    const chPL = pl.CUSTOMS_CHAPTER_PL[ch.code] || ch;
    const links = CUSTOMS_DESTINATIONS.map(d => {
      const dInfo = customs.EU_VAT[d];
      const dNamePL = pl.COUNTRY_PL[d] || dInfo.name;
      return `<a class="related-card" href="/pl/guides/customs/${chPL.slug}-do-${slug(d)}/">
        <div class="related-tag">HS ${escapeHtml(ch.code)} → ${escapeHtml(dNamePL)}</div>
        <h3>${escapeHtml(chPL.name)} do ${escapeHtml(dNamePL)}</h3>
        <div class="related-desc">${(customs.HS_CHAPTER_DUTY[ch.code].rate * 100).toFixed(2)}% MFN · ${(dInfo.rate * 100).toFixed(0)}% VAT</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>HS ${escapeHtml(ch.code)} · ${escapeHtml(chPL.name)}</h2><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · ${CL.customsBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Przewodniki celne</p>
      <h1>Kalkulacje landed cost dla importu UE.</h1>
      <p class="lead">36 przewodników pokrywających najczęściej importowane rozdziały HS × sześć głównych kierunków UE. Każdy zawiera matematykę cło + VAT + brokerage dla przykładowej przesyłki 25 000 €, porównanie z preferencyjnymi pochodzeniami (EVFTA Wietnam itp.) oraz alternatywę składu celnego.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text"><h3>${CL.runOnRealNumbers}</h3><p>${CL.runOnRealNumbersText}</p></div>
      <a href="/agent/">Compliance Agent →</a>
    </aside>
  `;

  return { path: 'pl/guides/customs', canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'pl', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: canonical }, { lang: 'x-default', href: enCanonical }] }) };
}

// ── Customs pages — German ─────────────────────────────────

function generateCustomsPageDE(chapter, destination) {
  const destInfo = customs.EU_VAT[destination];
  const chapterInfo = customs.HS_CHAPTER_DUTY[chapter.code];
  const destNameDE = de.COUNTRY_DE[destination] || destInfo.name;
  const chDE = de.CUSTOMS_CHAPTER_DE[chapter.code] || { name: chapter.name, slug: chapter.slug };
  const CL = de.CUSTOMS_LABEL_DE;
  const L = de.LABEL_DE;

  const sampleQuote = customs.calculateQuote({ customsValueEur: 25000, hsCode: chapter.code, destinationCountry: destination, originCountry: 'CN', linesCount: 4 });
  const vnPreferentialQuote = customs.calculateQuote({ customsValueEur: 25000, hsCode: chapter.code, destinationCountry: destination, originCountry: 'VN', linesCount: 4, claimPreferential: true });
  const standard = sampleQuote.quotes.find(q => q.routeKey === 'standard_clearance');
  const vnStandard = vnPreferentialQuote.ok ? vnPreferentialQuote.quotes.find(q => q.routeKey === 'standard_clearance') : null;

  const slugUrl = `${chDE.slug}-${slug(destination)}`;
  const title = `Import von ${chDE.name.toLowerCase()} nach ${destNameDE} — Zoll- und MwSt-Calculator | OrcaTrade`;
  const description = `Landed-Cost-Berechnung für HS-Kapitel ${chapter.code} (${chDE.name.toLowerCase()}) Import nach ${destNameDE}. MFN-Zollsatz, ${(destInfo.rate * 100).toFixed(0)}% MwSt., Brokerage-Gebühren, Zolllageralternative. Calculator-fundiert.`.slice(0, 300);
  const canonical = `${SITE_URL}/de/guides/customs/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/customs/${chapter.slug}-into-${slug(destination)}/`;
  const plCanonical = `${SITE_URL}/pl/guides/customs/${(pl.CUSTOMS_CHAPTER_PL[chapter.code]?.slug || chapter.slug)}-do-${slug(destination)}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', headline: title, description, datePublished: TODAY, dateModified: TODAY, inLanguage: 'de', author: { '@type': 'Organization', name: 'OrcaTrade Group' }, publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } }, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/de/guides/` },
        { '@type': 'ListItem', position: 2, name: CL.customsBreadcrumb, item: `${SITE_URL}/de/guides/customs/` },
        { '@type': 'ListItem', position: 3, name: `${chDE.name} nach ${destNameDE}`, item: canonical },
      ]},
    ],
  });

  const dutyDeltaEur = vnStandard ? Math.round(standard.dutyEur - vnStandard.dutyEur) : 0;
  const antiDumpingChapters = ['72', '73', '76', '64'];
  const antiDumpingNote = antiDumpingChapters.includes(chapter.code) ? `
    <div class="caution-block">
      <div class="label">${CL.antiDumpingTitle}</div>
      <p style="margin:0;color:rgba(255,255,255,0.85);">Waren chinesischen Ursprungs in Kapitel ${chapter.code} ziehen Antidumpingzölle auf den MFN-Satz. Verifizieren Sie immer TARIC für den spezifischen 8-stelligen Code vor Verpflichtung.</p>
    </div>` : '';

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · <a href="/de/guides/customs/">${CL.customsBreadcrumb}</a> · ${escapeHtml(chDE.name)} nach ${escapeHtml(destNameDE)}
    </nav>

    <header class="guide-hero">
      <p class="kicker">${CL.customsGuide} · ${CL.hsChapter} ${escapeHtml(chapter.code)}</p>
      <h1>Import von ${escapeHtml(chDE.name.toLowerCase())} nach ${escapeHtml(destNameDE)}: vollständige Landed Cost</h1>
      <p class="lead">Wir arbeiten Zoll + MwSt. + Brokerage auf HS-Kapitel ${escapeHtml(chapter.code)} (${escapeHtml(chapterInfo.label.toLowerCase())}) bei Eintritt nach ${escapeHtml(destNameDE)} aus. Zahlen aus dem OrcaTrade-Zoll-Calculator — MFN-Zollsätze, ${(destInfo.rate * 100).toFixed(1)}% nationale MwSt., EU-Brokerage-Benchmarks plus die Zolllageralternative, die die meisten KMU nicht einpreisen.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${(chapterInfo.rate * 100).toFixed(2)}%</div><div class="label">${CL.mfnDutyRate}</div></div>
      <div class="guide-stat"><div class="num">${(destInfo.rate * 100).toFixed(1)}%</div><div class="label">${CL.vatRate} ${escapeHtml(destNameDE)}</div></div>
      <div class="guide-stat"><div class="num">${standard?.totalEur || '—'} €</div><div class="label">${CL.totalCnGoods}</div></div>
      <div class="guide-stat"><div class="num">${standard ? Math.round(standard.totalEur - 25000) : '—'} €</div><div class="label">${CL.taxAndFees}</div></div>
    </div>

    <section class="guide-section">
      <h2>${CL.mathLineByLine}</h2>
      <p>Für eine Beispielsendung von <strong>25.000 € Zollwert</strong> HS ${escapeHtml(chapter.code)} aus China nach ${escapeHtml(destNameDE)}, mit 4 Rechnungszeilen:</p>
      <table class="data-table">
        <thead><tr><th>Komponente</th><th>Berechnung</th><th>Betrag</th></tr></thead>
        <tbody>
          <tr><td>${CL.customsValue}</td><td>—</td><td class="num">${standard?.customsValueEur.toLocaleString('de-DE')} €</td></tr>
          <tr><td>${CL.importDuty}</td><td class="num">${(standard?.dutyRate * 100).toFixed(2)}% × ${standard?.customsValueEur.toLocaleString('de-DE')} €</td><td class="num">${Math.round(standard?.dutyEur).toLocaleString('de-DE')} €</td></tr>
          <tr><td>${CL.importVat}</td><td class="num">${(standard?.vatRate * 100).toFixed(1)}% × (Zollwert + Zoll)</td><td class="num">${Math.round(standard?.vatEur).toLocaleString('de-DE')} €</td></tr>
          <tr><td>Brokerage</td><td>${CL.brokerageDesc}</td><td class="num">${standard?.brokerageEur} €</td></tr>
          <tr><td>${CL.ensFiling}</td><td>pauschal</td><td class="num">${standard?.entrySummaryDeclarationEur} €</td></tr>
          <tr style="background: rgba(184,190,200,0.08);"><td><strong>${CL.totalCashOut}</strong></td><td>—</td><td class="num"><strong>${standard?.totalEur.toLocaleString('de-DE')} €</strong></td></tr>
        </tbody>
      </table>
      <p>MwSt. ist für umsatzsteuerregistrierte Importeure auf der nächsten Erklärung erstattungsfähig — effektiv eine Cash-Flow-Position, kein Nettokostenpunkt. Zoll ist nicht erstattungsfähig; das ist die tatsächlichen Tarifkosten des Imports.</p>
    </section>

    ${antiDumpingNote}

    <section class="guide-section">
      <h2>${CL.evftaTitle}</h2>
      <p>Für HS-Kapitel ${escapeHtml(chapter.code)} aus Vietnam gibt das EU-Vietnam-Freihandelsabkommen (EVFTA) typischerweise eine Zollreduktion von 70% mit gültigem Ursprungsnachweis (REX oder Rechnungserklärung). Für die gleiche Sendung von 25.000 €:</p>
      <table class="data-table">
        <thead><tr><th>Ursprung</th><th>Effektiver Zollsatz</th><th>Bezahlter Zoll</th><th>${CL.totalCashOut}</th></tr></thead>
        <tbody>
          <tr><td>China (MFN)</td><td class="num">${standard?.dutyRate ? (standard.dutyRate * 100).toFixed(2) + '%' : '—'}</td><td class="num">${Math.round(standard?.dutyEur || 0).toLocaleString('de-DE')} €</td><td class="num">${standard?.totalEur.toLocaleString('de-DE')} €</td></tr>
          ${vnStandard ? `<tr style="background: rgba(111, 166, 111, 0.06);"><td>Vietnam (EVFTA-Präferenz)</td><td class="num">${(vnStandard.dutyRate * 100).toFixed(2)}%</td><td class="num">${Math.round(vnStandard.dutyEur).toLocaleString('de-DE')} €</td><td class="num">${vnStandard.totalEur.toLocaleString('de-DE')} €</td></tr>` : ''}
        </tbody>
      </table>
      ${dutyDeltaEur > 100 ? `<p>Die Zollersparnis durch Sourcing in Vietnam mit gültigem EVFTA-Nachweis: <strong>${dutyDeltaEur.toLocaleString('de-DE')} €</strong> auf der gleichen 25.000-€-Sendung. Für hochvolumige SKUs rechtfertigt das oft die Lieferantenwechsel-Kosten.</p>` : ''}
    </section>

    <section class="guide-section">
      <h2>${CL.bondedTitle}</h2>
      <p>Wenn die Waren länger als 30 Tage vor dem Verkauf liegen, verschiebt das Zolllager Zoll + MwSt. — und vermeidet sie vollständig bei Re-Export. Cash-Flow-Vorteil bei 6% jährlichen Kapitalkosten × N Lagerungstage.</p>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${CL.runOnRealNumbers}</h3>
        <p>${CL.runOnRealNumbersText}</p>
      </div>
      <a href="/agent/?prompt=Ich%20arbeite%20Landed%20Cost%20auf%20einer%20Sendung%20von%2025.000%20%E2%82%AC%20HS%20${chapter.code}%20aus%20China%20nach%20${encodeURIComponent(destNameDE)}%20aus.">Compliance Agent →</a>
    </aside>
  `;

  return { path: `de/guides/customs/${slugUrl}`, canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'de', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: plCanonical }, { lang: 'de', href: canonical }, { lang: 'x-default', href: enCanonical }], linkContext: { hsChapter: chapter.code, destination, pageType: 'customs' } }) };
}

function generateCustomsIndexDE() {
  const CL = de.CUSTOMS_LABEL_DE;
  const L = de.LABEL_DE;
  const title = 'Zoll-Leitfäden — Landed-Cost-Berechnungen für EU-Importe | OrcaTrade';
  const description = '36 Zoll-Landed-Cost-Leitfäden für die wichtigsten HS-Kapitel × EU-Destinationen. MFN-Zollsätze, nationale MwSt., Brokerage, Zolllager-Alternativen. Calculator-fundiert.';
  const canonical = `${SITE_URL}/de/guides/customs/`;
  const enCanonical = `${SITE_URL}/guides/customs/`;
  const plCanonical = `${SITE_URL}/pl/guides/customs/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, inLanguage: 'de', url: canonical });

  const sections = CUSTOMS_CHAPTERS.map(ch => {
    const chDE = de.CUSTOMS_CHAPTER_DE[ch.code] || ch;
    const links = CUSTOMS_DESTINATIONS.map(d => {
      const dInfo = customs.EU_VAT[d];
      const dNameDE = de.COUNTRY_DE[d] || dInfo.name;
      return `<a class="related-card" href="/de/guides/customs/${chDE.slug}-${slug(d)}/">
        <div class="related-tag">HS ${escapeHtml(ch.code)} → ${escapeHtml(dNameDE)}</div>
        <h3>${escapeHtml(chDE.name)} nach ${escapeHtml(dNameDE)}</h3>
        <div class="related-desc">${(customs.HS_CHAPTER_DUTY[ch.code].rate * 100).toFixed(2)}% MFN · ${(dInfo.rate * 100).toFixed(0)}% MwSt.</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>HS ${escapeHtml(ch.code)} · ${escapeHtml(chDE.name)}</h2><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · ${CL.customsBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Zoll-Leitfäden</p>
      <h1>Landed-Cost-Berechnungen für EU-Importe.</h1>
      <p class="lead">36 Leitfäden zu den meistimportierten HS-Kapiteln × sechs wichtigsten EU-Mitgliedstaaten. Jeder enthält die Zoll + MwSt. + Brokerage-Mathematik für eine Beispielsendung von 25.000 €, Vergleich gegen präferenzielle Ursprünge (EVFTA Vietnam etc.) und die Zolllageralternative.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text"><h3>${CL.runOnRealNumbers}</h3><p>${CL.runOnRealNumbersText}</p></div>
      <a href="/agent/">Compliance Agent →</a>
    </aside>
  `;

  return { path: 'de/guides/customs', canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'de', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: plCanonical }, { lang: 'de', href: canonical }, { lang: 'x-default', href: enCanonical }] }) };
}

function generateCustomsIndex() {
  const title = 'Customs guides — landed-cost calculations for EU imports | OrcaTrade';
  const description = '36 customs landed-cost guides for major HS chapters × EU destinations. MFN duty rates, national VAT, brokerage, bonded warehouse alternatives. Calculator-grounded.';
  const canonical = `${SITE_URL}/guides/customs/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url: canonical });

  const sections = CUSTOMS_CHAPTERS.map(ch => {
    const links = CUSTOMS_DESTINATIONS.map(d => {
      const dInfo = customs.EU_VAT[d];
      return `<a class="related-card" href="/guides/customs/${ch.slug}-into-${slug(d)}/">
        <div class="related-tag">HS ${escapeHtml(ch.code)} → ${escapeHtml(dInfo.name)}</div>
        <h3>${escapeHtml(ch.name)} into ${escapeHtml(dInfo.name)}</h3>
        <div class="related-desc">${(customs.HS_CHAPTER_DUTY[ch.code].rate * 100).toFixed(2)}% MFN · ${(dInfo.rate * 100).toFixed(0)}% VAT</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>HS ${escapeHtml(ch.code)} · ${escapeHtml(ch.name)}</h2><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/">Home</a> · <a href="/guides/">Guides</a> · Customs</nav>
    <header class="guide-hero">
      <p class="kicker">Customs guides</p>
      <h1>Landed-cost calculations for EU imports.</h1>
      <p class="lead">36 guides covering the most-imported HS chapters × six major EU destinations. Each carries the duty + VAT + brokerage math for a sample €25,000 shipment, comparison against preferential origins (EVFTA Vietnam etc.), and the bonded-warehouse alternative.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Calculate landed cost for your real shipment</h3>
        <p>The Compliance Agent's customs tools cover all 50+ HS chapters, all 27 EU member states, with anti-dumping overlays and preferential-FTA detection.</p>
      </div>
      <a href="/agent/">Open Compliance Agent →</a>
    </aside>
  `;

  return {
    path: 'guides/customs',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: `${SITE_URL}/pl/guides/customs/` },
        { lang: 'de', href: `${SITE_URL}/de/guides/customs/` },
        { lang: 'x-default', href: canonical },
      ],
    }),
  };
}

// ── Warehouse hub pages ────────────────────────────────────

function generateWarehousePage(hubKey) {
  const hub = warehouse.HUBS[hubKey];

  // Sample quote for a typical SME profile
  const sampleQuote = warehouse.calculateQuote({
    monthlyOrders: 1500,
    avgUnitsPerOrder: 1.5,
    avgLinesPerOrder: 1.2,
    avgPalletsHeld: 50,
    avgOrderWeightKg: 2,
    primaryDestination: hub.country,
  });

  // Find this hub's quote
  const thisHub = sampleQuote.quotes.find(h => h.hubKey === hubKey);
  const cheapest = [...sampleQuote.quotes].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur)[0];

  const slugUrl = `${slug(hub.name)}-3pl`;
  const title = `${hub.name} 3PL — pricing, capacity, fit | OrcaTrade`;
  const description = `${hub.name} (${hub.countryName}) as an EU 3PL hub: storage from €${hub.storagePerPalletPerMonthEur}/pallet/month, pick & pack pricing, sea freight from Asia ${hub.transitFromAsiaSea}. When ${hub.name} is the right hub vs alternatives.`.slice(0, 300);
  const canonical = `${SITE_URL}/guides/warehouse/${slugUrl}/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title,
        description,
        datePublished: TODAY,
        dateModified: TODAY,
        author: { '@type': 'Organization', name: 'OrcaTrade Group' },
        publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Guides', item: `${SITE_URL}/guides/` },
          { '@type': 'ListItem', position: 2, name: 'Warehouse', item: `${SITE_URL}/guides/warehouse/` },
          { '@type': 'ListItem', position: 3, name: hub.name, item: canonical },
        ],
      },
    ],
  });

  const cheaperByEur = thisHub.totalMonthlyEur - cheapest.totalMonthlyEur;
  const isCheapest = thisHub.hubKey === cheapest.hubKey;

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/">Home</a> · <a href="/guides/">Guides</a> · <a href="/guides/warehouse/">Warehouse</a> · ${escapeHtml(hub.name)} 3PL
    </nav>

    <header class="guide-hero">
      <p class="kicker">Warehouse guide · ${escapeHtml(hub.region)}</p>
      <h1>${escapeHtml(hub.name)} as an EU 3PL hub: pricing, capacity, fit</h1>
      <p class="lead">${escapeHtml(hub.countryName)}'s ${escapeHtml(hub.name)} hub for SME importers fulfilling Asia-sourced inventory across the EU. Storage at €${hub.storagePerPalletPerMonthEur}/pallet/month list, pick & pack from €${hub.pickBaseEur}/order base, sea freight from Asia: ${escapeHtml(hub.transitFromAsiaSea)}.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">€${hub.storagePerPalletPerMonthEur}</div><div class="label">Storage · pallet/mo</div></div>
      <div class="guide-stat"><div class="num">€${hub.pickBaseEur}</div><div class="label">Pick base · order</div></div>
      <div class="guide-stat"><div class="num">€${hub.inboundReceiptPerPalletEur}</div><div class="label">Inbound · pallet</div></div>
      <div class="guide-stat"><div class="num">€${hub.setupFeeEur}</div><div class="label">One-off setup</div></div>
    </div>

    <section class="guide-section">
      <h2>Where ${escapeHtml(hub.name)} excels</h2>
      <ul>${hub.pros.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    </section>

    <section class="guide-section">
      <h2>Where to push back</h2>
      <ul>${hub.cons.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </section>

    <section class="guide-section">
      <h2>Sample monthly cost · 1,500 orders to ${escapeHtml(hub.countryName)}</h2>
      <p>For a typical SME shipper running 1,500 orders/month, 1.5 average units/order, 50 pallets held, average parcel 2 kg, primary destination ${escapeHtml(hub.countryName)}:</p>
      <table class="data-table">
        <thead><tr><th>Component</th><th>Monthly cost</th></tr></thead>
        <tbody>
          ${thisHub.breakdown.filter(b => !b.isVas).map(b => `<tr><td>${escapeHtml(b.label)}</td><td class="num">€${b.monthlyCostEur.toLocaleString('en-IE')}</td></tr>`).join('')}
          <tr style="background: rgba(184,190,200,0.08);"><td><strong>Total monthly</strong></td><td class="num"><strong>€${thisHub.totalMonthlyEur.toLocaleString('en-IE')}</strong></td></tr>
          <tr><td>Cost per order</td><td class="num">€${thisHub.costPerOrderEur}</td></tr>
        </tbody>
      </table>
      ${!isCheapest ? `<p>${escapeHtml(hub.name)} costs <strong>€${Math.abs(cheaperByEur).toLocaleString('en-IE')}/month more</strong> than the cheapest alternative (${escapeHtml(cheapest.hubName)} at €${cheapest.totalMonthlyEur.toLocaleString('en-IE')}/mo). Whether that premium is justified depends on your customer-base geography and onward delivery time.</p>` : `<p>For this profile, ${escapeHtml(hub.name)} is the lowest-cost hub of the six benchmarked.</p>`}
    </section>

    <section class="guide-section">
      <h2>${escapeHtml(hub.name)} vs all 6 EU hubs</h2>
      <p>Same shipper profile (1,500 orders/month to ${escapeHtml(hub.countryName)}), all 6 hubs side by side:</p>
      <table class="data-table">
        <thead><tr><th>Hub</th><th>Region</th><th>Total monthly</th><th>Cost per order</th></tr></thead>
        <tbody>
          ${[...sampleQuote.quotes].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur).map(h => {
            const isCurrent = h.hubKey === hubKey;
            return `<tr${isCurrent ? ' style="background: rgba(184,190,200,0.06);"' : ''}>
              <td>${escapeHtml(h.hubName)}${isCurrent ? ' <span style="opacity:0.6;font-size:0.78em;">(this guide)</span>' : ` <a href="/guides/warehouse/${slug(h.hubName)}-3pl/" style="font-size:0.85em; opacity:0.7;">[guide →]</a>`}</td>
              <td>${escapeHtml(h.hubRegion)}</td>
              <td class="num">€${h.totalMonthlyEur.toLocaleString('en-IE')}</td>
              <td class="num">€${h.costPerOrderEur}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    <section class="guide-section">
      <h2>What's not in the cost</h2>
      <ul>
        <li><strong>Value-added services</strong> — QC inspection, labelling, kitting, photography, returns processing, gift wrapping (each €0.15–€4.20 per unit/return).</li>
        <li><strong>Last-mile shipping</strong> — included in pick &amp; pack but rate varies by destination region (within-region cheaper than cross-region).</li>
        <li><strong>Returns handling</strong> — counts only if you opt into the returns VAS line.</li>
        <li><strong>3PL contract terms</strong> — rates here are mid-market list. Above 3,000 orders/month negotiate 10–15% off; above 10,000 orders/month, 20–25%.</li>
      </ul>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Run the comparison on your real volume</h3>
        <p>The Logistics Agent benchmarks all 6 hubs on your specific monthly orders, units, pallets, and primary destination — and recommends the best fit.</p>
      </div>
      <a href="/agent/logistics/?prompt=I%27m%20looking%20at%20${encodeURIComponent(hub.name)}%20as%20my%20EU%203PL%20hub.%20Compare%20it%20against%20the%20other%205%20options%20on%20cost%20and%20customer-experience%20fit.">Open Logistics Agent →</a>
    </aside>
  `;

  const plCanonical = `${SITE_URL}/pl/guides/warehouse/${slugUrl}/`;
  const deCanonical = `${SITE_URL}/de/guides/warehouse/${slug(de.CITY_DE[hub.name] || hub.name)}-3pl/`;
  return {
    path: `guides/warehouse/${slugUrl}`,
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: plCanonical },
        { lang: 'de', href: deCanonical },
        { lang: 'x-default', href: canonical },
      ],
      linkContext: { destination: hub.country, pageType: 'warehouse' },
    }),
  };
}

// ── Warehouse pages — Polish ───────────────────────────────

function generateWarehousePagePL(hubKey) {
  const hub = warehouse.HUBS[hubKey];
  const cityPL = pl.CITY_PL[hub.name] || hub.name;
  const countryPL = pl.COUNTRY_PL[hub.country] || hub.countryName;
  const WL = pl.WAREHOUSE_LABEL_PL;
  const L = pl.LABEL_PL;

  const sampleQuote = warehouse.calculateQuote({ monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: hub.country });
  const thisHub = sampleQuote.quotes.find(h => h.hubKey === hubKey);
  const cheapest = [...sampleQuote.quotes].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur)[0];

  const slugUrl = `${slug(cityPL)}-3pl`;
  const title = `${cityPL} 3PL — cennik, wydajność, dopasowanie | OrcaTrade`;
  const description = `${cityPL} (${countryPL}) jako hub 3PL w UE: magazynowanie od ${hub.storagePerPalletPerMonthEur} €/paleta/mc, ceny pick & pack, fracht morski z Azji ${hub.transitFromAsiaSea}. Kiedy ${cityPL} jest właściwym hubem.`.slice(0, 300);
  const canonical = `${SITE_URL}/pl/guides/warehouse/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/warehouse/${slug(hub.name)}-3pl/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', headline: title, description, datePublished: TODAY, dateModified: TODAY, inLanguage: 'pl', author: { '@type': 'Organization', name: 'OrcaTrade Group' }, publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } }, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/pl/guides/` },
        { '@type': 'ListItem', position: 2, name: WL.warehouseBreadcrumb, item: `${SITE_URL}/pl/guides/warehouse/` },
        { '@type': 'ListItem', position: 3, name: `${cityPL} 3PL`, item: canonical },
      ]},
    ],
  });

  const cheaperByEur = thisHub.totalMonthlyEur - cheapest.totalMonthlyEur;
  const isCheapest = thisHub.hubKey === cheapest.hubKey;

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · <a href="/pl/guides/warehouse/">${WL.warehouseBreadcrumb}</a> · ${escapeHtml(cityPL)} 3PL
    </nav>

    <header class="guide-hero">
      <p class="kicker">${WL.warehouseGuide} · ${escapeHtml(pl.REGION_PL[hub.region] || hub.region)}</p>
      <h1>${escapeHtml(cityPL)} ${WL.asEuHub}: ${WL.pricingCapacityFit}</h1>
      <p class="lead">${escapeHtml(countryPL)}, hub ${escapeHtml(cityPL)} dla MŚP-importerów realizujących azjatyckie zapasy w całej UE. Magazynowanie po ${hub.storagePerPalletPerMonthEur} €/paleta/mc cena listy, pick & pack od ${hub.pickBaseEur} €/zamówienie baza, fracht morski z Azji: ${escapeHtml(hub.transitFromAsiaSea)}.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${hub.storagePerPalletPerMonthEur} €</div><div class="label">${WL.storagePerPallet}</div></div>
      <div class="guide-stat"><div class="num">${hub.pickBaseEur} €</div><div class="label">${WL.pickBase}</div></div>
      <div class="guide-stat"><div class="num">${hub.inboundReceiptPerPalletEur} €</div><div class="label">${WL.inboundPerPallet}</div></div>
      <div class="guide-stat"><div class="num">${hub.setupFeeEur} €</div><div class="label">${WL.oneOffSetup}</div></div>
    </div>

    <section class="guide-section">
      <h2>${WL.whereExcels}: ${escapeHtml(cityPL)}</h2>
      <ul>${hub.pros.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    </section>

    <section class="guide-section">
      <h2>${WL.wherePushBack}</h2>
      <ul>${hub.cons.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </section>

    <section class="guide-section">
      <h2>${WL.sampleMonthlyCost}</h2>
      <p>${WL.forTypical1500} z 1,5 średnich jednostek/zamówienie, 50 palet utrzymywanych, średnia paczka 2 kg, główny kierunek ${escapeHtml(countryPL)}:</p>
      <table class="data-table">
        <thead><tr><th>Komponent</th><th>${WL.monthlyCost}</th></tr></thead>
        <tbody>
          ${thisHub.breakdown.filter(b => !b.isVas).map(b => `<tr><td>${escapeHtml(b.label)}</td><td class="num">${b.monthlyCostEur.toLocaleString('pl-PL')} €</td></tr>`).join('')}
          <tr style="background: rgba(184,190,200,0.08);"><td><strong>${WL.totalMonthly}</strong></td><td class="num"><strong>${thisHub.totalMonthlyEur.toLocaleString('pl-PL')} €</strong></td></tr>
          <tr><td>${WL.costPerOrder}</td><td class="num">${thisHub.costPerOrderEur} €</td></tr>
        </tbody>
      </table>
      ${!isCheapest ? `<p>${escapeHtml(cityPL)} kosztuje <strong>${Math.abs(cheaperByEur).toLocaleString('pl-PL')} €/mc więcej</strong> niż najtańsza alternatywa (${escapeHtml(pl.CITY_PL[cheapest.hubName] || cheapest.hubName)} po ${cheapest.totalMonthlyEur.toLocaleString('pl-PL')} €/mc). Czy ta premia jest uzasadniona zależy od geografii bazy klientów i czasu dostawy.</p>` : `<p>Dla tego profilu, ${escapeHtml(cityPL)} jest najtańszym hubem z 6 zbenchmarkowanych.</p>`}
    </section>

    <section class="guide-section">
      <h2>${escapeHtml(cityPL)} ${WL.vsAllSixHubs}</h2>
      <table class="data-table">
        <thead><tr><th>${WL.hub}</th><th>${WL.region}</th><th>${WL.totalMonthly}</th><th>${WL.costPerOrder}</th></tr></thead>
        <tbody>
          ${[...sampleQuote.quotes].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur).map(h => {
            const isCurrent = h.hubKey === hubKey;
            const cityLocPL = pl.CITY_PL[h.hubName] || h.hubName;
            return `<tr${isCurrent ? ' style="background: rgba(184,190,200,0.06);"' : ''}>
              <td>${escapeHtml(cityLocPL)}${isCurrent ? ' <span style="opacity:0.6;font-size:0.78em;">(ten przewodnik)</span>' : ''}</td>
              <td>${escapeHtml(h.hubRegion)}</td>
              <td class="num">${h.totalMonthlyEur.toLocaleString('pl-PL')} €</td>
              <td class="num">${h.costPerOrderEur} €</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    <section class="guide-section">
      <h2>${WL.whatNotInCost}</h2>
      <ul>
        <li>${WL.vasNote}</li>
        <li>${WL.contractTerms}</li>
      </ul>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${WL.runComparisonOnVolume}</h3>
        <p>${WL.runComparisonText}</p>
      </div>
      <a href="/agent/logistics/?prompt=Patrz%C4%99%20na%20${encodeURIComponent(cityPL)}%20jako%20m%C3%B3j%20hub%203PL%20w%20UE.%20Por%C3%B3wnaj%20z%20pozosta%C5%82ymi%205%20opcjami.">Logistics Agent →</a>
    </aside>
  `;

  const deCityForSlug = de.CITY_DE[hub.name] || hub.name;
  const deCanonical = `${SITE_URL}/de/guides/warehouse/${slug(deCityForSlug)}-3pl/`;
  return { path: `pl/guides/warehouse/${slugUrl}`, canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'pl', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: canonical }, { lang: 'de', href: deCanonical }, { lang: 'x-default', href: enCanonical }], linkContext: { destination: hub.country, pageType: 'warehouse' } }) };
}

function generateWarehouseIndexPL() {
  const WL = pl.WAREHOUSE_LABEL_PL;
  const L = pl.LABEL_PL;
  const title = 'Przewodniki magazyn / 3PL — sześć hubów UE w benchmarku | OrcaTrade';
  const description = 'Sześć profili hubów 3PL w UE: Rotterdam, Hamburg, Frankfurt, Poznań, Praga, Barcelona. Koszt magazynowania, pick & pack, inbound, setup, przykładowy koszt miesięczny dla MŚP.';
  const canonical = `${SITE_URL}/pl/guides/warehouse/`;
  const enCanonical = `${SITE_URL}/guides/warehouse/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, inLanguage: 'pl', url: canonical });

  const links = Object.keys(warehouse.HUBS).map(hubKey => {
    const hub = warehouse.HUBS[hubKey];
    const cityPL = pl.CITY_PL[hub.name] || hub.name;
    return `<a class="related-card" href="/pl/guides/warehouse/${slug(cityPL)}-3pl/">
      <div class="related-tag">${escapeHtml(hub.region)} · ${escapeHtml(hub.country)}</div>
      <h3>${escapeHtml(cityPL)}</h3>
      <div class="related-desc">${hub.storagePerPalletPerMonthEur} €/paleta/mc · ${hub.pickBaseEur} € pick base</div>
    </a>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/pl/">${L.homeBreadcrumb}</a> · <a href="/pl/guides/">${L.guidesBreadcrumb}</a> · ${WL.warehouseBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Przewodniki magazyn / 3PL</p>
      <h1>Sześć hubów 3PL w UE, w benchmarku.</h1>
      <p class="lead">Profile dla sześciu hubów 3PL w UE, które OrcaTrade benchmarkuje dla MŚP-shipperów: Rotterdam, Hamburg, Frankfurt, Poznań, Praga, Barcelona. Każdy przewodnik pokrywa koszt magazynowania, ceny pick & pack, obsługę inbound, opłatę setupową i przykładowy koszt miesięczny dla typowego profilu MŚP z 1500 zamówieniami.</p>
    </header>
    <section class="guide-section"><div class="related-grid">${links}</div></section>
    <aside class="agent-cta">
      <div class="cta-text"><h3>${WL.runComparisonOnVolume}</h3><p>${WL.runComparisonText}</p></div>
      <a href="/agent/logistics/">Logistics Agent →</a>
    </aside>
  `;

  return { path: 'pl/guides/warehouse', canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'pl', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: canonical }, { lang: 'x-default', href: enCanonical }] }) };
}

// ── Warehouse pages — German ───────────────────────────────

function generateWarehousePageDE(hubKey) {
  const hub = warehouse.HUBS[hubKey];
  const cityDE = de.CITY_DE[hub.name] || hub.name;
  const countryDE = de.COUNTRY_DE[hub.country] || hub.countryName;
  const WL = de.WAREHOUSE_LABEL_DE;
  const L = de.LABEL_DE;

  const sampleQuote = warehouse.calculateQuote({ monthlyOrders: 1500, avgUnitsPerOrder: 1.5, avgLinesPerOrder: 1.2, avgPalletsHeld: 50, avgOrderWeightKg: 2, primaryDestination: hub.country });
  const thisHub = sampleQuote.quotes.find(h => h.hubKey === hubKey);
  const cheapest = [...sampleQuote.quotes].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur)[0];

  const slugUrl = `${slug(cityDE)}-3pl`;
  const title = `${cityDE} 3PL — Preise, Kapazität, Eignung | OrcaTrade`;
  const description = `${cityDE} (${countryDE}) als EU-3PL-Hub: Lagerung ab ${hub.storagePerPalletPerMonthEur} €/Palette/Monat, Pick-and-Pack-Preise, Seefracht aus Asien ${hub.transitFromAsiaSea}. Wann ${cityDE} der richtige Hub ist.`.slice(0, 300);
  const canonical = `${SITE_URL}/de/guides/warehouse/${slugUrl}/`;
  const enCanonical = `${SITE_URL}/guides/warehouse/${slug(hub.name)}-3pl/`;
  const plCityForSlug = pl.CITY_PL[hub.name] || hub.name;
  const plCanonical = `${SITE_URL}/pl/guides/warehouse/${slug(plCityForSlug)}-3pl/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Article', headline: title, description, datePublished: TODAY, dateModified: TODAY, inLanguage: 'de', author: { '@type': 'Organization', name: 'OrcaTrade Group' }, publisher: { '@type': 'Organization', name: 'OrcaTrade Group', logo: { '@type': 'ImageObject', url: `${SITE_URL}/orcatrade_logo.png` } }, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: L.guidesBreadcrumb, item: `${SITE_URL}/de/guides/` },
        { '@type': 'ListItem', position: 2, name: WL.warehouseBreadcrumb, item: `${SITE_URL}/de/guides/warehouse/` },
        { '@type': 'ListItem', position: 3, name: `${cityDE} 3PL`, item: canonical },
      ]},
    ],
  });

  const cheaperByEur = thisHub.totalMonthlyEur - cheapest.totalMonthlyEur;
  const isCheapest = thisHub.hubKey === cheapest.hubKey;

  const body = `
    <nav class="guide-breadcrumb">
      <a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · <a href="/de/guides/warehouse/">${WL.warehouseBreadcrumb}</a> · ${escapeHtml(cityDE)} 3PL
    </nav>

    <header class="guide-hero">
      <p class="kicker">${WL.warehouseGuide} · ${escapeHtml(de.REGION_DE[hub.region] || hub.region)}</p>
      <h1>${escapeHtml(cityDE)} ${WL.asEuHub}: ${WL.pricingCapacityFit}</h1>
      <p class="lead">${escapeHtml(countryDE)}s ${escapeHtml(cityDE)}-Hub für KMU-Importeure, die asiatische Bestände in der EU abwickeln. Lagerung zu ${hub.storagePerPalletPerMonthEur} €/Palette/Monat Listenpreis, Pick-and-Pack ab ${hub.pickBaseEur} €/Auftrag Basis, Seefracht aus Asien: ${escapeHtml(hub.transitFromAsiaSea)}.</p>
    </header>

    <div class="guide-stats">
      <div class="guide-stat"><div class="num">${hub.storagePerPalletPerMonthEur} €</div><div class="label">${WL.storagePerPallet}</div></div>
      <div class="guide-stat"><div class="num">${hub.pickBaseEur} €</div><div class="label">${WL.pickBase}</div></div>
      <div class="guide-stat"><div class="num">${hub.inboundReceiptPerPalletEur} €</div><div class="label">${WL.inboundPerPallet}</div></div>
      <div class="guide-stat"><div class="num">${hub.setupFeeEur} €</div><div class="label">${WL.oneOffSetup}</div></div>
    </div>

    <section class="guide-section">
      <h2>${WL.whereExcels}: ${escapeHtml(cityDE)}</h2>
      <ul>${hub.pros.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    </section>

    <section class="guide-section">
      <h2>${WL.wherePushBack}</h2>
      <ul>${hub.cons.map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </section>

    <section class="guide-section">
      <h2>${WL.sampleMonthlyCost}</h2>
      <p>${WL.forTypical1500} mit 1,5 durchschnittlichen Einheiten/Auftrag, 50 Paletten gehalten, durchschnittliche Sendung 2 kg, Hauptdestination ${escapeHtml(countryDE)}:</p>
      <table class="data-table">
        <thead><tr><th>Komponente</th><th>${WL.monthlyCost}</th></tr></thead>
        <tbody>
          ${thisHub.breakdown.filter(b => !b.isVas).map(b => `<tr><td>${escapeHtml(b.label)}</td><td class="num">${b.monthlyCostEur.toLocaleString('de-DE')} €</td></tr>`).join('')}
          <tr style="background: rgba(184,190,200,0.08);"><td><strong>${WL.totalMonthly}</strong></td><td class="num"><strong>${thisHub.totalMonthlyEur.toLocaleString('de-DE')} €</strong></td></tr>
          <tr><td>${WL.costPerOrder}</td><td class="num">${thisHub.costPerOrderEur} €</td></tr>
        </tbody>
      </table>
      ${!isCheapest ? `<p>${escapeHtml(cityDE)} kostet <strong>${Math.abs(cheaperByEur).toLocaleString('de-DE')} €/Monat mehr</strong> als die günstigste Alternative (${escapeHtml(de.CITY_DE[cheapest.hubName] || cheapest.hubName)} bei ${cheapest.totalMonthlyEur.toLocaleString('de-DE')} €/Monat). Ob diese Prämie gerechtfertigt ist, hängt von der Geografie Ihrer Kundenbasis und der Lieferzeit ab.</p>` : `<p>Für dieses Profil ist ${escapeHtml(cityDE)} der günstigste Hub der sechs benchmarkten.</p>`}
    </section>

    <section class="guide-section">
      <h2>${escapeHtml(cityDE)} ${WL.vsAllSixHubs}</h2>
      <table class="data-table">
        <thead><tr><th>${WL.hub}</th><th>${WL.region}</th><th>${WL.totalMonthly}</th><th>${WL.costPerOrder}</th></tr></thead>
        <tbody>
          ${[...sampleQuote.quotes].sort((a, b) => a.totalMonthlyEur - b.totalMonthlyEur).map(h => {
            const isCurrent = h.hubKey === hubKey;
            const cityLocDE = de.CITY_DE[h.hubName] || h.hubName;
            return `<tr${isCurrent ? ' style="background: rgba(184,190,200,0.06);"' : ''}>
              <td>${escapeHtml(cityLocDE)}${isCurrent ? ' <span style="opacity:0.6;font-size:0.78em;">(dieser Leitfaden)</span>' : ''}</td>
              <td>${escapeHtml(h.hubRegion)}</td>
              <td class="num">${h.totalMonthlyEur.toLocaleString('de-DE')} €</td>
              <td class="num">${h.costPerOrderEur} €</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </section>

    <section class="guide-section">
      <h2>${WL.whatNotInCost}</h2>
      <ul>
        <li>${WL.vasNote}</li>
        <li>${WL.contractTerms}</li>
      </ul>
    </section>

    <aside class="agent-cta">
      <div class="cta-text">
        <h3>${WL.runComparisonOnVolume}</h3>
        <p>${WL.runComparisonText}</p>
      </div>
      <a href="/agent/logistics/?prompt=Ich%20schaue%20mir%20${encodeURIComponent(cityDE)}%20als%20meinen%20EU-3PL-Hub%20an.%20Vergleichen%20Sie%20mit%20den%20anderen%205%20Optionen.">Logistics Agent →</a>
    </aside>
  `;

  return { path: `de/guides/warehouse/${slugUrl}`, canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'de', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: plCanonical }, { lang: 'de', href: canonical }, { lang: 'x-default', href: enCanonical }], linkContext: { destination: hub.country, pageType: 'warehouse' } }) };
}

function generateWarehouseIndexDE() {
  const WL = de.WAREHOUSE_LABEL_DE;
  const L = de.LABEL_DE;
  const title = 'Lager- / 3PL-Leitfäden — sechs EU-Hubs im Benchmark | OrcaTrade';
  const description = 'Sechs EU-3PL-Hub-Profile: Rotterdam, Hamburg, Frankfurt, Posen, Prag, Barcelona. Lagerkosten, Pick-and-Pack, Wareneingang, Setup, beispielhafte Monatskosten für KMU.';
  const canonical = `${SITE_URL}/de/guides/warehouse/`;
  const enCanonical = `${SITE_URL}/guides/warehouse/`;
  const plCanonical = `${SITE_URL}/pl/guides/warehouse/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, inLanguage: 'de', url: canonical });

  const links = Object.keys(warehouse.HUBS).map(hubKey => {
    const hub = warehouse.HUBS[hubKey];
    const cityDE = de.CITY_DE[hub.name] || hub.name;
    return `<a class="related-card" href="/de/guides/warehouse/${slug(cityDE)}-3pl/">
      <div class="related-tag">${escapeHtml(hub.region)} · ${escapeHtml(hub.country)}</div>
      <h3>${escapeHtml(cityDE)}</h3>
      <div class="related-desc">${hub.storagePerPalletPerMonthEur} €/Palette/Monat · ${hub.pickBaseEur} € Pick-Basis</div>
    </a>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/de/">${L.homeBreadcrumb}</a> · <a href="/de/guides/">${L.guidesBreadcrumb}</a> · ${WL.warehouseBreadcrumb}</nav>
    <header class="guide-hero">
      <p class="kicker">Lager- / 3PL-Leitfäden</p>
      <h1>Sechs EU-3PL-Hubs, im Benchmark.</h1>
      <p class="lead">Profile für die sechs EU-3PL-Hubs, die OrcaTrade für KMU-Versender benchmarkt: Rotterdam, Hamburg, Frankfurt, Posen, Prag, Barcelona. Jeder Leitfaden behandelt Lagerkosten, Pick-and-Pack-Preise, Wareneingangsabwicklung, Setup-Gebühr und beispielhafte Monatskosten für ein typisches KMU-Profil mit 1.500 Aufträgen.</p>
    </header>
    <section class="guide-section"><div class="related-grid">${links}</div></section>
    <aside class="agent-cta">
      <div class="cta-text"><h3>${WL.runComparisonOnVolume}</h3><p>${WL.runComparisonText}</p></div>
      <a href="/agent/logistics/">Logistics Agent →</a>
    </aside>
  `;

  return { path: 'de/guides/warehouse', canonical, html: pageShell({ title, description, canonical, jsonLd, body, locale: 'de', hreflangAlternates: [{ lang: 'en', href: enCanonical }, { lang: 'pl', href: plCanonical }, { lang: 'de', href: canonical }, { lang: 'x-default', href: enCanonical }] }) };
}

function generateWarehouseIndex() {
  const title = 'Warehouse / 3PL guides — six EU hubs benchmarked | OrcaTrade';
  const description = 'Six EU 3PL hub profiles: Rotterdam, Hamburg, Frankfurt, Poznań, Prague, Barcelona. Storage cost, pick & pack, inbound, setup, sample monthly cost for SME shippers.';
  const canonical = `${SITE_URL}/guides/warehouse/`;
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url: canonical });

  const links = Object.keys(warehouse.HUBS).map(hubKey => {
    const hub = warehouse.HUBS[hubKey];
    return `<a class="related-card" href="/guides/warehouse/${slug(hub.name)}-3pl/">
      <div class="related-tag">${escapeHtml(hub.region)} · ${escapeHtml(hub.country)}</div>
      <h3>${escapeHtml(hub.name)}</h3>
      <div class="related-desc">€${hub.storagePerPalletPerMonthEur}/pallet/mo · €${hub.pickBaseEur} pick base</div>
    </a>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/">Home</a> · <a href="/guides/">Guides</a> · Warehouse</nav>
    <header class="guide-hero">
      <p class="kicker">Warehouse / 3PL guides</p>
      <h1>Six EU 3PL hubs, benchmarked.</h1>
      <p class="lead">Profiles for the six EU 3PL hubs OrcaTrade benchmarks for SME shippers: Rotterdam, Hamburg, Frankfurt, Poznań, Prague, Barcelona. Each guide covers storage cost, pick &amp; pack pricing, inbound handling, setup fee, and sample monthly cost for a typical 1,500-order SME profile.</p>
    </header>
    <section class="guide-section"><div class="related-grid">${links}</div></section>
    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Benchmark all 6 on your real volume</h3>
        <p>The Logistics Agent compares all 6 hubs on your monthly orders, primary customer destination, and value-added service mix — and recommends the right balance of cost vs delivery speed.</p>
      </div>
      <a href="/agent/logistics/">Open Logistics Agent →</a>
    </aside>
  `;

  return {
    path: 'guides/warehouse',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: `${SITE_URL}/pl/guides/warehouse/` },
        { lang: 'de', href: `${SITE_URL}/de/guides/warehouse/` },
        { lang: 'x-default', href: canonical },
      ],
    }),
  };
}

// ── Index pages (one per category) ──────────────────────────

function generateSourcingIndex() {
  const title = 'Sourcing guides — Asia → Europe by country and category | OrcaTrade';
  const description = '40 sourcing guides covering 5 countries (CN / VN / IN / BD / TR) × 8 product categories (apparel, electronics, furniture, toys, cosmetics, homeware, footwear, machinery). FOB cost, lead time, MOQ, quality and IP risk for each combination.';
  const canonical = `${SITE_URL}/guides/sourcing/`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
  });

  const sections = Object.keys(sourcing.CATEGORIES).map(catKey => {
    const cat = sourcing.CATEGORIES[catKey];
    const links = Object.keys(sourcing.COUNTRIES).map(country => {
      const ci = sourcing.COUNTRIES[country];
      const cp = cat.countryProfiles[country];
      if (!cp) return '';
      return `<a class="related-card" href="/guides/sourcing/${slug(catKey)}-from-${slug(country)}/">
        <div class="related-tag">${escapeHtml(ci.name)}</div>
        <h3>${escapeHtml(cat.label)} from ${escapeHtml(ci.name)}</h3>
        <div class="related-desc">FOB ${cp.fobIndex}× · ${cp.leadTimeWeeks + ci.seaTransitWeeks}w total · ${cp.qualityRisk} quality</div>
      </a>`;
    }).join('');
    return `<section class="guide-section"><h2>${escapeHtml(cat.label)}</h2><p>${escapeHtml(cat.description)}</p><div class="related-grid">${links}</div></section>`;
  }).join('');

  const body = `
    <nav class="guide-breadcrumb"><a href="/">Home</a> · <a href="/guides/">Guides</a> · Sourcing</nav>
    <header class="guide-hero">
      <p class="kicker">Sourcing guides</p>
      <h1>Where to source from. By country, by category.</h1>
      <p class="lead">40 guides covering the five major Asian sourcing markets (China, Vietnam, India, Bangladesh, Türkiye) across eight product categories. Each guide carries OrcaTrade's calculator-grounded FOB index, lead time, MOQ band, and quality + IP risk benchmark.</p>
    </header>
    ${sections}
    <aside class="agent-cta">
      <div class="cta-text">
        <h3>Use the Sourcing Agent for a tailored comparison</h3>
        <p>Skip browsing — describe your product, target FOB, MOQ, and urgency. The agent compares all five countries on your specific brief.</p>
      </div>
      <a href="/agent/sourcing/">Open Sourcing Agent →</a>
    </aside>
  `;

  return {
    path: 'guides/sourcing',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: `${SITE_URL}/pl/guides/sourcing/` },
        { lang: 'x-default', href: canonical },
      ],
    }),
  };
}

// ── Guides root index ──────────────────────────────────────

function generateGuidesRoot() {
  const title = 'OrcaTrade Guides — sourcing, routing, customs, warehousing for Asia–Europe importers';
  const description = 'Long-form guides for European SMEs importing from Asia. Country sourcing comparisons, transport mode selection, customs landed-cost calculations, and EU 3PL hub benchmarks. Calculator-grounded.';
  const canonical = `${SITE_URL}/guides/`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
  });

  const body = `
    <nav class="guide-breadcrumb"><a href="/">Home</a> · Guides</nav>
    <header class="guide-hero">
      <p class="kicker">OrcaTrade Guides</p>
      <h1>Calculator-grounded guides for Asia–Europe trade.</h1>
      <p class="lead">No filler content. Every guide is anchored to OrcaTrade's deterministic calculators for sourcing, routing, customs, and warehousing — so the numbers you read are the same numbers you'd get from running the agent. Browse by domain below.</p>
    </header>

    <section class="guide-section">
      <h2>Sourcing</h2>
      <p>Where to source — country comparisons across CN / VN / IN / BD / TR for eight product categories. FOB index, lead time, MOQ, quality and IP risk per combination.</p>
      <a href="/guides/sourcing/" style="display:inline-block; margin-top: 0.4rem; padding: 0.6rem 1rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.78rem; text-decoration: none;">Browse 40 sourcing guides →</a>
    </section>

    <section class="guide-section">
      <h2>Routing</h2>
      <p>How to ship between Asia and Europe — corridor guides covering sea FCL, sea LCL, air, and rail (where viable) for the major lanes. Calculator-grounded cost, transit, and CO₂ per shipment band.</p>
      <a href="/guides/routing/" style="display:inline-block; margin-top: 0.4rem; padding: 0.6rem 1rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.78rem; text-decoration: none;">Browse 30 routing guides →</a>
    </section>

    <section class="guide-section">
      <h2>Customs</h2>
      <p>Landed-cost calculations for the major HS chapters across six EU member states. Duty + VAT + brokerage math, preferential FTA comparisons, bonded-warehouse alternatives.</p>
      <a href="/guides/customs/" style="display:inline-block; margin-top: 0.4rem; padding: 0.6rem 1rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.78rem; text-decoration: none;">Browse 36 customs guides →</a>
    </section>

    <section class="guide-section">
      <h2>Warehouse / 3PL</h2>
      <p>Six EU 3PL hub profiles — Rotterdam, Hamburg, Frankfurt, Poznań, Prague, Barcelona. Storage cost, pick &amp; pack pricing, sample monthly cost for typical SME shippers.</p>
      <a href="/guides/warehouse/" style="display:inline-block; margin-top: 0.4rem; padding: 0.6rem 1rem; background: var(--accent-color, #b8bec8); color: #0a0912; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.78rem; text-decoration: none;">Browse 6 warehouse guides →</a>
    </section>
  `;

  return {
    path: 'guides',
    canonical,
    html: pageShell({
      title, description, canonical, jsonLd, body,
      hreflangAlternates: [
        { lang: 'en', href: canonical },
        { lang: 'pl', href: `${SITE_URL}/pl/guides/` },
        { lang: 'x-default', href: canonical },
      ],
    }),
  };
}

// ── Sitemap ────────────────────────────────────────────────

function generateSitemap(urls) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.canonical}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap-guides.xml'), xml);
}

function generateMasterSitemap(generatedGuides) {
  // Hand-curated list of canonical site pages — high-priority entries.
  const sitePages = [
    { loc: `${SITE_URL}/`,                          priority: '1.0', changefreq: 'weekly' },
    { loc: `${SITE_URL}/agents/`,                   priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/agent/orchestrator/`,       priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/agent/`,                    priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/agent/sourcing/`,           priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/agent/logistics/`,          priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/agent/finance/`,            priority: '0.9', changefreq: 'weekly' },
    { loc: `${SITE_URL}/platform/`,                 priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/pricing/`,                  priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/routing/`,                  priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/routing/quote/`,            priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/customs/`,                  priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/customs/quote/`,            priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/warehouse/`,                priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/warehouse/quote/`,          priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/insurance/`,                priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/insurance/quote/`,          priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/buyer-verification/`,       priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/buyer-verification/check/`, priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/samples/`,                  priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/samples/request/`,          priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/returns/`,                  priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/returns/quote/`,            priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/documents/`,                priority: '0.7', changefreq: 'monthly' },
    { loc: `${SITE_URL}/documents/commercial-invoice/`, priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/documents/packing-list/`,   priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/documents/proforma-invoice/`, priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/documents/certificate-of-origin/`, priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/dashboard/`,                priority: '0.5', changefreq: 'weekly' },
    { loc: `${SITE_URL}/sourcing.html`,             priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/finance.html`,              priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/intelligence.html`,         priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/orcatrade.html`,            priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/contact.html`,              priority: '0.6', changefreq: 'monthly' },
    { loc: `${SITE_URL}/process.html`,              priority: '0.5', changefreq: 'monthly' },
    // PL + DE locale roots
    { loc: `${SITE_URL}/pl/`,                       priority: '0.8', changefreq: 'weekly' },
    { loc: `${SITE_URL}/de/`,                       priority: '0.8', changefreq: 'weekly' },
  ];

  const guideUrls = generatedGuides.map(g => ({ loc: g.canonical, priority: '0.7', changefreq: 'monthly' }));

  const all = [...sitePages, ...guideUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
  return all.length;
}

// ── Run ────────────────────────────────────────────────────

function run() {
  const generated = [];

  // 40 sourcing pages (5 countries × 8 categories)
  for (const country of Object.keys(sourcing.COUNTRIES)) {
    for (const category of Object.keys(sourcing.CATEGORIES)) {
      const page = generateSourcingPage(country, category);
      writePage(page.path, page.html);
      generated.push(page);
    }
  }

  // Sourcing index
  const sIndex = generateSourcingIndex();
  writePage(sIndex.path, sIndex.html);
  generated.push(sIndex);

  // 30 routing pages (5 origins × 6 destinations)
  for (const origin of ROUTING_ORIGINS) {
    for (const dest of ROUTING_DESTINATIONS) {
      const page = generateRoutingPage(origin, dest);
      writePage(page.path, page.html);
      generated.push(page);
    }
  }
  // Routing index
  const rIndex = generateRoutingIndex();
  writePage(rIndex.path, rIndex.html);
  generated.push(rIndex);

  // 36 customs pages (6 chapters × 6 destinations)
  for (const chapter of CUSTOMS_CHAPTERS) {
    for (const dest of CUSTOMS_DESTINATIONS) {
      const page = generateCustomsPage(chapter, dest);
      writePage(page.path, page.html);
      generated.push(page);
    }
  }
  // Customs index
  const cIndex = generateCustomsIndex();
  writePage(cIndex.path, cIndex.html);
  generated.push(cIndex);

  // 6 warehouse pages (one per hub)
  for (const hubKey of Object.keys(warehouse.HUBS)) {
    const page = generateWarehousePage(hubKey);
    writePage(page.path, page.html);
    generated.push(page);
  }
  // Warehouse index
  const wIndex = generateWarehouseIndex();
  writePage(wIndex.path, wIndex.html);
  generated.push(wIndex);

  // Guides root
  const gRoot = generateGuidesRoot();
  writePage(gRoot.path, gRoot.html);
  generated.push(gRoot);

  // ── Polish (PL) localisations ──
  // Currently sourcing only — routing/customs/warehouse PL coming in later iters.
  for (const country of Object.keys(sourcing.COUNTRIES)) {
    for (const category of Object.keys(sourcing.CATEGORIES)) {
      const page = generateSourcingPagePL(country, category);
      if (page) {
        writePage(page.path, page.html);
        generated.push(page);
      }
    }
  }
  const sIndexPL = generateSourcingIndexPL();
  writePage(sIndexPL.path, sIndexPL.html);
  generated.push(sIndexPL);

  // 30 PL routing pages
  for (const origin of ROUTING_ORIGINS) {
    for (const dest of ROUTING_DESTINATIONS) {
      const page = generateRoutingPagePL(origin, dest);
      writePage(page.path, page.html);
      generated.push(page);
    }
  }
  const rIndexPL = generateRoutingIndexPL();
  writePage(rIndexPL.path, rIndexPL.html);
  generated.push(rIndexPL);

  // 36 PL customs pages
  for (const ch of CUSTOMS_CHAPTERS) {
    for (const dest of CUSTOMS_DESTINATIONS) {
      const page = generateCustomsPagePL(ch, dest);
      writePage(page.path, page.html);
      generated.push(page);
    }
  }
  const cIndexPL = generateCustomsIndexPL();
  writePage(cIndexPL.path, cIndexPL.html);
  generated.push(cIndexPL);

  // 6 PL warehouse pages
  for (const hubKey of Object.keys(warehouse.HUBS)) {
    const page = generateWarehousePagePL(hubKey);
    writePage(page.path, page.html);
    generated.push(page);
  }
  const wIndexPL = generateWarehouseIndexPL();
  writePage(wIndexPL.path, wIndexPL.html);
  generated.push(wIndexPL);

  const gRootPL = generateGuidesRootPL();
  writePage(gRootPL.path, gRootPL.html);
  generated.push(gRootPL);

  // ── German (DE) localisations ──
  for (const country of Object.keys(sourcing.COUNTRIES)) {
    for (const category of Object.keys(sourcing.CATEGORIES)) {
      const page = generateSourcingPageDE(country, category);
      if (page) {
        writePage(page.path, page.html);
        generated.push(page);
      }
    }
  }
  const sIndexDE = generateSourcingIndexDE();
  writePage(sIndexDE.path, sIndexDE.html);
  generated.push(sIndexDE);

  // 30 DE routing pages
  for (const origin of ROUTING_ORIGINS) {
    for (const dest of ROUTING_DESTINATIONS) {
      const page = generateRoutingPageDE(origin, dest);
      writePage(page.path, page.html);
      generated.push(page);
    }
  }
  const rIndexDE = generateRoutingIndexDE();
  writePage(rIndexDE.path, rIndexDE.html);
  generated.push(rIndexDE);

  // 36 DE customs pages
  for (const ch of CUSTOMS_CHAPTERS) {
    for (const dest of CUSTOMS_DESTINATIONS) {
      const page = generateCustomsPageDE(ch, dest);
      writePage(page.path, page.html);
      generated.push(page);
    }
  }
  const cIndexDE = generateCustomsIndexDE();
  writePage(cIndexDE.path, cIndexDE.html);
  generated.push(cIndexDE);

  // 6 DE warehouse pages
  for (const hubKey of Object.keys(warehouse.HUBS)) {
    const page = generateWarehousePageDE(hubKey);
    writePage(page.path, page.html);
    generated.push(page);
  }
  const wIndexDE = generateWarehouseIndexDE();
  writePage(wIndexDE.path, wIndexDE.html);
  generated.push(wIndexDE);

  const gRootDE = generateGuidesRootDE();
  writePage(gRootDE.path, gRootDE.html);
  generated.push(gRootDE);

  // Trade defence guides (delegated to a separate generator that owns its
  // own data + i18n). Each entry { canonical, relPath, html } is included
  // in both sitemaps so search engines pick up the full surface.
  const tdGenerator = require('./generate-trade-defence-pages');
  const tdPages = tdGenerator.build();
  for (const tdPage of tdPages) {
    generated.push({ canonical: tdPage.canonical });
  }
  console.log(`Trade defence pages: ${tdPages.length} (already written by sub-generator).`);

  // Preferential origin guides (regime pages + country pivots).
  const prefGenerator = require('./generate-preferential-pages');
  const prefPages = prefGenerator.build();
  for (const p of prefPages) {
    generated.push({ canonical: p.canonical });
  }
  console.log(`Preferential origin pages: ${prefPages.length} (already written by sub-generator).`);

  // Compliance overlay guides (CBAM, EUDR, REACH, CE, RoHS, ...).
  const complianceGenerator = require('./generate-compliance-pages');
  const compliancePages = complianceGenerator.build();
  for (const p of compliancePages) {
    generated.push({ canonical: p.canonical });
  }
  console.log(`Compliance pages: ${compliancePages.length} (already written by sub-generator).`);

  // Sitemap (guides only)
  generateSitemap(generated);
  // Master sitemap (everything indexable)
  const masterCount = generateMasterSitemap(generated);

  console.log(`Generated ${generated.length} guide pages.`);
  console.log(`Sitemap: sitemap-guides.xml (${generated.length} URLs)`);
  console.log(`Master sitemap: sitemap.xml (${masterCount} URLs)`);
}

if (require.main === module) {
  run();
}

module.exports = { run, slug, escapeHtml };
