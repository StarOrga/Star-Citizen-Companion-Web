import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloStageComponent } from './codex-holo-stage.component';
import { CodexDetail } from '../codex.service';
import { HoloSilhouette } from '../holo-silhouette';
import { ShipCapabilities } from '../codex-mission';
import type { LayoutSection, LayoutSlot } from '../codex-hardpoint-layout.component';
import type { KpiStripCell } from '../codex-kpi-sets';

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
}> = {}): Promise<ComponentFixture<CodexHoloStageComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexHoloStageComponent],
    providers: [provideRouter([]), provideTranslateService({})],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexHoloStageComponent);
  fixture.componentRef.setInput('detail', inputs.detail ?? detailWithPorts([]));
  fixture.componentRef.setInput('displayName', 'Nomad');
  fixture.componentRef.setInput('activeMissionId', 'all');
  fixture.componentRef.setInput('shipCapabilities', CAPS);
  fixture.componentRef.setInput('silhouette', inputs.silhouette ?? null);
  fixture.componentRef.setInput('reducedMotion', inputs.reducedMotion ?? false);
  if (inputs.primaryModuleSections) fixture.componentRef.setInput('primaryModuleSections', inputs.primaryModuleSections);
  if (inputs.allKpiCells) fixture.componentRef.setInput('allKpiCells', inputs.allKpiCells);
  fixture.detectChanges();
  return fixture;
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
    expect(pins.map((p) => p.querySelector('i')!.textContent!.trim())).toEqual(['1', '2', '3']);
    expect(pins[0].textContent).toContain('Laser Cannon');
    expect(pins[2].textContent).toContain('FR-66');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('controller_fuel');
  });

  it('a digit hotkey selects the pin of that number and the inspector counter follows', async () => {
    const fixture = await setup({
      primaryModuleSections: [{ section: 'weapons', slots: [slot('hardpoint_gun_left', 'Laser Cannon'), slot('hardpoint_gun_right', 'Repeater')] }],
    });
    // Karma renders at a tablet width, where the rails start collapsed
    // (concept mo5-rails) — open the inspector rail to read its body.
    fixture.componentInstance.rightCollapsed.set(false);
    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: '2' }));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.inspectedPort()).toBe('hardpoint_gun_right');
    expect(el.querySelector('.holo-right .ph .n')!.textContent!.replace(/\s+/g, '')).toBe('2/2');
    expect(el.querySelector('.inspector')!.textContent).toContain('Repeater');
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
