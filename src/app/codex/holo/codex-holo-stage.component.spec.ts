import { provideNoShipBlueprints } from '../ship-blueprint/ship-blueprint.testing';
import { ComponentFixture, TestBed, fakeAsync, flush, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloStageComponent, HOLO_TONES, resetHoloArrivalSession } from './codex-holo-stage.component';
import { CodexDetail } from '../codex.service';
import { HoloSilhouette } from '../holo-silhouette';
import { ShipCapabilities } from '../codex-mission';
import type { LayoutSection, LayoutSlot } from '../codex-hardpoint-layout.component';
import type { KpiStripCell } from '../codex-kpi-sets';
import type { HardpointFrame } from '../hardpoint-map';

const CAPS: ShipCapabilities = { hasCargo: false, hasQuantum: true, hasMining: false, hasSalvage: false };

function detailWithPorts(portNames: string[]): CodexDetail {
  return {
    classNameSlug: 'cnou_nomad',
    kind: 'ship',
    row: { role: null },
    payload: {} as never,
    ports: portNames.map((portName, i) => ({
      parentClassName: 'CNOU_Nomad',
      parentKind: 'ship',
      portName,
      minSize: null,
      maxSize: null,
      types: [],
      flags: [],
      portIndex: i,
      helperName: null,
      position: null,
      rotation: null,
    })),
    strings: [],
  } as unknown as CodexDetail;
}

function silhouetteWithAnchor(portId: string): HoloSilhouette {
  return {
    schema: 1,
    kind: 'ship',
    classNameSlug: 'cnou_nomad',
    build: { channel: 'LIVE', patchVersion: '4.9.0', buildNumber: '1' },
    generatedAt: null,
    toolVersion: null,
    source: null,
    viewBox: '0 0 1000 1000',
    path: 'M0 0 L1000 0 L1000 1000 L0 1000 Z',
    bbox: { x: 0, y: 0, w: 1000, h: 1000 },
    scaleMPerUnit: null,
    anchors: [{ portId, x: 40, y: 60, side: null, depth: null, source: null, helper: null, clamped: false }],
    unresolved: [],
  };
}

function slot(rawPort: string, name: string): LayoutSlot {
  return {
    port: rawPort.replace(/_/g, ' '),
    rawPort,
    className: `${name}_class`,
    kind: 'weapon',
    name,
    size: 3,
    grade: null,
    manufacturerCode: 'AEGS',
  };
}

async function setup(inputs: Partial<{
  detail: CodexDetail;
  silhouette: HoloSilhouette | null;
  reducedMotion: boolean;
  primaryModuleSections: LayoutSection[];
  allKpiCells: KpiStripCell[];
  hardpointFrame: HardpointFrame | null;
  previewSilhouette: string | null;
}> = {}): Promise<ComponentFixture<CodexHoloStageComponent>> {
  // No compileComponents(): the components are AOT-compiled, and its native
  // promise would escape fakeAsync (Angular code runs untransformed under Vitest).
  TestBed.configureTestingModule({
    imports: [CodexHoloStageComponent],
    providers: [
      provideNoShipBlueprints(),provideRouter([]), provideTranslateService({})],
  });
  const fixture = TestBed.createComponent(CodexHoloStageComponent);
  fixture.componentRef.setInput('detail', inputs.detail ?? detailWithPorts([]));
  fixture.componentRef.setInput('displayName', 'Nomad');
  fixture.componentRef.setInput('activeMissionId', 'all');
  fixture.componentRef.setInput('shipCapabilities', CAPS);
  fixture.componentRef.setInput('silhouette', inputs.silhouette ?? null);
  fixture.componentRef.setInput('reducedMotion', inputs.reducedMotion ?? false);
  if (inputs.primaryModuleSections) fixture.componentRef.setInput('primaryModuleSections', inputs.primaryModuleSections);
  if (inputs.allKpiCells) fixture.componentRef.setInput('allKpiCells', inputs.allKpiCells);
  if (inputs.hardpointFrame !== undefined) fixture.componentRef.setInput('hardpointFrame', inputs.hardpointFrame);
  if (inputs.previewSilhouette !== undefined) fixture.componentRef.setInput('previewSilhouette', inputs.previewSilhouette);
  fixture.detectChanges();
  return fixture;
}

function silhouetteWithBbox(bbox: HoloSilhouette['bbox']): HoloSilhouette {
  return { ...silhouetteWithAnchor('__none__'), anchors: [], bbox };
}

function cell(key: KpiStripCell['key'], value: number | null): KpiStripCell {
  return {
    key,
    labelKey: `codex.kpi.${key}`,
    format: 'int',
    value,
    delta: null,
    accent: false,
    gapKey: null,
    lowerIsBetter: false,
    tooltipKey: null,
    fromPower: false,
  };
}

beforeEach(() => resetHoloArrivalSession());

