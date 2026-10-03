import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AssetPackageViewerComponent, HOVER_GRACE_MS } from './asset-package-viewer.component';
import { AssetPackageService } from './asset-package.service';
import { CodexService } from '../codex.service';
import { parseManifest, type AssetPackageRow } from './asset-package.model';
import { manifestFixture, placementFixture } from './asset-package.model.spec';

const ROW: AssetPackageRow = {
  kind: 'ship', entityClass: 'AEGS_Gladius', shipId: 'AEGS_Gladius', manifestSha256: 'm', rootSha256: 'root',
  interiorSha256: 'int', partCount: 2, totalBytes: 10, schemaVersion: 1,
};

function emptySlotManifest(): Record<string, unknown> {
  const raw = manifestFixture();
  (raw['placements'] as Record<string, unknown>[]).push(
    placementFixture({
      id: 'empty_gun', portName: 'hardpoint_weapon_left', group: 'weapons', position: [2, 0, 1], rotation: [0, 0, 0, 1],
      port: { minSize: 1, maxSize: 3, types: ['WeaponGun'], flags: [], editable: true }, loadout: 'empty',
    }),
  );
  return raw;
}

describe('AssetPackageViewerComponent (state logic, no WebGL)', () => {
  function create(raw: Record<string, unknown> = manifestFixture()) {
    TestBed.configureTestingModule({
      imports: [AssetPackageViewerComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        // The manifest never arrives: the spec drives the state directly and no
        // three.js scene (WebGL) is ever created.
        { provide: AssetPackageService, useValue: { manifest: () => new Promise(() => undefined), urls: {} } },
        { provide: CodexService, useValue: { resolveEntities: () => Promise.resolve(new Map()) } },
      ],
    });
    const fixture = TestBed.createComponent(AssetPackageViewerComponent);
    fixture.componentRef.setInput('row', ROW);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.manifest.set(parseManifest(raw));
    return { fixture, c };
  }

  /** Stand in for the per-frame projection (no WebGL in Karma). */
  function project(c: AssetPackageViewerComponent, ids: string[]): void {
    c['viewport'].set({ w: 1000, h: 600 });
    c['silhouette'].set({ left: 300, top: 200, right: 700, bottom: 400 });
    c['points'].set(new Map(ids.map((id, i) => [id, { x: 400 + i * 40, y: 300, onScreen: true }] as const)));
  }

  it('starts with interior off and the other groups on', () => {
    const { c } = create();
    expect(c.status()).toBe('loading');
    expect(c.groupsOn().has('interior')).toBeFalse();
    expect(c.visibleIds().has('hardpoint_power_plant')).toBeTrue();
  });

  it('toggles a group and a single placement (with its children)', () => {
    const { c } = create();
    c.toggleGroup('components');
    expect(c.visibleIds().has('hardpoint_power_plant')).toBeFalse();
    c.toggleGroup('components');
    c.togglePlacement('turret');
    expect(c.visibleIds().has('turret')).toBeFalse();
    expect(c.visibleIds().has('turret/gun')).toBeFalse();
    c.togglePlacement('turret');
    expect(c.visibleIds().has('turret/gun')).toBeTrue();
  });

  it('hover/focus x-rays onto one placement and reports its raw port; leaving lingers for the label', fakeAsync(() => {
    const { c } = create();
    const seen: (string[] | null)[] = [];
    c.hovered.subscribe((v) => seen.push(v));
    const pp = c.manifest()!.placements[0];
    c.focus(pp);
    expect(c.focusIds()).toEqual(['hardpoint_power_plant']);
    c.blur(pp);
    // Grace period: the pointer may still reach the label.
    expect(c.focusIds()).toEqual(['hardpoint_power_plant']);
    tick(HOVER_GRACE_MS);
    expect(c.focusIds()).toEqual([]);
    expect(seen).toEqual([['hardpoint_power_plant'], null]);
  }));

  it('entering the label keeps the selection', fakeAsync(() => {
    const { c } = create();
    const pp = c.manifest()!.placements[0];
    c.focus(pp);
    c.blur(pp);
    c.holdLabel();
    tick(HOVER_GRACE_MS * 2);
    expect(c.focusIds()).toEqual(['hardpoint_power_plant']);
    c.releaseLabel();
    tick(HOVER_GRACE_MS);
    expect(c.focusIds()).toEqual([]);
  }));

  it('follows the host list via activePorts', () => {
    const { fixture, c } = create();
    fixture.componentRef.setInput('activePorts', ['turret']);
    expect(c.focusIds()).toEqual(['turret', 'turret/gun']);
    expect(c.labelTarget()?.id).toBe('turret');
  });

  it('a modified click keeps the x-ray (the anchor opens a new tab), a plain one clears it', () => {
    const { c } = create();
    c.focus(c.manifest()!.placements[0]);
    c.onActivate(new MouseEvent('click', { button: 0, ctrlKey: true }));
    expect(c.focusIds().length).toBe(1);
    c.onActivate(new MouseEvent('click', { button: 0 }));
    expect(c.focusIds().length).toBe(0);
  });

  it('lists free attachment slots without a link', () => {
    const { c } = create();
    const optic = c.rows().find((r) => r.p.id === 'optic')!;
    expect(optic.free).toBeTrue();
    expect(optic.link).toBeNull();
  });

  it('labels the selected component outside the hull with a link to its codex page', async () => {
    const { fixture, c } = create();
    c['items'].set(new Map([['POWR_A', { kind: 'component', name: 'Regulus' }]]));
    project(c, ['hardpoint_power_plant']);
    c.status.set('ready');
    c.focus(c.manifest()!.placements[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    const l = c.label()!;
    expect(l.row.name).toBe('Regulus');
    // The anchor sits left of the hull centre: the label goes left, outside the hull.
    expect(l.side).toBe('left');
    expect(l.left + 240).toBeLessThanOrEqual(300);
    const el: HTMLElement = fixture.nativeElement;
    const group = el.querySelector('.clabel')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toContain('Regulus');
    const a = group.querySelector('a.nm') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/codex/component/POWR_A');
    expect(a.getAttribute('aria-label')).toContain('Regulus');
    expect(a.getAttribute('title')).toBeNull();
    expect(el.querySelector('svg.leader line')).not.toBeNull();
    // Step buttons: icon-only, named, no native tooltip.
    const steps = group.querySelectorAll('button.step');
    expect(steps.length).toBe(2);
    steps.forEach((b) => {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBeNull();
    });
  });

  it('steps through the slots, pins the choice and reports its port', () => {
    const { c } = create(emptySlotManifest());
    const seen: (string[] | null)[] = [];
    c.hovered.subscribe((v) => seen.push(v));
    c.step(1);
    expect(c.pinned()).toBe('hardpoint_power_plant');
    c.step(-1);
    expect(c.pinned()).toBe('empty_gun');
    expect(c.focusIds()).toEqual(['empty_gun']);
    c.unpin();
    expect(c.focusIds()).toEqual([]);
    expect(seen).toEqual([['hardpoint_power_plant'], ['hardpoint_weapon_left'], null]);
  });

  it('labels an empty slot as free with the port and what it accepts', () => {
    const { c } = create(emptySlotManifest());
    project(c, ['empty_gun']);
    c.step(-1);
    const l = c.label()!;
    expect(l.empty).toBeTrue();
    expect(l.row.link).toBeNull();
    expect(c.labelMeta(l)).toBe('hardpoint_weapon_left · S3 · WeaponGun');
  });

  it('shows no label without a projected anchor', () => {
    const { c } = create();
    c.focus(c.manifest()!.placements[0]);
    expect(c.label()).toBeNull();
  });
});
