import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarShipDetailComponent } from './hangar-ship-detail.component';
import { HangarService } from './hangar.service';
import { CodexService } from '../codex/codex.service';
import { CodexHoloForkGuard } from '../codex/holo/codex-holo-fork-guard';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';
import { HangarShipConfig } from './hangar.types';
import { ShipSkinViewerComponent } from '../codex/ship-skin-viewer.component';
import { UpcomingShipsService } from '../codex/upcoming-ships.service';
import { provideNoShipBlueprints } from '../codex/ship-blueprint/ship-blueprint.testing';

/** The RSI feed only adds the hero picture; specs get none. */
const rsiStub = { ensureLoaded: () => Promise.resolve(), heroArtFor: () => [] as string[] };

@Component({ selector: 'sc-ship-skin-viewer', standalone: true, template: '' })
class StubSkinViewerComponent {
  readonly shipId = input<string>();
}

function makeRoute(id: string): Partial<ActivatedRoute> {
  return {
    snapshot: { paramMap: { get: () => id } } as unknown as ActivatedRoute['snapshot'],
  };
}

// Audit D05 step 7 (AUD-050): a failed ship read is not "this entry does not
// exist" — the page shows the error kind with a retry that reads again.
describe('HangarShipDetailComponent load failure', () => {
  let fixture: ComponentFixture<HangarShipDetailComponent>;
  let getShip: jasmine.Spy;

  function setup(): void {
    getShip = jasmine.createSpy('getShip');
    TestBed.configureTestingModule({
      imports: [HangarShipDetailComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: HangarService,
          useValue: {
            ships: signal([{ id: 'other' }]),
            loadAll: jasmine.createSpy('loadAll').and.resolveTo(),
            getShip,
            listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
          },
        },
        { provide: CodexService, useValue: {} },
        { provide: UpcomingShipsService, useValue: rsiStub },
        provideNoShipBlueprints(),
        { provide: CodexHoloForkGuard, useValue: {} },
        { provide: ScConfirmService, useValue: {} },
        { provide: ActivatedRoute, useValue: makeRoute('ship-1') },
      ],
    });
    fixture = TestBed.createComponent(HangarShipDetailComponent);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows the error kind with a retry instead of "not found"', async () => {
    spyOn(console, 'warn');
    setup();
    getShip.and.rejectWith(new TypeError('Failed to fetch'));
    await settle();

    const card: HTMLElement | null = fixture.nativeElement.querySelector('.sc-card.err[role="alert"]');
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain('errors.network');
    expect(card?.querySelector('button.retry')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('hangar.detail.notFound');
    expect(fixture.nativeElement.textContent).not.toContain('Failed to fetch');
  });

  it('retry reads the remembered id again', async () => {
    spyOn(console, 'warn');
    setup();
    getShip.and.rejectWith(new TypeError('Failed to fetch'));
    await settle();

    getShip.and.resolveTo(null);
    (fixture.nativeElement.querySelector('button.retry') as HTMLButtonElement).click();
    await settle();

    expect(getShip).toHaveBeenCalledTimes(2);
    expect(getShip.calls.mostRecent().args).toEqual(['ship-1']);
    expect(fixture.nativeElement.querySelector('.sc-card.err')).toBeNull();
    // The second read found no row — only now is "not found" the honest answer.
    expect(fixture.nativeElement.textContent).toContain('hangar.detail.notFound');
  });
});