describe('CodexHoloStageComponent', () => {
  it('renders the neutral placeholder when there is no silhouette', async () => {
    const fixture = await setup({ silhouette: null });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.silhouette-placeholder')).toBeTruthy();
    expect(el.querySelector('svg.silhouette')).toBeFalsy();
  });

  it('places a resolved pin for a port with a matching anchor', async () => {
    const fixture = await setup({
      detail: detailWithPorts(['hardpoint_gun_left']),
      silhouette: silhouetteWithAnchor('hardpoint_gun_left'),
    });
    const el: HTMLElement = fixture.nativeElement;
    const pin = el.querySelector('.pin');
    expect(pin).toBeTruthy();
    expect(pin!.classList.contains('unresolved')).toBe(false);
    expect((pin as HTMLElement).style.left).toBe('40%');
    expect((pin as HTMLElement).style.top).toBe('60%');
  });

  // #642: anchors exist per hardpoint node (a Nomad: 96) — only shown pins
  // use one, matched by port name whatever its case.
  it('matches a pin to its anchor by port name, case-insensitively, and ignores the other anchors', async () => {
    const sil = silhouetteWithAnchor('hardpoint_gun_left');
    const fixture = await setup({
      detail: detailWithPorts(['HardPoint_Gun_Left']),
      silhouette: { ...sil, anchors: [...sil.anchors, { ...sil.anchors[0], portId: 'hardpoint_seat_pilot', x: 10, y: 10 }] },
    });
    const pins = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.pin'));
    expect(pins.length).toBe(1);
    expect(pins[0].classList.contains('unresolved')).toBe(false);
    expect(pins[0].style.left).toBe('40%');
  });

  it('gives a port with no anchor the dashed unresolved ring, not an invented position', async () => {
    const fixture = await setup({
      detail: detailWithPorts(['hardpoint_gun_left', 'hardpoint_shield_generator_2']),
      silhouette: silhouetteWithAnchor('hardpoint_gun_left'),
    });
    const el: HTMLElement = fixture.nativeElement;
    const pins = Array.from(el.querySelectorAll('.pin'));
    expect(pins.length).toBe(2);
    const unresolved = pins.filter((p) => p.classList.contains('unresolved'));
    expect(unresolved.length).toBe(1);
  });

  it('reduced motion skips the arrival transformation (arrives immediately)', async () => {
    const fixture = await setup({ reducedMotion: true });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.holo-stage.arrived')).toBeTruthy();
    expect(el.querySelector('.holo-stage.reduced-motion')).toBeTruthy();
  });

  it('without reduced motion, arrival is deferred (not arrived on the first tick)', async () => {
    const fixture = await setup({ reducedMotion: false });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.holo-stage.arrived')).toBeFalsy();
  });

  // Pins are the ports the list shows — numbered in the list's display order
  // (weapons before shields, whatever order the buckets arrived in) — never
  // the extract's raw item-port rows (fuel controllers, docking tubes …).
  it('numbers the pins from the configurable blocks in display order, not from detail.ports', async () => {
    const fixture = await setup({
      detail: detailWithPorts(['controller_fuel', 'dockingtube_fuel']),
      primaryModuleSections: [
        { section: 'shields', slots: [slot('hardpoint_shield_generator', 'FR-66')] },
        { section: 'weapons', slots: [slot('hardpoint_gun_left', 'Laser Cannon'), slot('hardpoint_gun_right', 'Laser Cannon')] },
      ],
    });
    const pins = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.pin'));
    expect(pins.length).toBe(3);
    expect(fixture.componentInstance.pins().map((p) => p.index)).toEqual([1, 2, 3]); // the order stays; the numbers are no longer drawn (C10)
    expect(pins[0].getAttribute('aria-label')).toContain('Laser Cannon');
    expect(pins[2].getAttribute('aria-label')).toContain('FR-66');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('controller_fuel');
  });

  it('a digit key no longer selects a pin (C11)', async () => {
    const fixture = await setup({
      primaryModuleSections: [{ section: 'weapons', slots: [slot('hardpoint_gun_left', 'Laser Cannon'), slot('hardpoint_gun_right', 'Repeater')] }],
    });
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: '2' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.inspectedPort()).toBeNull();
  });

  it('the parts filters hide pins by kind; the last chip on stays on (C6)', async () => {
    const fixture = await setup({
      primaryModuleSections: [
        { section: 'weapons', slots: [slot('hardpoint_gun_left', 'Laser Cannon')] },
        { section: 'shields', slots: [slot('hardpoint_shield', 'FR-66')] },
      ],
    });
    const c = fixture.componentInstance;
    const el: HTMLElement = fixture.nativeElement;
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('.holo-views .vf-chip'));
    expect(chips.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true', 'true', 'false']);
    expect(c.tablePins().map((p) => p.portName)).toEqual(['hardpoint_gun_left', 'hardpoint_shield']);
    c.togglePartFilter('components');
    expect(c.tablePins().map((p) => p.portName)).toEqual(['hardpoint_gun_left']);
    expect(c.labelPins().map((p) => p.portName)).toEqual(['hardpoint_gun_left']);
    for (const id of ['missiles', 'other', 'weapons'] as const) c.togglePartFilter(id);
    expect([...c.partFilter()]).toEqual(['weapons']);
    chips[4].click();
    expect(c.hotspotScope()).toBe('all');
  });

  // The tiles read the FULL sheet: a combat Einsatz still fills "Bewegung".
  it('fills every perspective tile from allKpiCells with formatted values', async () => {
    const fixture = await setup({
      allKpiCells: [cell('sustainedDps', 1944.58), cell('shieldHp', 6336), cell('boost', 520), cell('ir', 14520)],
    });
    const tiles = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.ptile'));
    expect(tiles.length).toBe(4);
    const nums = tiles.map((t) => t.querySelector('.big .num')!.textContent!.trim());
    expect(nums[0]).toBe('1,945');
    expect(nums[2]).toBe('520');
    expect(nums[3]).toBe('14,520');
    expect(nums.some((n) => n.includes('1944.58'))).toBe(false);
  });
});

