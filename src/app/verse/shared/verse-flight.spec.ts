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
  });

  afterEach(() => delete document.documentElement.dataset['verseFlight']);

  const settle = async (h: RouterTestingHarness) => {
    await h.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 20));
  };

  it('hub → subpage: names the hub planet while the hub is captured, then cleans up', async () => {
    const h = await RouterTestingHarness.create('/verse');
    expect(start).not.toHaveBeenCalled();
    await h.navigateByUrl('/verse/news');
    await settle(h);
    expect(start).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({ name: 'verse-emblem', dir: 'down' });
    finish();
    await settle(h);
    expect(document.documentElement.dataset['verseFlight']).toBeUndefined();
  });

  it('subpage → hub: flies back and names the hub planet for the new capture', async () => {
    const h = await RouterTestingHarness.create('/verse/news');
    await h.navigateByUrl('/verse');
    await settle(h);
    expect(start).toHaveBeenCalledTimes(1);
    expect(seen[0].dir).toBe('up');
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
});
