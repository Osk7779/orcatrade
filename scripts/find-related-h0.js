// Cross-link helper for the legacy SEO guide generators (sourcing/routing/
// customs/warehouse) into the H0 deep-intelligence pages (trade defence,
// preferential origin, compliance overlay).
//
// Given the page's context (category, origin, destination, locale, pageType)
// returns an array of { href, title, type } items to render in the
// "Related guides" aside.
//
// Limits coverage to the most relevant 3-5 links per page so the section
// stays curated, not noisy.

const tradeDefence = require('../lib/intelligence/data/eu-trade-defence');
const preferential = require('../lib/intelligence/data/preferential-origin');
const compliance = require('../lib/intelligence/data/eu-compliance');

// Map productCategory to a representative HS chapter for trade-defence /
// compliance lookups when the page does not carry an explicit HS code.
const CATEGORY_TO_CHAPTER = {
  apparel: '62',
  electronics: '85',
  furniture: '94',
  toys: '95',
  cosmetics: '33',
  homeware: '69',
  footwear: '64',
  machinery: '84',
};

function regimeSlug(id) {
  return String(id).toLowerCase().replace(/_/g, '-');
}

function tradeDefenceSlug(id) {
  return regimeSlug(id);
}

// Reverse lookup: HS chapter → product category (for customs pages that
// know their chapter but not the category).
const CHAPTER_TO_CATEGORY = {};
for (const [cat, ch] of Object.entries(CATEGORY_TO_CHAPTER)) {
  CHAPTER_TO_CATEGORY[ch] = cat;
}

