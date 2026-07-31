import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { StarscapeComponent } from './starscape.component';
import { StarscapeService, Wallpaper } from './starscape.service';

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

describe('StarscapeComponent', () => {
  const first = wallpaper('abc123');

  function configure(
    svc: ReturnType<typeof serviceStub>,
    queryParams: Record<string, string> = {},
  ): void {
    TestBed.configureTestingModule({
      imports: [StarscapeComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: StarscapeService, useValue: svc },
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
  ): ComponentFixture<StarscapeComponent> {
    configure(svc, queryParams);
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
    expect(source.media).toBe('(max-width: 900px)');
    expect(source.getAttribute('srcset')).toBe(
      'https://media.robertsspaceindustries.com/abc123/post.jpg',
    );
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
});
