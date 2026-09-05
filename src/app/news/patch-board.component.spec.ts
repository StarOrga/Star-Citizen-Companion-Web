import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TranslateModule, TranslateService, TranslationObject } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ConsentService } from '../core/consent.service';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { PatchBoardComponent } from './patch-board.component';
import type { PatchOutline } from './patch-outline';
import type { RoadmapPayload } from './roadmap';
import { RoadmapService } from './roadmap.service';

/**
 * The board as rendered (rethink Ⓚ, 2026-09-04): a time stack with three
 * cards open, the older lines folded, status as a word, and a search that
 * finds PATCHES. `/news/patches` sits behind the auth guard, so this DOM
 * assertion is the only place the template is exercised before a human
 * sees it — which is why it renders with the REAL German bundle.
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
    note('p410', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12504217', '2026-08-03T10:00:00Z'),
    note('l49', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-09T18:00:00Z'),
    note('l48', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-06-12T18:00:00Z'),
    note('l47', 'Star Citizen Alpha 4.7 LIVE Release Notes', '2026-03-20T18:00:00Z'),
  ],
} as unknown as VerseFeed;

const ROADMAP: RoadmapPayload = {
  current: { id: 'c', name: '4.10', quarter: 'Q3 2026', status: 'released', patchLine: '4.10', cards: [
    { id: 'orison', slug: 'orison', name: 'Siege of Orison', description: 'V2', body: '', status: 'released', category: 'Gameplay', thumbnail: null },
  ] },
  next: { id: 'n', name: '4.11', quarter: 'Q3 2026', status: 'tentative', patchLine: '4.11', cards: [
    { id: 'nyx', slug: 'nyx', name: 'Nyx I', description: '', body: '', status: 'tentative', category: 'Locations', thumbnail: null },
    { id: 'gen', slug: 'gen', name: 'Genesis: Starchitect', description: '', body: '', status: 'tentative', category: 'Core Tech', thumbnail: null },
  ] },
  later: [],
  liveVersion: '4.10',
  ptuVersion: '',
  boardUrl: 'https://robertsspaceindustries.com/roadmap',
  updatedAt: '',
};

const OUTLINE: PatchOutline = {
  slug: 'l410', subject: 'x', truncated: false, bulletCount: 1,
  nodes: [{ kind: 'heading', text: 'Features', depth: 0 }, { kind: 'bullet', text: 'Hydrogen & Quantum Fuel Rebalance', depth: 0 }],
};

/** A roadmap service with one loaded outline and no network. */
function roadmapStub(payload: RoadmapPayload | null) {
  const outlines = signal<ReadonlyMap<string, PatchOutline>>(new Map([['l410', OUTLINE]]));
  return {
    roadmap: signal(payload),
    loading: signal(false),
    unavailable: signal(payload === null),
    outlines,
    pending: signal<ReadonlySet<string>>(new Set()),
    hasRoadmap: () => payload !== null,
    loadedOutlineCount: () => outlines().size,
    loadRoadmap: () => Promise.resolve(),
    requestOutlines: () => undefined,
    hasOutline: (slug: string) => outlines().has(slug),
    outlineFor: (slug: string) => outlines().get(slug) ?? null,
    isPending: () => false,
    isMissing: () => false,
  };
}

describe('Patch board — the time stack (rethink Ⓚ)', () => {
  let fixture: ComponentFixture<PatchBoardComponent>;
  let de: TranslationObject;

  beforeAll(async () => {
    const res = await fetch('/i18n/de.json');
    expect(res.ok).withContext('public/i18n/de.json must be served to Karma').toBeTrue();
    de = await res.json();
  });

  async function render(feed: VerseFeed, roadmap: RoadmapPayload | null): Promise<void> {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PatchBoardComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        NewsService,
        { provide: HttpClient, useValue: { get: () => of(feed) } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
        { provide: RoadmapService, useValue: roadmapStub(roadmap) },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', de);
    translate.use('de');
    fixture = TestBed.createComponent(PatchBoardComponent);
    fixture.detectChanges();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    localStorage.clear();
  });

  const root = () => fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(root().querySelectorAll('.stack > .row:not(.fold)')) as HTMLElement[];

  it('opens with exactly three cards in time order — next, live, superseded — and folds the rest', async () => {
    await render(FEED, ROADMAP);
    expect(rows().map((r) => r.dataset['status'])).toEqual(['next', 'live', 'superseded']);
    expect(rows().map((r) => r.querySelector('.ver')?.textContent?.trim())).toEqual(['Alpha 4.11', 'Alpha 4.10', 'Alpha 4.9']);
    const fold = (root().querySelector('.fold-btn') as HTMLButtonElement | null);
    expect(fold).withContext('older lines are folded, not listed').not.toBeNull();
    expect(fold!.textContent).toContain('4.8');
    expect(fold!.textContent).toContain('4.7');
    // No chip filters beside the search — the stack is the selection.
    expect(root().querySelector('.patch-filter, .chip')).toBeNull();
  });

  it('says the status as a word, LIVE as the hero row, and every card is a real link into its dossier', async () => {
    await render(FEED, ROADMAP);
    const live = rows()[1];
    expect(live.classList.contains('hero')).toBeTrue();
    expect(live.querySelector('.status')?.textContent).toContain('Live');
    expect(rows()[0].querySelector('.status')?.textContent).toContain('Nächster');
    expect(rows()[2].querySelector('.status')?.textContent).toContain('Abgelöst');
    for (const row of rows()) {
      const a = (row.querySelector('a.card') as HTMLAnchorElement | null);
      expect(a).withContext('a card is an anchor').not.toBeNull();
      expect(a!.getAttribute('href')).toMatch(/^\/news\/patches\/4\.\d+$/);
    }
    // The live card carries hotfix count and note count; the next card its roadmap teaser.
    expect(live.textContent).toContain('1 Hotfix');
    expect(live.textContent).toContain('3 Notes');
    expect(rows()[0].querySelector('.teaser')?.textContent).toContain('Nyx I');
  });

  it('unfolds the older lines on demand', async () => {
    await render(FEED, ROADMAP);
    (root().querySelector('.fold-btn') as HTMLButtonElement | null)!.click();
    fixture.detectChanges();
    expect(rows().map((r) => r.querySelector('.ver')?.textContent?.trim())).toEqual(['Alpha 4.11', 'Alpha 4.10', 'Alpha 4.9', 'Alpha 4.8', 'Alpha 4.7']);
  });

  it('search finds PATCHES: cards with hits stay, annotated, and carry the query into the dossier link', async () => {
    await render(FEED, ROADMAP);
    const input = (root().querySelector('#patch-board-search') as HTMLInputElement | null)!;
    input.value = 'quantum';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rows().length).toBe(1);
    expect(rows()[0].querySelector('.ver')?.textContent?.trim()).toBe('Alpha 4.10');
    expect(rows()[0].querySelector('.hits')?.textContent).toContain('1 Stichpunkte');
    expect((rows()[0].querySelector('a.card') as HTMLAnchorElement | null)!.getAttribute('href')).toContain('q=quantum');

    input.value = 'nyx';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rows().map((r) => r.querySelector('.ver')?.textContent?.trim())).toEqual(['Alpha 4.11']);
  });

  it('still stacks without a roadmap: live and superseded, no next card', async () => {
    await render(FEED, null);
    expect(rows().map((r) => r.dataset['status'])).toEqual(['live', 'superseded']);
  });
});
