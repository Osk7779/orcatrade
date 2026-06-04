import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  // Pin Turbopack's workspace root to this directory. Next 16 changed its
  // root-inference default; without this, builds fail with "couldn't find
  // next/package.json from the project directory" when run from inside the
  // repo because Turbopack walks up past the app-shell.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
