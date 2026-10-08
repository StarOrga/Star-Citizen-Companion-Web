import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloTableComponent } from './codex-holo-table.component';
import { HoloPhase, StagePin } from './codex-holo-model';
import { ShipBlueprintService } from '../ship-blueprint/ship-blueprint.service';
import { fakeShipBlueprints } from '../ship-blueprint/ship-blueprint.testing';
import { AssetPackageService } from '../asset-package/asset-package.service';
import type { HardpointFrame, HardpointMarker } from '../hardpoint-map';
import { HoloAnchorFixture, JAVELIN_ANCHORS, NOMAD_ANCHORS, leaderPins } from '../testing/holo-anchors.fixture';

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

  describe('schema view', () => {
    const FRAME: HardpointFrame = { min: [-2, -5, -1], max: [2, 5, 1], source: 'bbox' };
    const MARKERS: HardpointMarker[] = [
      { port: 'hp_a', label: 'A', itemName: null, position: [0, 4, 0], top: { x: 0.5, y: 0.1 }, side: { x: 0.9, y: 0.5 }, clamped: false },
      { port: 'hp_b', label: 'B', itemName: null, position: [1, -3, 0], top: { x: 0.75, y: 0.8 }, side: { x: 0.2, y: 0.5 }, clamped: false },
    ];

    async function schemaSetup(withDrawing: boolean) {
      const blueprints = fakeShipBlueprints();
      if (withDrawing) blueprints.set('AEGS_Gladius');
      TestBed.configureTestingModule({
        imports: [CodexHoloTableComponent],
        providers: [
          provideTranslateService({ fallbackLang: 'en' }),
          { provide: ShipBlueprintService, useValue: blueprints },
          // No package for this hull: the extractor's positions are used.
          { provide: AssetPackageService, useValue: { findRow: () => Promise.resolve(null), manifest: () => Promise.reject(new Error('none')) } },
        ],
      });
      const fixture = TestBed.createComponent(CodexHoloTableComponent);
      const inputs: Record<string, unknown> = {
        pins: PINS, viewMode: 'schema', shipClassName: 'AEGS_Gladius', hardpointFrame: FRAME, hardpointMarkers: MARKERS,
      };
      for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture;
    }

    it('draws the blueprint schema with every positioned hardpoint, labelled like its pin', async () => {
      const fixture = await schemaSetup(true);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('sc-ship-blueprint-schema')).not.toBeNull();
      expect(el.querySelector('sc-ship-hardpoint-map')).toBeNull();
      expect(el.querySelectorAll('sc-ship-blueprint-schema g.mk').length).toBe(2);
      expect(el.querySelector('.hp-list button')!.textContent).toContain('Label hp_a');
    });

    it('opens a hardpoint from the schema in the inspector (pinInspect)', async () => {
      const fixture = await schemaSetup(true);
      const seen: string[] = [];
      fixture.componentInstance.pinInspect.subscribe((p) => seen.push(p));
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.hp-list button')[1]!.click();
      expect(seen).toEqual(['hp_b']);
    });

    it('keeps the box map for a hull without a drawing', async () => {
      const fixture = await schemaSetup(false);
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('sc-ship-blueprint-schema')).toBeNull();
      expect(el.querySelector('sc-ship-hardpoint-map')).not.toBeNull();
    });
  });

  describe('leader lines (#642)', () => {
    /** StagePins as the stage builds them from a fixture: anchored pins resolved. */
    function stagePins(fx: HoloAnchorFixture): StagePin[] {
      return leaderPins(fx).map((p) => pin(p.portName, p.index, { x: p.x, y: p.y, resolved: p.resolved, label: `Label ${p.index}` }));
    }

    function leaderSetup(fx: HoloAnchorFixture, inputs: Record<string, unknown> = {}) {
      TestBed.configureTestingModule({
        imports: [CodexHoloTableComponent],
        providers: [provideTranslateService({ fallbackLang: 'en' })],
      });
      const fixture = TestBed.createComponent(CodexHoloTableComponent);
      // A desktop-sized surface: Karma's own window is only 749px wide.
      const host = fixture.nativeElement as HTMLElement;
      host.style.width = '980px';
      host.style.height = '640px';
      const pins = stagePins(fx);
      const all: Record<string, unknown> = { pins, silhouette: fx.silhouette, dense: pins.length > 8, ...inputs };
      for (const [k, v] of Object.entries(all)) fixture.componentRef.setInput(k, v);
      // Render; the frame measures itself after that render (afterNextRender —
      // run by the application tick; layout is synchronous); render again.
      fixture.detectChanges();
      TestBed.inject(ApplicationRef).tick();
      fixture.detectChanges();
      return fixture;
    }

    const labels = (f: ComponentFixture<CodexHoloTableComponent>) =>
      Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.leader-labels button.ll'));
    const labelFor = (f: ComponentFixture<CodexHoloTableComponent>, port: string) =>
      labels(f).find((b) => b.dataset['port'] === port)!;
    const pinFor = (f: ComponentFixture<CodexHoloTableComponent>, index: number) =>
      pinButtons(f).find((b) => b.querySelector('i')!.textContent!.trim() === String(index))!;


    it('labels every Nomad pin in a side column, joined by a leader line, instead of the key', () => {
      const fixture = leaderSetup(NOMAD_ANCHORS);
      const el = fixture.nativeElement as HTMLElement;
      expect(fixture.componentInstance.leader()).not.toBeNull();
      expect(labels(fixture).length).toBe(17);
      expect(el.querySelectorAll('svg.leaders path').length).toBe(17);
      expect(el.querySelector('.pin-key')).toBeNull();
      // The rendered label boxes never overlap.
      const rects = labels(fixture).map((b) => b.getBoundingClientRect());
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [a, b] = [rects[i], rects[j]];
          const hit = a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
          expect(hit).withContext(`label ${i + 1} × ${j + 1}`).toBeFalse();
        }
      }
      // The dots stay keyboard-silent: the labels are the tab stops.
      expect(pinFor(fixture, 1).getAttribute('tabindex')).toBe('-1');
    });

    it('hovering a label lights its pin and line, hovering a pin lights its label', () => {
      const fixture = leaderSetup(NOMAD_ANCHORS);
      const hovered: (string[] | null)[] = [];
      fixture.componentInstance.hovered.subscribe((h) => hovered.push(h));
      const port3 = NOMAD_ANCHORS.pins[2];
      labelFor(fixture, port3).dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(pinFor(fixture, 3).classList).toContain('active');
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('svg.leaders path.active').length).toBe(1);
      expect(hovered).toEqual([[port3]]);
      labelFor(fixture, port3).dispatchEvent(new MouseEvent('mouseleave'));
      pinFor(fixture, 5).dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(labelFor(fixture, NOMAD_ANCHORS.pins[4]).classList).toContain('active');
      expect(pinFor(fixture, 3).classList).not.toContain('active');
      expect(labelFor(fixture, port3).classList).not.toContain('active');
    });

    it('selection marks the pin and its label; a label click inspects the port', () => {
      const fixture = leaderSetup(NOMAD_ANCHORS, { inspectedPort: NOMAD_ANCHORS.pins[0] });
      const label1 = labelFor(fixture, NOMAD_ANCHORS.pins[0]);
      expect(label1.classList).toContain('sel');
      expect(label1.getAttribute('aria-pressed')).toBe('true');
      expect(pinFor(fixture, 1).classList).toContain('sel');
      const seen: string[] = [];
      fixture.componentInstance.pinInspect.subscribe((p) => seen.push(p));
      labelFor(fixture, NOMAD_ANCHORS.pins[1]).click();
      expect(seen).toEqual([NOMAD_ANCHORS.pins[1]]);
    });

    it('lights the label of a port the host marks active (hover elsewhere on the page)', () => {
      const fixture = leaderSetup(NOMAD_ANCHORS, { activePorts: [NOMAD_ANCHORS.pins[6]] });
      expect(labelFor(fixture, NOMAD_ANCHORS.pins[6]).classList).toContain('active');
    });

    it('keeps the numbered key for the Javelin (47 pins)', () => {
      const fixture = leaderSetup(JAVELIN_ANCHORS);
      const el = fixture.nativeElement as HTMLElement;
      expect(fixture.componentInstance.leader()).toBeNull();
      expect(labels(fixture).length).toBe(0);
      expect(el.querySelectorAll('.pin-key button.pk').length).toBe(47);
    });

    it('keeps the numbered key for a silhouette without anchors', () => {
      const bare: HoloAnchorFixture = { ...NOMAD_ANCHORS, silhouette: { ...NOMAD_ANCHORS.silhouette, anchors: [] } };
      const fixture = leaderSetup(bare);
      expect(labels(fixture).length).toBe(0);
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('.pin-key button.pk').length).toBe(17);
    });

    it('draws no leader lines outside the holo view', () => {
      const fixture = leaderSetup(NOMAD_ANCHORS, { viewMode: 'schema' });
      expect(fixture.componentInstance.leader()).toBeNull();
    });

    it('shows the leader lines complete under reduced motion (no draw-in)', () => {
      const fixture = leaderSetup(NOMAD_ANCHORS, { still: true });
      const path = (fixture.nativeElement as HTMLElement).querySelector('svg.leaders path')!;
      expect(getComputedStyle(path).animationName).toBe('none');
      expect(getComputedStyle(path).strokeDashoffset).toMatch(/^0(px)?$/);
    });
  });
});
