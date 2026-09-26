// Single source of truth for site navigation. Header, mobile menu and
// footer all read from here so no tool can silently drop out of one of
// them. Every href below must resolve (see the link crawl in the
// overhaul PR); tool pages that still live on the static root project
// are plain <a> links, not next/link.

export type NavItem = { label: string; href: string; desc?: string };
export type NavGroup = { heading: string; items: NavItem[] };

export const PRIMARY_NAV: NavItem[] = [
  { label: 'Platform', href: '/platform/' },
  { label: 'Build a plan', href: '/start/' },
];

export const SECONDARY_NAV: NavItem[] = [
  { label: 'Guides', href: '/guides/' },
  { label: 'Pricing', href: '/pricing/' },
  { label: 'Dashboard', href: '/app/dashboard' },
];

export const TOOLS_GROUPS: NavGroup[] = [
  {
    heading: 'AI agents',
    items: [
      { label: 'Agent hub', desc: 'All five agents in one place', href: '/agents/' },
      { label: 'Operations orchestrator', desc: 'One agent across every domain', href: '/agent/orchestrator/' },
      { label: 'Compliance agent', desc: 'CBAM, EUDR, REACH, CE marking', href: '/agent/' },
      { label: 'Sourcing agent', desc: 'Where to source, supplier risk', href: '/agent/sourcing/' },
      { label: 'Logistics agent', desc: 'Transport, customs, 3PL', href: '/agent/logistics/' },
      { label: 'Finance agent', desc: 'Payment terms, LC, FX', href: '/agent/finance/' },
    ],
  },
  {
    heading: 'Logistics',
    items: [
      { label: 'Routing', desc: 'Sea, rail and air compared', href: '/routing/' },
      { label: 'Customs', desc: 'Duty and bonded warehousing', href: '/customs/' },
      { label: 'Warehouse', desc: 'Six-hub 3PL benchmark', href: '/warehouse/' },
    ],
  },
  {
    heading: 'Trade services',
    items: [
      { label: 'Trade documents', desc: 'CI, packing list, COO, B/L', href: '/documents/' },
      { label: 'Insurance', desc: 'Cargo and trade-credit quotes', href: '/insurance/' },
      { label: 'Buyer verification', desc: 'Tier-1 buyer dossiers', href: '/buyer-verification/' },
      { label: 'Samples', desc: 'Hong Kong consolidation', href: '/samples/' },
      { label: 'Returns', desc: 'Reverse logistics', href: '/returns/' },
    ],
  },
];

export const FOOTER_COLUMNS: NavGroup[] = [
  {
    heading: 'Platform',
    items: [
      { label: 'Import plan builder', href: '/start/' },
      { label: 'Search', href: '/search/' },
      { label: 'Sourcing', href: '/sourcing/' },
      { label: 'Intelligence', href: '/intelligence/' },
      { label: 'Logistics', href: '/logistics/' },
      { label: 'Finance', href: '/finance/' },
      { label: 'How it works', href: '/process/' },
      { label: 'Quote Studio', href: '/tools/quote-rebrand/' },
    ],
  },
  {
    heading: 'Tools',
    items: [
      { label: 'AI agents', href: '/agents/' },
      { label: 'Routing', href: '/routing/' },
      { label: 'Customs', href: '/customs/' },
      { label: 'Warehouse', href: '/warehouse/' },
      { label: 'Trade documents', href: '/documents/' },
      { label: 'Insurance', href: '/insurance/' },
      { label: 'Buyer verification', href: '/buyer-verification/' },
      { label: 'Samples & returns', href: '/samples/' },
    ],
  },
  {
    heading: 'Guides',
    items: [
      { label: 'EU customs', href: '/guides/customs/' },
      { label: 'Compliance', href: '/guides/compliance/' },
      { label: 'Trade defence', href: '/guides/trade-defence/' },
      { label: 'Preferential origin', href: '/guides/preferential-origin/' },
      { label: 'Sourcing', href: '/guides/sourcing/' },
      { label: 'Routing', href: '/guides/routing/' },
      { label: 'Worked examples', href: '/examples/' },
    ],
  },
  {
    heading: 'Company',
    items: [
      { label: 'Contact', href: '/contact/' },
      { label: 'Trust centre', href: '/trust/' },
      { label: 'System status', href: '/status/' },
      { label: 'Changelog', href: '/changelog/' },
      { label: 'Partners', href: '/partners/' },
      { label: 'Press', href: '/press/' },
      { label: 'Privacy', href: '/regulations/privacy/' },
    ],
  },
];
