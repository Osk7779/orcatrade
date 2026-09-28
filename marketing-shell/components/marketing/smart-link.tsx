import NextLink from 'next/link';
import type { ComponentProps } from 'react';

// Drop-in replacement for next/link. The cockpit (/app/*) is a separate
// Next.js deployment proxied onto the same origin, so a client-side
// transition into it fetches an RSC payload this app cannot serve (404)
// before falling back. Cross-app hrefs render as a plain anchor instead.
type Props = ComponentProps<typeof NextLink>;

export default function SmartLink({ href, prefetch, ...rest }: Props) {
  const h = typeof href === 'string' ? href : href.pathname || '';
  if (h === '/app' || h.startsWith('/app/') || h.startsWith('/app?') || h.startsWith('/api/')) {
    const { replace: _r, scroll: _s, shallow: _sh, passHref: _p, legacyBehavior: _l, locale: _lo, onNavigate: _n, ...anchor } =
      rest as Props & Record<string, unknown>;
    return <a href={h} {...(anchor as ComponentProps<'a'>)} />;
  }
  return <NextLink href={href} prefetch={prefetch} {...rest} />;
}
