// Single source of truth for the OrcaTrade site navigation — i18n-aware.
//
// Each page declares an empty <header data-site-header></header>; this script
// detects the locale from the URL (/, /pl/, /de/), renders the brand + nav
// links + Tools mega-dropdown + lang switcher + mobile toggle in the
// appropriate language, with locale-aware hrefs (including PL/DE slug
// variants like /pl/cennik/ vs /de/preise/).

(function () {
  'use strict';

  // EN-canonical structure. Labels here are the EN strings — translations
  // for PL/DE live in I18N below. hrefs here are the EN URLs — locale
  // overrides for differently-slugged pages live in SLUG_OVERRIDES below.
  const NAV = {
    brand: {
      logoSrc: '/orcatrade_logo.png',
      logoAlt: 'OrcaTrade Group logo',
      labelTop: 'OrcaTrade',
      labelBottom: 'group',
      href: '/',
    },
    primary: [
      { label: 'Home',         href: '/',          match: ['/', '/index.html'] },
      { label: 'Platform',     href: '/platform/', match: ['/platform/'] },
      { label: 'Build a plan', href: '/start/',    match: ['/start/'] },
    ],
    tools: {
      label: 'Tools',
      groups: [
        {
          heading: 'AI Agents',
          items: [
            { label: 'Agent Hub',              desc: 'All 5 agents · cross-domain stories · demo prompts', href: '/agents/' },
            { label: 'Operations Orchestrator', desc: 'One agent · every domain · cross-domain plans',     href: '/agent/orchestrator/' },
            { label: 'Sourcing Agent',          desc: 'Where to source · supplier shortlists · risk',       href: '/agent/sourcing/' },
            { label: 'Compliance Agent',        desc: 'CBAM · EUDR · REACH · CE marking',                   href: '/agent/' },
            { label: 'Logistics Agent',         desc: 'Transport · customs · 3PL · full plans',             href: '/agent/logistics/' },
            { label: 'Finance Agent',           desc: 'Payment terms · LC · FX · working capital',          href: '/agent/finance/' },
          ],
        },
        {
          heading: 'Trade Services',
          items: [
            { label: 'Trade Documents',     desc: 'CI · Packing List · COO · Bill of Lading', href: '/documents/' },
            { label: 'Insurance',           desc: 'Cargo + trade-credit quotes',              href: '/insurance/' },
            { label: 'Buyer Verification',  desc: 'Tier-1 buyer dossiers',                    href: '/buyer-verification/' },
            { label: 'Samples',             desc: 'HK consolidation',                         href: '/samples/' },
            { label: 'Returns',             desc: 'Reverse logistics',                        href: '/returns/' },
          ],
        },
        {
          heading: 'Logistics',
          items: [
            { label: 'Routing',   desc: 'Sea / rail / air comparison', href: '/routing/' },
            { label: 'Customs',   desc: 'Duty + bonded warehouse',     href: '/customs/' },
            { label: 'Warehouse', desc: '6-hub 3PL benchmark',         href: '/warehouse/' },
          ],
        },
      ],
    },
    secondary: [
      { label: 'Guides',    href: '/guides/',    match: ['/guides/'] },
      { label: 'Dashboard', href: '/dashboard/', match: ['/dashboard/'] },
      { label: 'Pricing',   href: '/pricing/',   match: ['/pricing/'] },
      // Sprint nav-account-link: visible everywhere on the site.
      // /account/ handles both signed-in (shows account home + quick
      // links) and signed-out (shows the magic-link sign-in form) —
      // a single link works for both states, no JS gating needed.
      { label: 'Sign in',   href: '/account/',   match: ['/account/'] },
    ],
    langSwitcher: [
      { code: 'EN', href: '/' },
      { code: 'PL', href: '/pl/' },
      { code: 'DE', href: '/de/' },
    ],
  };

  // Per-locale string translations. Missing keys fall back to EN.
  const I18N = {
    PL: {
      'Home': 'Strona główna',
      'Platform': 'Platforma',
      'Build a plan': 'Zbuduj plan',
      'Tools': 'Narzędzia',
      'AI Agents': 'Agenci AI',
      'Agent Hub': 'Hub agentów',
      'All 5 agents · cross-domain stories · demo prompts': 'Wszystkich 5 agentów · scenariusze cross-domain · prompty',
      'Operations Orchestrator': 'Orchestrator operacji',
      'One agent · every domain · cross-domain plans': 'Jeden agent · każda domena · plany cross-domain',
      'Sourcing Agent': 'Agent sourcingu',
      'Where to source · supplier shortlists · risk': 'Gdzie sourcować · krótkie listy dostawców · ryzyko',
      'Compliance Agent': 'Agent compliance',
      'CBAM · EUDR · REACH · CE marking': 'CBAM · EUDR · REACH · oznakowanie CE',
      'Logistics Agent': 'Agent logistyki',
      'Transport · customs · 3PL · full plans': 'Transport · cło · 3PL · pełne plany',
      'Finance Agent': 'Agent finansów',
      'Payment terms · LC · FX · working capital': 'Warunki płatności · LC · FX · kapitał obrotowy',
      'Trade Services': 'Usługi handlowe',
      'Trade Documents': 'Dokumenty handlowe',
      'CI · Packing List · COO · Bill of Lading': 'Faktura handlowa · Packing list · Świadectwo pochodzenia · Konosament',
      'Insurance': 'Ubezpieczenia',
      'Cargo + trade-credit quotes': 'Cargo + kredyt kupiecki — wyceny',
      'Buyer Verification': 'Weryfikacja kupującego',
      'Tier-1 buyer dossiers': 'Dossiery kupujących Tier-1',
      'Samples': 'Próbki',
      'HK consolidation': 'Konsolidacja HK',
      'Returns': 'Zwroty',
      'Reverse logistics': 'Logistyka zwrotna',
      'Logistics': 'Logistyka',
      'Routing': 'Routing',
      'Sea / rail / air comparison': 'Morze / kolej / lotnictwo — porównanie',
      'Customs': 'Cło',
      'Duty + bonded warehouse': 'Cło + skład celny',
      'Warehouse': 'Magazyn',
      '6-hub 3PL benchmark': 'Benchmark 6 hubów 3PL',
      'Guides': 'Przewodniki',
      'Dashboard': 'Dashboard',
      'Pricing': 'Cennik',
      'Sign in': 'Zaloguj',
      'Open navigation': 'Otwórz nawigację',
      'Close navigation': 'Zamknij nawigację',
    },
    DE: {
      'Home': 'Startseite',
      'Platform': 'Plattform',
      'Build a plan': 'Plan erstellen',
      'Tools': 'Werkzeuge',
      'AI Agents': 'KI-Agenten',
      'Agent Hub': 'Agenten-Hub',
      'All 5 agents · cross-domain stories · demo prompts': 'Alle 5 Agenten · domänenübergreifende Stories · Demo-Prompts',
      'Operations Orchestrator': 'Operations-Orchestrator',
      'One agent · every domain · cross-domain plans': 'Ein Agent · jede Domäne · domänenübergreifende Pläne',
      'Sourcing Agent': 'Sourcing-Agent',
      'Where to source · supplier shortlists · risk': 'Wo beziehen · Lieferanten-Shortlists · Risiko',
      'Compliance Agent': 'Compliance-Agent',
      'CBAM · EUDR · REACH · CE marking': 'CBAM · EUDR · REACH · CE-Kennzeichnung',
      'Logistics Agent': 'Logistik-Agent',
      'Transport · customs · 3PL · full plans': 'Transport · Zoll · 3PL · vollständige Pläne',
      'Finance Agent': 'Finance-Agent',
      'Payment terms · LC · FX · working capital': 'Zahlungsbedingungen · LC · FX · Working Capital',
      'Trade Services': 'Handelsdienste',
      'Trade Documents': 'Handelsdokumente',
      'CI · Packing List · COO · Bill of Lading': 'Handelsrechnung · Packliste · Ursprungszeugnis · Konnossement',
      'Insurance': 'Versicherung',
      'Cargo + trade-credit quotes': 'Cargo + Warenkredit — Angebote',
      'Buyer Verification': 'Käufer-Verifikation',
      'Tier-1 buyer dossiers': 'Tier-1-Käufer-Dossiers',
      'Samples': 'Muster',
      'HK consolidation': 'HK-Konsolidierung',
      'Returns': 'Retouren',
      'Reverse logistics': 'Reverse Logistics',
      'Logistics': 'Logistik',
      'Routing': 'Routing',
      'Sea / rail / air comparison': 'See / Schiene / Luft — Vergleich',
      'Customs': 'Zoll',
      'Duty + bonded warehouse': 'Zoll + Zolllager',
      'Warehouse': 'Lager',
      '6-hub 3PL benchmark': '6-Hub-3PL-Benchmark',
      'Guides': 'Leitfäden',
      'Dashboard': 'Dashboard',
      'Pricing': 'Preise',
      'Sign in': 'Anmelden',
      'Open navigation': 'Navigation öffnen',
      'Close navigation': 'Navigation schließen',
    },
  };

  // For pages whose URL slug differs across locales, map the EN canonical
  // href to the localized one. Pages not listed here use the simple
  // prefix rule (/foo/ → /pl/foo/ or /de/foo/).
  const SLUG_OVERRIDES = {
    PL: {
      '/pricing/':     '/pl/cennik/',
      '/logistics/':   '/pl/logistyka/',
      '/platform/':    '/pl/platforma/',
      '/analysis/':    '/pl/analiza/',
      '/supply-chain/':'/pl/lancuch-dostaw/',
      '/founding/':    '/pl/zalozyciele-10/',
    },
    DE: {
      '/pricing/':     '/de/preise/',
      '/logistics/':   '/de/logistik/',
      '/platform/':    '/de/plattform/',
      '/analysis/':    '/de/analyse/',
      '/supply-chain/':'/de/lieferkette/',
      '/founding/':    '/de/gruender-10/',
    },
  };

  function detectLocale(path) {
    if (path.indexOf('/pl/') === 0) return 'PL';
    if (path.indexOf('/de/') === 0) return 'DE';
    return 'EN';
  }

  function t(key, locale) {
    if (locale === 'EN') return key;
    const dict = I18N[locale];
    return (dict && dict[key]) || key;
  }

  // Translate an EN-canonical href into the right localized URL.
  // Application routes that don't have localized versions (/agent/*,
  // /dashboard/) stay unchanged for all locales.
  function localizeHref(enHref, locale) {
    if (locale === 'EN') return enHref;
    if (!enHref || enHref.indexOf('/') !== 0) return enHref;
    // App routes that aren't translated stay as-is
    if (enHref.indexOf('/agent/') === 0) return enHref;
    if (enHref.indexOf('/dashboard/') === 0) return enHref;
    // /account/ is the single user-facing app surface — same flow
    // for every locale, no PL/DE marketing copy required.
    if (enHref.indexOf('/account/') === 0) return enHref;
    // Root → /pl/ or /de/
    if (enHref === '/') return '/' + locale.toLowerCase() + '/';
    // Slug override?
    const overrides = SLUG_OVERRIDES[locale] || {};
    if (overrides[enHref]) return overrides[enHref];
    // Default: prepend locale prefix
    return '/' + locale.toLowerCase() + enHref;
  }

  function pathStartsWith(currentPath, candidates) {
    return (candidates || []).some(c => currentPath === c || (c !== '/' && currentPath.indexOf(c) === 0));
  }

  function isToolActive(currentPath, locale) {
    return NAV.tools.groups.some(g => g.items.some(i => {
      const href = localizeHref(i.href, locale);
      return pathStartsWith(currentPath, [href]);
    }));
  }

  function renderLink(item, currentPath, locale) {
    const href = localizeHref(item.href, locale);
    const matchList = (item.match || [item.href]).map(m => localizeHref(m, locale));
    const active = pathStartsWith(currentPath, matchList);
    return `<a href="${href}"${active ? ' class="active"' : ''}>${t(item.label, locale)}</a>`;
  }

  function renderToolsDropdown(currentPath, locale) {
    const activeClass = isToolActive(currentPath, locale) ? ' is-active' : '';
    const groupsHtml = NAV.tools.groups.map(group => {
      const itemsHtml = group.items.map(item => {
        const href = localizeHref(item.href, locale);
        const active = pathStartsWith(currentPath, [href]);
        return `<a class="nav-mega-item${active ? ' active' : ''}" href="${href}">
          <span class="nav-mega-item-label">${t(item.label, locale)}</span>
          <span class="nav-mega-item-desc">${t(item.desc, locale)}</span>
        </a>`;
      }).join('');
      return `<div class="nav-mega-section">
        <div class="nav-mega-heading">${t(group.heading, locale)}</div>
        ${itemsHtml}
      </div>`;
    }).join('');
    return `<div class="nav-dropdown${activeClass}">
      <button class="nav-dropdown-toggle" type="button" aria-expanded="false">${t(NAV.tools.label, locale)} ▾</button>
      <div class="nav-dropdown-menu grouped">${groupsHtml}</div>
    </div>`;
  }

  function renderLangSwitcher(locale) {
    const buttons = NAV.langSwitcher.map(l => {
      const cls = 'lang-btn' + (l.code === locale ? ' lang-active' : '');
      return `<a href="${l.href}" class="${cls}">${l.code}</a>`;
    }).join('');
    return `<div class="lang-switcher">${buttons}</div>`;
  }

  function renderHeader(currentPath) {
    const locale = detectLocale(currentPath);
    const primaryLinksHtml = NAV.primary.map(item => renderLink(item, currentPath, locale)).join('');
    const secondaryLinksHtml = NAV.secondary.map(item => renderLink(item, currentPath, locale)).join('');
    const toolsHtml = renderToolsDropdown(currentPath, locale);
    const langSwitcherHtml = renderLangSwitcher(locale);
    const brandHref = localizeHref(NAV.brand.href, locale);
    const navOpenLabel = t('Open navigation', locale);

    return `<div class="nav">
      <div class="brand">
        <a href="${brandHref}">
          <div class="brand-logo">
            <img src="${NAV.brand.logoSrc}" alt="${NAV.brand.logoAlt}">
          </div>
          <div class="brand-text">
            <span>${NAV.brand.labelTop}</span>
            <span>${NAV.brand.labelBottom}</span>
          </div>
        </a>
      </div>
      <nav class="nav-links">
        ${primaryLinksHtml}
        ${toolsHtml}
        ${secondaryLinksHtml}
      </nav>
      ${langSwitcherHtml}
      <button class="nav-toggle" aria-label="${navOpenLabel}" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>`;
  }

  function bindMobileNav(headerEl, locale) {
    const toggle = headerEl.querySelector('.nav-toggle');
    const links = headerEl.querySelector('.nav-links');
    if (!toggle || !links) return;

    const openLabel = t('Open navigation', locale);
    const closeLabel = t('Close navigation', locale);

    function closeMenu() {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', openLabel);
      links.classList.remove('is-open');
      headerEl.querySelectorAll('.nav-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      document.body.style.overflow = '';
    }

    toggle.addEventListener('click', function () {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      if (open) closeMenu();
      else {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', closeLabel);
        links.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      }
    });

    headerEl.querySelectorAll('.nav-dropdown-toggle').forEach(function (dropdownToggle) {
      dropdownToggle.addEventListener('click', function (event) {
        if (window.matchMedia('(max-width: 840px)').matches) {
          event.preventDefault();
          const dropdown = dropdownToggle.closest('.nav-dropdown');
          if (dropdown) dropdown.classList.toggle('is-open');
        }
      });
    });

    links.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
  }

  function init() {
    const headerEl = document.querySelector('header[data-site-header]');
    if (!headerEl) return;
    const currentPath = window.location.pathname || '/';
    const locale = detectLocale(currentPath);
    headerEl.innerHTML = renderHeader(currentPath);
    bindMobileNav(headerEl, locale);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
