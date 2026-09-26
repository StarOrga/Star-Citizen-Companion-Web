import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexBoardFigureComponent } from './codex-board-figure.component';
import {
  SUIT_ANCHORS_3D,
  SUIT_CAMERA,
  SUIT_PARTS,
  buildHardsuit,
  fallbackZones,
  paintPart,
  pointInPolygon,
  projectSuitPoint,
  suitAnchors3d,
  suitZones,
} from './codex-board-suit';
import * as THREE from 'three';

async function setup(
  filled: string[],
  decorative = false,
  extra: Record<string, unknown> = {},
): Promise<ComponentFixture<CodexBoardFigureComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexBoardFigureComponent],
    providers: [provideTranslateService({ fallbackLang: 'en' })],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexBoardFigureComponent);
  fixture.componentRef.setInput('filled', new Set(filled));
  fixture.componentRef.setInput('decorative', decorative);
  for (const [k, v] of Object.entries(extra)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture;
}

describe('CodexBoardFigureComponent', () => {
  it('renders the drawn suit as the fallback, whatever the engine does', async () => {
    const el: HTMLElement = (await setup([])).nativeElement;
    // The SVG must be in the DOM from the first frame — it is the no-WebGL
    // rendering, not a replacement that arrives later.
    expect(el.querySelector('svg.board-doll')).not.toBeNull();
    expect(el.querySelectorAll('svg.board-doll .pd-part').length).toBe(SUIT_PARTS.length);
    expect(el.querySelector('canvas.board-stage')).not.toBeNull();
  });

  it('marks only the equipped positions', async () => {
    const el: HTMLElement = (await setup(['helmet', 'legs'])).nativeElement;
    const on = Array.from(el.querySelectorAll('svg.board-doll .pd-part.on'));
    expect(on.length).toBe(2);
    expect(on.every((g) => g.getAttribute('fill') === 'url(#pd-plate-on)')).toBeTrue();
    expect(el.querySelector('svg.board-doll .visor')?.getAttribute('fill')).toBe(
      'url(#pd-visor-on)',
    );
  });

  it('leaves the visor open when the helmet is not', async () => {
    const el: HTMLElement = (await setup(['core'])).nativeElement;
    expect(el.querySelector('svg.board-doll .visor')?.getAttribute('fill')).toBe('url(#pd-visor)');
  });

  // Feedback 77668f11: the collapsed AN BORD rail shows the figure and nothing
  // else. Inside that button the suit is decoration — the control already has
  // a name, and the picture must not add a second one.
  it('carries a name of its own, and drops it in decorative mode', async () => {
    const named: HTMLElement = (await setup(['helmet'])).nativeElement;
    const doll = named.querySelector('svg.board-doll');
    expect(doll?.getAttribute('role')).toBe('img');
    expect(doll?.getAttribute('aria-label')).toBe('codex.landing.paperdoll.aria');

    TestBed.resetTestingModule();
    const bare: HTMLElement = (await setup(['helmet'], true)).nativeElement;
    for (const node of [bare.querySelector('svg.board-doll'), bare.querySelector('canvas.board-stage')]) {
      expect(node?.getAttribute('role')).toBeNull();
      expect(node?.getAttribute('aria-label')).toBeNull();
      expect(node?.getAttribute('aria-hidden')).toBe('true');
    }
    // Still the same figure, only unannounced.
    expect(bare.querySelectorAll('svg.board-doll .pd-part.on').length).toBe(1);
    expect(bare.textContent?.trim()).toBe('');
  });
});

