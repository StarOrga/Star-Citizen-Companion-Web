import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { StarscapeComponent } from './starscape.component';
import { StarscapeService, Wallpaper } from './starscape.service';
import { StarscapeVotesService } from './starscape-votes.service';

function wallpaper(id: string): Wallpaper {
  return {
    imageId: id,
    sourceUrl: `https://media.robertsspaceindustries.com/${id}/source.jpg`,
    previewUrl: `https://media.robertsspaceindustries.com/${id}/cover.jpg`,
    title: `Wallpaper ${id}`,
    series: 'Release Info',
    articleUrl: 'https://robertsspaceindustries.com/comm-link/1',
    publishedAt: '2026-07-01T00:00:00Z',
  };
}

/** Only the surface StarscapeComponent actually reads. */
function serviceStub(wallpapers: Wallpaper[]) {
  return {
    wallpapers: signal(wallpapers),
    total: signal(wallpapers.length),
    loading: signal(false),
    error: signal<string | null>(null),
    timedOut: signal(false),
    activeSeries: signal(''),
    seriesOptions: signal<string[]>([]),
    hasMore: signal(false),
    desktopRelease: signal(null),
    ringReleases: signal([]),
    loadRingReleases: jasmine.createSpy('loadRingReleases').and.resolveTo(undefined),
    loadDesktopRelease: jasmine.createSpy('loadDesktopRelease').and.resolveTo(undefined),
    load: jasmine.createSpy('load').and.resolveTo(undefined),
    setSeries: jasmine.createSpy('setSeries').and.resolveTo(undefined),
    loadOne: jasmine.createSpy('loadOne').and.resolveTo(null),
  };
}

/** Only the surface the gallery + the vote button actually read. */
function votesStub(opts: { canVote?: boolean; counts?: Record<string, number>; mine?: string[] } = {}) {
  return {
    counts: signal<ReadonlyMap<string, number>>(new Map(Object.entries(opts.counts ?? {}))),
    mine: signal<ReadonlySet<string>>(new Set(opts.mine ?? [])),
    busy: signal<ReadonlySet<string>>(new Set<string>()),
    topOnly: signal(false),
    topWallpapers: signal<readonly Wallpaper[]>([]),
    topLoading: signal(false),
    topLimit: 7,
    canVote: signal(opts.canVote ?? true),
    syncCounts: jasmine.createSpy('syncCounts').and.resolveTo(undefined),
    toggle: jasmine.createSpy('toggle').and.resolveTo(undefined),
    loadTop: jasmine.createSpy('loadTop').and.resolveTo(undefined),
    loadPreference: jasmine.createSpy('loadPreference').and.resolveTo(undefined),
    setTopOnly: jasmine.createSpy('setTopOnly').and.resolveTo(undefined),
  };
}

