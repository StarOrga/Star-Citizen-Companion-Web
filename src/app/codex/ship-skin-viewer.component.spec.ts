import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ShipSkinViewerComponent } from './ship-skin-viewer.component';
import { ShipSkin, ShipSkinsService } from './ship-skins.service';

function skin(over: Partial<ShipSkin>): ShipSkin {
  return {
    shipId: 'DRAK_Cutlass_Black',
    skinId: 'a',
    name: 'A',
    description: '',
    source: 'store',
    nameVerified: false,
    modelPath: null,
    iconPath: 'DRAK_Cutlass_Black/a.webp',
    modelBytes: null,
    sort: 100,
    ...over,
  };
}

describe('ShipSkinViewerComponent', () => {
  let listSkins: jasmine.Spy;

  async function setup(skins: ShipSkin[], shipId = 'DRAK_Cutlass_Black') {
    listSkins = jasmine.createSpy('listSkins').and.resolveTo({ skins, error: false });
    const svc: Partial<ShipSkinsService> = {
      listSkins,
      assetUrl: (p?: string | null) => (p ? `http://assets/${p}` : null),
    };
    await TestBed.configureTestingModule({
      imports: [ShipSkinViewerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ShipSkinsService, useValue: svc },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShipSkinViewerComponent);
    fixture.componentRef.setInput('shipId', shipId);
    // One CD runs the shipId effect (which calls listSkins). We intentionally do
    // NOT run a second detectChanges after whenStable: that would render the
    // <model-viewer> custom element and spin up a WebGL context in headless
    // Chrome (flaky teardown). These tests assert signal state, not the 3D DOM.
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when the ship has no skins', async () => {
    const fixture = await setup([]);
    expect(fixture.nativeElement.querySelector('.skins')).toBeNull();
    expect(fixture.componentInstance.catalogError()).toBeFalse();
  });

  it('surfaces a retry affordance when the catalog query fails (not silent)', async () => {
    listSkins = jasmine.createSpy('listSkins').and.resolveTo({ skins: [], error: true });
    await TestBed.configureTestingModule({
      imports: [ShipSkinViewerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ShipSkinsService, useValue: { listSkins, assetUrl: () => null } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShipSkinViewerComponent);
    fixture.componentRef.setInput('shipId', 'DRAK_Cutlass_Black');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.catalogError()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.catalog-error')).not.toBeNull();
  });

  it('loads skins for the shipId and auto-selects the first one with a 3D model', async () => {
    const skins = [
      skin({ skinId: 'standard', modelPath: 'DRAK_Cutlass_Black/standard.glb', sort: 10 }),
      skin({ skinId: 'event_only', modelPath: null, sort: 20 }),
    ];
    const fixture = await setup(skins);
    const c = fixture.componentInstance;
    expect(listSkins).toHaveBeenCalledWith('DRAK_Cutlass_Black');
    expect(c.current()?.skinId).toBe('standard');
    expect(c.mode()).toBe('3d');
    expect(c.modelLoading()).toBeTrue(); // glb is loading until <model-viewer> fires (load)
  });

  it('falls back to paint mode when no skin has a 3D model', async () => {
    const fixture = await setup([skin({ skinId: 'event_only', modelPath: null })]);
    expect(fixture.componentInstance.mode()).toBe('paint');
  });

  it('select() switches current skin and resets mode by 3D availability', async () => {
    const skins = [
      skin({ skinId: 'standard', modelPath: 'm.glb' }),
      skin({ skinId: 'paintonly', modelPath: null }),
    ];
    const fixture = await setup(skins);
    const c = fixture.componentInstance;
    c.select(skins[1]);
    expect(c.current()?.skinId).toBe('paintonly');
    expect(c.mode()).toBe('paint');
  });

  it('setMode() refuses 3D when the current skin has no model', async () => {
    const fixture = await setup([skin({ skinId: 'paintonly', modelPath: null })]);
    const c = fixture.componentInstance;
    c.setMode('3d');
    expect(c.mode()).toBe('paint');
  });

  it('onKey() activates a skin on Enter (keyboard a11y)', async () => {
    const skins = [skin({ skinId: 'standard', modelPath: 'm.glb' }), skin({ skinId: 'b' })];
    const fixture = await setup(skins);
    const c = fixture.componentInstance;
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    spyOn(ev, 'preventDefault');
    c.onKey(ev, skins[1]);
    expect(c.current()?.skinId).toBe('b');
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('onModelError() surfaces an error state; onModelLoad() clears loading', async () => {
    const fixture = await setup([skin({ skinId: 'standard', modelPath: 'm.glb' })]);
    const c = fixture.componentInstance;
    c.onModelError();
    expect(c.modelError()).toBeTrue();
    c.onModelLoad();
    expect(c.modelError()).toBeFalse();
    expect(c.modelLoading()).toBeFalse();
  });

  it('reloads and replaces skins when the shipId input changes (race-safe)', async () => {
    const fixture = await setup([skin({ skinId: 'cutlass_a', modelPath: 'm.glb' })]);
    const c = fixture.componentInstance;
    expect(c.current()?.skinId).toBe('cutlass_a');

    listSkins.and.resolveTo({
      skins: [skin({ shipId: 'AEGS_Gladius', skinId: 'gladius_a' })],
      error: false,
    });
    fixture.componentRef.setInput('shipId', 'AEGS_Gladius');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listSkins).toHaveBeenCalledWith('AEGS_Gladius');
    expect(c.skins().length).toBe(1);
    expect(c.current()?.skinId).toBe('gladius_a');
  });
});