// ── Wave 5 (holodeck audit): overlaps, default silhouette, share, resets ──
describe('CodexHoloStageComponent — wave 5 fixes', () => {
  const manyPorts = Array.from({ length: 12 }, (_, i) => `hardpoint_gun_${i}`);

  it('above eight pins the table is dense: labels leave the canvas, a numbered key takes over', async () => {
    const fixture = await setup({ detail: detailWithPorts(manyPorts) });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.shipwrap.dense')).toBeTruthy();
    expect(el.querySelectorAll('.pin-key li').length).toBe(12);
    expect(el.querySelectorAll('.pin').length).toBe(12);
  });

  it('eight or fewer pins keep their labels on the canvas and no key is drawn', async () => {
    const fixture = await setup({ detail: detailWithPorts(manyPorts.slice(0, 6)) });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.shipwrap.dense')).toBeFalsy();
    expect(el.querySelector('.pin-key')).toBeFalsy();
  });

  it('a duplicated raw port name yields ONE pin (track keys stay unique)', async () => {
    const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left', 'hardpoint_gun_left', 'hardpoint_gun_right']) });
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.pin').length).toBe(2);
  });

  it('the fallback ring hugs the silhouette bbox instead of a fixed circle', async () => {
    // A narrow, full-height hull: the ring is an ellipse — narrower than tall.
    const fixture = await setup({
      detail: detailWithPorts(['a', 'b', 'c', 'd']),
      silhouette: silhouetteWithBbox({ x: 300, y: 0, w: 400, h: 1000 }),
    });
    const pins = fixture.componentInstance.pins();
    const xs = pins.map((p) => p.x);
    const ys = pins.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(Math.max(...ys) - Math.min(...ys));
    // Pin 1 sits on the nose (top centre) just outside the outline.
    expect(pins[0].x).toBeCloseTo(50, 0);
    expect(pins[0].y).toBeLessThan(0);
    expect(pins[0].side).toBe('below');
  });

  it('top and bottom ring pins stack their label vertically, flank pins go outward', async () => {
    const fixture = await setup({ detail: detailWithPorts(['n', 'e', 's', 'w']) });
    const sides = fixture.componentInstance.pins().map((p) => p.side);
    expect(sides).toEqual(['below', 'left', 'above', 'right']);
  });

  it('with no silhouette, the game icon is the default silhouette; a broken icon falls back to the artwork', async () => {
    const fixture = await setup({ silhouette: null, previewSilhouette: 'https://example.test/icon.webp' });
    fixture.componentRef.setInput('heroArt', ['https://example.test/render.jpg']);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('img.ghost-icon')).toBeTruthy();
    expect(el.querySelector('.ghost-art')).toBeFalsy();
    fixture.componentInstance.previewFailed.set(true);
    fixture.detectChanges();
    expect(el.querySelector('img.ghost-icon')).toBeFalsy();
    expect(el.querySelector('.ghost-art')).toBeTruthy();
  });

  it('with neither icon nor artwork the generic hull glyph is drawn — never an empty ring', async () => {
    const fixture = await setup({ silhouette: null });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.silhouette-placeholder .generic-hull')).toBeTruthy();
  });

  it('a ship without hardpoints says so on the table and in the inspector instead of "1 bis 0"', async () => {
    const fixture = await setup({ detail: detailWithPorts([]) });
    fixture.componentInstance.panelTab.set('parts'); // Einordnung is the default tab
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.table-empty')).toBeTruthy();
    expect(el.querySelector('.holo-panel .empty')!.textContent).toContain('codex.holo.stage.noPorts');
  });

  it('the bottom row: Akte first, then Außen; without coordinates or a model the views say why (C6, C7)', async () => {
    const fixture = await setup({ hardpointFrame: null });
    const el: HTMLElement = fixture.nativeElement;
    const views = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.holo-views .vw-thumb'));
    expect(views().map((b) => b.dataset['view'])).toEqual(['akte', '3d', 'simple', 'top', 'side', 'front']);
    expect(views().map((b) => b.getAttribute('aria-disabled'))).toEqual([null, 'true', null, 'true', 'true', 'true']);
    expect(el.querySelector('.table-eyebrow'), 'no eyebrow above the table (C1)').toBeNull();
    expect(el.querySelector('.tools5, .sub-views')).toBeNull();
    fixture.componentInstance.has3d.set(true);
    fixture.detectChanges();
    expect(views()[1].getAttribute('aria-disabled')).toBeNull();
  });

  it('Akte is a view: it lies over the table and any other view closes it', async () => {
    const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
    const c = fixture.componentInstance;
    const el: HTMLElement = fixture.nativeElement;
    const seen: string[] = [];
    c.viewChange.subscribe((v) => seen.push(v));
    el.querySelector<HTMLButtonElement>('.vw-thumb[data-view="akte"]')!.click();
    fixture.detectChanges();
    expect(c.activeView()).toBe('akte');
    expect(el.querySelector('.holo-akte.on')).toBeTruthy();
    expect(el.querySelector('.vw-thumb[data-view="akte"]')!.getAttribute('aria-checked')).toBe('true');
    el.querySelector<HTMLButtonElement>('.vw-thumb[data-view="simple"]')!.click();
    fixture.detectChanges();
    expect(c.activeView()).toBe('simple');
    expect(el.querySelector('.holo-akte.on')).toBeNull();
    expect(seen).toEqual(['akte', 'simple']);
  });

  it('the toolbar has no Teilen any more and Escape closes the inspector (C9)', async () => {
    const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.share-wrap')).toBeNull();
    expect(el.querySelector('sc-codex-holo-share')).toBeNull();
    expect(el.querySelector('.holo-topbar .ht-centre sc-codex-holo-einsatz'), 'the Einsatz in the head centre (C4)').toBeTruthy();
    expect(el.querySelector('.holo-topbar .ht-right'), 'the hangar slot top right (C5)').toBeTruthy();
    c.inspectedPort.set('hardpoint_gun_left');
    c.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(c.inspectedPort()).toBeNull();
  });

  it('a raw-port pin (no loadout sections) still gives the inspector a target — but no dead swap button', async () => {
    const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
    const c = fixture.componentInstance;
    c.inspectPin('hardpoint_gun_left');
    fixture.detectChanges();
    const target = c.inspectorTarget();
    expect(target).toBeTruthy();
    expect(target!.slot.rawPort).toBe('hardpoint_gun_left');
    expect(c.inspectorIsRawPort()).toBe(true);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.inspector .insp-actions')).toBeNull();
    expect(el.querySelector('.inspector')!.textContent).toContain('codex.holo.stage.rawPortHint');
  });

  it('a pin backed by a loadout slot keeps its swap / open actions', async () => {
    const fixture = await setup({
      primaryModuleSections: [{ section: 'weapons', slots: [slot('hardpoint_gun_left', 'Laser Cannon')] }],
    });
    const c = fixture.componentInstance;
    c.inspectPin('hardpoint_gun_left');
    fixture.detectChanges();
    expect(c.inspectorIsRawPort()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.inspector .insp-actions')).toBeTruthy();
  });

  it('an off-centre bbox never pushes the fallback ring past the canvas', async () => {
    const fixture = await setup({
      detail: detailWithPorts(Array.from({ length: 40 }, (_, i) => `p${i}`)),
      silhouette: silhouetteWithBbox({ x: 0, y: 0, w: 300, h: 300 }),
    });
    for (const p of fixture.componentInstance.pins()) {
      expect(p.x).toBeGreaterThanOrEqual(-4.01);
      expect(p.x).toBeLessThanOrEqual(104.01);
      expect(p.y).toBeGreaterThanOrEqual(-4.01);
      expect(p.y).toBeLessThanOrEqual(104.01);
    }
  });

  describe('surfaces (3D | Schema with its sub-views)', () => {
    afterEach(() => localStorage.removeItem('sc.codex.holo.surface'));

    it('has no Einsatz bar on any surface; the views row stays on every surface', async () => {
      const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
      const c = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      expect(el.querySelector('.rolebar')).toBeNull();
      expect(el.querySelector('.holo-views')).not.toBeNull();
      c.has3d.set(true);
      c.pickSurface('3d');
      fixture.detectChanges();
      expect(c.viewMode()).toBe('3d');
      expect(el.querySelector('.rolebar')).toBeNull();
      expect(el.querySelector('.vw-thumb[data-view="3d"]')!.getAttribute('aria-checked')).toBe('true');
    });

    it('a view the hull cannot show only says why, and the table falls back to Einfach', async () => {
      const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
      const c = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      const front = el.querySelector<HTMLButtonElement>('.vw-thumb[data-view="front"]')!;
      expect(front.getAttribute('aria-disabled'), 'no front view without a drawing').toBe('true');
      front.click();
      expect(c.surface()).toBe('simple');
      c.chosenSurface.set('front');
      expect(c.surface()).toBe('simple');
    });

    it('arrow keys walk the views like one radio group, skipping the disabled ones', async () => {
      const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
      const c = fixture.componentInstance;
      fixture.detectChanges();
      expect(c.activeView()).toBe('simple');
      c.onViewKey(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      expect(c.activeView()).toBe('akte');
      c.onViewKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(c.activeView()).toBe('simple');
    });

    it('remembers a Schema sub-view across hulls, and 3D is the default again after picking it', async () => {
      const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
      const c = fixture.componentInstance;
      c.pickSurface('simple');
      expect(localStorage.getItem('sc.codex.holo.surface')).toBe('simple');
      fixture.componentRef.setInput('detail', { ...detailWithPorts(['hardpoint_gun_left']), classNameSlug: 'aegs_gladius' });
      fixture.detectChanges();
      expect(c.chosenSurface()).toBe('simple');
      c.pickSurface('3d');
      expect(localStorage.getItem('sc.codex.holo.surface')).toBeNull();
    });

    it('lights the part under inspection on the table', async () => {
      const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
      const c = fixture.componentInstance;
      c.inspectPin('hardpoint_gun_left');
      expect(c.tableActivePorts()).toContain('hardpoint_gun_left');
    });
  });

  it('switching to another hull resets inspector and view mode', async () => {
    const fixture = await setup({ detail: detailWithPorts(['hardpoint_gun_left']) });
    const c = fixture.componentInstance;
    c.inspectPin('hardpoint_gun_left');
    c.chosenSurface.set('simple');
    fixture.detectChanges();
    fixture.componentRef.setInput('detail', { ...detailWithPorts(['hardpoint_gun_left']), classNameSlug: 'aegs_gladius' });
    fixture.detectChanges();
    expect(c.inspectedPort()).toBeNull();
    expect(c.viewMode()).toBe('holo');
  });

  // Fake clock (REQ-28): the fixture is built INSIDE fakeAsync, so the reveal
  // timer the arrival effect starts lands on the fake queue, not on real time.
  it('the arrival re-plays for a new hull and reports the hull once it arrived', fakeAsync(() => {
    let fixture!: ComponentFixture<CodexHoloStageComponent>;
    void setup({ reducedMotion: false }).then((f) => (fixture = f));
    flushMicrotasks();
    const c = fixture.componentInstance;
    const arrived: string[] = [];
    c.arrivedShip.subscribe((slug) => arrived.push(slug));
    // No hero art in the fixture: the reveal starts at once and ends after REVEAL_MS (1300).
    tick(1299);
    expect(c.arrived()).toBe(false);
    tick(1);
    expect(c.arrived()).toBe(true);
    expect(arrived).toEqual(['cnou_nomad']);
    fixture.componentRef.setInput('detail', { ...detailWithPorts([]), classNameSlug: 'aegs_gladius' });
    fixture.detectChanges();
    expect(c.arrived()).toBe(false);
    flush();
    expect(arrived).toEqual(['cnou_nomad', 'aegs_gladius']);
  }));

  it('a missile pin keeps its gold tone when its position is only estimated', async () => {
    const fixture = await setup({
      primaryModuleSections: [
        { section: 'weapons', slots: [slot('hardpoint_gun_left', 'Laser Cannon')] },
        { section: 'missiles', slots: [slot('hardpoint_missile_rack', 'Rack')] },
      ],
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.pin.unresolved').length).toBe(2);
    expect(el.querySelector('.pin.gold.unresolved')).toBeTruthy();
    expect(fixture.componentInstance.pinRing()).not.toBeNull();
  });

  it('with nothing inspected, the inspector lists the pins by block instead of an empty box', async () => {
    const fixture = await setup({
      primaryModuleSections: [
        { section: 'shields', slots: [slot('hardpoint_shield_generator', 'FR-66')] },
        { section: 'weapons', slots: [slot('hardpoint_gun_left', 'Laser Cannon'), slot('hardpoint_gun_right', 'Laser Cannon')] },
      ],
    });
    const c = fixture.componentInstance;
    c.panelTab.set('parts'); // Einordnung is the default tab
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const groups = Array.from(el.querySelectorAll('.holo-panel .pgroup'));
    expect(groups.length).toBe(2);
    expect(groups[0].querySelectorAll('.part').length).toBe(2);
    expect(el.querySelector('.holo-panel .empty')).toBeNull();
    c.inspectPin('hardpoint_shield_generator');
    fixture.detectChanges();
    expect(c.inspectedPort()).toBe('hardpoint_shield_generator');
    expect(el.querySelector('.inspector')!.textContent).toContain('FR-66');
  });

  it('the page title names the ship once, without repeating the maker word', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('displayName', 'Aegis Avenger Stalker');
    fixture.componentRef.setInput('manufacturerName', 'Aegis Dynamics');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1.ht-name')!.textContent!.trim()).toBe('Avenger Stalker');
    expect(el.querySelector('.ht-kicker')!.textContent).toContain('Aegis Dynamics');
  });

  it('a static tile that carries a sentence instead of a value shows the dash and keeps the sentence as tooltip', async () => {
    const fixture = await setup();
    fixture.componentRef.setInput('heroChips', [
      { key: 'crew', text: '3 crew' },
      { key: 'cargo', text: 'Laderaum · Kapazität nicht in den Spieldaten' },
    ]);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    expect(c.staticChip('crew')).toBe('3');
    expect(c.staticChip('cargo')).toBe('—');
    expect(c.staticChipTitle('cargo')).toContain('Spieldaten');
    expect(c.staticChipTitle('crew')).toBeNull();
  });
});

describe('CodexHoloStageComponent one panel (concept glas3)', () => {
  const sections = [
    { section: 'weapons', slots: [slot('hp_gun', 'Gun')] },
    { section: 'shields', slots: [slot('hp_shield', 'Shield')] },
    { section: 'coolers', slots: [slot('hp_cool', 'Cooler')] },
    { section: 'countermeasures', slots: [slot('hp_decoy', 'Decoy')] },
  ] as unknown as LayoutSection[];

  it('has one panel with three tabs, Einordnung first and open, Bauteile second', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelectorAll('.holo-panel').length).toBe(1);
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((t) => t.id);
    expect(tabs).toEqual(['holo-tab-rank', 'holo-tab-parts', 'holo-tab-changes']);
    expect(c.panelTab()).toBe('rank');
    expect(el.querySelector('.rankbody')).not.toBeNull();
    expect(el.querySelector('.statics')).not.toBeNull();
    expect(el.querySelector('sc-codex-holo-inspector')).toBeNull();
    (el.querySelector('#holo-tab-parts') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('sc-codex-holo-inspector')).not.toBeNull();
    expect(el.querySelector('.rankbody')).toBeNull();
    (el.querySelector('#holo-tab-changes') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.panelTabIndex()).toBe(2);
    // C17: the Werk opens on the patch comparison, "Deine Anpassungen" one switch away.
    expect(c.changeView()).toBe('patch');
    expect(el.querySelector('.chg-sw')).not.toBeNull();
    expect(el.querySelector('sc-codex-holo-changes')).toBeNull();
    c.changeView.set('mine');
    f.detectChanges();
    expect(el.querySelector('sc-codex-holo-changes')).not.toBeNull();
  });

  it('opens Änderungen on "Deine Anpassungen" while an exemplar is shown (C17)', async () => {
    const f = await setup();
    f.componentRef.setInput('inHangar', true);
    f.detectChanges();
    expect(f.componentInstance.changeView()).toBe('mine');
    f.componentRef.setInput('inHangar', false);
    f.detectChanges();
    expect(f.componentInstance.changeView()).toBe('patch');
  });

  it('the tabs are one control for the keyboard', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    c.onTabKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(c.panelTab()).toBe('parts');
    c.onTabKey(new KeyboardEvent('keydown', { key: 'End' }));
    expect(c.panelTab()).toBe('changes');
    c.onTabKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(c.panelTab()).toBe('rank');
    c.onTabKey(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(c.panelTab()).toBe('changes');
  });

  it('selecting a part brings the Bauteile tab forward', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    c.panelTab.set('rank');
    c.inspectPin('hp_gun');
    expect(c.panelTab()).toBe('parts');
    c.panelTab.set('changes');
    c.onPartSelected({ id: 'x', portName: 'hp_shield', itemClass: 'S', swappable: true });
    expect(c.panelTab()).toBe('parts');
    expect(c.inspectedPort()).toBe('hp_shield');
    expect(c.viewerSelectedPort()).toBe('x');
    c.onPartSelected(null);
    expect(c.inspectedPort()).toBeNull();
    expect(c.viewerSelectedPort()).toBeNull();
  });

  it('a part with no loadout slot is named from the package, with nothing to swap', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    const swaps: unknown[] = [];
    c.swapRequested.subscribe((t) => swaps.push(t));
    c.onPartSelected({ id: 'y', portName: 'hp_thruster', itemClass: 'AEGS_Thruster', swappable: false });
    expect(c.inspectorIsRawPort()).toBe(true);
    expect(c.inspectorTarget()?.slot.className).toBe('AEGS_Thruster');
    c.onPartSwap({ id: 'y', portName: 'hp_thruster', itemClass: 'AEGS_Thruster', swappable: false });
    expect(swaps).toEqual([]);
  });

  it('the callout swap icon acts on the selected part', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    const swaps: unknown[] = [];
    c.swapRequested.subscribe((t) => swaps.push(t));
    const sel = { id: 'z', portName: 'hp_gun', itemClass: 'G', swappable: true };
    c.onPartSelected(sel);
    c.onPartSwap(sel);
    expect(swaps.length).toBe(1);
  });

  it('one rule for the dots: the swappable ports are the pins of Einfach, countermeasures are not', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    expect([...c.swappablePorts()].sort()).toEqual(['hp_cool', 'hp_gun', 'hp_shield']);
    expect(c.tablePins().map((p) => p.portName).sort()).toEqual(['hp_cool', 'hp_gun', 'hp_shield']);
    expect(c.pins().length).toBe(4);
  });

  it('an Einsatz keeps its blocks lit from the section data; the default, Bergbau and Bergung quiet nothing', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    expect(c.relevantPorts()).toBeNull();
    f.componentRef.setInput('activeMissionId', 'combat');
    expect([...c.relevantPorts()!].sort()).toEqual(['hp_gun', 'hp_shield']);
    f.componentRef.setInput('activeMissionId', 'stealth');
    expect([...c.relevantPorts()!].sort()).toEqual(['hp_cool', 'hp_decoy', 'hp_shield']);
    f.componentRef.setInput('activeMissionId', 'mining');
    expect(c.relevantPorts()).toBeNull();
    f.componentRef.setInput('activeMissionId', 'salvage');
    expect(c.relevantPorts()).toBeNull();
  });

  it('the page takes the Einsatz hue, the default stays the accent token', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const stage = (f.nativeElement as HTMLElement).querySelector('.holo-stage') as HTMLElement;
    f.detectChanges();
    expect(stage.getAttribute('data-mission')).toBe('all');
    expect(stage.style.getPropertyValue('--holo-e')).toBe('var(--sc-mission-all)');
    f.componentRef.setInput('activeMissionId', 'stealth');
    f.detectChanges();
    expect(stage.style.getPropertyValue('--holo-e')).toBe('var(--sc-mission-stealth)');
  });

  it('a picked Einsatz on a ship of that class still shows: its own label, symbol hue and the lit parts', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    f.componentRef.setInput('rankShipClass', 'combat');
    f.detectChanges();
    expect(c.missionLabelKey()).toBe('codex.rank.class.combat');
    f.componentRef.setInput('activeMissionId', 'combat');
    f.detectChanges();
    expect(c.missionLabelKey()).toBe('codex.mission.combat');
    expect(c.missionLabelKey()).not.toBe(c.rankClassLabel());
    expect(c.missionHue()).toBe('var(--sc-mission-combat)');
    expect([...c.relevantPorts()!].sort()).toEqual(['hp_gun', 'hp_shield']);
    const stage = (f.nativeElement as HTMLElement).querySelector('.holo-stage') as HTMLElement;
    expect(stage.getAttribute('data-mission')).toBe('combat');
  });

  it('a ship opens on its class: the strip names it, the rank profile follows the class', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const c = f.componentInstance;
    const asked: string[] = [];
    c.rankProfileChange.subscribe((p) => asked.push(p));
    f.componentRef.setInput('rankShipClass', 'transport');
    f.detectChanges();
    expect(c.rankClassLabel()).toBe('codex.rank.class.transport');
    expect(c.missionSegments().find((m) => m.id === 'all')!.labelKey).toBe('codex.rank.class.transport');
    expect(asked[asked.length - 1]).toBe('transport');
  });

  it('a later ship arrives short: no hero wait, the values are there at once', fakeAsync(() => {
    let f!: ComponentFixture<CodexHoloStageComponent>;
    void setup({ primaryModuleSections: sections }).then((x) => (f = x));
    flush();
    f.detectChanges();
    flush();
    f.detectChanges();
    expect(f.componentInstance.phase()).toBe('done');
    const arrived: string[] = [];
    f.componentInstance.arrivedShip.subscribe((s) => arrived.push(s));
    f.componentRef.setInput('detail', { ...detailWithPorts(['hp_x']), classNameSlug: 'NEXT_Ship' });
    f.detectChanges();
    expect(f.componentInstance.phase()).toBe('done');
    expect(f.componentInstance.bodyReady()).toBe(true);
    tick(400);
    expect(arrived).toEqual(['NEXT_Ship']);
    f.destroy();
  }));
});

