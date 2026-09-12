import { config } from './config.ts';

export interface DiscoveredFencingTvItem {
  kind: 'competition' | 'video';
  title: string;
  url: string;
  slug: string;
}

let cached: { expiresAt: number; items: DiscoveredFencingTvItem[] } | null = null;

function titleFromSlug(slug: string) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseLinks(html: string) {
  const found = new Map<string, DiscoveredFencingTvItem>();
  const normalized = html.replaceAll('\\u002F', '/').replaceAll('\\/', '/');
  for (const match of normalized.matchAll(/\/(competitions|videos)\/([a-zA-Z0-9][a-zA-Z0-9_-]{2,})/g)) {
    const collection = match[1] as 'competitions' | 'videos';
    const slug = match[2];
    if (/^(undefined|null|index)$/i.test(slug)) continue;
    const url = `https://fencingtv.com/${collection}/${slug}`;
    found.set(url, { kind: collection === 'competitions' ? 'competition' : 'video', title: titleFromSlug(slug), url, slug });
  }
  return [...found.values()];
}

export async function discoverFencingTv(query = '', kind: 'all' | 'competition' | 'video' = 'all') {
  if (!config.fencingTvDiscoveryEnabled) return { available: false, items: [], message: 'FencingTV discovery is disabled.' };
  if (!cached || cached.expiresAt < Date.now()) {
    const pages = await Promise.allSettled(['competitions', 'videos'].map(async (page) => {
      const response = await fetch(`https://fencingtv.com/${page}`, {
        headers: { 'User-Agent': 'SabreStudio/0.1 personal video catalog' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`FencingTV ${page} returned ${response.status}`);
      return parseLinks(await response.text());
    }));
    const items = pages.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    cached = { expiresAt: Date.now() + 15 * 60_000, items: [...new Map(items.map((item) => [item.url, item])).values()] };
  }
  const term = query.trim().toLowerCase();
  const items = cached.items.filter((item) => (kind === 'all' || item.kind === kind) && (!term || `${item.title} ${item.slug}`.toLowerCase().includes(term))).slice(0, 60);
  return {
    available: cached.items.length > 0,
    items,
    message: cached.items.length ? '' : 'The public catalog did not expose server-rendered links. Open the FencingTV calendar and paste a detail URL.',
  };
}
