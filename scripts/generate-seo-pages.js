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
  return String(s)
    .normalize('NFD')                  // decompose accented chars (Poznań → Poznan + combining ́)
    .replace(/[̀-ͯ]/g, '')   // strip combining marks
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

  return {
    path: `guides/routing/${slugUrl}`,
    canonical,
    html: pageShell({ title, description, canonical, jsonLd, body }),
  };
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
    html: pageShell({ title, description, canonical, jsonLd, body }),
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

  return {
    path: `guides/customs/${slugUrl}`,
    canonical,
    html: pageShell({ title, description, canonical, jsonLd, body }),
  };
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
    html: pageShell({ title, description, canonical, jsonLd, body }),
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

  return {
    path: `guides/warehouse/${slugUrl}`,
    canonical,
    html: pageShell({ title, description, canonical, jsonLd, body }),
  };
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

  // Sitemap
  generateSitemap(generated);

  console.log(`Generated ${generated.length} pages.`);
  console.log(`Sitemap: sitemap-guides.xml (${generated.length} URLs)`);
}

if (require.main === module) {
  run();
}

module.exports = { run, slug, escapeHtml };