describe('CodexHoloStageComponent sound (cx-sound)', () => {
  let started: { freq: number; gain: number }[];
  let realCtx: unknown;

  class FakeParam {
    value = 0;
    last = 0;
    setValueAtTime(v: number) { this.value = v; this.last = Math.max(this.last, v); return this; }
    exponentialRampToValueAtTime(v: number) { this.last = Math.max(this.last, v); return this; }
  }
  class FakeCtx {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() {
      const frequency = new FakeParam();
      const node = {
        type: 'sine',
        frequency,
        connect: (g: { gain: FakeParam }) => ({ connect: () => { node.gainNode = g; } }),
        gainNode: null as { gain: FakeParam } | null,
        start: () => started.push({ freq: frequency.value, gain: node.gainNode?.gain.last ?? 0 }),
        stop: () => undefined,
      };
      return node;
    }
    createGain() { return { gain: new FakeParam() }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }

  beforeEach(() => {
    started = [];
    realCtx = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    localStorage.removeItem('sc.codex.holo.sound');
  });
  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = realCtx;
    localStorage.removeItem('sc.codex.holo.sound');
  });

  it('is off by default and silent until switched on', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    expect(c.soundOn()).toBe(false);
    c.has3d.set(true);
    c.pickSurface('3d');
    expect(started.length, 'no sound while off').toBe(0);
  });

  it('plays quiet tones once on: toggle blip, view + Einsatz switch, every gain <= 0.05', async () => {
    const fixture = await setup();
    const c = fixture.componentInstance;
    c.toggleSound();
    expect(started.length, 'confirmation blip').toBe(1);
    c.has3d.set(true);
    c.pickSurface('3d');
    expect(started.length, 'view switch tick').toBe(2);
    fixture.componentRef.setInput('activeMissionId', 'combat');
    fixture.detectChanges();
    expect(started.length, 'Einsatz switch tick').toBe(3);
    c.tone('arrive');
    expect(started.length, 'arrival = two notes').toBe(5);
    expect(started.every((s) => s.gain > 0 && s.gain <= 0.05)).toBe(true);
    expect(Object.values(HOLO_TONES).flat().every((n) => n.gain <= 0.05)).toBe(true);
  });
});

