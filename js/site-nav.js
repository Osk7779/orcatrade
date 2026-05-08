// Single source of truth for the OrcaTrade site navigation.
//
// Each page declares an empty <header data-site-header></header>; this script
// renders the brand + nav links + lang switcher + mobile toggle into it, and
// marks the current page's link as active based on window.location.pathname.
//
// Adding a new tool: append it to NAV.tools, redeploy. No need to touch every page.

(function () {
  'use strict';

  const NAV = {
    brand: {
      logoSrc: 'orcatrade_logo.png',
      logoAlt: 'OrcaTrade Group logo',
      labelTop: 'OrcaTrade',
      labelBottom: 'group',
      href: '/',
    },
    primary: [
      { label: 'Home', href: '/', match: ['/', '/index.html'] },
      { label: 'Platform', href: '/platform/', match: ['/platform/'] },
      // Tools is a grouped mega-dropdown — defined separately below
    ],
    tools: {
      label: 'Tools',
      groups: [
        {
          heading: 'AI Agents',
          items: [
            { label: 'Agent Hub', desc: 'All 5 agents · cross-domain stories · demo prompts', href: '/agents/' },
            { label: 'Operations Orchestrator', desc: 'One agent · every domain · cross-domain plans', href: '/agent/orchestrator/' },
            { label: 'Sourcing Agent', desc: 'Where to source · supplier shortlists · risk', href: '/agent/sourcing/' },
            { label: 'Compliance Agent', desc: 'CBAM · EUDR · REACH · CE marking', href: '/agent/' },
            { label: 'Logistics Agent', desc: 'Transport · customs · 3PL · full plans', href: '/agent/logistics/' },
            { label: 'Finance Agent', desc: 'Payment terms · LC · FX · working capital', href: '/agent/finance/' },
          ],
        },
        {
          heading: 'Trade Services',
          items: [
            { label: 'Trade Documents', desc: 'CI · Packing List · COO · Bill of Lading', href: '/documents/' },
            { label: 'Insurance', desc: 'Cargo + trade-credit quotes', href: '/insurance/' },
            { label: 'Buyer Verification', desc: 'Tier-1 buyer dossiers', href: '/buyer-verification/' },
            { label: 'Samples', desc: 'HK consolidation', href: '/samples/' },
            { label: 'Returns', desc: 'Reverse logistics', href: '/returns/' },
          ],
        },
        {
          heading: 'Logistics',
          items: [
            { label: 'Routing', desc: 'Sea / rail / air comparison', href: '/routing/' },
            { label: 'Customs', desc: 'Duty + bonded warehouse', href: '/customs/' },
            { label: 'Warehouse', desc: '6-hub 3PL benchmark', href: '/warehouse/' },
          ],
        },
      ],
    },
    secondary: [
      { label: 'Dashboard', href: '/dashboard/', match: ['/dashboard/'] },
      { label: 'Pricing', href: '/pricing/', match: ['/pricing/'] },
    ],
    langSwitcher: [
      { code: 'EN', href: '/' },
      { code: 'PL', href: '/pl/' },
      { code: 'DE', href: '/de/' },
    ],
  };

  function pathStartsWith(currentPath, candidates) {
    return (candidates || []).some(c => currentPath === c || (c !== '/' && currentPath.indexOf(c) === 0));
  }

  function isToolActive(currentPath) {
    return NAV.tools.groups.some(g => g.items.some(i => pathStartsWith(currentPath, [i.href])));
  }

  function renderLink(item, currentPath) {
    const active = pathStartsWith(currentPath, item.match || [item.href]);
    return `<a href="${item.href}"${active ? ' class="active"' : ''}>${item.label}</a>`;
  }

  function renderToolsDropdown(currentPath) {
    const activeClass = isToolActive(currentPath) ? ' is-active' : '';
    const groupsHtml = NAV.tools.groups.map(group => {
      const itemsHtml = group.items.map(item => {
        const active = pathStartsWith(currentPath, [item.href]);
        return `<a class="nav-mega-item${active ? ' active' : ''}" href="${item.href}">
          <span class="nav-mega-item-label">${item.label}</span>
          <span class="nav-mega-item-desc">${item.desc}</span>
        </a>`;
      }).join('');
      return `<div class="nav-mega-section">
        <div class="nav-mega-heading">${group.heading}</div>
        ${itemsHtml}
      </div>`;
    }).join('');
    return `<div class="nav-dropdown${activeClass}">
      <button class="nav-dropdown-toggle" type="button" aria-expanded="false">${NAV.tools.label} ▾</button>
      <div class="nav-dropdown-menu grouped">${groupsHtml}</div>
    </div>`;
  }

  function renderLangSwitcher(currentPath) {
    const detectedLocale = currentPath.startsWith('/pl/') ? 'PL'
      : currentPath.startsWith('/de/') ? 'DE'
      : 'EN';
    const buttons = NAV.langSwitcher.map(l => {
      const cls = 'lang-btn' + (l.code === detectedLocale ? ' lang-active' : '');
      return `<a href="${l.href}" class="${cls}">${l.code}</a>`;
    }).join('');
    return `<div class="lang-switcher">${buttons}</div>`;
  }

  function renderHeader(currentPath) {
    const primaryLinksHtml = NAV.primary.map(item => renderLink(item, currentPath)).join('');
    const secondaryLinksHtml = NAV.secondary.map(item => renderLink(item, currentPath)).join('');
    const toolsHtml = renderToolsDropdown(currentPath);
    const langSwitcherHtml = renderLangSwitcher(currentPath);

    return `<div class="nav">
      <div class="brand">
        <a href="${NAV.brand.href}">
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
      <button class="nav-toggle" aria-label="Open navigation" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
    </div>`;
  }

  function bindMobileNav(headerEl) {
    const toggle = headerEl.querySelector('.nav-toggle');
    const links = headerEl.querySelector('.nav-links');
    if (!toggle || !links) return;

    function closeMenu() {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
      links.classList.remove('is-open');
      headerEl.querySelectorAll('.nav-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      document.body.style.overflow = '';
    }

    toggle.addEventListener('click', function () {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      if (open) closeMenu();
      else {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Close navigation');
        links.classList.add('is-open');
        document.body.style.overflow = 'hidden';
      }
    });

    // Mobile dropdown click-to-open (only triggers below the mobile breakpoint)
    headerEl.querySelectorAll('.nav-dropdown-toggle').forEach(function (dropdownToggle) {
      dropdownToggle.addEventListener('click', function (event) {
        if (window.matchMedia('(max-width: 840px)').matches) {
          event.preventDefault();
          const dropdown = dropdownToggle.closest('.nav-dropdown');
          if (dropdown) dropdown.classList.toggle('is-open');
        }
      });
    });

    // Auto-close mobile menu when a real navigation link is tapped
    links.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
  }

  function init() {
    const headerEl = document.querySelector('header[data-site-header]');
    if (!headerEl) return;
    const currentPath = window.location.pathname || '/';
    headerEl.innerHTML = renderHeader(currentPath);
    bindMobileNav(headerEl);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
