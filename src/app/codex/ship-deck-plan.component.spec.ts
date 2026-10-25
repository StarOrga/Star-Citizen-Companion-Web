import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { ShipDeck } from './codex.types';
import { ShipDeckPlanComponent } from './ship-deck-plan.component';

// Renders the real SVG: the point of the component is that rooms appear as
// outlines on the right deck — a pure-function test cannot catch a template
// that draws an empty frame.

const room = (key: string, x: number) => ({
  key,
  name: null,
  pos: [x, 0, 0],
  floorZ: 0,
  height: 3,
  shapes: [[[x - 4, -4], [x + 4, -4], [x + 4, 4], [x - 4, 4]]],
});

const DECKS: ShipDeck[] = [
  { key: 'Ship_Lower_Deck', name: { en: 'Lower Deck', de: 'Unterdeck' }, order: 0, rooms: [room('Cargo_Room_RN', 0)] },
  {
    key: 'Ship_Main_Deck',
    name: { en: 'Main Deck', de: null },
    order: 1,
    rooms: [room('Bridge_Room_RN', 0), room('Galley_Room_RN', 10)],
  },
];

describe('ShipDeckPlanComponent', () => {
  let fixture: ComponentFixture<ShipDeckPlanComponent>;

  function render(decks: ShipDeck[] | null, lang: 'en' | 'de' = 'en'): HTMLElement {
    fixture.componentRef.setInput('decks', decks);
    fixture.componentRef.setInput('lang', lang);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShipDeckPlanComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(ShipDeckPlanComponent);
  });

  it('renders nothing without rooms', () => {
    expect(render(null).querySelector('.deck-plan')).toBeNull();
    expect(render([{ key: 'A_Deck', name: null, order: 0 }]).querySelector('.deck-plan')).toBeNull();
  });

  it('opens on the deck with the most rooms and draws each room', () => {
    const el = render(DECKS);
    const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Lower Deck 1', 'Main Deck 2']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(el.querySelectorAll('g.room').length).toBe(2);
    expect(el.querySelectorAll('g.room path').length).toBe(2);
  });

  it('switches decks by click and by arrow key', () => {
    const el = render(DECKS);
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('g.room').length).toBe(1);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelectorAll('g.room').length).toBe(2);
  });

  it('names the hovered room in the readout', () => {
    const el = render(DECKS, 'de');
    const g = el.querySelector<SVGGElement>('g.room')!;
    g.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(el.querySelector('.readout')!.textContent!.trim()).toBe('Bridge');
    expect(g.classList).toContain('on');
    g.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    expect(el.querySelector('.readout')!.classList).toContain('empty');
  });

  it('lists every room by name and a chip lights its room', () => {
    const el = render(DECKS);
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('.legend .chip'));
    expect(chips.map((c) => c.textContent!.trim())).toEqual(['Bridge', 'Galley']);
    chips[1].click();
    fixture.detectChanges();
    const rooms = el.querySelectorAll('g.room');
    expect(rooms[1].classList).toContain('on');
    expect(rooms[0].classList).not.toContain('on');
    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('a click holds the room after the pointer leaves, a second click releases it', () => {
    const el = render(DECKS);
    const g = el.querySelectorAll<SVGGElement>('g.room')[1];
    g.dispatchEvent(new Event('mouseenter'));
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    g.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    expect(el.querySelector('.readout')!.textContent!.trim()).toBe('Galley');
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.readout')!.classList).toContain('empty');
  });

  it('rooms stay out of the tab order and Home/End jump between decks', () => {
    const el = render([...DECKS, { ...DECKS[0], key: 'Ship_Upper_Deck', name: { en: 'Upper Deck', de: null }, order: 2 }]);
    expect(el.querySelector('g.room[tabindex]')).toBeNull();
    const tabs = el.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    const panel = el.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[2].id);
    expect(tabs[2].getAttribute('aria-controls')).toBe(panel.id);
    expect(tabs[2].id).toMatch(/^dp-\d+-tab-2$/);
    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('a single deck shows no switcher', () => {
    const el = render([DECKS[1]]);
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.querySelector('[role="tabpanel"]')).toBeNull();
    expect(el.querySelectorAll('g.room').length).toBe(2);
  });
});
