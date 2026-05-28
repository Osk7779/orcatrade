import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        // Internal team tool, no value to crawl
        disallow: ['/tools/quote-rebrand'],
      },
    ],
    sitemap: 'https://orcatrade.pl/sitemap.xml',
    host: 'https://orcatrade.pl',
  };
}