// Audit D16 step 5 (AUD-053, REQ-9): the write paths of the ship detail page.
// A failed write (service answers null/false) leaves list and draft untouched.
// The page renders no write error today (AUD-053 gap) — only state is asserted.
describe('HangarShipDetailComponent writes', () => {
  let fixture: ComponentFixture<HangarShipDetailComponent>;
  let hangar: Record<string, jasmine.Spy>;
  let confirm: jasmine.Spy;
  let ensureEditable: jasmine.Spy;
  let codexDetail: jasmine.Spy;

  const SHIP = {
    id: 'ship-1',
    shipClassName: 'ANVL_Carrack',
    customName: null,
    status: 'owned',
    pinnedRank: null,
    selectedSkinId: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  function cfg(id: string, name: string, extra: Record<string, unknown> = {}): HangarShipConfig {
    return {
      id,
      hangarShipId: 'ship-1',
      name,
      role: 'combat',
      loadout: [{ portName: 'hp1', className: 'wpn_x', kind: 'item' }],
      isActive: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      sourceConfigId: null,
      followsOwner: false,
      ownerUserId: null,
      forkedAt: null,
      ...extra,
    } as HangarShipConfig;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** `detail`: what the Codex lookup answers; an Error makes it fail. */
  async function setup(configs: HangarShipConfig[] = [], detail: unknown = null): Promise<void> {
    codexDetail = jasmine.createSpy('getDetail');
    if (detail instanceof Error) codexDetail.and.rejectWith(detail);
    else codexDetail.and.resolveTo(detail);
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    ensureEditable = jasmine.createSpy('ensureEditable').and.resolveTo('own');
    hangar = {
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(),
      getShip: jasmine.createSpy('getShip').and.resolveTo({ ...SHIP }),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo(configs),
      createConfig: jasmine.createSpy('createConfig').and.resolveTo(null),
      deleteConfig: jasmine.createSpy('deleteConfig').and.resolveTo(true),
      updateConfig: jasmine.createSpy('updateConfig').and.resolveTo(null),
      forkFollowedLoadout: jasmine.createSpy('forkFollowedLoadout').and.resolveTo(null),
      updateShip: jasmine.createSpy('updateShip').and.resolveTo(false),
      removeShip: jasmine.createSpy('removeShip').and.resolveTo(false),
    };
    TestBed.configureTestingModule({
      imports: [HangarShipDetailComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: HangarService, useValue: { ships: signal([{ id: 'other' }]), ...hangar } },
        {
          provide: CodexService,
          useValue: {
            getDetail: codexDetail,
            resolveEntities: jasmine.createSpy('resolveEntities').and.resolveTo(new Map()),
            getEntityPayloads: jasmine.createSpy('getEntityPayloads').and.resolveTo(new Map()),
            previewUrl: () => null,
          },
        },
        { provide: UpcomingShipsService, useValue: rsiStub },
        provideNoShipBlueprints(),
        { provide: CodexHoloForkGuard, useValue: { ensureEditable } },
        { provide: ScConfirmService, useValue: { confirm } },
        { provide: ActivatedRoute, useValue: makeRoute('ship-1') },
      ],
    });
    // The real viewer talks to Supabase/model-viewer and never lets the zone settle.
    TestBed.overrideComponent(HangarShipDetailComponent, {
      remove: { imports: [ShipSkinViewerComponent] },
      add: { imports: [StubSkinViewerComponent] },
    });
    fixture = TestBed.createComponent(HangarShipDetailComponent);
    await settle();
  }

  const q = <T extends Element>(sel: string): T | null => fixture.nativeElement.querySelector(sel);
  const tabEls = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.cfg-tab'));

  function type(sel: string, value: string): void {
    const el = q<HTMLInputElement | HTMLTextAreaElement>(sel)!;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function click(sel: string): Promise<void> {
    q<HTMLElement>(sel)!.click();
    await settle();
  }

  /** Marks the draft dirty through the public reset of a stock port. */
  async function makeDirty(): Promise<void> {
    fixture.componentInstance.resetPort({ port: { portName: 'hp1' } } as never);
    await settle();
  }

  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((e) => e.replaceChildren());
  });

  it('uses app sc-select pickers for pin and role, never a native select (REQ-9)', async () => {
    await setup();
    expect(q('sc-select.pin-select')).toBeTruthy();
    expect(q('sc-select.role-select')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
  });

  describe('createConfig', () => {
    it('adds the new config in front, selects it and clears the name', async () => {
      await setup([cfg('c1', 'Old')]);
      hangar['createConfig'].and.resolveTo(cfg('c2', 'Mining rig', { role: 'mining' }));
      type('.cfg-name', '  Mining rig ');
      await settle();
      await click('.new-config .sc-btn');

      expect(hangar['createConfig']).toHaveBeenCalledWith('ship-1', 'Mining rig', 'multipurpose');
      expect(tabEls().length).toBe(2);
      expect(tabEls()[0].textContent).toContain('Mining rig');
      expect(tabEls()[0].classList).toContain('active');
      expect(q<HTMLInputElement>('.cfg-name')!.value).toBe('');
    });

    it('keeps list and name when the service returns null', async () => {
      await setup([cfg('c1', 'Old')]);
      type('.cfg-name', 'Broken');
      await settle();
      await click('.new-config .sc-btn');

      expect(hangar['createConfig']).toHaveBeenCalled();
      expect(tabEls().length).toBe(1);
      expect(q<HTMLInputElement>('.cfg-name')!.value).toBe('Broken');
    });

    it('does not call the service for a blank name', async () => {
      await setup();
      expect(q<HTMLButtonElement>('.new-config .sc-btn')!.disabled).toBeTrue();
      await fixture.componentInstance.createConfig();
      expect(hangar['createConfig']).not.toHaveBeenCalled();
    });
  });

  describe('deleteConfig', () => {
    it('asks first and removes the config on confirm', async () => {
      await setup([cfg('c1', 'One'), cfg('c2', 'Two')]);
      await click('.cfg-actions .danger');

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.calls.mostRecent().args[0].params).toEqual({ name: 'One' });
      expect(hangar['deleteConfig']).toHaveBeenCalledWith('c1');
      expect(tabEls().length).toBe(1);
      expect(tabEls()[0].textContent).toContain('Two');
      expect(tabEls()[0].classList).toContain('active');
    });

    it('does nothing when the dialog is cancelled', async () => {
      await setup([cfg('c1', 'One')]);
      confirm.and.resolveTo(false);
      await click('.cfg-actions .danger');

      expect(hangar['deleteConfig']).not.toHaveBeenCalled();
      expect(tabEls().length).toBe(1);
    });

    it('keeps the config when the delete fails', async () => {
      await setup([cfg('c1', 'One')]);
      hangar['deleteConfig'].and.resolveTo(false);
      await click('.cfg-actions .danger');

      expect(hangar['deleteConfig']).toHaveBeenCalledWith('c1');
      expect(tabEls().length).toBe(1);
    });
  });

  describe('saveLoadout', () => {
    it('writes the draft through the fork guard and clears dirty', async () => {
      await setup([cfg('c1', 'One')]);
      await makeDirty();
      expect(q('.cfg-actions .primary')).toBeTruthy();
      hangar['updateConfig'].and.resolveTo(cfg('c1', 'One saved', { loadout: [] }));
      await click('.cfg-actions .primary');

      expect(ensureEditable).toHaveBeenCalled();
      expect(hangar['updateConfig']).toHaveBeenCalledWith('c1', { loadout: [] });
      expect(q('.cfg-actions .primary')).toBeNull();
      expect(tabEls()[0].textContent).toContain('One saved');
    });

    it('stays dirty and keeps the list when the write returns null', async () => {
      await setup([cfg('c1', 'One')]);
      await makeDirty();
      await click('.cfg-actions .primary');

      expect(hangar['updateConfig']).toHaveBeenCalled();
      expect(q('.cfg-actions .primary')).toBeTruthy();
      expect(fixture.componentInstance.dirty()).toBeTrue();
      expect(tabEls()[0].textContent).toContain('One');
    });

    it('writes nothing when the fork guard is cancelled', async () => {
      await setup([cfg('c1', 'One', { followsOwner: true })]);
      ensureEditable.and.resolveTo('cancelled');
      await makeDirty();
      await click('.cfg-actions .primary');

      expect(hangar['updateConfig']).not.toHaveBeenCalled();
      expect(hangar['forkFollowedLoadout']).not.toHaveBeenCalled();
      expect(q('.cfg-actions .primary')).toBeTruthy();
    });

    it('writes the fork instead of the row after a confirmed fork', async () => {
      await setup([cfg('c1', 'One', { followsOwner: true })]);
      ensureEditable.and.resolveTo('forked');
      hangar['forkFollowedLoadout'].and.resolveTo(cfg('c1', 'One', { loadout: [] }));
      await makeDirty();
      await click('.cfg-actions .primary');

      expect(hangar['forkFollowedLoadout']).toHaveBeenCalledWith('c1', { loadout: [] });
      expect(hangar['updateConfig']).not.toHaveBeenCalled();
      expect(q('.cfg-actions .primary')).toBeNull();
    });
  });

  describe('saveName', () => {
    it('stores the trimmed name and shows it', async () => {
      await setup();
      hangar['updateShip'].and.resolveTo(true);
      await click('.name-row .icon-btn');
      type('.name-input', '  Nomad ');
      await settle();
      await click('.name-row .sc-btn');

      expect(hangar['updateShip']).toHaveBeenCalledWith('ship-1', { customName: 'Nomad' });
      expect(q('h1')!.textContent).toContain('Nomad');
    });

    it('keeps the old name when the write fails', async () => {
      await setup();
      const before = q('h1')!.textContent;
      await click('.name-row .icon-btn');
      type('.name-input', 'Nomad');
      await settle();
      await click('.name-row .sc-btn');

      expect(hangar['updateShip']).toHaveBeenCalledWith('ship-1', { customName: 'Nomad' });
      expect(q('h1')!.textContent).toBe(before);
      expect(q('h1')!.textContent).not.toContain('Nomad');
    });
  });

  describe('saveNotes', () => {
    it('stores the notes and hides the save button', async () => {
      await setup();
      hangar['updateShip'].and.resolveTo(true);
      expect(q('.notes .sc-btn')).toBeNull();
      type('.notes textarea', 'Fuel first');
      await settle();
      await click('.notes .sc-btn');

      expect(hangar['updateShip']).toHaveBeenCalledWith('ship-1', { notes: 'Fuel first' });
      expect(q('.notes .sc-btn')).toBeNull();
    });

    it('writes the trimmed notes', async () => {
      await setup();
      hangar['updateShip'].and.resolveTo(true);
      type('.notes textarea', ' Fuel first ');
      await settle();
      await click('.notes .sc-btn');

      expect(hangar['updateShip']).toHaveBeenCalledWith('ship-1', { notes: 'Fuel first' });
    });

    it('keeps the draft and the save button when the write fails', async () => {
      await setup();
      type('.notes textarea', 'Fuel first');
      await settle();
      await click('.notes .sc-btn');

      expect(hangar['updateShip']).toHaveBeenCalledWith('ship-1', { notes: 'Fuel first' });
      expect(q('.notes .sc-btn')).toBeTruthy();
      expect(q<HTMLTextAreaElement>('.notes textarea')!.value).toBe('Fuel first');
    });
  });

  describe('hero', () => {
    it('names the ship readably, never by its raw class name, and shows the class as a chip', async () => {
      await setup();
      expect(q('h1')!.textContent!.trim()).toBe('ANVL Carrack');
      expect(q('sc-class-chip')!.textContent).toContain('ANVL_Carrack');
      // No render anywhere: the ship glyph stands in, never an empty frame.
      expect(q('.hero-art sc-codex-icon')).toBeTruthy();
    });

    it('takes the catalog name and maker once the Codex data is there', async () => {
      await setup([], {
        payload: { name: { de: 'Carrack', en: 'Carrack', key: 'k' }, manufacturer: { code: 'ANVL', name: { de: 'Anvil Aerospace', en: 'Anvil Aerospace', key: 'm' } } },
        ports: [],
        row: { name_localized: 'Anvil Carrack' },
      });
      expect(q('h1')!.textContent!.trim()).toBe('Carrack');
      expect(q('.sc-detail-mfr')!.textContent!.trim()).toBe('Anvil Aerospace');
      expect(q('.codex-err')).toBeNull();
    });

    it('says when the Codex data failed, with a retry, and keeps the rest of the page', async () => {
      await setup([], new TypeError('Failed to fetch'));
      expect(q('.codex-err[role="alert"]')).toBeTruthy();
      expect(q('sc-select.pin-select')).toBeTruthy();

      codexDetail.and.resolveTo(null);
      await click('.codex-err .retry');
      expect(codexDetail).toHaveBeenCalledTimes(2);
      expect(q('.codex-err')).toBeNull();
    });

    it('links into the ship\'s Codex page', async () => {
      await setup();
      const link = Array.from(fixture.nativeElement.querySelectorAll('.head-actions a')) as HTMLAnchorElement[];
      expect(link.map((a) => a.getAttribute('href'))).toContain('/codex/ship/ANVL_Carrack');
    });
  });

  describe('remove', () => {
    it('asks and does not remove on cancel', async () => {
      await setup();
      confirm.and.resolveTo(false);
      await click('.head-actions .danger');

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(hangar['removeShip']).not.toHaveBeenCalled();
    });

    it('removes the ship after confirmation', async () => {
      await setup();
      await click('.head-actions .danger');
      expect(hangar['removeShip']).toHaveBeenCalledWith('ship-1');
    });
  });
});