describe('CodexHoloStageComponent lower part (concept holotisch-unten r1, d2)', () => {
  const sections = [
    { section: 'weapons', slots: [slot('hp_gun', 'Gun')] },
    { section: 'missiles', slots: [slot('hp_rack', 'Rack')] },
    { section: 'shields', slots: [slot('hp_shield', 'Shield')] },
    { section: 'quantum', slots: [slot('hp_qd', 'Drive')] },
    { section: 'coolers', slots: [slot('hp_cool', 'Cooler')] },
  ] as unknown as LayoutSection[];

  it('the parts come first in four columns over the strip areas, each section where it counts (C4/C5)', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const el: HTMLElement = f.nativeElement;
    const areas = Array.from(el.querySelectorAll<HTMLElement>('.holo-below .below-area'));
    expect(areas.map((a) => a.dataset['p'])).toEqual(['offensive', 'defensive', 'movement', 'signature']);
    const secs = (a: HTMLElement) => Array.from(a.querySelectorAll('[data-sec]')).map((d) => d.getAttribute('data-sec'));
    expect(secs(areas[0])).toEqual(['weapons', 'missiles']);
    expect(secs(areas[1])).toEqual(['shields']);
    expect(secs(areas[2])).toEqual(['quantum']);
    expect(secs(areas[3])).toEqual(['coolers']);
    // No "Antrieb & Systeme" merge across columns.
    expect(el.querySelector('.holo-below .mod-sec.merged')).toBeNull();
    // Perspectives come after the parts and are the last thing before the strip (C4/C9).
    const below = el.querySelector('.holo-below')!;
    const persp = el.querySelector('sc-codex-holo-perspectives.below-persp')!;
    expect(below.compareDocumentPosition(persp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(persp.nextElementSibling?.tagName.toLowerCase()).toBe('sc-codex-holo-strip');
    expect(persp.classList).toContain('row');
  });

  it('the side column sits in the first (Einsatz) column and holds no chip filter row (C6/C8)', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const el: HTMLElement = f.nativeElement;
    const side = el.querySelector<HTMLElement>('.holo-below .below-side')!;
    expect(side).toBeTruthy();
    expect(getComputedStyle(side).gridColumnStart).toBe('1');
    expect(el.querySelector('.holo-below .chip, .holo-below [role="toolbar"]')).toBeNull();
  });

  it('the strip carries the four perspective areas in its dock (C9)', async () => {
    const f = await setup({ primaryModuleSections: sections });
    const el: HTMLElement = f.nativeElement;
    (el.querySelector('sc-codex-holo-strip .hs-toggle') as HTMLButtonElement).click();
    f.detectChanges();
    const dock = el.querySelector('sc-codex-holo-strip .hs-panel')!;
    expect(dock.querySelector('.hp-energy')).toBeTruthy();
    expect(dock.querySelector('sc-codex-holo-perspectives.in-dock.row')).toBeTruthy();
  });

  const room = (key: string) => ({ key, name: null, pos: [0, 0, 0], floorZ: null, height: 3, shapes: [[[-2, -2], [2, -2], [2, 2], [-2, 2]]] });

  it('deck chips in Einfach: Außen + one per deck; one deck reads Außen + its own name; no rooms, no chips (C14, D5)', async () => {
    const f = await setup();
    const c = f.componentInstance;
    expect(c.deckChips()).toEqual([]);
    f.componentRef.setInput('decks', [{ key: 'D1', name: { en: 'Deck 1', de: 'Deck 1' }, order: 0, rooms: [room('A')] }]);
    f.detectChanges();
    expect(c.deckChips().map((d) => d.labelKey)).toEqual(['codex.holo.stage.deckOutside', null]);
    expect(c.deckChips()[1].label).toBe('Deck 1');
    f.componentRef.setInput('decks', [
      { key: 'D1', name: { en: 'Deck 1', de: 'Deck 1' }, order: 0, rooms: [room('A')] },
      { key: 'D2', name: { en: 'Deck 2', de: 'Deck 2' }, order: 1, rooms: [room('B')] },
      { key: 'D3', name: null, order: 2 },
    ]);
    f.detectChanges();
    expect(c.deckChips().map((d) => d.key)).toEqual([null, 'D1', 'D2']);
    const el: HTMLElement = f.nativeElement;
    // Innen in the bottom row: one thumbnail per deck with rooms (Außen is its own group).
    expect(Array.from(el.querySelectorAll<HTMLElement>('.vw-thumb[data-view^="deck:"]')).map((b) => b.dataset['view'])).toEqual(['deck:D1', 'deck:D2']);
    el.querySelector<HTMLButtonElement>('.vw-thumb[data-view="deck:D2"]')!.click();
    f.detectChanges();
    expect(c.activeViewId()).toBe('deck:D2');
    expect(c.tableDeck()?.key).toBe('D2');
    // Inside a deck there are no part markers: the deck plan replaces the hull.
    expect(el.querySelector('sc-ship-deck-plan.deck-sheet')).toBeTruthy();
    expect(el.querySelector('sc-codex-holo-table .shipwrap')).toBeNull();
    // Picking a part goes back outside, where its marker is.
    c.inspectPin('hp_gun');
    expect(c.deckView()).toBeNull();
  });

  it('D5: a deck on the table lists its rooms in the bottom row; a chip picks the room on the plan', async () => {
    const f = await setup();
    const c = f.componentInstance;
    const named = (key: string, en: string) => ({ ...room(key), name: { en, de: en } });
    f.componentRef.setInput('decks', [
      { key: 'D1', name: { en: 'Deck 1', de: 'Deck 1' }, order: 0, rooms: [named('R1', 'Cockpit'), named('R2', 'Cargo Bay'), named('R3', 'Cargo Bay')] },
      { key: 'D2', name: { en: 'Deck 2', de: 'Deck 2' }, order: 1, rooms: [named('R4', 'Engineering')] },
    ]);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    // Outside: the parts filters, no rooms.
    expect(el.querySelector('.vr-chip')).toBeNull();
    el.querySelector<HTMLButtonElement>('.vw-thumb[data-view="deck:D1"]')!.click();
    f.detectChanges();
    // One chip per readable name, A-Z; the filters make way.
    expect(Array.from(el.querySelectorAll('.vr-chip')).map((b) => b.textContent!.trim())).toEqual(['Cargo Bay', 'Cockpit']);
    expect(el.querySelector('.vf-chip.all')).toBeNull();
    el.querySelector<HTMLButtonElement>('.vr-chip[data-room="R1"]')!.click();
    f.detectChanges();
    expect(c.deckRoom()).toBe('R1');
    expect(c.tableDeck()?.room).toBe('R1');
    expect(el.querySelector('.vr-chip[data-room="R1"]')!.getAttribute('aria-pressed')).toBe('true');
    // The plan shows the same room picked.
    expect(el.querySelector('sc-ship-deck-plan .room.on')?.getAttribute('aria-label')).toBe('Cockpit');
    // A second press lets go; another deck starts with no room.
    el.querySelector<HTMLButtonElement>('.vr-chip[data-room="R1"]')!.click();
    f.detectChanges();
    expect(c.deckRoom()).toBeNull();
    c.pickRoom('R2');
    c.pickDeck('D2');
    expect(c.deckRoom()).toBeNull();
  });
});
