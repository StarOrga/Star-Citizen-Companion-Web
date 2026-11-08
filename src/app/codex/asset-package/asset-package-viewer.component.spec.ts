import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { AssetPackageViewerComponent, HOVER_GRACE_MS } from './asset-package-viewer.component';
import { AssetPackageService } from './asset-package.service';
import { CodexService } from '../codex.service';
import { parseManifest, type AssetPackageRow } from './asset-package.model';
import { calloutSize } from './holo-overlay';
import { manifestFixture, placementFixture } from './asset-package.testing';

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
    expect(c.groupsOn().has('interior')).toBe(false);
    expect(c.visibleIds().has('hardpoint_power_plant')).toBe(true);
  });

  it('toggles a group and a single placement (with its children)', () => {
    const { c } = create();
    c.toggleGroup('components');
    expect(c.visibleIds().has('hardpoint_power_plant')).toBe(false);
    c.toggleGroup('components');
    c.togglePlacement('turret');
    expect(c.visibleIds().has('turret')).toBe(false);
    expect(c.visibleIds().has('turret/gun')).toBe(false);
    c.togglePlacement('turret');
    expect(c.visibleIds().has('turret/gun')).toBe(true);
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
    expect(optic.free).toBe(true);
    expect(optic.link).toBeNull();
  });

  it('labels the selected component outside the hull with a link to its codex page', async () => {
    const { fixture, c } = create();
    const t = TestBed.inject(TranslateService);
    t.setTranslation('en', {
      codex: { assetPackage: { label: { aria: 'Selected slot: {{name}}', open: 'Open {{name}} in the Codex', prev: 'Previous slot', next: 'Next slot' } } },
    });
    t.use('en');
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
    expect(l.empty).toBe(true);
    expect(l.row.link).toBeNull();
    expect(c.labelMeta(l)).toBe('hardpoint_weapon_left · S3 · WeaponGun');
  });

  it('shows no label without a projected anchor', () => {
    const { c } = create();
    c.focus(c.manifest()!.placements[0]);
    expect(c.label()).toBeNull();
  });

  it('moving from one hotspot to its neighbour retargets at once, never through "nothing"', () => {
    const { c } = create();
    const seen: (string[] | null)[] = [];
    c.hovered.subscribe((v) => seen.push(v));
    const [a, b] = c.manifest()!.placements;
    c.focus(a);
    c.blur(a);
    c.focus(b);
    expect(c.localFocus()).toBe(b.id);
    expect(seen).toEqual([[a.portName], [b.portName]]);
  });

  it('Escape clears a pin or hover label, swallows the key only then, and ignores a dialog above', async () => {
    const { fixture, c } = create();
    const outer = vi.fn().mockName('outer');
    document.addEventListener('keydown', outer);
    const press = () => {
      const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
    };
    // Nothing selected: no listener, the stage's own Escape sees the key.
    press();
    expect(outer).toHaveBeenCalledTimes(1);

    c.step(1);
    fixture.detectChanges();
    await fixture.whenStable();
    press();
    expect(c.pinned()).toBeNull();
    expect(outer).toHaveBeenCalledTimes(1);

    c.focus(c.manifest()!.placements[0]);
    fixture.detectChanges();
    await fixture.whenStable();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    press();
    expect(c.localFocus()).not.toBeNull();
    expect(outer).toHaveBeenCalledTimes(2);
    dlg.remove();
    press();
    expect(c.localFocus()).toBeNull();
    expect(outer).toHaveBeenCalledTimes(2);
    document.removeEventListener('keydown', outer);
  });

  describe('table interaction', () => {
    function table(raw: Record<string, unknown> = manifestFixture()) {
      const made = create(raw);
      made.fixture.componentRef.setInput('interaction', 'table');
      made.c['items'].set(new Map([['POWR_A', { kind: 'component', name: 'Regulus' }]]));
      return made;
    }

    it('a hover lights the part without the see-through, a selection turns it on and holds', () => {
      const { c } = table();
      const seen: unknown[] = [];
      c.selectionChange.subscribe((v) => seen.push(v?.id ?? null));
      const pp = c.manifest()!.placements[0];
      c.focus(pp);
      expect(c.focusIds()).toEqual([pp.id]);
      expect(c['seeThrough']()).toBe(false);
      c.blur(pp);
      expect(c.focusIds()).toEqual([]);

      c.onPick(new MouseEvent('click', { button: 0, cancelable: true }), c.toRowFor(pp));
      expect(c.pinned()).toBe(pp.id);
      expect(c['seeThrough']()).toBe(true);
      expect(seen).toEqual([pp.id]);
      // The pointer goes on to a neighbour: the selection and its see-through stay, both are lit.
      const other = c.manifest()!.placements[1];
      c.focus(other);
      expect(c.focusIds()).toContain(pp.id);
      expect(c.focusIds()).toContain(other.id);
      c.blur(other);
      expect(c.pinned()).toBe(pp.id);
      expect(c.clearSelection()).toBe(true);
      expect(seen).toEqual([pp.id, null]);
    });

    it('a plain click on a dot selects instead of navigating, a modified click stays the browser\'s', async () => {
      const { fixture, c } = table();
      project(c, ['hardpoint_power_plant']);
      c.status.set('ready');
      fixture.detectChanges();
      await fixture.whenStable();
      const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockReturnValue(undefined as never);
      const a = (fixture.nativeElement as HTMLElement).querySelector('a.hs') as HTMLAnchorElement;
      expect(a.getAttribute('href')).toBe('/codex/component/POWR_A');
      expect(a.getAttribute('title')).toBeNull();

      const ctrl = new MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true, bubbles: true });
      // Keep Karma's page: only the viewer's own reaction is under test here.
      const stop = (ev: Event) => ev.preventDefault();
      a.parentElement!.addEventListener('click', stop);
      a.dispatchEvent(ctrl);
      a.parentElement!.removeEventListener('click', stop);
      expect(c.pinned()).toBeNull();

      const plain = new MouseEvent('click', { button: 0, cancelable: true, bubbles: true });
      a.dispatchEvent(plain);
      expect(plain.defaultPrevented).toBe(true);
      expect(c.pinned()).toBe('hardpoint_power_plant');
      expect(nav).not.toHaveBeenCalled();
    });

    it('names the hovered dot with a tag that never takes the pointer, not a tooltip bubble', async () => {
      const { fixture, c } = table();
      project(c, ['hardpoint_power_plant']);
      c.status.set('ready');
      c.focus(c.byId().get('hardpoint_power_plant')!);
      fixture.detectChanges();
      await fixture.whenStable();
      const tag = (fixture.nativeElement as HTMLElement).querySelector('.dot-name') as HTMLElement;
      expect(tag.textContent).toContain('Regulus');
      expect(getComputedStyle(tag).pointerEvents).toBe('none');
      c.select(c.byId().get('hardpoint_power_plant')!);
      expect(c.hoverTag()).toBeNull();
    });

    it('takes the selection from the host by port or id and does not echo it', () => {
      const { fixture, c } = table();
      const seen: unknown[] = [];
      c.selectionChange.subscribe((v) => seen.push(v));
      fixture.componentRef.setInput('selectedPort', 'HARDPOINT_POWER_PLANT');
      fixture.detectChanges();
      expect(c.pinned()).toBe('hardpoint_power_plant');
      fixture.componentRef.setInput('selectedPort', null);
      fixture.detectChanges();
      expect(c.pinned()).toBeNull();
      expect(seen).toEqual([]);
    });

    function withSwappable(): Record<string, unknown> {
      const raw = manifestFixture();
      const list = raw['placements'] as Record<string, unknown>[];
      for (const p of list) if (p['id'] === 'hardpoint_power_plant') p['port'] = { minSize: 1, maxSize: 1, types: ['PowerPlant'], flags: [], editable: true };
      return raw;
    }

    it('shows swappable dots by default; the chip at the end of the row shows all', async () => {
      const { fixture, c } = table(withSwappable());
      const ids = c.manifest()!.placements.filter((p) => p.position && p.itemClass).map((p) => p.id);
      project(c, ids);
      c.status.set('ready');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(c.hotspots().map((h) => h.p.id)).toEqual(['hardpoint_power_plant']);
      const el: HTMLElement = fixture.nativeElement;
      const chips = el.querySelectorAll('.bar .chip');
      const toggle = chips[chips.length - 1] as HTMLButtonElement;
      expect(toggle.classList).toContain('all-parts');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      toggle.click();
      expect(c.hotspotScope()).toBe('all');
      expect(c.hotspots().length).toBeGreaterThan(1);
      expect(c.hotspots().filter((h) => h.minor).length).toBe(c.hotspots().length - 1);
    });

    it('gives an out-of-scope part the panel points at a dot, without moving the others', () => {
      const { fixture, c } = table(withSwappable());
      const ids = c.manifest()!.placements.filter((p) => p.position && p.itemClass).map((p) => p.id);
      project(c, ids);
      const before = c.hotspots().map((h) => [h.p.id, h.x, h.y]);
      const other = ids.find((id) => id !== 'hardpoint_power_plant')!;
      fixture.componentRef.setInput('selectedPort', other);
      fixture.detectChanges();
      const after = c.hotspots();
      expect(after.length).toBeGreaterThan(before.length);
      expect(after.slice(0, before.length).map((h) => [h.p.id, h.x, h.y])).toEqual(before as never);
    });

    it('keeps relevant parts lit and quiet ones reachable', async () => {
      const { fixture, c } = table();
      const ids = c.manifest()!.placements.filter((p) => p.position && p.itemClass).map((p) => p.id);
      project(c, ids);
      fixture.componentRef.setInput('hotspotScope', 'all');
      fixture.componentRef.setInput('relevantPorts', new Set(['turret']));
      c.status.set('ready');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(c.quietIds().has('turret')).toBe(false);
      expect(c.quietIds().has('turret/gun')).toBe(false);
      expect(c.quietIds().has('hardpoint_power_plant')).toBe(true);
      const quiet = (fixture.nativeElement as HTMLElement).querySelector('.hs.q') as HTMLElement;
      expect(quiet).not.toBeNull();
      expect(getComputedStyle(quiet).pointerEvents).toBe('auto');
      fixture.componentRef.setInput('relevantPorts', new Set());
      expect(c.quietIds().size).toBe(0);
    });

    it('sets the callout in a gutter, fixed, and offers the swap only on a swappable port', async () => {
      const { fixture, c } = table(withSwappable());
      project(c, ['hardpoint_power_plant']);
      fixture.componentRef.setInput('safeArea', { left: 190, right: 190 });
      fixture.componentRef.setInput('calloutValues', [{ label: 'Size', value: 'S1' }]);
      fixture.detectChanges();
      c.select(c.byId().get('hardpoint_power_plant')!);
      c.status.set('ready');
      fixture.detectChanges();
      await fixture.whenStable();
      const co = c.callout()!;
      expect(c.label()).toBeNull();
      expect(co.left + calloutSize(window.innerWidth).w).toBeLessThanOrEqual(190);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.callout .co-nm')!.textContent).toContain('Regulus');
      const swaps: unknown[] = [];
      c.swapRequested.subscribe((v) => swaps.push(v.id));
      (el.querySelector('.co-swap') as HTMLButtonElement).click();
      expect(swaps).toEqual(['hardpoint_power_plant']);
      // No gutter (phone): the panel carries it alone, the anchor stays readable.
      fixture.componentRef.setInput('safeArea', null);
      expect(c.callout()).toBeNull();
      expect(c.selectionAnchor()).not.toBeNull();
    });

    function wheel(init: WheelEventInit): WheelEvent {
      return new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true, composed: true, ...init });
    }

    it('leaves a wheel without Ctrl to the page and hints once; Ctrl + wheel zooms', fakeAsync(() => {
      const { fixture, c } = table();
      const zoomBy = vi.fn().mockName('zoomBy');
      c['scene'] = { zoomBy, dispose: () => undefined, setFocus: () => undefined, setPaused: () => undefined } as never;
      const host: HTMLElement = fixture.nativeElement;
      const orbit = vi.fn().mockName('orbit');
      const canvas = host.querySelector('canvas')!;
      canvas.addEventListener('wheel', orbit);

      const plain = wheel({});
      canvas.dispatchEvent(plain);
      expect(plain.defaultPrevented).toBe(false);
      expect(orbit).not.toHaveBeenCalled();
      expect(zoomBy).not.toHaveBeenCalled();
      expect(c.wheelHint()).toBe(true);
      tick(5000);
      expect(c.wheelHint()).toBe(false);
      canvas.dispatchEvent(wheel({}));
      expect(c.wheelHint()).toBe(false);

      const ctrl = wheel({ ctrlKey: true });
      canvas.dispatchEvent(ctrl);
      expect(ctrl.defaultPrevented).toBe(true);
      expect(zoomBy).toHaveBeenCalledTimes(1);
      expect(zoomBy).toHaveBeenCalledWith(100);
      c['scene'] = null;
    }));

    it('the classic viewer leaves the wheel, the click and the hover x-ray alone', () => {
      const { fixture, c } = create();
      const pp = c.manifest()!.placements[0];
      c.focus(pp);
      expect(c['seeThrough']()).toBe(true);
      c['scene'] = { zoomBy: () => undefined, dispose: () => undefined, setFocus: () => undefined, setPaused: () => undefined } as never;
      const plain = wheel({});
      const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
      const orbit = vi.fn().mockName('orbit');
      canvas.addEventListener('wheel', orbit);
      canvas.dispatchEvent(plain);
      expect(orbit).toHaveBeenCalled();
      expect(c.wheelHint()).toBe(false);
      c['scene'] = null;
    });
  });

  it('fans stacked hotspots apart, has no tooltip bubble and offers a reset-view chip', () => {
    const { fixture, c } = create();
    c['viewport'].set({ w: 1000, h: 600 });
    const withPos = c.manifest()!.placements.filter((p) => p.position).slice(0, 2);
    c['points'].set(new Map(withPos.map((p, i) => [p.id, { x: 400 + i * 2, y: 300, onScreen: true }] as const)));
    c.status.set('ready');
    fixture.detectChanges();
    const hs = c.hotspots();
    expect(hs.length).toBeGreaterThanOrEqual(2);
    expect(Math.hypot(hs[0].x - hs[1].x, hs[0].y - hs[1].y)).toBeGreaterThanOrEqual(17.9);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.hs').length).toBe(hs.length);
    el.querySelectorAll('.hs').forEach((d) => expect(d.getAttribute('aria-label')).toBeTruthy());
    expect(el.querySelector('.bar .reset-view')).not.toBeNull();
  });
});
