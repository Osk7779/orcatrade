import type { Metadata } from 'next';
import { Inter, Fraunces, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/marketing/header';
import { Footer } from '@/components/marketing/footer';
import { Colophon } from '@/components/marketing/colophon';
import { IntroOverlay } from '@/components/marketing/intro-overlay';
import { CookieBanner } from '@/components/marketing/cookie-banner';
import { FloatingDock } from '@/components/marketing/floating-dock';
import { TracingBeam } from '@/components/marketing/tracing-beam';

const sans = Inter({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-sans',
  display: 'swap',
});

const serif = Fraunces({
  subsets: ['latin'],
  weight: 'variable',
  axes: ['SOFT', 'opsz'],
  variable: '--font-serif',
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
      className={`${sans.variable} ${serif.variable} ${mono.variable}`}
    >
      <body className="min-h-screen font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:border focus:border-[var(--color-ivory-dim)] focus:bg-[var(--color-ink)] focus:px-4 focus:py-2 focus:text-[12px] focus:font-medium focus:text-[var(--color-ivory)]"
        >
          Skip to content
        </a>

        {/* Shared chrome — every page gets it for free */}
        <IntroOverlay />
        <Header />
        <TracingBeam />

        <main id="main-content">{children}</main>

        <Footer />
        <Colophon />
        <FloatingDock />
        <CookieBanner />
      </body>
    </html>
  );
}
