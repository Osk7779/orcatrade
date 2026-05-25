/** @type {import('next').NextConfig} */
// The app shell is served under /app on orcatrade.pl (the main site rewrites
// /app/:path* to this separate Vercel project). basePath keeps every route,
// asset and link under that prefix so it composes cleanly behind the proxy.
const nextConfig = {
  basePath: '/app',
  reactStrictMode: true,
  // The API stays in the repo-root project at orcatrade.pl/api/*. Because the
  // app shell is proxied onto the SAME origin (orcatrade.pl/app), client fetches
  // to '/api/...' hit the existing handlers directly and the session cookie is
  // sent automatically — no CORS, no token plumbing.
  poweredByHeader: false,
};

export default nextConfig;
