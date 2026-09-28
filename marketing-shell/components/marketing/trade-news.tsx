import Link from '@/components/marketing/smart-link';
import { FadeUp } from './fade-up';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// Three featured compliance guides from the live /guides/compliance/ tree.
// Titles and excerpts come from the locale bundle.

const FEATURED_META = [
  { href: '/guides/compliance/cbam/', readMin: 9 },
  { href: '/guides/compliance/eudr/', readMin: 11 },
  { href: '/guides/compliance/gpsr/', readMin: 7 },
];

type NewsArticle = HomepageCopy['newsSection']['items'][number] & {
  href: string;
  readMin: number;
};

function NewsCard({
  article,
  minSuffix,
  readGuide,
}: {
  article: NewsArticle;
  minSuffix: string;
  readGuide: string;
}) {
  return (
    <Link
      href={article.href}
      className="tile group flex flex-col gap-4 p-8 transition-transform duration-300 hover:scale-[1.015]"
    >
      <div className="flex items-center justify-between text-[12px] text-[var(--color-ivory-mute)]">
        <span>{article.tag}</span>
        <span>
          {article.readMin} {minSuffix}
        </span>
      </div>
      <h3 className="text-[21px] leading-[1.25] tracking-[-0.02em]">{article.title}</h3>
      <p className="line-clamp-4 text-[15px] leading-[1.55] text-[var(--color-ivory-dim)]">{article.excerpt}</p>
      <div className="mt-auto flex items-center justify-between pt-2 text-[13px]">
        <span className="text-[var(--color-ivory-mute)]">{article.regime}</span>
        <span className="text-[15px] text-[var(--color-link)] group-hover:underline">{readGuide} ›</span>
      </div>
    </Link>
  );
}

export function TradeNews({
  copy = EN_COPY.newsSection,
}: {
  copy?: HomepageCopy['newsSection'];
  locale?: 'en' | 'pl' | 'de';
}) {
  const articles: NewsArticle[] = copy.items.map((item, i) => ({
    ...item,
    ...FEATURED_META[i],
  }));
  return (
    <section id="news" className="bg-[var(--color-ink)] py-20 md:py-24">
      <div className="mx-auto max-w-[1080px] px-6">
        <FadeUp className="mb-12 text-center">
          <h2 className="mx-auto max-w-[26ch] text-[clamp(2rem,4vw,3rem)] leading-[1.1]">{copy.title}</h2>
          <Link href="/guides/compliance/" className="link-arrow mt-4">
            {copy.viewAll} <span aria-hidden>›</span>
          </Link>
        </FadeUp>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {articles.map((article) => (
            <NewsCard
              key={article.href}
              article={article}
              minSuffix={copy.minSuffix}
              readGuide={copy.readGuide}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
