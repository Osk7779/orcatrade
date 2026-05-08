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

// ── Helpers ────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

function pageShell({ title, description, canonical, jsonLd, body, locale = 'en' }) {
  const ogImage = `${SITE_URL}/orcatrade_logo.png`;
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonical}" />
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
      </article>
    </main>

    <footer style="position: relative; z-index: 1;">
      <div class="footer-inner">
        <span>© <span id="year"></span> OrcaTrade Group. All rights reserved.</span>
        <span><a href="/">Back to OrcaTrade Group</a></span>
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

  return {
    path: `guides/sourcing/${slugUrl}`,
    canonical,
    html: pageShell({ title, description, canonical, jsonLd, body }),
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
    html: pageShell({ title, description, canonical, jsonLd, body }),
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
  `;

  return {
    path: 'guides',
    canonical,
    html: pageShell({ title, description, canonical, jsonLd, body }),
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

  // Guides root
  const gRoot = generateGuidesRoot();
  writePage(gRoot.path, gRoot.html);
  generated.push(gRoot);

  // Sitemap
  generateSitemap(generated);

  console.log(`Generated ${generated.length} pages.`);
  console.log(`Sitemap: sitemap-guides.xml (${generated.length} URLs)`);
}

if (require.main === module) {
  run();
}

module.exports = { run, slug, escapeHtml };
