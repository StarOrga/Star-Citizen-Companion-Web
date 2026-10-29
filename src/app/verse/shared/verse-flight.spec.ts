import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { VerseFlight, verseFlightResolver } from './verse-flight';
import { verseFlightOf, verseFrameOf, verseWorldOf } from './verse-world';

@Component({ template: '<span class="src" data-verse-fly="news" style="display:block;width:40px;height:40px"></span>' })
class HubStub {}

@Component({ template: '<span class="emb" style="display:block;width:64px;height:64px;view-transition-name:verse-emblem"></span>' })
class PageStub {}

describe('verse-world', () => {
  it('knows the frame of a URL — only the page itself, not overlays below it', () => {
    expect(verseFrameOf('/verse')).toBe('hub');
    expect(verseFrameOf('/verse/?x=1')).toBe('hub');
    expect(verseFrameOf('/verse/news?filter=yt')).toBe('news');
    expect(verseFrameOf('/verse/explorer')).toBe('starmap');
    expect(verseFrameOf('/verse/news/abc')).toBeNull();
    expect(verseFrameOf('/hq')).toBeNull();
    expect(verseWorldOf('/verse/patches/4.3')).toBe('patches');
    expect(verseWorldOf('/verse')).toBeNull();
  });

  it('picks the flight direction', () => {
    expect(verseFlightOf('/verse', '/verse/news')).toBe('down');
    expect(verseFlightOf('/verse/news', '/verse')).toBe('up');
    expect(verseFlightOf('/verse/patches', '/verse/explorer')).toBe('side');
    expect(verseFlightOf('/verse/news', '/verse/news?x=1')).toBeNull();
    expect(verseFlightOf('/hq', '/verse/news')).toBeNull();
    expect(verseFlightOf(null, '/verse/news')).toBeNull();
  });
});

describe('VerseFlight', () => {
  let finish: () => void;
  let seen: { name: string; dir: string | undefined }[];
  let start: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'verse', component: HubStub, resolve: { f: verseFlightResolver } },
          { path: 'verse/news', component: PageStub, resolve: { f: verseFlightResolver } },
          { path: 'other', component: PageStub },
        ]),
      ],
    });
    seen = [];
    // The browser part: capture what the old page carries, run the update, finish on demand.
    start = spyOn(document, 'startViewTransition').and.callFake(((cb: () => Promise<void>) => {
      const src = document.querySelector<HTMLElement>('.src');
      seen.push({ name: src?.style.getPropertyValue('view-transition-name') ?? '', dir: document.documentElement.dataset['verseFlight'] });
      const done = Promise.resolve().then(() => cb());
      const finished = new Promise<void>((r) => (finish = r));
      return { ready: done, updateCallbackDone: done, finished, skipTransition: () => undefined } as unknown as ViewTransition;
    }) as typeof document.startViewTransition);
    const flight = TestBed.inject(VerseFlight);
    flight.reducedMotion = () => false;
    flight.hidden = () => false;
    flight.enabled = () => true;
    flight.aimMs = 0;
  });

  afterEach(() => {
    delete document.documentElement.dataset['verseFlight'];
    delete document.documentElement.dataset['verseAim'];
  });

  const settle = async (h: RouterTestingHarness) => {
    await h.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 20));
  };

  it('hub → subpage: dives (no emblem name on the hub tile), streaks layer while running, then cleans up', async () => {
    const h = await RouterTestingHarness.create('/verse');
    expect(start).not.toHaveBeenCalled();
    await h.navigateByUrl('/verse/news');
    await settle(h);
    expect(start).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({ name: '', dir: 'down' });
    expect(document.querySelector('.sc-flight-streaks')).not.toBeNull();
    finish();
    await settle(h);
    expect(document.documentElement.dataset['verseFlight']).toBeUndefined();
    expect(document.documentElement.dataset['verseAim']).toBeUndefined();
    expect(document.querySelector('.sc-flight-streaks')).toBeNull();
  });

  it('hub → subpage: aims at the clicked tile first (origin + highlighted world), then starts the transition', async () => {
    const flight = TestBed.inject(VerseFlight);
    flight.aimMs = 60;
    const h = await RouterTestingHarness.create('/verse');
    const src = document.querySelector<HTMLElement>('.src')!;
    src.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const nav = h.navigateByUrl('/verse/news');
    await new Promise((r) => setTimeout(r, 20));
    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement.dataset['verseAim']).toBe('news');
    expect(document.documentElement.style.getPropertyValue('--vf-ox')).toMatch(/^\d+px$/);
    await nav;
    await settle(h);
    expect(start).toHaveBeenCalledTimes(1);
    finish();
    await settle(h);
    expect(document.documentElement.dataset['verseAim']).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--vf-ox')).toBe('');
  });

  it('subpage → hub: flies back and names the hub planet for the new capture', async () => {
    const h = await RouterTestingHarness.create('/verse/news');
    await h.navigateByUrl('/verse');
    await settle(h);
    expect(start).toHaveBeenCalledTimes(1);
    expect(seen[0].dir).toBe('up');
    expect(document.documentElement.dataset['verseAim']).toBe('news');
    expect(document.querySelector<HTMLElement>('.src')!.style.getPropertyValue('view-transition-name')).toBe('verse-emblem');
    finish();
    await settle(h);
    expect(document.querySelector<HTMLElement>('.src')!.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('no flight outside the frame, on a query change or under reduced motion', async () => {
    const h = await RouterTestingHarness.create('/other');
    await h.navigateByUrl('/verse/news');
    await h.navigateByUrl('/verse/news?x=1');
    expect(start).not.toHaveBeenCalled();
    TestBed.inject(VerseFlight).reducedMotion = () => true;
    await h.navigateByUrl('/verse');
    expect(start).not.toHaveBeenCalled();
  });

  it('no flight with the Verse β off: the legacy pages have no emblem to land on', async () => {
    TestBed.inject(VerseFlight).enabled = () => false;
    const h = await RouterTestingHarness.create('/verse');
    await h.navigateByUrl('/verse/news');
    await settle(h);
    expect(start).not.toHaveBeenCalled();
  });
});