describe('StarscapeComponent', () => {
  const first = wallpaper('abc123');

  function configure(
    svc: ReturnType<typeof serviceStub>,
    queryParams: Record<string, string> = {},
    votes: ReturnType<typeof votesStub> = votesStub(),
  ): void {
    TestBed.configureTestingModule({
      imports: [StarscapeComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: StarscapeService, useValue: svc },
        { provide: StarscapeVotesService, useValue: votes },
        { provide: RoleService, useValue: { role: signal('viewer') } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    });
  }

  function setup(
    svc = serviceStub([first]),
    queryParams: Record<string, string> = {},
    votes: ReturnType<typeof votesStub> = votesStub(),
  ): ComponentFixture<StarscapeComponent> {
    configure(svc, queryParams, votes);
    const f = TestBed.createComponent(StarscapeComponent);
    f.detectChanges();
    return f;
  }

  // Chrome on Windows implements Web Share, so `navigator.share` lives on the
  // prototype and cannot be deleted — the "no share sheet" cases have to shadow
  // it with an own `undefined` property instead.
  const stubbed: string[] = [];
  function stubNavigator(key: 'share' | 'clipboard', value: unknown): void {
    Object.defineProperty(navigator, key, { value, configurable: true });
    if (!stubbed.includes(key)) stubbed.push(key);
  }

  afterEach(() => {
    for (const key of stubbed.splice(0)) {
      delete (navigator as unknown as Record<string, unknown>)[key];
    }
    TestBed.resetTestingModule();
  });

  it('pins the light post variant for phones via a <picture> source', () => {
    const f = setup();
    const source = f.nativeElement.querySelector('.tile picture source') as HTMLSourceElement;
    expect(source).not.toBeNull();
    // A `sizes` hint is multiplied by the device pixel ratio, so it cannot keep a
    // DPR-3 phone off the 1140w cover — only an explicit media source can.
    //
    // The pin stops at 480px: past it a tile is 350-608px wide on DPR-2 hardware,
    // where the 500w post is under 1x CSS density and looks soft. Widening it back
    // to the 900px it used to be re-blurs every tablet (feedback 4e54ad2c).
    expect(source.media).toBe('(max-width: 480px)');
    expect(source.getAttribute('srcset')).toBe(
      'https://media.robertsspaceindustries.com/abc123/post.jpg',
    );
    f.destroy();
  });

  it('sizes the tile slot as the single full-width phone column it now is', () => {
    const f = setup();
    const img = f.nativeElement.querySelector('.tile picture img') as HTMLImageElement;
    // 95vw, not the 48vw of the two-column phone grid that rendered every
    // ultrawide wallpaper as a ~75px stripe (feedback 4e54ad2c).
    expect(img.getAttribute('sizes')).toBe('(max-width: 640px) 95vw, (max-width: 900px) 46vw, 300px');
    f.destroy();
  });

  it('shapes loading placeholders by aspect ratio so they match the column width', () => {
    const f = setup();
    const c = f.componentInstance;
    // A ratio, never a pixel height: a fixed height tuned for a 260px desktop
    // column painted a 200-340px block in a phone column and then snapped down to
    // the real ~150px image, reflowing the whole page on every decode.
    const ratios = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => Number(c.skelRatio(i)));
    for (const r of ratios) expect(r).toBeGreaterThan(1); // landscape art, always
    expect(ratios[10]).toBe(ratios[0]); // cycles
    f.destroy();
  });

  it('builds a deep link to the wallpaper for sharing', () => {
    const f = setup();
    expect(f.componentInstance.shareUrl(first)).toBe(
      `${location.origin}/starscape?image=abc123`,
    );
    f.destroy();
  });

  it('reopens a shared wallpaper from ?image=', fakeAsync(() => {
    const other = wallpaper('deep42');
    const svc = serviceStub([first]);
    svc.loadOne.and.resolveTo(other);
    const f = setup(svc, { image: 'deep42' });
    tick();
    f.detectChanges();
    expect(svc.loadOne).toHaveBeenCalledWith('deep42');
    expect(f.componentInstance.active()).toEqual(other);
    f.destroy();
  }));

  it('hands the wallpaper to the native share sheet when one exists', async () => {
    const f = setup();
    const share = jasmine.createSpy('share').and.resolveTo(undefined);
    stubNavigator('share', share);
    await f.componentInstance.share(first);
    expect(share).toHaveBeenCalledWith({
      title: 'Wallpaper abc123',
      url: `${location.origin}/starscape?image=abc123`,
    });
    // The native sheet is its own confirmation — no inline hint.
    expect(f.componentInstance.shareHint()).toBeNull();
    f.destroy();
  });

  it('falls back to the clipboard with a localized confirmation', async () => {
    const f = setup();
    stubNavigator('share', undefined);
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    stubNavigator('clipboard', { writeText });
    await f.componentInstance.share(first);
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/starscape?image=abc123`);
    expect(f.componentInstance.shareHint()).toBe('starscape.share.copied');
    f.destroy();
  });

  it('reports a failed copy instead of claiming success', async () => {
    const f = setup();
    stubNavigator('share', undefined);
    stubNavigator('clipboard', { writeText: () => Promise.reject(new Error('denied')) });
    await f.componentInstance.share(first);
    expect(f.componentInstance.shareHint()).toBe('starscape.share.failed');
    f.destroy();
  });

  it('says so when there is neither a share sheet nor a clipboard', async () => {
    const f = setup();
    stubNavigator('share', undefined);
    stubNavigator('clipboard', undefined);
    await f.componentInstance.share(first);
    expect(f.componentInstance.shareHint()).toBe('starscape.share.failed');
    f.destroy();
  });

  /* ---------------------------------------------------------------- *
   * "Ich sehe nur graue blaue balken" (admin feedback 4e54ad2c round 3).
   *
   * Every one of these pins the same rule: a shimmering placeholder may
   * never be the page's final state. Whatever goes wrong — the request,
   * one preview, or all of them — the grid has to end up saying so and
   * offering a way out.
   * ---------------------------------------------------------------- */

  it('offers a retry instead of leaving a failed page load as a dead end', () => {
    const svc = serviceStub([]);
    svc.error.set('network unreachable');
    const f = setup(svc);
    const card = f.nativeElement.querySelector('.err') as HTMLElement;
    expect(card).not.toBeNull();
    // The server's own words survive as the small technical line.
    expect(card.textContent).toContain('network unreachable');
    (card.querySelector('button') as HTMLButtonElement).click();
    expect(svc.load).toHaveBeenCalledWith(true);
    f.destroy();
  });

  it('does not print our own deadline marker as if it were a server message', () => {
    const svc = serviceStub([]);
    svc.error.set('timeout after 15s');
    svc.timedOut.set(true);
    const f = setup(svc);
    // The localized headline carries the meaning; an untranslated internal
    // string has no business on screen.
    expect(f.nativeElement.querySelector('.err-detail')).toBeNull();
    expect(f.nativeElement.querySelector('.err')).not.toBeNull();
    f.destroy();
  });

  it('keeps a broken preview visible as a stated failure with a retry', () => {
    const f = setup();
    const c = f.componentInstance;
    c.onBroken('abc123');
    f.detectChanges();
    const failed = f.nativeElement.querySelector('.tile-failed') as HTMLElement;
    expect(failed).not.toBeNull();

    const before = c.lowResFor(first.previewUrl, first.imageId);
    const ev = new MouseEvent('click', { cancelable: true, bubbles: true });
    (failed.querySelector('.tf-retry') as HTMLButtonElement).dispatchEvent(ev);
    f.detectChanges();

    // The tile is an anchor to the CDN original — a retry must not navigate.
    expect(ev.defaultPrevented).toBeTrue();
    expect(c.broken().has('abc123')).toBeFalse();
    // A changed url is what makes the browser re-run its selection; a fragment
    // does that without altering the request the CDN actually receives.
    expect(c.lowResFor(first.previewUrl, first.imageId)).not.toBe(before);
    expect(c.lowResFor(first.previewUrl, first.imageId).split('#')[0]).toBe(before);
    f.destroy();
  });

  it('never demotes a tile that already painted to "broken"', () => {
    const f = setup();
    const c = f.componentInstance;
    c.onLoad('abc123');
    c.onBroken('abc123');
    expect(c.broken().has('abc123')).toBeFalse();
    f.destroy();
  });

  it('says the pictures are not arriving once the rows have waited long enough', fakeAsync(() => {
    const f = setup();
    expect(f.componentInstance.imagesStalled()).toBeFalse();
    tick(21000);
    f.detectChanges();
    expect(f.componentInstance.imagesStalled()).toBeTrue();
    expect(f.nativeElement.querySelector('.stalled')).not.toBeNull();
    f.destroy();
  }));

  it('stays quiet when a preview did arrive, however slowly', fakeAsync(() => {
    const f = setup();
    f.componentInstance.onLoad('abc123');
    tick(21000);
    f.detectChanges();
    expect(f.componentInstance.imagesStalled()).toBeFalse();
    expect(f.nativeElement.querySelector('.stalled')).toBeNull();
    f.destroy();
  }));

  /* ---------------------------------------------------------------- *
   * Thumbs-up + "Top 7 only" (admin feedback 058468f7).
   * ---------------------------------------------------------------- */

  it('puts the thumbs-up NEXT TO the tile link, never inside it', () => {
    const f = setup();
    const button = f.nativeElement.querySelector('sc-vote-button .vote') as HTMLButtonElement;
    expect(button).not.toBeNull();
    // A <button> nested in the tile's <a> would be invalid HTML and would eat
    // the anchor's middle-click / "open in new tab" behaviour.
    expect(button.closest('a')).toBeNull();
    expect(button.closest('.tile-wrap')).not.toBeNull();
    expect(button.tagName).toBe('BUTTON');
    f.destroy();
  });

  it('votes on click without following the tile link', () => {
    const votes = votesStub();
    const f = setup(serviceStub([first]), {}, votes);
    const button = f.nativeElement.querySelector('sc-vote-button .vote') as HTMLButtonElement;
    const ev = new MouseEvent('click', { cancelable: true, bubbles: true });
    button.dispatchEvent(ev);
    expect(votes.toggle).toHaveBeenCalledWith('abc123');
    expect(ev.defaultPrevented).toBeTrue();
    f.destroy();
  });

  it('shows the public tally to a signed-out visitor but disables the vote', () => {
    const votes = votesStub({ canVote: false, counts: { abc123: 3 } });
    const f = setup(serviceStub([first]), {}, votes);
    const button = f.nativeElement.querySelector('sc-vote-button .vote') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-label')).toContain('starscape.vote.signedOut');
    expect(button.textContent).toContain('3');
    f.destroy();
  });

  it('marks a cast vote as pressed so it reads as state, not decoration', () => {
    const votes = votesStub({ counts: { abc123: 1 }, mine: ['abc123'] });
    const f = setup(serviceStub([first]), {}, votes);
    const button = f.nativeElement.querySelector('sc-vote-button .vote') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList).toContain('voted');
    // Kept visible on desktop too - otherwise you cannot see what you liked
    // without hovering every tile.
    expect((button.closest('sc-vote-button') as HTMLElement).classList).toContain('is-voted');
    f.destroy();
  });

  /* ---------------------------------------------------------------- *
   * The tally is EVERYBODY'S (admin feedback bfd2149a).
   * ---------------------------------------------------------------- */

  it('shows the public tally even at zero, so a missing count cannot pass for none', () => {
    const f = setup(serviceStub([first]), {}, votesStub({ counts: {} }));
    const button = f.nativeElement.querySelector('sc-vote-button .vote') as HTMLButtonElement;
    expect(button.querySelector('.vote-count')).not.toBeNull();
    expect(button.textContent).toContain('0');
    expect(button.getAttribute('aria-label')).toContain('starscape.vote.totalNone');
    f.destroy();
  });

  it("says the number is everyone's total, and separately that the caller voted", () => {
    const votes = votesStub({ counts: { abc123: 5 }, mine: ['abc123'] });
    const f = setup(serviceStub([first]), {}, votes);
    const button = f.nativeElement.querySelector('sc-vote-button .vote') as HTMLButtonElement;
    const label = button.getAttribute('aria-label') ?? '';
    // The count phrase and the "your vote is included" phrase are distinct: the
    // whole complaint was that one bare digit cannot say which of the two it is.
    expect(label).toContain('starscape.vote.total');
    expect(label).toContain('starscape.vote.mine');
    // Hover has no touch equivalent, so the number itself stays on the button.
    expect(button.textContent).toContain('5');
    // title mirrors aria-label - the tooltip is the desktop surface for it.
    expect(button.getAttribute('title')).toBe(label);
    f.destroy();
  });

  it("singular tally does not read '1 votes'", () => {
    const f = setup(serviceStub([first]), {}, votesStub({ counts: { abc123: 1 } }));
    const button = f.nativeElement.querySelector('sc-vote-button .vote') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toContain('starscape.vote.totalOne');
    f.destroy();
  });

  it('keeps the ranking tallies visible without hover while Top-N is on', () => {
    const votes = votesStub({ counts: { top001: 4 } });
    votes.topOnly.set(true);
    votes.topWallpapers.set([wallpaper('top001')]);
    const f = setup(serviceStub([first]), {}, votes);
    const host = f.nativeElement.querySelector('sc-vote-button.tile-vote') as HTMLElement;
    // Hovering seven tiles one by one is not a way to check whether the Top 7
    // reflects everyone's votes.
    expect(host.classList).toContain('always-on');
    expect(host.textContent).toContain('4');
    f.destroy();
  });

  it('persists the Top-N toggle through the service rather than locally', () => {
    const votes = votesStub();
    const f = setup(serviceStub([first]), {}, votes);
    const toggle = f.nativeElement.querySelector('.top-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    expect(votes.setTopOnly).toHaveBeenCalledWith(true);
    f.destroy();
  });

  it('paints the server-side ranking (not the paged list) while Top-N is on', () => {
    const votes = votesStub();
    votes.topOnly.set(true);
    votes.topWallpapers.set([wallpaper('top001')]);
    const svc = serviceStub([first]);
    svc.hasMore.set(true);
    const f = setup(svc, {}, votes);
    const tiles = f.nativeElement.querySelectorAll('.tile-wrap');
    expect(tiles.length).toBe(1);
    expect((tiles[0].querySelector('.tile') as HTMLAnchorElement).getAttribute('aria-label'))
      .toBe('Wallpaper top001');
    // A ranked Top-N is a complete list - "load more" would contradict it.
    expect(f.nativeElement.querySelector('.more')).toBeNull();
    // Series chips filter the whole gallery; the ranking is global by definition.
    expect(f.nativeElement.querySelector('.filter-bar')).toBeNull();
    f.destroy();
  });
});
