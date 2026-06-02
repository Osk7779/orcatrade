import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
// Marketing-shell owns the public-facing routes: /, /start, /tools/quote-rebrand.
// Unlike app-shell (which sets basePath: '/app'), this project has NO basePath
// because it serves the site root. Deployed as a separate Vercel project; the
// root project's vercel.json rewrites the relevant paths to this deployment.
// The 658 SEO guides + /api stay at the repo root and are untouched.
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The repo root has its own package-lock.json for the static site's tiny
  // dependency set. Pin tracing root to this project so Next doesn't walk up.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
