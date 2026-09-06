import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TranslateModule, TranslateService, TranslationObject } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ConsentService } from '../core/consent.service';
import { NewsService, VerseFeed, VerseNewsItem } from './news.service';
import { PatchBoardComponent } from './patch-board.component';
import { PatchStabilityService } from './patch-stability.service';
import { StabilityVerdict, stabilityPercent, toneOf } from './patch-stability';
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
    { id: '1543', slug: 'Siege-Of-Orison', name: 'Siege of Orison', description: 'V2', body: '', status: 'released', category: 'Gameplay', thumbnail: null },
    { id: '1551', slug: 'Super-Heavy-Combat-Armor', name: 'Super Heavy Combat Armor', description: '', body: '', status: 'released', category: 'Characters', thumbnail: null },
  ] },
  next: { id: 'n', name: '4.11', quarter: 'Q3 2026', status: 'tentative', patchLine: '4.11', cards: [
    { id: '1589', slug: 'Nyx-I', name: 'Nyx I', description: '', body: '', status: 'tentative', category: 'Locations', thumbnail: null },
    { id: '1599', slug: 'Genesis-Starchitect', name: 'Genesis: Starchitect', description: '', body: '', status: 'tentative', category: 'Core Tech', thumbnail: null },
  ] },
  later: [],
  liveVersion: '4.10',
  ptuVersion: '',
  boardUrl: 'https://robertsspaceindustries.com/roadmap',
  updatedAt: '',
};

/**
 * A next release with a full roadmap: ten items, nine of them with a picture,
 * and the picture-less one FIRST — so "pictures lead the strip" is visible in
 * the rendered order rather than an accident of the payload.
 */
