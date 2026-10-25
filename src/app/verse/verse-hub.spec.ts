import { verseItemLink } from './pages/verse-briefing.component';
import { verseKpiTiles } from './pages/verse-patch-kpis';
import { dossierLineOf } from './pages/verse-patches.component';
import { verseStatusView } from './shared/verse-status.component';
import { VERSE_ROUTES } from './verse.routes';

// The briefing component itself is covered in pages/briefing/verse-briefing.component.spec.ts.

describe('Verse hub — pure helpers', () => {
  it('verseItemLink splits in-app paths and keeps only https externals', () => {
    expect(verseItemLink('/verse/gallery?image=a1')).toEqual({ internal: true, path: '/verse/gallery', query: { image: 'a1' } });
    expect(verseItemLink('/verse/patches/4.3')).toEqual({ internal: true, path: '/verse/patches/4.3', query: null });
    expect(verseItemLink('https://robertsspaceindustries.com/x')?.internal).toBeFalse();
    expect(verseItemLink('//evil.example.com')).toBeNull();
    expect(verseItemLink('javascript:alert(1)')).toBeNull();
    expect(verseItemLink(null)).toBeNull();
  });

  it('dossierLineOf recognises an opened dossier only', () => {
    expect(dossierLineOf('/verse/patches/4.3?q=x')).toBe('4.3');
    expect(dossierLineOf('/verse/patches')).toBeNull();
    expect(dossierLineOf('/verse/news')).toBeNull();
  });

  it('verseStatusView falls back to the digest patch block without a feed', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    const v = verseStatusView([], { line: '4.3', liveAt: '2026-09-28T12:00:00Z', channels: { ptu: '4.4.0' }, status: 'ptu' }, now);
    expect(v).toEqual(jasmine.objectContaining({ line: '4.3', state: 'ptu', ptuLine: '4.4.0', sinceDays: 10, nextDays: null }));
    expect(verseStatusView([], null, now)).toBeNull();
  });

  it('verseKpiTiles shows nothing it cannot prove', () => {
    expect(verseKpiTiles([], [])).toEqual([]);
  });

  it('every in-app digest url shape has a Verse route', () => {
    const paths = VERSE_ROUTES.map((r) => r.path);
    expect(paths).toEqual(jasmine.arrayContaining(['', 'news', 'patches', 'gallery', 'gallery/constellations', 'explorer']));
    expect(VERSE_ROUTES.find((r) => r.path === 'patches')?.children?.[0].path).toBe(':line');
  });
});
