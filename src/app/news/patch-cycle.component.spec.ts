import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService, TranslationObject } from '@ngx-translate/core';
import { PatchCycleComponent } from './patch-cycle.component';
import { groupPatchNotes } from './patch-notes';
import { stackCardFor } from './patch-stack';
import type { VerseNewsItem } from './news.service';

/**
 * The cycle axis as it is laid out (feedback 01df732d, follow-up).
 *
 * The shipped version pinned every marker label to the marker's own percentage,
 * above and below the rail. Wherever two markers sat close together — the
 * middle of every running cycle — the chips, names and dates printed over each
 * other and over the facts underneath: the panel read as text stacked on text.
 * So this suite measures real boxes in the browser instead of asserting
 * classes — nothing that carries text may intersect anything else that carries
 * text, at phone, tablet and desktop width.
 */

function patch(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id,
    title,
    url: 'https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/' + id,
    publishedAt,
    channel: 'patch',
    source: 'patch-notes',
  };
}

const FEED: VerseNewsItem[] = [
  patch('l410', 'Star Citizen Alpha 4.10 LIVE Release Notes', '2026-08-27T00:00:00Z'),
  patch('h410', 'Star Citizen Alpha 4.10 LIVE - Hotfix Central', '2026-09-03T00:00:00Z'),
  patch('p410', '[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12479687', '2026-08-03T00:00:00Z'),
  patch('l49', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-09T00:00:00Z'),
  patch('p49', '[Wave 1] Star Citizen Alpha 4.9 PTU Patch Notes 12107679', '2026-06-18T00:00:00Z'),
  patch('l48', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-06-12T00:00:00Z'),
  patch('p48', '[Wave 1] Star Citizen Alpha 4.8 PTU Patch Notes 12000000', '2026-05-20T00:00:00Z'),
  patch('l47', 'Star Citizen Alpha 4.7 LIVE Release Notes', '2026-03-20T00:00:00Z'),
];
const GROUPS = groupPatchNotes(FEED);
const NOW = Date.parse('2026-09-04T12:00:00Z');
/** Far enough past the median that "today" is pinned to the axis' right end. */
const OVERDUE = Date.parse('2026-11-20T12:00:00Z');

/**
 * Every box in the panel that carries readable text - including the class the
 * broken version used for its pinned labels, so re-introducing one is measured
 * rather than trusted.
 */
const TEXT_BOXES = '.lab, .today, .mark, .facts li, .lede .sentence, .charts summary';

function overlaps(a: DOMRect, b: DOMRect): boolean {
  // A shared border is not an overlap; a shared pixel is.
  return a.left < b.right - 0.5 && b.left < a.right - 0.5
    && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}

describe('Patch cycle axis — the panel may not print over itself', () => {
  let fixture: ComponentFixture<PatchCycleComponent>;
  let de: TranslationObject;

  beforeAll(async () => {
    const res = await fetch('/i18n/de.json');
    expect(res.ok).toBeTrue();
    de = await res.json();
  });

  async function render(line: string, width: number, now = NOW): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PatchCycleComponent, TranslateModule.forRoot()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', de);
    translate.use('de');
    fixture = TestBed.createComponent(PatchCycleComponent);
    fixture.componentRef.setInput('card', stackCardFor(line, GROUPS, null)!);
    fixture.componentRef.setInput('groups', GROUPS);
    fixture.componentRef.setInput('now', now);
    (fixture.nativeElement as HTMLElement).style.width = width + 'px';
    fixture.detectChanges();
    // Not whenStable(): the folded-away chart carousel runs an interval, so the
    // fixture is never "stable" - a few microtasks are what the rendering needs.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  const root = () => fixture.nativeElement as HTMLElement;
  const boxes = () => Array.from(root().querySelectorAll(TEXT_BOXES)) as HTMLElement[];
  const label = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

  // 375 = the phone the feedback came from, 768 = tablet, 1200 = desktop.
  for (const width of [375, 768, 1200]) {
    it('keeps every label clear of every other label at ' + width + 'px', async () => {
      await render('4.10', width);
      const els = boxes();
      expect(els.length).toBeGreaterThan(4);
      for (let i = 0; i < els.length; i++) {
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i].getBoundingClientRect();
          const b = els[j].getBoundingClientRect();
          expect(overlaps(a, b))
            .withContext(width + 'px: "' + label(els[i]) + '" over "' + label(els[j]) + '"')
            .toBeFalse();
        }
      }
    });

    it('keeps every label inside the panel at ' + width + 'px', async () => {
      await render('4.10', width);
      const host = root().getBoundingClientRect();
      for (const el of boxes()) {
        const r = el.getBoundingClientRect();
        expect(r.left).withContext('left of "' + label(el) + '"').toBeGreaterThanOrEqual(host.left - 0.5);
        expect(r.right).withContext('right of "' + label(el) + '"').toBeLessThanOrEqual(host.right + 0.5);
      }
    });
  }

  it('parks today at the far end of the rail without hanging out of the panel', async () => {
    await render('4.10', 375, OVERDUE);
    const today = root().querySelector('.today') as HTMLElement;
    expect(today.getAttribute('data-edge')).toBe('end');
    expect(today.getBoundingClientRect().right).toBeLessThanOrEqual(root().getBoundingClientRect().right + 0.5);
  });

  it('names three milestones — start, Live, target — and leaves the rest as markers', async () => {
    await render('4.10', 1200);
    const marks = Array.from(root().querySelectorAll('.mark')) as HTMLElement[];
    expect(marks.map((m) => m.getAttribute('data-key'))).toEqual(['firstTest', 'live', 'usual']);
    expect(label(marks[0])).toContain('PTU-Start 4.10');
    expect(label(marks[1])).toContain('Live 4.10');
    expect(label(marks[2])).toContain('Nächster Live');
    // The rail still carries every marker — they just stopped carrying prose.
    expect((Array.from(root().querySelectorAll('.pt')) as HTMLElement[]).map((p) => p.getAttribute('data-key')))
      .toEqual(['prevLive', 'firstTest', 'leadUsual', 'live', 'hotfix', 'now', 'usual']);
    expect(root().querySelector('.track .lab')).withContext('no free-floating labels left').toBeNull();
    // The names that came off the rail stay reachable on hover.
    expect(root().querySelector('.pt[data-key="hotfix"]')?.getAttribute('title')).toContain('Hotfix');
  });

  it('a finished cycle ends on its real successor and has no today marker', async () => {
    await render('4.9', 1200);
    expect(root().querySelector('.today')).toBeNull();
    expect((Array.from(root().querySelectorAll('.mark')) as HTMLElement[]).map((m) => m.getAttribute('data-key')))
      .toEqual(['firstTest', 'live', 'nextLive']);
  });
});
