import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexZoneRailComponent, ZoneRailKind } from './codex-zone-rail.component';

/** A 1x1 gif, so the fallback walk never fires a real request in Karma. */
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function setup(over: {
  kind?: ZoneRailKind;
  summary?: string | null;
  heroSuit?: ReadonlySet<string> | null;
  heroArt?: readonly string[] | null;
}): Promise<ComponentFixture<CodexZoneRailComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexZoneRailComponent],
    providers: [provideTranslateService({ fallbackLang: 'en' })],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexZoneRailComponent);
  const ref = fixture.componentRef;
  ref.setInput('kind', over.kind ?? 'board');
  ref.setInput('eyebrowKey', 'zone.eyebrow');
  ref.setInput('labelKey', 'zone.expand');
  ref.setInput('fallbackKey', 'zone.fallback');
  ref.setInput('summary', over.summary ?? null);
  if (over.heroSuit !== undefined) ref.setInput('heroSuit', over.heroSuit);
  if (over.heroArt !== undefined) ref.setInput('heroArt', over.heroArt);
  fixture.detectChanges();
  return fixture;
}

/** Everything the rail puts on screen as words, collapsed to one line. */
function words(el: HTMLElement): string {
  return (el.querySelector('button.zone-rail')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('CodexZoneRailComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  // Feedback 77668f11: "nur die visuelle darstellung des maennchen bzw. des
  // schiffs (flagship only) ohne texte / angaben wenn collapsed."
  describe('with a hero', () => {
    it('shows the AN BORD figure and no content text at all', async () => {
      const fixture = await setup({ kind: 'board', summary: 'Fixit', heroSuit: new Set(['helmet']) });
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('.rail-hero sc-codex-board-figure')).not.toBeNull();
      // The set's name is a detail; the figure replaces it, it does not join it.
      expect(el.querySelector('.rail-sub')).toBeNull();
      expect(words(el)).not.toContain('Fixit');
      // The zone label and the chevron are the rail's OWN affordances and stay:
      // a strip that does not say what it opens is a picture, not a control.
      expect(words(el)).toBe('zone.eyebrow');
      expect(el.querySelector('.rail-chevron')).not.toBeNull();
      expect(el.querySelector('button.zone-rail.has-hero')).not.toBeNull();
    });

    it('renders the figure as decoration, not as a second accessible name', async () => {
      const fixture = await setup({ kind: 'board', heroSuit: new Set(['core']) });
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('.rail-hero')?.getAttribute('aria-hidden')).toBe('true');
      // The button already names itself; the suit must not announce a second one.
      expect(el.querySelector('svg.board-doll')?.getAttribute('aria-label')).toBeNull();
      expect(el.querySelector('svg.board-doll')?.getAttribute('role')).toBeNull();
      expect(el.querySelector('button.zone-rail')?.getAttribute('aria-label')).toBe('zone.expand');
    });

    it('shows the flagship art for IM HANGAR, without naming the ship', async () => {
      const fixture = await setup({
        kind: 'hangar',
        summary: 'Aegis Avenger Stalker',
        heroArt: [PIXEL],
      });
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector<HTMLImageElement>('.rail-ship img')?.getAttribute('src')).toBe(PIXEL);
      expect(words(el)).toBe('zone.eyebrow');
      expect(el.querySelector('.rail-sub')).toBeNull();
    });

    it('falls back to the ship glyph when the hull has no art', async () => {
      const fixture = await setup({ kind: 'hangar', summary: 'Gladius', heroArt: [] });
      const el: HTMLElement = fixture.nativeElement;

      // An empty candidate list is still a flagship — the glyph is a picture of
      // a ship, so the rail keeps its hero shape instead of falling back to text.
      expect(el.querySelector('.rail-ship img')).toBeNull();
      expect(el.querySelector('.rail-ship sc-codex-icon')).not.toBeNull();
      expect(words(el)).toBe('zone.eyebrow');
    });
  });

  // Nothing equipped / empty hangar: there is no hero to show, so the rail is
  // the strip it has always been, summary line included.
  describe('without a hero', () => {
    it('keeps the plain rail and its summary', async () => {
      const fixture = await setup({ kind: 'hangar', summary: 'Aegis Avenger Stalker' });
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('.rail-hero')).toBeNull();
      expect(el.querySelector('button.zone-rail.has-hero')).toBeNull();
      expect(el.querySelector('.rail-sub')?.textContent?.trim()).toBe('Aegis Avenger Stalker');
    });

    it('names the empty state when there is nothing to summarise', async () => {
      const fixture = await setup({ kind: 'board', summary: null });
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.rail-sub')?.textContent?.trim()).toBe('zone.fallback');
    });
  });
});
