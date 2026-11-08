import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { RoadmapService, threadSlugOf } from './roadmap.service';
import { PatchOutline } from './patch-outline';

/**
 * The outline queue and the roadmap load. The transport-error retry (AUD-096)
 * is covered in roadmap.spec.ts and deliberately not repeated here.
 */
const outline = (slug: string): PatchOutline => ({
  slug, subject: slug, nodes: [{ kind: 'bullet', text: 'x', depth: 0 }], bulletCount: 1, truncated: false,
});

const settle = () => new Promise((r) => setTimeout(r));

describe('RoadmapService — outline queue', () => {
  let svc: RoadmapService;
  let http: HttpTestingController;

  const noteRequests = (): TestRequest[] => http.match((r) => r.url.includes('rsi-roadmap') && r.url.includes('notes='));
  const slugsOf = (req: TestRequest): string[] =>
    decodeURIComponent(req.request.urlWithParams.split('notes=')[1]).split(',');

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockReturnValue(undefined as never);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(RoadmapService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('never has more than two requests of five slugs in flight', async () => {
    const slugs = Array.from({ length: 12 }, (_, i) => `n${i}`);
    svc.requestOutlines(slugs);

    const first = noteRequests();
    expect(first.length).toBe(2);
    expect(first.every((r) => slugsOf(r).length <= 5)).toBe(true);
    // Everything asked for is pending at enqueue time, queued or not.
    expect(slugs.every((s) => svc.isPending(s))).toBe(true);

    first[0].flush({ roadmap: null, outlines: slugsOf(first[0]).map(outline) });
    await settle();

    // One slot freed → exactly one follow-up request, carrying the next five.
    const next = noteRequests();
    expect(next.length).toBe(1);
    expect(slugsOf(next[0])).toEqual(['n10', 'n11']);
    expect(svc.loadedOutlineCount()).toBe(5);

    first[1].flush({ roadmap: null, outlines: [] });
    next[0].flush({ roadmap: null, outlines: [outline('n10'), outline('n11')] });
    await settle();
    expect(svc.pending().size).toBe(0);
  });

  it('files a slug the server returned nothing for as missing', async () => {
    svc.requestOutlines(['gone', 'here']);
    const [req] = noteRequests();
    req.flush({ roadmap: null, outlines: [outline('here')] });
    await settle();

    expect(svc.isMissing('gone')).toBe(true);
    expect(svc.isMissing('here')).toBe(false);
    expect(svc.hasOutline('here')).toBe(true);
    expect(svc.outlineFor('here')?.bulletCount).toBe(1);

    // Known-missing and loaded slugs are not asked for again.
    svc.requestOutlines(['gone', 'here']);
    expect(noteRequests().length).toBe(0);
  });

  it('treats an empty outlines list as missing for every slug', async () => {
    svc.requestOutlines(['a']);
    noteRequests()[0].flush({ roadmap: null, outlines: [] });
    await settle();
    expect(svc.isMissing('a')).toBe(true);
    expect(svc.pending().has('a')).toBe(false);
  });

  it('de-duplicates in-flight and repeated slugs and ignores empty ones', () => {
    svc.requestOutlines(['a', 'a', '', 'b']);
    svc.requestOutlines(['a', 'b']);
    const reqs = noteRequests();
    expect(reqs.length).toBe(1);
    expect(slugsOf(reqs[0])).toEqual(['a', 'b']);
  });

  it('loads the roadmap once and shares the in-flight request', async () => {
    const roadmap = {
      current: { id: 'c', name: '4.10', cards: [{ id: '1', name: 'Card', status: 'committed' }] },
      next: null,
    };
    const p1 = svc.loadRoadmap();
    const p2 = svc.loadRoadmap();
    const req = http.expectOne((r) => r.url.includes('rsi-roadmap') && !r.url.includes('notes='));
    expect(svc.loading()).toBe(true);
    req.flush({ roadmap, outlines: [] });
    await Promise.all([p1, p2]);

    expect(svc.loading()).toBe(false);
    expect(svc.roadmap()).not.toBeNull();
    await svc.loadRoadmap();
    http.expectNone((r) => r.url.includes('rsi-roadmap'));
  });

  it('flips unavailable when the roadmap request fails', async () => {
    const p = svc.loadRoadmap();
    http.expectOne((r) => r.url.includes('rsi-roadmap')).error(new ProgressEvent('error'), { status: 0 });
    await p;
    expect(svc.unavailable()).toBe(true);
    expect(svc.roadmap()).toBeNull();
    expect(svc.loading()).toBe(false);
  });
});

describe('threadSlugOf', () => {
  it('extracts and lower-cases the slug from Spectrum thread URLs', () => {
    expect(threadSlugOf('https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/Star-Citizen-Alpha-4-9'))
      .toBe('star-citizen-alpha-4-9');
  });

  it('handles a trailing slash, a query string, a fragment and a following path segment', () => {
    for (const tail of ['/', '?page=2', '#reply', '/123']) {
      expect(threadSlugOf(`https://x.test/forum/1/thread/patch-4-9${tail}`), tail).toBe('patch-4-9');
    }
  });

  it('returns an empty string for URLs that are not threads', () => {
    expect(threadSlugOf('https://x.test/comm-link/Transmission/1-foo')).toBe('');
    expect(threadSlugOf('')).toBe('');
  });
});
