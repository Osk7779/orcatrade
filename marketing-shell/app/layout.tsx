import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/marketing/header';
import { Footer } from '@/components/marketing/footer';
import { CookieBanner } from '@/components/marketing/cookie-banner';

const sans = Inter({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OrcaTrade Group — Import operations, on autopilot',
  description:
    'AI-native trade compliance and import operations for European businesses sourcing from Asia. Search, source, comply, route, finance — one calculator-grounded platform.',
  metadataBase: new URL('https://orcatrade.pl'),
  openGraph: {
    title: 'OrcaTrade Group — Import operations, on autopilot',
    description:
      'AI-native trade compliance and import operations for European businesses sourcing from Asia.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-screen font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:border focus:rounded-full focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-[12px] focus:font-medium focus:text-white"
        >
          Skip to content
        </a>

        {/* Shared chrome — every page gets it for free */}
        <Header />

        <main id="main-content">{children}</main>

        <Footer />
        <CookieBanner />
      </body>
    </html>
  );
}
