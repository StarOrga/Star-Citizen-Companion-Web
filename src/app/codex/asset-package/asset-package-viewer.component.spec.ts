import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AssetPackageViewerComponent } from './asset-package-viewer.component';
import { AssetPackageService } from './asset-package.service';
import { CodexService } from '../codex.service';
import { parseManifest, type AssetPackageRow } from './asset-package.model';
import { manifestFixture } from './asset-package.model.spec';

const ROW: AssetPackageRow = {
  kind: 'ship', entityClass: 'AEGS_Gladius', shipId: 'AEGS_Gladius', manifestSha256: 'm', rootSha256: 'root',
  interiorSha256: 'int', partCount: 2, totalBytes: 10, schemaVersion: 1,
};

describe('AssetPackageViewerComponent (state logic, no WebGL)', () => {
  function create() {
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
    c.manifest.set(parseManifest(manifestFixture()));
    return { fixture, c };
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

  it('hover/focus x-rays onto one placement and reports its raw port', () => {
    const { c } = create();
    const seen: (string[] | null)[] = [];
    c.hovered.subscribe((v) => seen.push(v));
    const pp = c.manifest()!.placements[0];
    c.focus(pp);
    expect(c.focusIds()).toEqual(['hardpoint_power_plant']);
    c.blur(pp);
    expect(c.focusIds()).toEqual([]);
    expect(seen).toEqual([['hardpoint_power_plant'], null]);
  });

  it('follows the host list via activePorts', () => {
    const { fixture, c } = create();
    fixture.componentRef.setInput('activePorts', ['turret']);
    expect(c.focusIds()).toEqual(['turret', 'turret/gun']);
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
});
