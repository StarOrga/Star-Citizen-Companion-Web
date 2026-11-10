import type { PrefetchWarmer } from './prefetch.model';

/**
 * The Verse hub (`/verse`): the digest and the live news feed the briefing reads first
 * (VerseBriefingComponent's own start-up reads, same guards, so arriving finds them in
 * VerseApiService / NewsService). The services load through `import()`.
 */
export const VERSE_HUB_WARMER: PrefetchWarmer = {
  id: 'verse-hub',
  matches: (path) => path === '/verse' || path === '/',
  warm: async (injector) => {
    const [{ VerseApiService }, { NewsService }] = await Promise.all([
      import('../../verse/data/verse-api.service'),
      import('../../news/news.service'),
    ]);
    const api = injector.get(VerseApiService);
    const news = injector.get(NewsService);
    const reads: Promise<unknown>[] = [];
    if (api.digestState() === 'idle') reads.push(api.loadDigest());
    if (!news.feed() && !news.loading()) reads.push(news.refresh(true));
    await Promise.all(reads);
  },
};
