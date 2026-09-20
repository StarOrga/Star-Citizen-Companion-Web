import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloStageComponent } from './codex-holo-stage.component';
import { CodexDetail } from '../codex.service';
import { HoloSilhouette } from '../holo-silhouette';
import { ShipCapabilities } from '../codex-mission';

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

async function setup(inputs: Partial<{
  detail: CodexDetail;
  silhouette: HoloSilhouette | null;
  reducedMotion: boolean;
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
  fixture.detectChanges();
  return fixture;
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
});
