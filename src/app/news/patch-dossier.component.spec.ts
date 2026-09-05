import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TranslateModule, TranslateService, TranslationObject } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ConsentService } from '../core/consent.service';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { PatchDossierComponent } from './patch-dossier.component';
import type { PatchOutline } from './patch-outline';
import type { RoadmapPayload } from './roadmap';
import { RoadmapService } from './roadmap.service';

/**
 * The dossier as rendered (rethink Ⓚ): four question-named sections behind a
 * table of contents, the note's build facts as preparation tiles, the roadmap
 * cards carrying the note's matching bullets, the in-patch search with an
 * honest coverage line, and the cycle axis with its two bars.
 */

function note(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id,
    title,
    url: `https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/${id}`,
    publishedAt,
    channel: 'patch',
    source: 'patch-notes',
  };
}

const FEED = {
  status: null,
  fetchedAt: new Date().toISOString(),
  news: [
    note('l410', 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-08-27T18:00:00Z'),
    note('h410', 'Star Citizen Alpha 4.10 LIVE - Hotfix Central (Updated 9.3.2026)', '2026-09-03T12:00:00Z'),
    note('p410a', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12479687', '2026-08-03T10:00:00Z'),
    note('p410b', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12490000', '2026-08-10T10:00:00Z'),
    note('p410c', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12504217', '2026-08-25T10:00:00Z'),
    note('l49', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-09T18:00:00Z'),
    note('p49', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes 12107679', '2026-06-18T10:00:00Z'),
    note('l48', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-06-12T18:00:00Z'),
  ],
} as unknown as VerseFeed;

const ROADMAP: RoadmapPayload = {
  current: { id: 'c', name: '4.10', quarter: 'Q3 2026', status: 'released', patchLine: '4.10', cards: [
    { id: 'orison', slug: 'orison', name: 'Siege of Orison', description: 'The event returns as V2.', body: 'Long text about Orison.', status: 'released', category: 'Gameplay', thumbnail: null },
    { id: 'fuel', slug: 'fuel', name: 'Fuel Tanks and Consumption Rebalance', description: '', body: '', status: 'released', category: 'Gameplay', thumbnail: null },
  ] },
  next: null,
  later: [],
  liveVersion: '4.10',
  ptuVersion: '',
  boardUrl: 'https://robertsspaceindustries.com/roadmap',
  updatedAt: '',
};

const LIVE_OUTLINE: PatchOutline = {
  slug: 'l410', subject: 'Star Citizen Alpha 4.10 LIVE Release Notes', truncated: false, bulletCount: 6,
  nodes: [
    { kind: 'heading', text: 'Star Citizen Alpha Patch 4.10 LIVE', depth: 0 },
    { kind: 'subheading', text: 'Important Build Info', depth: 0 },
    { kind: 'bullet', text: 'Long Term Persistence: Preserved', depth: 0 },
    { kind: 'bullet', text: 'Starting aUEC: 20,000', depth: 0 },
    { kind: 'heading', text: 'Features and Gameplay', depth: 0 },
    { kind: 'subheading', text: 'Gameplay', depth: 0 },
    { kind: 'bullet', text: 'Siege of Orison V2', depth: 0 },
    { kind: 'bullet', text: 'Loot Generation & Drop Rates', depth: 0 },
    { kind: 'subheading', text: 'Ships & Vehicles', depth: 0 },
    { kind: 'bullet', text: 'Hydrogen & Quantum Fuel Rebalance', depth: 0 },
    { kind: 'heading', text: 'Known Issues', depth: 0 },
    { kind: 'bullet', text: 'Quantum travel may desync in a party of 4+', depth: 0 },
  ],
};

function roadmapStub(payload: RoadmapPayload | null) {
  const outlines = signal<ReadonlyMap<string, PatchOutline>>(new Map([['l410', LIVE_OUTLINE]]));
  const requested: string[][] = [];
  return {
    requested,
    roadmap: signal(payload),
    loading: signal(false),
    unavailable: signal(payload === null),
    outlines,
    pending: signal<ReadonlySet<string>>(new Set()),
    hasRoadmap: () => payload !== null,
    loadedOutlineCount: () => outlines().size,
    loadRoadmap: () => Promise.resolve(),
    requestOutlines: (slugs: string[]) => { requested.push([...slugs]); },
    hasOutline: (slug: string) => outlines().has(slug),
    outlineFor: (slug: string) => outlines().get(slug) ?? null,
    isPending: () => false,
    isMissing: () => false,
  };
}

describe('Patch dossier — one patch, opened (rethink Ⓚ)', () => {
  let fixture: ComponentFixture<PatchDossierComponent>;
  let stub: ReturnType<typeof roadmapStub>;
  let de: TranslationObject;

  beforeAll(async () => {
    const res = await fetch('/i18n/de.json');
    expect(res.ok).toBeTrue();
    de = await res.json();
  });

  async function render(line: string, q = '', roadmap: RoadmapPayload | null = ROADMAP): Promise<void> {
    localStorage.clear();
    TestBed.resetTestingModule();
    stub = roadmapStub(roadmap);
    TestBed.configureTestingModule({
      imports: [PatchDossierComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        NewsService,
        { provide: HttpClient, useValue: { get: () => of(FEED) } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
        { provide: RoadmapService, useValue: stub },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', de);
    translate.use('de');
    // The feed is what the dossier resolves its line against.
    await TestBed.inject(NewsService).refresh();
    fixture = TestBed.createComponent(PatchDossierComponent);
    fixture.componentRef.setInput('line', line);
    fixture.componentRef.setInput('q', q);
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    document.body.style.overflow = '';
    localStorage.clear();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const text = (sel: string) => root().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('renders the live patch with all four sections behind a table of contents', async () => {
    await render('4.10');
    expect(text('.hero h2')).toBe('Alpha 4.10');
    expect(text('.hero .status')).toBe('Live');
    expect((Array.from(root().querySelectorAll('.toc-link')) as HTMLElement[]).map((a) => a.textContent?.trim())).toEqual([
      'Wie bereite ich mich vor?', 'Was steckt drin?', 'Haben sie … gefixt?', 'Wann kommt der nächste?',
    ]);
    expect(root().querySelector('#pd-prep')).not.toBeNull();
    expect(root().querySelector('#pd-contents')).not.toBeNull();
    expect(root().querySelector('#pd-fixed')).not.toBeNull();
    expect(root().querySelector('#pd-next')).not.toBeNull();
    // Opening the overlay locks the page behind it.
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('reads the preparation facts and known issues out of the note', async () => {
    await render('4.10');
    const tiles = (Array.from(root().querySelectorAll('#pd-prep .prep li')) as HTMLElement[]);
    expect(tiles.map((t) => t.querySelector('.pk-label')?.textContent)).toEqual(['Long Term Persistence', 'Starting aUEC']);
    expect(tiles[0].getAttribute('data-tone')).toBe('kept');
    expect(text('#pd-prep')).toContain('Bekannte Probleme');
    expect(text('#pd-prep')).toContain('Quantum travel may desync');
    expect(root().querySelector('.wipe-tag')).toBeNull();
  });

  it('puts the note bullets ON the matching roadmap cards and keeps the rest in a leftover line', async () => {
    await render('4.10');
    const cards = (Array.from(root().querySelectorAll('#pd-contents .fc')) as HTMLElement[]);
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Siege of Orison V2');
    expect(cards[1].textContent).toContain('Hydrogen & Quantum Fuel Rebalance');
    expect(text('#pd-contents .leftover summary')).toContain('(1)');
    expect(text('#pd-contents .leftover')).toContain('Loot Generation');
    // Long text opens per card.
    (cards[0].querySelector('.more') as HTMLButtonElement | null)!.click();
    fixture.detectChanges();
    expect(cards[0].textContent).toContain('Long text about Orison.');
  });

  it('search inside the patch: hits in context, honest coverage, and a way to load the rest', async () => {
    await render('4.10', 'quantum');
    const hits = (Array.from(root().querySelectorAll('#pd-fixed .hits li')) as HTMLElement[]);
    expect(hits.length).toBe(2);
    expect(hits[0].textContent).toContain('Features and Gameplay › Ships & Vehicles');
    expect(root().querySelector('#pd-fixed mark')).not.toBeNull();
    expect(text('#pd-fixed .coverage')).toContain('1 von 5 Notes');
    (root().querySelector('#pd-fixed .coverage .pill-btn') as HTMLButtonElement | null)!.click();
    expect(stub.requested.some((s) => s.length === 5)).withContext('load-the-rest asks for every note of the line').toBeTrue();
    // Every note stays reachable underneath, the three waves folded into one row.
    expect(text('#pd-fixed .all-notes summary')).toContain('Alle Notes (5)');
    expect(text('#pd-fixed .wave summary')).toContain('3 Build-Wellen');
  });

  it('draws the cycle from one anchor: a usual bar behind, the real bar in front, and keeps the old charts folded away', async () => {
    await render('4.10');
    const axis = root().querySelector('#pd-next .axis')!;
    expect(axis.querySelector('.bar.real:not(.lead)')).not.toBeNull();
    expect(axis.querySelector('.bar.usual:not(.lead)')).withContext('a live line projects the usual next release').not.toBeNull();
    expect(axis.querySelector('.bar.real.lead')).withContext('the test phase is measured retrospectively').not.toBeNull();
    expect((Array.from(axis.querySelectorAll('.pt')) as HTMLElement[]).map((p) => p.getAttribute('data-key'))).toEqual(['prevLive', 'firstTest', 'live', 'hotfix', 'now', 'usual']);
    expect(text('#pd-next .sentence')).toContain('ist seit');
    expect(text('#pd-next .facts')).toContain('Test → Live: 24 Tage');
    expect(text('#pd-next .facts')).toContain('1 Hotfix seit Live');
    const charts = root().querySelector('#pd-next details.charts') as HTMLDetailsElement | null;
    expect(charts!.open).toBeFalse();
    expect(charts!.querySelector('sc-patch-cadence')).not.toBeNull();
  });

  it('a superseded line is a finished stretch ending on its successor, with no usual marker and no today', async () => {
    await render('4.9');
    expect(text('.hero .status')).toBe('Abgelöst');
    const keys = (Array.from(root().querySelectorAll('#pd-next .pt')) as HTMLElement[]).map((p) => p.getAttribute('data-key'));
    expect(keys).toContain('nextLive');
    expect(keys).not.toContain('usual');
    expect(keys).not.toContain('now');
    expect(text('#pd-next .sentence')).toContain('von Alpha 4.10 abgelöst');
    // No roadmap for 4.9 → the note itself is what the contents section holds.
    expect(root().querySelector('#pd-contents sc-patch-note-detail')).not.toBeNull();
  });

  it('an unknown line does not crash — it says so and offers the way back', async () => {
    await render('3.0');
    expect(text('.hero .state')).toContain('keine Patch-Daten');
    expect(root().querySelector('a.close')).not.toBeNull();
  });
});
