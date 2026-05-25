import type { Metadata } from 'next';
import { Inter, Cormorant_Garamond } from 'next/font/google';
import './globals.css';

const geist = Inter({ subsets: ['latin'], variable: '--font-geist' });
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-cormorant',
});

export const metadata: Metadata = {
  title: 'OrcaTrade',
  description: 'Your import-operations cockpit — plans, monitoring, compliance and documents in one place.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${cormorant.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
