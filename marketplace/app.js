// Marketplace shell client (Sprint H4).
// Renders the anonymised supplier-exemplar cards. Data is inlined here
// so the page works without an API roundtrip. Mirror of
// lib/intelligence/data/supplier-exemplars.js — keep both in sync.

(function () {
  'use strict';

  var EXEMPLARS = [
    { id: 'ex_001', category: 'Apparel — woven',                      country: 'VN', region: 'Ho Chi Minh City + Long An', yearsOperating: 15, moqRange: '1,000 – 50,000 units',  leadTimeWeeks: '8 – 12',  certifications: ['OEKO-TEX 100', 'BSCI', 'WRAP'], capabilities: ['Cut-and-sew', 'Sublimation print', 'In-house QC'], preferentialOriginEligible: true,  notes: 'Eligible for EVFTA preferential origin with EUR.1; track record on EU-bound shipments.' },
    { id: 'ex_002', category: 'Apparel — knitwear',                   country: 'BD', region: 'Dhaka',                       yearsOperating: 22, moqRange: '3,000 – 100,000 units', leadTimeWeeks: '10 – 14', certifications: ['OEKO-TEX 100', 'GOTS', 'BSCI', 'Accord/RSC'], capabilities: ['Circular knit', 'Reactive dye', 'Compliance lab in-house'], preferentialOriginEligible: true,  notes: 'EBA preferential — duty-free entry to EU under GSP+; LDC graduation 2026 will impact this.' },
    { id: 'ex_003', category: 'Footwear — leather',                   country: 'IN', region: 'Chennai + Ambur',             yearsOperating: 30, moqRange: '500 – 20,000 pairs',     leadTimeWeeks: '10 – 14', certifications: ['LWG', 'Sedex'], capabilities: ['Goodyear welt', 'Cement construction', 'Custom lasts'], preferentialOriginEligible: true,  notes: 'EU GSP standard rate applies; CHEM/REACH compliance for leather aniline dyes.' },
    { id: 'ex_004', category: 'Electronics — consumer',               country: 'CN', region: 'Shenzhen + Dongguan',         yearsOperating: 18, moqRange: '500 – 10,000 units',     leadTimeWeeks: '6 – 10',  certifications: ['ISO 9001', 'ISO 14001', 'CE/FCC'], capabilities: ['SMT line', 'Plastic injection', 'Tooling'], preferentialOriginEligible: false, notes: 'Standard MFN duty for HS 85; assess RoHS + WEEE for EU placement.' },
    { id: 'ex_005', category: 'Electronics — components (PCBA)',      country: 'TW', region: 'Taipei + Hsinchu',            yearsOperating: 25, moqRange: '1,000 – 50,000 units',  leadTimeWeeks: '4 – 8',   certifications: ['ISO 9001', 'IATF 16949', 'IPC-A-610 Class 3'], capabilities: ['HDI PCB', 'Auto-pick-and-place', 'AOI + X-ray'], preferentialOriginEligible: false, notes: 'Higher cost, lower defect rate; preferred for safety-critical end-use.' },
    { id: 'ex_006', category: 'Cosmetics — skincare',                 country: 'KR', region: 'Gyeonggi-do',                 yearsOperating: 12, moqRange: '500 – 10,000 units',     leadTimeWeeks: '6 – 10',  certifications: ['ISO 22716', 'CPNP-aware', 'Cruelty-free'], capabilities: ['Private label', 'Custom formulation', 'Stability + challenge testing'], preferentialOriginEligible: true, notes: 'EU-Korea FTA preferential origin; CPNP notification required before sale.' },
    { id: 'ex_007', category: 'Furniture — case goods',               country: 'VN', region: 'Binh Duong',                  yearsOperating: 17, moqRange: '50 – 2,000 units (per SKU)', leadTimeWeeks: '10 – 14', certifications: ['FSC', 'BSCI', 'Fumigation cert'], capabilities: ['Solid wood + veneer', 'Hand-finish', 'Container loading optimisation'], preferentialOriginEligible: true,  notes: 'EVFTA preferential origin; EUDR scope from 2025 — geolocation polygons required.' },
    { id: 'ex_008', category: 'Toys — plush',                         country: 'CN', region: 'Yangzhou',                    yearsOperating: 20, moqRange: '1,000 – 30,000 units',  leadTimeWeeks: '8 – 12',  certifications: ['EN-71 lab partner', 'ICTI Care'], capabilities: ['Custom plush', 'Embroidery', 'BB/POM stuffing'], preferentialOriginEligible: false, notes: 'EN-71 mechanical + chemical; CE marking required for toys.' },
    { id: 'ex_009', category: 'Homeware — ceramics',                  country: 'CN', region: 'Jiangsu',                     yearsOperating: 28, moqRange: '500 – 20,000 units',    leadTimeWeeks: '8 – 12',  certifications: ['LFGB / FDA food-contact', 'BSCI'], capabilities: ['Bone china + porcelain', 'Hand-paint', 'Decal'], preferentialOriginEligible: false, notes: 'AD measures may apply (table-and-kitchenware ceramics) — confirm rate per manufacturer.' },
    { id: 'ex_010', category: 'Machinery — small engineered',         country: 'CN', region: 'Zhejiang',                    yearsOperating: 16, moqRange: '10 – 500 units',         leadTimeWeeks: '12 – 16', certifications: ['ISO 9001', 'CE Machinery Directive ready'], capabilities: ['CNC machining', 'Welding', 'Custom assembly'], preferentialOriginEligible: false, notes: 'CE Machinery declaration of conformity + technical file required.' },
    { id: 'ex_011', category: 'Machinery — small engineered',         country: 'KR', region: 'Daegu + Ulsan',               yearsOperating: 35, moqRange: '5 – 200 units',          leadTimeWeeks: '14 – 20', certifications: ['ISO 9001', 'KS Mark', 'CE Machinery'], capabilities: ['Precision CNC', 'In-house tooling', 'After-sales service network in EU'], preferentialOriginEligible: true,  notes: 'EU-Korea FTA; higher unit price, EU-grade documentation maturity.' },
    { id: 'ex_012', category: 'Steel — cold-rolled',                  country: 'TR', region: 'Marmara',                     yearsOperating: 40, moqRange: '20 – 500 t',             leadTimeWeeks: '6 – 10',  certifications: ['ISO 9001', 'CE EN 10130'], capabilities: ['Cold-rolling + slitting', 'Galvanising'], preferentialOriginEligible: true, notes: 'A.TR Customs Union — does NOT waive AD on Türkiye-origin CR steel; check current measure.' },
    { id: 'ex_013', category: 'Cosmetics — colour',                   country: 'IT', region: 'Lombardy + Crema',            yearsOperating: 22, moqRange: '500 – 10,000 units',    leadTimeWeeks: '6 – 8',   certifications: ['ISO 22716', 'CPNP-ready'], capabilities: ['Lipstick + mascara filling', 'Custom shades', 'EU-resident Responsible Person'], preferentialOriginEligible: false, notes: 'Intra-EU; no customs friction. Often the right hub for "made-in-EU" positioning.' },
    { id: 'ex_014', category: 'Apparel — performance / activewear',   country: 'VN', region: 'Hanoi + Hung Yen',            yearsOperating: 11, moqRange: '500 – 20,000 units',    leadTimeWeeks: '10 – 14', certifications: ['OEKO-TEX 100', 'Bluesign', 'Higg FEM'], capabilities: ['Bonded seams', 'Sublimation', 'Stretch fabric expertise'], preferentialOriginEligible: true,  notes: 'EVFTA preferential; rule of origin requires fabric forming in VN or another EVFTA-eligible origin.' },
    { id: 'ex_015', category: 'E-bike + e-scooter',                   country: 'VN', region: 'Haiphong',                    yearsOperating: 8,  moqRange: '50 – 2,000 units',      leadTimeWeeks: '10 – 14', certifications: ['ISO 9001', 'EN 15194 ready', 'UN 38.3 (battery)'], capabilities: ['Frame welding', 'Battery pack assembly', 'Final QC line'], preferentialOriginEligible: true, notes: 'EVFTA preferential; battery pack origin matters for AD/CVD on completed e-bikes.' },
  ];

  var COUNTRY_NAMES = { CN: 'China', VN: 'Vietnam', IN: 'India', BD: 'Bangladesh', KR: 'South Korea', TR: 'Türkiye', TW: 'Taiwan', IT: 'Italy' };

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function uniq(arr) { var s = new Set(arr); return [...s]; }

  function renderCountryFilter(activeCountry) {
    var bar = document.getElementById('country-filter');
    var countries = uniq(EXEMPLARS.map(function (e) { return e.country; })).sort();
    bar.innerHTML = '<button class="filter-btn ' + (activeCountry === 'all' ? 'active' : '') + '" data-country="all" type="button">All countries</button>'
      + countries.map(function (c) {
          return '<button class="filter-btn ' + (activeCountry === c ? 'active' : '') + '" data-country="' + c + '" type="button">' + escapeHtml(COUNTRY_NAMES[c] || c) + '</button>';
        }).join('');
    bar.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { renderAll(btn.getAttribute('data-country')); });
    });
  }

  function renderCard(e) {
    return '<div class="supplier-card" data-id="' + escapeHtml(e.id) + '">'
      +   '<div class="cat">' + escapeHtml(e.category) + '</div>'
      +   '<div class="country">' + escapeHtml(COUNTRY_NAMES[e.country] || e.country) + '<span class="yrs">' + e.yearsOperating + ' yrs</span></div>'
      +   '<div class="region">' + escapeHtml(e.region) + '</div>'
      +   '<div class="meta-row">'
      +     '<span class="k">MOQ</span><span>' + escapeHtml(e.moqRange) + '</span>'
      +     '<span class="k">Lead time</span><span>' + escapeHtml(e.leadTimeWeeks) + ' weeks</span>'
      +   '</div>'
      +   '<div class="certs">' + e.certifications.map(function (c) { return '<span class="cert">' + escapeHtml(c) + '</span>'; }).join('') + '</div>'
      +   (e.preferentialOriginEligible
            ? '<div class="pref">✓ Preferential-origin eligible</div>'
            : '<div class="pref-not">— No preferential origin (MFN duty applies)</div>')
      +   '<div class="notes">' + escapeHtml(e.notes) + '</div>'
      +   '<a class="request-btn" href="/#contact?intent=supplier-introduction&exemplar=' + escapeHtml(e.id) + '">Request introduction</a>'
      + '</div>';
  }

  function renderAll(activeCountry) {
    activeCountry = activeCountry || 'all';
    renderCountryFilter(activeCountry);
    var filtered = activeCountry === 'all' ? EXEMPLARS : EXEMPLARS.filter(function (e) { return e.country === activeCountry; });
    document.getElementById('supplier-grid').innerHTML = filtered.map(renderCard).join('');
  }

  renderAll('all');
})();
