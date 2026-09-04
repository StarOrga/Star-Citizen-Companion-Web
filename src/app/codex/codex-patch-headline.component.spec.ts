import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexPatchHeadlineComponent } from './codex-patch-headline.component';
import { CodexService } from './codex.service';
import { PatchTimelineEntry, buildPatchTimeline } from './codex-patch-timeline';
import { CodexBuild } from './codex.types';
import { NewsService } from '../news/news.service';
import { PatchLineGroup } from '../news/patch-notes';

function build(patch: string, over: Partial<CodexBuild> = {}): CodexBuild {
  return {
    id: `build-${patch}`,
    channel: 'LIVE',
    patchVersion: patch,
    buildNumber: 'desktop',
    schemaVersion: 1,
    qualityScore: null,
    toolVersion: null,
    entityCounts: { ships: 300, items: 700 },
    isCurrent: false,
    extractedAt: '2026-08-02T20:29:00Z',
    ...over,
  };
}

describe('CodexPatchHeadlineComponent', () => {
  let selectSpy: jasmine.Spy;
  let timeline: ReturnType<typeof signal<readonly PatchTimelineEntry[]>>;
  let active: ReturnType<typeof signal<CodexBuild | null>>;

  async function setup(opts: {
    builds?: CodexBuild[];
    uploaded?: string[];
    /** Patch lines RSI has taken LIVE, as the Verse-News feed reports them. */
    published?: string[];
    live?: string;
    stale?: boolean;
  } = {}): Promise<ComponentFixture<CodexPatchHeadlineComponent>> {
    const builds = opts.builds ?? [build('4.2'), build('4.1')];
    const livePatch = opts.live ?? builds[0]?.patchVersion ?? null;
    const liveBuild = builds.find((b) => b.patchVersion === livePatch) ?? null;

    active = signal<CodexBuild | null>(liveBuild);
    timeline = signal<readonly PatchTimelineEntry[]>([]);
    const entries = buildPatchTimeline(builds, opts.uploaded ?? []);

    selectSpy = jasmine.createSpy('selectBuild').and.callFake((b: CodexBuild | null) => {
      const target = b ?? liveBuild;
      if (!target || target.id === active()?.id) return false;
      active.set(target);
      return true;
    });

    const codex: Partial<CodexService> = {
      build: active as never,
      liveBuild: signal(liveBuild) as never,
      stale: signal(opts.stale ?? false) as never,
      viewingPastPatch: computed(() => !!liveBuild && active()?.id !== liveBuild.id) as never,
      patchTimeline: timeline as never,
      loadPatchTimeline: jasmine
        .createSpy('loadPatchTimeline')
        .and.callFake(async () => {
          timeline.set(entries);
          return entries;
        }),
      selectBuild: selectSpy as never,
    };

    await TestBed.configureTestingModule({
      imports: [CodexPatchHeadlineComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        // The switch reads the patch lines the shell's status chip already
        // holds — never its own request, so a stub signal is the whole surface.
        {
          provide: NewsService,
          useValue: {
            patchLines: signal<PatchLineGroup[]>(
              (opts.published ?? []).map((line) => ({ line, hasLive: true }) as PatchLineGroup),
            ),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CodexPatchHeadlineComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  async function openSwitch(fixture: ComponentFixture<CodexPatchHeadlineComponent>): Promise<void> {
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('.patch-trigger')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('carries the live patch as the headline, and nothing about playability', async () => {
    const fixture = await setup();
    const el: HTMLElement = fixture.nativeElement;

    // Round two of 463872dd: the header chip already says "Spielbar" on every
    // page, so this line is the patch and only the patch.
    expect(el.querySelector('.status-online')).toBeNull();
    expect(el.querySelector('.live-dot')).toBeNull();
    expect(el.querySelector('.status-pill .status-patch')).not.toBeNull();
    expect(el.querySelector('.patch-trigger')?.getAttribute('aria-expanded')).toBe('false');
    // Resting control: nothing loaded, nothing shown.
    expect(el.querySelector('.patch-pop')).toBeNull();
    expect(TestBed.inject(CodexService).loadPatchTimeline).not.toHaveBeenCalled();
  });

  it('loads the patch list on the FIRST open and caps it at the last three', async () => {
    const patches = ['4.9', '4.8', '4.7', '4.6', '4.5', '4.4', '4.3'];
    const fixture = await setup({ builds: patches.map((p) => build(p)) });
    await openSwitch(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(TestBed.inject(CodexService).loadPatchTimeline).toHaveBeenCalled();
    const rows = Array.from(el.querySelectorAll<HTMLElement>('.patch-row .row-ver'));
    expect(rows.map((r) => r.textContent?.trim())).toEqual(['4.9', '4.8', '4.7']);
    // Three and only three: the pager went with the cap (f68c6c6b).
    expect(el.querySelector('.patch-more')).toBeNull();
  });

  it('lists a patch RSI shipped without a data upload, greyed out and inert', async () => {
    const fixture = await setup({
      builds: [build('4.9'), build('4.8')],
      published: ['4.10', '4.9', '4.8'],
      live: '4.9',
    });
    await openSwitch(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.patch-row'));
    expect(rows.map((r) => r.querySelector('.row-ver')?.textContent?.trim())).toEqual([
      '4.10', '4.9', '4.8',
    ]);
    // The newer patch is visible but unreachable — and says so in words, not
    // by dimming alone.
    const newer = rows[0];
    expect(newer.classList).toContain('nodata');
    expect(newer.disabled).toBeTrue();
    expect(newer.getAttribute('aria-disabled')).toBe('true');
    expect(newer.querySelector('.row-data')?.textContent).toContain('patchSwitch.noData');
    expect(rows[1].disabled).toBeFalse();
    expect(rows[1].getAttribute('aria-disabled')).toBe('false');
  });

  it('never says "Live" anywhere in the switch (f68c6c6b)', async () => {
    const fixture = await setup({
      builds: [build('4.9'), build('4.8')],
      published: ['4.10'],
      live: '4.9',
    });
    await openSwitch(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.row-tag')).toBeNull();
    expect(el.textContent).not.toContain('patchSwitch.live');
    expect(el.textContent).not.toContain('backToLive');
  });

  it('marks which patches have codex data and makes the data-less ones unselectable', async () => {
    const fixture = await setup({
      builds: [build('4.2'), build('4.1', { entityCounts: {} })],
      uploaded: ['4.3'],
      live: '4.2',
    });
    await openSwitch(fixture);
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.patch-row'),
    );

    const byVersion = new Map(rows.map((r) => [r.querySelector('.row-ver')!.textContent!.trim(), r]));
    // Uploaded but never ingested: listed, marked, and inert.
    const missing = byVersion.get('4.3')!;
    expect(missing.disabled).toBeTrue();
    expect(missing.classList).toContain('nodata');
    expect(missing.querySelector('.row-data')?.textContent).toContain('patchSwitch.noData');
    // With data: selectable, and the marking states the record count.
    const withData = byVersion.get('4.2')!;
    expect(withData.disabled).toBeFalse();
    expect(withData.querySelector('.row-data')?.classList).toContain('has');
    expect(withData.querySelector('.row-data')?.textContent).toContain('patchSwitch.hasDataCount');
    expect(withData.getAttribute('aria-selected')).toBe('true');
    // Counts unknown (empty entity_counts) still reads as "data available".
    expect(byVersion.get('4.1')?.querySelector('.row-data')?.textContent).toContain(
      'patchSwitch.hasData',
    );
  });

  it('switches the codex to the picked patch, closes, and tells the host to reload', async () => {
    const fixture = await setup({ builds: [build('4.2'), build('4.1')], live: '4.2' });
    const reloads = jasmine.createSpy('reload');
    fixture.componentInstance.patchChange.subscribe(reloads);
    await openSwitch(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const older = Array.from(el.querySelectorAll<HTMLButtonElement>('.patch-row')).find(
      (r) => r.querySelector('.row-ver')?.textContent?.trim() === '4.1',
    )!;
    older.click();
    fixture.detectChanges();

    expect(selectSpy).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'build-4.1' }));
    expect(reloads).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.patch-pop')).toBeNull();
    // Viewing an older patch is said out loud, and offers the way back.
    expect(el.querySelector('.patch-past')).not.toBeNull();
    await openSwitch(fixture);
    expect(el.querySelector('.patch-back')?.textContent).toContain('patchSwitch.backToCurrent');

    el.querySelector<HTMLButtonElement>('.patch-back')!.click();
    fixture.detectChanges();
    expect(selectSpy).toHaveBeenCalledWith(null);
    expect(reloads).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.patch-past')).toBeNull();
  });

  it('does nothing at all when a data-less patch is activated programmatically', async () => {
    const fixture = await setup({ builds: [build('4.2')], uploaded: ['4.3'], live: '4.2' });
    const reloads = jasmine.createSpy('reload');
    fixture.componentInstance.patchChange.subscribe(reloads);
    await openSwitch(fixture);

    const entry = fixture.componentInstance.visible().find((e) => e.patchVersion === '4.3')!;
    fixture.componentInstance.choose(entry);
    fixture.detectChanges();

    expect(selectSpy).not.toHaveBeenCalled();
    expect(reloads).not.toHaveBeenCalled();
  });

  it('keeps the stale-catalog hint reachable from the merged pill', async () => {
    const fixture = await setup({ stale: true });
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.status-pill')?.classList).toContain('stale');
    expect(el.querySelector<HTMLAnchorElement>('.status-stale')?.getAttribute('href')).toContain(
      '/uploader',
    );
  });
});