// Concept C1 (2026-09-26): the set page hangs its slot tiles around the figure,
// lights a part per tile and reads leader-line end points off the figure.
describe('CodexBoardFigureComponent — set page API', () => {
  it('lights exactly the highlighted part and steps the rest back', async () => {
    const fixture = await setup(['core'], false, { highlight: 'legs' });
    const el: HTMLElement = fixture.nativeElement;
    const lit = Array.from(el.querySelectorAll('svg.board-doll .pd-part.hl'));
    expect(lit.map((g) => g.getAttribute('data-part'))).toEqual(['legs']);
    expect(lit[0].getAttribute('fill')).toBe('url(#pd-plate-hl)');
    expect(el.querySelector('svg.board-doll')?.classList).toContain('has-hl');

    fixture.componentRef.setInput('highlight', null);
    fixture.detectChanges();
    expect(el.querySelectorAll('svg.board-doll .pd-part.hl').length).toBe(0);
    expect(el.querySelector('svg.board-doll')?.classList).not.toContain('has-hl');
    // Equipped state is untouched by the highlight coming and going.
    expect(el.querySelector('svg.board-doll .pd-part[data-part="core"]')?.classList).toContain('on');
  });

  it('draws no hit zones unless interactive', async () => {
    const el: HTMLElement = (await setup([], true)).nativeElement;
    expect(el.querySelector('svg.board-zones')).toBeNull();
  });

  it('renders one hit zone per part and reports the part under the pointer', async () => {
    const fixture = await setup([], true, { interactive: true });
    const el: HTMLElement = fixture.nativeElement;
    const zones = Array.from(el.querySelectorAll<SVGGElement>('svg.board-zones g.zone'));
    expect(zones.map((z) => z.getAttribute('data-part')).sort()).toEqual([...SUIT_PARTS].sort());
    expect(zones.every((z) => z.querySelectorAll('polygon').length > 0)).toBeTrue();
    expect(el.querySelector('svg.board-zones')?.getAttribute('aria-hidden')).toBe('true');

    const seen: (string | null)[] = [];
    fixture.componentInstance.partHover.subscribe((p) => seen.push(p));
    const helmet = zones.find((z) => z.getAttribute('data-part') === 'helmet')!;
    helmet.dispatchEvent(new PointerEvent('pointerenter'));
    helmet.dispatchEvent(new PointerEvent('pointerleave'));
    expect(seen).toEqual(['helmet', null]);
  });

  it('exposes an anchor inside the figure box for all six parts, on both sides', async () => {
    const fixture = await setup([]);
    const cmp = fixture.componentInstance;
    const inBox = (p: { x: number; y: number }): boolean => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    for (const part of SUIT_PARTS) {
      expect(inBox(cmp.partAnchors()[part])).withContext(part).toBeTrue();
      const { left, right } = cmp.partAnchorsBySide()[part];
      expect(inBox(left) && inBox(right)).withContext(part).toBeTrue();
      expect(left.x).withContext(part).toBeLessThan(right.x);
    }
    fixture.componentRef.setInput('anchorSide', { helmet: 'right' });
    expect(cmp.partAnchors().helmet).toEqual(cmp.partAnchorsBySide().helmet.right);
  });

  it('projects exactly like the render camera', () => {
    const aspect = 120 / 184;
    const h = SUIT_CAMERA.halfHeight;
    const cam = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.1, 40);
    cam.position.set(...SUIT_CAMERA.position);
    cam.lookAt(...SUIT_CAMERA.target);
    cam.updateMatrixWorld(true);
    for (const p of [[0, 0, 0], [0.3, 1.2, -0.2], [-0.5, 1.8, 0.4]] as const) {
      const ours = projectSuitPoint(p, aspect);
      const ndc = new THREE.Vector3(...p).project(cam);
      expect(ours.x).toBeCloseTo((ndc.x + 1) / 2, 9);
      expect(ours.y).toBeCloseTo((1 - ndc.y) / 2, 9);
    }
  });

  it('ends every 3D leader line on its own, frontmost part', () => {
    const suit = buildHardsuit(THREE, { idle: '#3d5a6c', tint: '#f0c27b', accent: '#52c1e6' });
    const zones = suitZones(THREE, suit);
    const anchors = suitAnchors3d();
    for (const part of SUIT_PARTS) {
      for (const side of ['left', 'right'] as const) {
        const hits = zones.filter((z) => z.polygons.some((poly) => pointInPolygon(anchors[part][side], poly)));
        // Zones are stacked back to front; the last hit is what the pointer —
        // and the eye — lands on.
        expect(hits.at(-1)?.part).withContext(`${part} ${side} ${SUIT_ANCHORS_3D[part][side]}`).toBe(part);
      }
    }
    suit.dispose();
  });

  it('gives the drawn fallback a zone for every part too', () => {
    expect(fallbackZones().map((z) => z.part).sort()).toEqual([...SUIT_PARTS].sort());
  });
});

describe('buildHardsuit', () => {
  const palette = { idle: '#3d5a6c', tint: '#f0c27b', accent: '#52c1e6' };

  it('models every position as its own group of real geometry', () => {
    const suit = buildHardsuit(THREE, palette);
    for (const part of SUIT_PARTS) {
      expect(suit.armour[part]).toBeDefined();
    }
    // Six groups, none of them empty — an unequipped position is still a body
    // part, which is the whole reason the empty state stopped being a black box.
    expect(suit.root.children.length).toBe(SUIT_PARTS.length);
    expect(suit.root.children.every((g) => g.children.length > 0)).toBeTrue();
    suit.dispose();
  });

  it('paints equipped in the tint and open in the lifted idle', () => {
    const suit = buildHardsuit(THREE, palette);
    const m = suit.armour.core;

    paintPart(THREE, m, palette, true);
    // Not the raw token: the tint is pulled down into the panel's darkness so
    // an equipped suit lights up instead of turning into a gold statue. What
    // must survive is that it is warm and that it glows.
    expect(m.color.r).toBeGreaterThan(m.color.b);
    expect(m.emissive.getHex()).toBeGreaterThan(0);

    paintPart(THREE, m, palette, false);
    // Lifted toward white, so the open suit reads on the dark panel instead of
    // vanishing into it.
    expect(m.color.getHexString()).not.toBe('3d5a6c');
    expect(m.color.r).toBeGreaterThan(new THREE.Color(palette.idle).r);
    expect(m.emissive.getHex()).toBe(0);

    suit.dispose();
  });
});
