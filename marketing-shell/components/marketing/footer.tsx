import Link from '@/components/marketing/smart-link';
import { CookiePreferencesLink } from './cookie-preferences-link';
import { FOOTER_COLUMNS } from '@/lib/nav';

// Apple-style footer: small grey type on the alternate surface, link
// columns, one legal line.
export function Footer() {
  return (
    <footer className="bg-[var(--color-navy)] text-[12px] text-[var(--color-ivory-mute)]">
      <div className="mx-auto max-w-[1080px] px-6 pb-8 pt-10">
        <p className="border-b border-[var(--color-navy-line)] pb-5 leading-[1.6]">
          OrcaTrade Group Ltd — calculator-grounded import operations for European businesses sourcing
          from Asia. Every figure comes from a deterministic calculator with cited sources; AI writes the
          explanation, never the number. London · Warsaw · Hong Kong.
        </p>

        <div className="grid grid-cols-2 gap-8 py-8 md:grid-cols-4">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-2.5 text-[12px] font-semibold tracking-normal text-[var(--color-ivory)]">
                {col.heading}
              </h3>
              <ul className="space-y-2">
                {col.items.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="hover:text-[var(--color-ivory)] hover:underline">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--color-navy-line)] pt-5 md:flex-row md:items-center md:justify-between">
          <span>Copyright © {new Date().getFullYear()} OrcaTrade Group Ltd. All rights reserved.</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/regulations/privacy/" className="hover:text-[var(--color-ivory)] hover:underline">
              Privacy
            </Link>
            <span aria-hidden className="text-[var(--color-navy-line)]">|</span>
            <CookiePreferencesLink />
            <span aria-hidden className="text-[var(--color-navy-line)]">|</span>
            <a href="mailto:orcatrade@orcatradegroup.com" className="hover:text-[var(--color-ivory)] hover:underline">
              orcatrade@orcatradegroup.com
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
