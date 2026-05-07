// api/news.js — CommonJS serverless function
// Fetches live trade news from RSS feeds, returns top 4 articles as JSON
// Cached at the CDN edge for 1 hour

const FEEDS = [
  { url: 'https://www.supplychaindive.com/feeds/news/', source: 'Supply Chain Dive' },
  { url: 'https://theloadstar.com/feed/',               source: 'The Loadstar' },
  { url: 'https://www.freightwaves.com/news/feed',      source: 'FreightWaves' },
];

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ');
}

function normaliseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function cleanFeedText(text, limit) {
  const cleaned = normaliseWhitespace(stripHtml(decodeHtmlEntities(text)));
  if (!limit || cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

// Keyword-based tag classification
function classifyTag(text) {
  const t = text.toLowerCase();
  if (/regulat|compliance|eudr|cbam|csddd|tariff|sanction|customs|policy|legislation|law|ban/.test(t))
    return 'Policy';
  if (/freight|shipping|port|vessel|container|sea|ocean|air cargo|carrier|forwarder|loadstar/.test(t))
    return 'Logistics';
  if (/sourc|supplier|factory|manufactur|vietnam|china|malaysia|indonesia|india|nearshoring|vendor/.test(t))
    return 'Sourcing';
  return 'Trade';
}

// Minimal RSS XML parser — no dependencies needed
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const title       = cleanFeedText(get('title'), 160);
    const link        = get('link') || block.match(/<link>([^<]+)<\/link>/i)?.[1] || '';
    const description = cleanFeedText(get('description'), 220);
    const pubDate     = get('pubDate') || get('dc:date') || '';

    if (title && link) {
      items.push({ title, link: link.trim(), description, pubDate, date: pubDate ? new Date(pubDate) : new Date(0) });
    }
  }
  return items;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch all feeds in parallel with a 6s timeout each
    const results = await Promise.allSettled(
      FEEDS.map(({ url, source }) =>
        fetch(url, {
          headers: { 'User-Agent': 'OrcaTrade-NewsBot/1.0' },
          signal: AbortSignal.timeout(6000),
        })
          .then(r => r.text())
          .then(xml => parseRSS(xml).map(item => ({ ...item, source })))
      )
    );

    // Combine all articles from feeds that succeeded
    const allArticles = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .filter(item => item && item.title && item.link);

    if (allArticles.length === 0) {
      return res.status(502).json({ error: 'No feeds available' });
    }

    const seenLinks = new Set();
    const dedupedArticles = allArticles.filter(article => {
      const key = normaliseWhitespace(article.link).toLowerCase();
      if (!key || seenLinks.has(key)) return false;
      seenLinks.add(key);
      return true;
    });

    // Sort by date descending, take top 4
    dedupedArticles.sort((a, b) => b.date - a.date);
    const top4 = dedupedArticles.slice(0, 4).map(({ title, link, description, pubDate, source }) => ({
      title: cleanFeedText(title, 160),
      link: String(link || '').trim(),
      excerpt: cleanFeedText(description || 'Read the full article for details.', 220),
      date: pubDate ? new Date(pubDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '',
      tag: classifyTag(title + ' ' + description),
      source: cleanFeedText(source, 48),
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({ articles: top4 });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch news' });
  }
};
