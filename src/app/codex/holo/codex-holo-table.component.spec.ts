import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloTableComponent } from './codex-holo-table.component';
import { HoloPhase, StagePin } from './codex-holo-model';

function pin(portName: string, index: number, over: Partial<StagePin> = {}): StagePin {
  return {
    portName,
    index,
    x: 10 * index,
    y: 20,
    resolved: true,
    side: 'right',
    label: `Label ${portName}`,
    short: null,
    tone: 'accent',
    slot: null,
    section: null,
    ...over,
  };
}

const PINS: StagePin[] = [pin('hp_a', 1), pin('hp_b', 2), pin('hp_c', 3, { tone: 'gold' })];

describe('CodexHoloTableComponent', () => {
  function setup(inputs: Record<string, unknown> = {}): ComponentFixture<CodexHoloTableComponent> {
    TestBed.configureTestingModule({
      imports: [CodexHoloTableComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(CodexHoloTableComponent);
    fixture.componentRef.setInput('pins', PINS);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  const pinButtons = (f: ComponentFixture<CodexHoloTableComponent>): HTMLButtonElement[] =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button.pin'));

  afterEach(() => TestBed.resetTestingModule());

  describe('pins per phase', () => {
    for (const phase of ['wait', 'hero'] as HoloPhase[]) {
      it(`renders no pins while the arrival is in phase "${phase}"`, () => {
        const fixture = setup({ phase });
        expect(pinButtons(fixture).length).toBe(0);
        expect((fixture.nativeElement as HTMLElement).classList).toContain(`ph-${phase}`);
      });
    }

    for (const phase of ['reveal', 'done'] as HoloPhase[]) {
      it(`renders every pin in phase "${phase}"`, () => {
        const fixture = setup({ phase });
        expect(pinButtons(fixture).length).toBe(3);
        expect(pinButtons(fixture).map((b) => b.querySelector('i')!.textContent!.trim())).toEqual(['1', '2', '3']);
      });
    }

    it('marks gold pins, the inspected pin and unresolved pins', () => {
      const fixture = setup({
        pins: [pin('hp_a', 1), pin('hp_b', 2, { tone: 'gold' }), pin('hp_c', 3, { resolved: false })],
        inspectedPort: 'hp_a',
      });
      const [a, b, c] = pinButtons(fixture);
      expect(a.classList).toContain('sel');
      expect(a.getAttribute('aria-pressed')).toBe('true');
      expect(b.classList).toContain('gold');
      expect(c.classList).toContain('unresolved');
    });

    it('shows the empty text instead of pins when the hull has no ports', () => {
      const fixture = setup({ pins: [] });
      const el = fixture.nativeElement as HTMLElement;
      expect(pinButtons(fixture).length).toBe(0);
      expect(el.querySelector('.table-empty')!.textContent).toContain('codex.holo.stage.noPorts');
    });

    it('emits pinInspect on click and hovered on pointer enter / leave', () => {
      const fixture = setup();
      const inspected: string[] = [];
      const hovered: (string[] | null)[] = [];
      fixture.componentInstance.pinInspect.subscribe((p) => inspected.push(p));
      fixture.componentInstance.hovered.subscribe((h) => hovered.push(h));
      const [first] = pinButtons(fixture);
      first.dispatchEvent(new MouseEvent('mouseenter'));
      first.dispatchEvent(new MouseEvent('mouseleave'));
      first.click();
      expect(hovered).toEqual([['hp_a'], null]);
      expect(inspected).toEqual(['hp_a']);
    });
  });

  describe('still (reduced motion)', () => {
    const sweepAnimation = (f: ComponentFixture<CodexHoloTableComponent>): string =>
      getComputedStyle((f.nativeElement as HTMLElement).querySelector('.sweep')!).animationName;

    it('sets the still class on the host and stops the looping sweep', () => {
      const fixture = setup({ still: true });
      expect((fixture.nativeElement as HTMLElement).classList).toContain('still');
      expect(sweepAnimation(fixture)).toBe('none');
    });

    it('animates the sweep without still (unless the browser itself asks for reduced motion)', () => {
      const fixture = setup();
      expect((fixture.nativeElement as HTMLElement).classList).not.toContain('still');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        expect(sweepAnimation(fixture)).toBe('none');
      } else {
        expect(sweepAnimation(fixture)).toContain('holo-sweep');
      }
    });
  });

  describe('dense table', () => {
    it('moves the labels into a numbered key that inspects on click', () => {
      const fixture = setup({ dense: true });
      const el = fixture.nativeElement as HTMLElement;
      const keys = Array.from(el.querySelectorAll<HTMLButtonElement>('.pin-key button.pk'));
      expect(keys.length).toBe(3);
      const inspected: string[] = [];
      fixture.componentInstance.pinInspect.subscribe((p) => inspected.push(p));
      keys[1].click();
      expect(inspected).toEqual(['hp_b']);
    });

    it('has no key on a sparse table', () => {
      const fixture = setup();
      expect((fixture.nativeElement as HTMLElement).querySelector('.pin-key')).toBeNull();
    });
  });

  it('shows the legend with the missile entry only when a gold pin exists', () => {
    const withGold = setup();
    const legendText = (withGold.nativeElement as HTMLElement).querySelector('.legend')!.textContent!;
    expect(legendText).toContain('codex.holo.stage.legendConfigurable');
    expect(legendText).toContain('codex.holo.stage.legendMissiles');
    expect(legendText).not.toContain('codex.holo.stage.legendUnresolved');
  });

  it('shows the unresolved legend entry when told there are unresolved pins', () => {
    const fixture = setup({ pins: [pin('hp_a', 1, { resolved: false })], hasUnresolved: true });
    const legendText = (fixture.nativeElement as HTMLElement).querySelector('.legend')!.textContent!;
    expect(legendText).toContain('codex.holo.stage.legendUnresolved');
    expect(legendText).not.toContain('codex.holo.stage.legendMissiles');
  });
});