function findRelatedH0({ category, origin, destination, hsChapter, locale = 'en', pageType }) {
  const lp = locale === 'en' ? '' : `/${locale}`;
  const links = [];

  // Derive category from hsChapter when explicit category is missing
  // (customs pages know chapter, not category).
  if (!category && hsChapter && CHAPTER_TO_CATEGORY[String(hsChapter).slice(0, 2)]) {
    category = CHAPTER_TO_CATEGORY[String(hsChapter).slice(0, 2)];
  }

  // ── 1. Preferential origin (if origin has a regime) ─────
  if (origin && preferential.isOriginCovered(origin)) {
    const sample = preferential.findBestRegime({
      origin,
      hsCode: category ? `${CATEGORY_TO_CHAPTER[category] || '62'}00` : '6200',
      mfnRatePct: 12,
    });
    if (sample) {
      links.push({
        type: 'preferential',
        href: `${lp}/guides/preferential-origin/from-${origin.toLowerCase()}/`,
        title: {
          en: `Preferential duty pathway from ${origin}`,
          pl: `Ścieżka preferencyjnego cła z ${origin}`,
          de: `Präferenz-Pfad ${originDe(origin)}`,
        }[locale] || `Preferential duty pathway from ${origin}`,
        subtitle: sample.name,
      });
    }
  }

  // ── 2. Trade defence (only when origin × HS chapter actually triggers
  //       a measure — no fuzzy fallback to arbitrary same-origin measures). ─────
  if (origin && (category || hsChapter)) {
    const ch = hsChapter
      ? String(hsChapter).slice(0, 2)
      : (CATEGORY_TO_CHAPTER[category] || '62');
    const hsForLookup = `${ch}00`;
    const measures = tradeDefence.findMeasures({ hsCode: hsForLookup, originCountry: origin });
    for (const m of measures.slice(0, 2)) {
      links.push({
        type: 'trade-defence',
        href: `${lp}/guides/trade-defence/${tradeDefenceSlug(m.id)}/`,
        title: {
          en: `${m.type} duty: ${m.description}`,
          pl: `Cło ${m.type === 'CVD' ? 'wyrównawcze' : 'antydumpingowe'}: ${m.description}`,
          de: `${m.type === 'CVD' ? 'Ausgleichszoll' : 'Antidumping'}: ${m.description}`,
        }[locale] || `${m.type} duty: ${m.description}`,
        subtitle: `${m.rateTypicalPct}% — ${m.citation}`,
      });
    }
  }

  // ── 3. Compliance overlay (if category triggers regimes) ─────
  if (category) {
    const hsForCompliance = `${CATEGORY_TO_CHAPTER[category] || '62'}00`;
    const regimes = compliance.findApplicableRegimes({
      hsCode: hsForCompliance,
      productCategory: category,
    });
    // Prioritise high-severity regimes, cap at 2
    const highSeverity = regimes.filter(r => r.severity === 'high').slice(0, 2);
    for (const r of highSeverity) {
      links.push({
        type: 'compliance',
        href: `${lp}/guides/compliance/${regimeSlug(r.id)}/`,
        title: r.name,
        subtitle: {
          en: r.status,
          pl: r.status,  // Status strings stay in EN for now (regulatory citations)
          de: r.status,
        }[locale] || r.status,
      });
    }
  }

  // ── 4. Fallback: link to the index page of each H0 family ───
  // Only if we have fewer than 2 links (page would feel orphaned otherwise)
  if (links.length < 2) {
    links.push({
      type: 'index',
      href: `${lp}/guides/trade-defence/`,
      title: {
        en: 'EU trade defence measures',
        pl: 'Środki ochrony handlu UE',
        de: 'EU-Handelsschutzmaßnahmen',
      }[locale] || 'EU trade defence measures',
      subtitle: '30+ active anti-dumping & countervailing duties',
    });
    links.push({
      type: 'index',
      href: `${lp}/guides/compliance/`,
      title: {
        en: 'EU compliance overlay',
        pl: 'Zgodność z prawem UE',
        de: 'EU-Compliance-Übersicht',
      }[locale] || 'EU compliance overlay',
      subtitle: '12 regulatory regimes with importer obligations',
    });
  }

  // Cap at 5 links, dedupe by href (in case the index fallbacks duplicate)
  const seen = new Set();
  return links.filter(l => {
    if (seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  }).slice(0, 5);
}

function originDe(code) {
  const DE = { CN: 'aus China', VN: 'aus Vietnam', IN: 'aus Indien', BD: 'aus Bangladesch', TR: 'aus der Türkei', JP: 'aus Japan', KR: 'aus Südkorea' };
  return DE[code] || `aus ${code}`;
}

// ── Render the "Related guides" aside HTML ─────────────────

function renderRelatedH0Aside(links, locale = 'en') {
  if (!links || links.length === 0) return '';
  const heading = {
    en: 'Related guides',
    pl: 'Powiązane poradniki',
    de: 'Verwandte Leitfäden',
  }[locale] || 'Related guides';

  const items = links.map(l => `
    <li class="related-item">
      <a href="${l.href}">
        <span class="related-title">${l.title}</span>
        <span class="related-subtitle">${l.subtitle || ''}</span>
        <span class="related-type">${l.type}</span>
      </a>
    </li>
  `).join('');

  return `
    <aside class="related-h0" style="margin-top: 2.5rem; padding: 1.4rem 1.6rem; background: rgba(13, 15, 20, 0.5); border: 1px solid rgba(255,255,255,0.08);">
      <h3 style="font-family: 'Cormorant Garant', Georgia, serif; font-size: 1.15rem; font-weight: 600; color: rgba(255,255,255,0.95); margin: 0 0 0.8rem;">${heading}</h3>
      <ul class="related-list" style="list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem;">
        ${items}
      </ul>
      <style>
        .related-list .related-item a { display: block; padding: 0.7rem 0.9rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); text-decoration: none; transition: background 0.15s, border 0.15s; }
        .related-list .related-item a:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.12); }
        .related-list .related-title { display: block; font-family: 'Cormorant Garant', Georgia, serif; font-size: 1rem; font-weight: 600; color: rgba(255,255,255,0.95); }
        .related-list .related-subtitle { display: block; font-size: 0.82rem; color: rgba(255,255,255,0.6); margin-top: 0.15rem; line-height: 1.45; }
        .related-list .related-type { display: inline-block; margin-top: 0.3rem; font-family: 'Geist Mono', monospace; font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase; padding: 0.12rem 0.5rem; border-radius: 1px; background: rgba(184,190,200,0.08); color: rgba(184,190,200,0.85); }
      </style>
    </aside>
  `;
}

module.exports = {
  findRelatedH0,
  renderRelatedH0Aside,
  CATEGORY_TO_CHAPTER,
};
