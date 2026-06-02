import type { MetadataRoute } from 'next';
import { COMPLIANCE_GUIDES } from '@/lib/compliance-guides';
import { PREF_ORIGIN_GUIDES } from '@/lib/preferential-origin';
import { TRADE_DEFENCE_GUIDES } from '@/lib/trade-defence';
import { WORKED_EXAMPLES } from '@/lib/examples';
import {
  COMMODITIES,
  SOURCING_COMMODITIES,
  DESTINATIONS,
  ORIGINS,
  WAREHOUSE_CITIES,
} from '@/lib/matrix-data';

const SITE = 'https://orcatrade.pl';

const SOURCING_ORIGINS = ORIGINS.filter((o) => ['cn', 'vn', 'in', 'bd', 'tr'].includes(o.code));
const ROUTING_ORIGINS = ORIGINS.filter((o) => ['cn', 'hk', 'vn', 'in', 'tr'].includes(o.code));

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const editorial = [
    '/',
    '/contact',
    '/founding',
    '/trust',
    '/changelog',
    '/regulations/privacy',
    '/docs/orcatrade-shareholder-brief',
    '/start',
    '/search',
    '/sourcing',
    '/intelligence',
    '/logistics',
    '/finance',
    '/process',
    '/agents',
    '/signin',
    '/buyer-verification',
    '/factory-risk',
    '/analysis',
  ].map((path) => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: path === '/' ? 1.0 : 0.8,
  }));

  const hubs = [
    '/examples',
    '/guides',
    '/guides/compliance',
    '/guides/customs',
    '/guides/sourcing',
    '/guides/routing',
    '/guides/warehouse',
    '/guides/preferential-origin',
    '/guides/trade-defence',
  ].map((path) => ({
    url: `${SITE}${path}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  const compliance = COMPLIANCE_GUIDES.map((g) => ({
    url: `${SITE}/guides/compliance/${g.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const prefOrigin = PREF_ORIGIN_GUIDES.map((g) => ({
    url: `${SITE}/guides/preferential-origin/${g.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const tradeDefence = TRADE_DEFENCE_GUIDES.map((g) => ({
    url: `${SITE}/guides/trade-defence/${g.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  const examples = WORKED_EXAMPLES.map((e) => ({
    url: `${SITE}/examples/${e.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  const customs = COMMODITIES.flatMap((c) =>
    DESTINATIONS.map((d) => ({
      url: `${SITE}/guides/customs/${c.slug}-into-${d.code}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  );

  const sourcing = SOURCING_COMMODITIES.flatMap((c) =>
    SOURCING_ORIGINS.map((o) => ({
      url: `${SITE}/guides/sourcing/${c.slug}-from-${o.code}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  );

  const routing = ROUTING_ORIGINS.flatMap((o) =>
    DESTINATIONS.map((d) => ({
      url: `${SITE}/guides/routing/${o.code}-to-${d.code}`,
      lastModified: now,
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    })),
  );

  const warehouse = WAREHOUSE_CITIES.map((c) => ({
    url: `${SITE}/guides/warehouse/${c.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  return [
    ...editorial,
    ...hubs,
    ...compliance,
    ...prefOrigin,
    ...tradeDefence,
    ...examples,
    ...customs,
    ...sourcing,
    ...routing,
    ...warehouse,
  ];
}