const ROADMAP_MANY: RoadmapPayload = {
  ...ROADMAP,
  next: {
    id: 'n', name: '4.11', quarter: 'Q3 2026', status: 'tentative', patchLine: '4.11',
    cards: [
      { id: 'x1', slug: 'No-Art', name: 'Ohne Bild', description: '', body: '', status: 'tentative', category: 'Core Tech', thumbnail: null },
      ...['Nyx I', 'Genesis: Starchitect', 'Kastak Arms Verdict', 'Tiburon Offerings', 'Engineering', 'Base Building', 'Pyro Outposts', 'Volumetric Clouds', 'Item Recovery'].map((name, i) => ({
        id: `r${i + 1}`, slug: `slug-${i + 1}`, name, description: '', body: '',
        status: 'tentative' as const, category: 'Gameplay', thumbnail: `https://cdn.example/r${i + 1}.jpg`,
      })),
    ],
  },
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

/**
 * A stability service with a verdict for the LIVE line and the one before it —
 * exactly the shape the board's corner badges read.
 */
function verdict(line: string, level: 1 | 2 | 3 | 4 | 5, score: number, early = false): StabilityVerdict {
  return {
    line, liveAt: '2026-08-26T00:00:00Z', daysLive: 10, level, score,
    stability: stabilityPercent(score), tone: toneOf(level),
    components: { community: score, service: 0, cig: null },
    early, insufficient: false, historical: false, days: [], tickets: [], kbOpen: null, hotfixes: [],
  };
}

function stabilityStub() {
  const map = new Map<string, StabilityVerdict>([
    ['4.10', verdict('4.10', 3, 0.44, true)],
    ['4.9', verdict('4.9', 1, 0.1)],
  ]);
  return {
    loaded: () => true,
    unavailable: () => false,
    allTime: () => [...map.values()],
    load: () => Promise.resolve(),
    verdictFor: (line: string) => map.get(line) ?? null,
    patchRowFor: () => null,
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
        { provide: PatchStabilityService, useValue: stabilityStub() },
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
      const a = (row.querySelector('a.card-link') as HTMLAnchorElement | null);
      expect(a).withContext('a card is an anchor').not.toBeNull();
      expect(a!.getAttribute('href')).toMatch(/^\/news\/patches\/4\.\d+$/);
      expect(a!.getAttribute('aria-label'))
        .withContext('a stretched link has no text of its own').toContain('Alpha');
    }
    // The live card carries its hotfix count; the next card its roadmap teaser.
    expect(live.textContent).toContain('1 Hotfix');
    expect(rows()[0].querySelectorAll('.teaser .tz:not(.rest)').length).toBe(2);
  });

  /**
   * Feedback fdaad6b7 round 2: "die x notes in dieser Übersicht ist auch
   * unnötig, kannst du rausnehmen". The number of patch notes behind a line
   * is not something anyone picks a patch by — and the dossier, which is
   * where it means something, still says it.
   */
  it('no longer counts the notes on the overview card', async () => {
    await render(FEED, ROADMAP);
    for (const row of rows()) {
      expect(row.textContent).withContext(row.querySelector('.ver')?.textContent ?? '').not.toContain('Notes');
    }
    expect(root().querySelector('.stack .counts, .stack .ct'))
      .withContext('the cell went with it — an empty column is still a column').toBeNull();
  });

  /**
   * Feedback fdaad6b7, with the screenshot annotated in red: the roadmap
   * COUNT was on the card twice — once in the quiet facts line, once as a chip
   * on the right — and the item names ran along the teaser strip taking the
   * width the icons wanted. All three were struck through as "irrelevant".
   */
  it('says the roadmap count nowhere on the card, and lists no item names on the strip', async () => {
    await render(FEED, ROADMAP_MANY);
    const next = rows()[0];
    expect(next.textContent)
      .withContext('the count was struck through in both places it appeared').not.toContain('Roadmap-Einträge');
    const strip = next.querySelector('.teaser') as HTMLElement;
    expect(strip.textContent?.replace(/[…\s]/g, ''))
      .withContext('the strip is pictures and an ellipsis, not a name list').toBe('');
  });

  /**
   * "von den roadmap icons mehr ergänzen … so viel wie platz ist und danach
   * '…'" — the count is width-driven now. Fed through the component's own
   * measurement port so the assertion is about the ARITHMETIC, not about how
   * wide Karma's 749 px viewport happens to make the card.
   */
  it('fills the strip with as many icons as fit, then a "…" that links on', async () => {
    await render(FEED, ROADMAP_MANY);
    const board = fixture.componentInstance;
    board.onTeaserBox('4.11', { width: 426, item: 96, gap: 6, rest: 40, rows: 2 });
    fixture.detectChanges();

    const icons = () => Array.from(rows()[0].querySelectorAll('.teaser .tz:not(.rest)')) as HTMLAnchorElement[];
    expect(icons().length).withContext('four per line, plus three beside the "…"').toBe(7);
    const rest = rows()[0].querySelector('.teaser .rest') as HTMLAnchorElement;
    expect(rest).withContext('and says there is more').not.toBeNull();
    expect(rest.textContent?.trim()).toBe('…');
    expect(rest.getAttribute('aria-label')).toContain('3 weitere');
    expect(rest.getAttribute('href')).withContext('the "…" leads to the first item it hid').toBe('/news/patches/4.11?focus=r8');

    // Narrower card, fewer icons — nothing hardcoded, nothing lost.
    board.onTeaserBox('4.11', { width: 160, item: 84, gap: 6, rest: 34, rows: 2 });
    fixture.detectChanges();
    expect(icons().length).toBe(2);
    expect(rows()[0].querySelector('.teaser .rest')?.getAttribute('aria-label')).toContain('8 weitere');
  });

  it('every icon is a real link into its OWN roadmap entry', async () => {
    await render(FEED, ROADMAP_MANY);
    fixture.componentInstance.onTeaserBox('4.11', { width: 900, item: 96, gap: 6, rest: 40, rows: 2 });
    fixture.detectChanges();
    const icons = Array.from(rows()[0].querySelectorAll('.teaser .tz:not(.rest)')) as HTMLAnchorElement[];
    expect(icons.length).toBeGreaterThan(3);
    // Pictures first — they are the interesting ones.
    expect(icons[0].querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/r1.jpg');
    expect(icons.map((a) => a.getAttribute('href')).slice(0, 3))
      .toEqual(['/news/patches/4.11?focus=r1', '/news/patches/4.11?focus=r2', '/news/patches/4.11?focus=r3']);
    expect(icons[0].getAttribute('aria-label')).toContain('Nyx I');
    // The card itself still opens the dossier — the icons sit on top of it.
    expect((rows()[0].querySelector('a.card-link') as HTMLAnchorElement).getAttribute('href')).toBe('/news/patches/4.11');
  });

  it('measures itself: the strip reports its width without being told', async () => {
    await render(FEED, ROADMAP_MANY);
    const strip = () => rows()[0].querySelector('.teaser') as HTMLElement;
    // The strip reports its box from a ResizeObserver, i.e. after layout —
    // so give the browser frames rather than microtasks.
    for (let frame = 0; frame < 8 && strip().querySelectorAll('.tz:not(.rest)').length <= 3; frame++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      fixture.detectChanges();
    }
    const icons = Array.from(strip().querySelectorAll('.tz:not(.rest)')) as HTMLElement[];
    expect(icons.length)
      .withContext('the strip measured itself and grew past the unmeasured fallback of three').toBeGreaterThan(3);
    // Whatever the viewport, the strip stays inside its TWO clipped lines and
    // its content never spills out of the card — the invariant that has to
    // hold on the phone branch Karma renders in AND on the desktop one it
    // does not. 2 × 52 + 6 is the phone cap; the desktop one is 2 × 60 + 6.
    expect(strip().scrollWidth).withContext('the strip does not overflow itself').toBeLessThanOrEqual(strip().clientWidth + 1);
    expect(strip().scrollHeight).withContext('and never wraps onto a third line').toBeLessThanOrEqual(strip().clientHeight + 1);
    expect(Math.round(strip().getBoundingClientRect().height)).toBeLessThanOrEqual(126);
  });

  /**
   * Round 2 of feedback fdaad6b7: "die roadmap icons können noch ruhig doppelt
   * so groß dargestellt werden". Measured on the element, because the number
   * lives in CSS — and a doubled thumbnail is also the first one on this strip
   * that clears the 48 px tap target round 1 left it short of.
   */
  it('draws the thumbnails at double size, over two rows, inside the card', async () => {
    await render(FEED, ROADMAP_MANY);
    const strip = () => rows()[0].querySelector('.teaser') as HTMLElement;
    // Same as above: the strip reports its box after layout, so give it frames.
    for (let frame = 0; frame < 8 && strip().querySelectorAll('.tz:not(.rest)').length <= 3; frame++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      fixture.detectChanges();
    }
    const icon = (strip().querySelector('.tz:not(.rest)') as HTMLElement).getBoundingClientRect();
    expect(Math.round(icon.width)).withContext('42/48 px in round 1').toBeGreaterThanOrEqual(84);
    expect(Math.round(icon.height)).withContext('26/30 px in round 1').toBeGreaterThanOrEqual(52);
    expect(Math.min(icon.width, icon.height))
      .withContext('a touch target you can actually hit').toBeGreaterThanOrEqual(48);

    // Ten items at this width do not fit on one line any more, so the wrap is
    // the thing being tested — and the card, whose height is FIXED, has to
    // have room for it. A clipped second row would still satisfy every count.
    const stripBox = strip().getBoundingClientRect();
    expect(stripBox.height).withContext('the strip wrapped onto a second row').toBeGreaterThan(icon.height + 1);
    const card = rows()[0].querySelector('.card')!.getBoundingClientRect();
    expect(Math.round(stripBox.bottom))
      .withContext(`strip bottom ${stripBox.bottom} vs card bottom ${card.bottom}`)
      .toBeLessThanOrEqual(Math.round(card.bottom));
  });

  it('unfolds the older lines on demand', async () => {
    await render(FEED, ROADMAP);
    (root().querySelector('.fold-btn') as HTMLButtonElement | null)!.click();
    fixture.detectChanges();
    expect(rows().map((r) => r.querySelector('.ver')?.textContent?.trim())).toEqual(['Alpha 4.11', 'Alpha 4.10', 'Alpha 4.9', 'Alpha 4.8', 'Alpha 4.7']);
  });

  /**
   * The 2026-09-05 rework: a query answers with the CONTENT that matched,
   * grouped by patch — not with the same cards plus a hit count. The stack
   * steps aside entirely while a search runs, and so do the monitor and the
   * all-time stability chart.
   */
  function search(term: string): void {
    const input = (root().querySelector('#patch-board-search') as HTMLInputElement | null)!;
    input.value = term;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  const groups = () => Array.from(root().querySelectorAll('sc-patch-find-results .grp')) as HTMLElement[];

  it('search returns the matching CONTENT, grouped by patch, and hides the stack', async () => {
    await render(FEED, ROADMAP);
    search('quantum');
    expect(root().querySelector('.stack')).withContext('the stack is not the answer to a query').toBeNull();
    expect(groups().length).toBe(1);
    expect(groups()[0].querySelector('.gver')?.textContent?.trim()).toBe('Alpha 4.10');
    // The bullet itself, not "1 Stichpunkte".
    expect(groups()[0].querySelector('.hit[data-kind="note"] .t')?.textContent)
      .toContain('Hydrogen & Quantum Fuel Rebalance');
    expect((groups()[0].querySelector('.gline') as HTMLAnchorElement).getAttribute('href')).toContain('q=quantum');
  });

  it('a roadmap hit is a picture card linking to RSI\'s own entry for it', async () => {
    await render(FEED, ROADMAP);
    search('nyx');
    expect(groups().map((g) => g.querySelector('.gver')?.textContent?.trim())).toEqual(['Alpha 4.11']);
    const hit = groups()[0].querySelector('.hit[data-kind="roadmap"] a.cell') as HTMLAnchorElement;
    expect(hit.getAttribute('href')).toBe('https://robertsspaceindustries.com/roadmap/release-view/1589-Nyx-I');
    expect(hit.getAttribute('target')).toBe('_blank');
    expect(hit.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a query hides the monitor and the all-time stability chart', async () => {
    await render(FEED, ROADMAP);
    expect(root().querySelector('sc-patch-monitor')).not.toBeNull();
    search('quantum');
    expect(root().querySelector('sc-patch-monitor')).toBeNull();
    expect(root().querySelector('sc-stability-history')).toBeNull();
  });

  it('British spelling finds American text', async () => {
    await render(FEED, ROADMAP);
    search('armor');
    expect(groups().length).withContext('the control: RSI\'s own spelling').toBe(1);
    search('armour');
    expect(groups().length).withContext('the same card, typed the British way').toBe(1);
    expect(groups()[0].querySelector('.hit[data-kind="roadmap"] .t')?.textContent)
      .toContain('Super Heavy Combat Armor');
  });

  /**
   * The 2026-09-05 alignment complaint, measured rather than eyeballed: the
   * columns used to widen with importance (150 / 170 / 190 px), so the status
   * word and the version number stepped sideways between neighbouring rows.
   */
  it('every card lines up: same status width, same version x, same height for next and superseded', async () => {
    await render(FEED, ROADMAP);
    const widths = rows().map((r) => Math.round(r.querySelector('.status')!.getBoundingClientRect().width));
    expect(new Set(widths).size).withContext(`status widths: ${widths}`).toBe(1);

    const lefts = rows().map((r) => Math.round(r.querySelector('.ver')!.getBoundingClientRect().left));
    expect(new Set(lefts).size).withContext(`version x: ${lefts}`).toBe(1);

    const cards = rows().map((r) => r.querySelector('.card') as HTMLElement);
    const [next, , superseded] = cards.map((c) => Math.round(c.getBoundingClientRect().height));
    expect(next).withContext('"next" and "superseded" are the same kind of row').toBe(superseded);
    // The shared height is fixed, so it also has to be big enough: a row that
    // clips its own content would pass the equality above and still be wrong.
    for (const c of cards) {
      expect(c.scrollHeight).withContext(`${c.textContent?.slice(0, 24)} is clipped`).toBeLessThanOrEqual(c.clientHeight + 1);
    }
  });

  it('a shipped line carries its stability as a badge in the card corner; a future one does not', async () => {
    await render(FEED, ROADMAP);
    const [next, live, superseded] = rows();
    expect(next.querySelector('sc-stability-badge .badge')).withContext('4.11 has not shipped').toBeNull();
    expect(live.querySelector('sc-stability-badge .badge')?.getAttribute('data-tone')).toBe('amber');
    expect(live.querySelector('sc-stability-badge .val')?.textContent?.replace(/\s/g, '')).toBe('56%');
    expect(superseded.querySelector('sc-stability-badge .badge')?.getAttribute('data-tone')).toBe('green');
    // Top-right corner: the badge sits right of the counts and at the card's top.
    const card = live.querySelector('.card')!.getBoundingClientRect();
    const badge = live.querySelector('sc-stability-badge')!.getBoundingClientRect();
    expect(badge.right).toBeLessThanOrEqual(card.right + 1);
    expect(badge.top - card.top).toBeLessThan(card.height / 2);
  });

  it('an empty query brings the stack back untouched', async () => {
    await render(FEED, ROADMAP);
    search('quantum');
    search('');
    expect(rows().map((r) => r.dataset['status'])).toEqual(['next', 'live', 'superseded']);
  });

  it('answers "when is the next patch" ABOVE search and stack, as a monitoring panel', async () => {
    await render(FEED, ROADMAP);
    const panel = root().querySelector('sc-patch-monitor .mon') as HTMLElement | null;
    expect(panel).withContext('the panel is on the board, not only in the dossier').not.toBeNull();

    // Position: the panel comes before the search field and before the stack.
    const order = Array.from(root().querySelectorAll('sc-patch-monitor, .search, .stack'));
    expect(order.map((el) => el.tagName === 'SC-PATCH-MONITOR' ? 'monitor' : el.className))
      .toEqual(['monitor', 'search', 'stack']);

    // Three cells, read as the rail's legend: where the run started (with the
    // hotfixes as a side note there), how it is going, where it ends.
    const tiles = Array.from(panel!.querySelectorAll('.tile')) as HTMLElement[];
    expect(tiles.length).toBe(3);
    expect(tiles[0].textContent).toContain('Alpha 4.10');
    expect(tiles[0].querySelector('.side')?.textContent)
      .withContext('hotfixes ride along with the live patch, not a readout of their own').toContain('Hotfix');
    expect(tiles[2].textContent).withContext('the cell at the rail\'s end names the next line').toContain('Alpha 4.11');
    expect(panel!.querySelector('.answer b')?.textContent?.trim()).withContext('the estimated date').toBeTruthy();

    // The cell widths come from the rail — the legend sits under what it explains.
    expect((panel!.querySelector('.tiles') as HTMLElement).style.getPropertyValue('--tile-cols'))
      .withContext('cell boundaries follow the rail geometry').toContain('fr');
    expect(panel!.querySelectorAll('.months .mo').length)
      .withContext('a coarse month scale under the rail').toBeGreaterThan(0);
  });

  it('keeps the caveats and the colour key behind the (i)', async () => {
    await render(FEED, ROADMAP);
    const note = root().querySelector('sc-patch-monitor .pop') as HTMLElement;
    expect(note.hidden).withContext('the explanation is folded away by default').toBeTrue();
    expect(note.textContent).toContain('Median-Schätzungen');

    (root().querySelector('sc-patch-monitor button.dot') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(note.hidden).toBeFalse();
  });

  it('still stacks without a roadmap: live and superseded, no next card', async () => {
    await render(FEED, null);
    expect(rows().map((r) => r.dataset['status'])).toEqual(['live', 'superseded']);
  });
});
