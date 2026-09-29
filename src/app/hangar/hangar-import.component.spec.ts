import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarImportComponent } from './hangar-import.component';
import { HangarService } from './hangar.service';
import { CodexListRow, CodexService } from '../codex/codex.service';
import { AnalyticsService } from '../core/analytics.service';

// Audit D16 step 5: the import preview matches file rows against the codex
// (exact ship_code first, name search as fuzzy fallback) and only writes the
// selected, matched rows that are not yet in the hangar.
describe('HangarImportComponent', () => {
  let fixture: ComponentFixture<HangarImportComponent>;
  let ships: ReturnType<typeof signal<{ shipClassName: string }[]>>;
  let codex: { getShipsByClassNames: jasmine.Spy; listByKind: jasmine.Spy };
  let hangar: { ships: unknown; addShip: jasmine.Spy; updateShip: jasmine.Spy };
  let analytics: { capture: jasmine.Spy };

  function row(slug: string, name: string): CodexListRow {
    return { classNameSlug: slug, nameLocalized: name } as CodexListRow;
  }

  function setup(): void {
    ships = signal<{ shipClassName: string }[]>([]);
    codex = {
      getShipsByClassNames: jasmine.createSpy('exact').and.resolveTo(new Map()),
      listByKind: jasmine.createSpy('fuzzy').and.resolveTo({ rows: [], count: 0 }),
    };
    hangar = {
      ships,
      addShip: jasmine.createSpy('addShip').and.callFake(async (slug: string) => ({ id: 'id-' + slug })),
      updateShip: jasmine.createSpy('updateShip').and.resolveTo(true),
    };
    analytics = { capture: jasmine.createSpy('capture') };
    TestBed.configureTestingModule({
      imports: [HangarImportComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: HangarService, useValue: hangar },
        { provide: AnalyticsService, useValue: analytics },
      ],
    });
    fixture = TestBed.createComponent(HangarImportComponent);
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const badges = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.row .badge')).map((e) => (e as HTMLElement).textContent!.trim());

  async function pickFile(text: string): Promise<void> {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="file"]');
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'x.json', { type: 'application/json' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // file.text() resolves off the microtask queue: poll until parsing is over
    for (let i = 0; i < 50 && !fixture.componentInstance.parseError() && fixture.componentInstance.entries().length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await settle();
  }

  afterEach(() => fixture?.destroy());

  describe('loadRows', () => {
    it('badges an exact ship_code match', async () => {
      setup();
      codex.getShipsByClassNames.and.resolveTo(new Map([['ANVL_Carrack', row('ANVL_Carrack', 'Carrack')]]));
      await fixture.componentInstance.loadRows([{ name: 'Carrack', ship_code: 'ANVL_Carrack' }]);
      fixture.detectChanges();

      expect(badges()).toEqual(['hangar.import.exact']);
      expect(codex.listByKind).not.toHaveBeenCalled();
    });

    it('falls back to a name search and badges it fuzzy', async () => {
      setup();
      codex.listByKind.and.resolveTo({ rows: [row('ANVL_Carrack', 'Carrack')], count: 1 });
      await fixture.componentInstance.loadRows([{ name: 'Carak' }]);
      fixture.detectChanges();

      expect(codex.listByKind).toHaveBeenCalledWith('ship', { search: 'Carak', limit: 1 });
      expect(badges()).toEqual(['hangar.import.fuzzy']);
    });

    it('badges a ship already in the hangar and disables its checkbox', async () => {
      setup();
      ships.set([{ shipClassName: 'ANVL_Carrack' }]);
      codex.getShipsByClassNames.and.resolveTo(new Map([['ANVL_Carrack', row('ANVL_Carrack', 'Carrack')]]));
      await fixture.componentInstance.loadRows([{ name: 'Carrack', ship_code: 'ANVL_Carrack' }]);
      fixture.detectChanges();

      expect(badges()).toEqual(['hangar.add.already']);
      expect((fixture.nativeElement.querySelector('.row input[type="checkbox"]') as HTMLInputElement).disabled).toBeTrue();
    });

    it('badges an unmatched row as no match', async () => {
      setup();
      await fixture.componentInstance.loadRows([{ name: 'Nothing' }]);
      fixture.detectChanges();
      expect(badges()).toEqual(['hangar.import.noMatch']);
    });
  });

  describe('file input', () => {
    it('shows errParse for broken JSON', async () => {
      setup();
      await pickFile('{kaputt');
      expect(fixture.nativeElement.querySelector('.err')?.textContent).toContain('hangar.import.errParse');
    });

    it('shows errNoShips for an object instead of a list', async () => {
      setup();
      await pickFile('{}');
      expect(fixture.nativeElement.querySelector('.err')?.textContent).toContain('hangar.import.errNoShips');
    });

    it('shows errNoShips for a list without ships', async () => {
      setup();
      await pickFile('[{"entity_type":"paint","name":"Skin"}]');
      expect(fixture.nativeElement.querySelector('.err')?.textContent).toContain('hangar.import.errNoShips');
    });
  });

  describe('runImport', () => {
    it('adds the ship, then sets the nickname as customName', async () => {
      setup();
      codex.getShipsByClassNames.and.resolveTo(new Map([['ANVL_Carrack', row('ANVL_Carrack', 'Carrack')]]));
      const order: string[] = [];
      hangar.addShip.and.callFake(async (slug: string) => (order.push('add'), { id: 'id-' + slug }));
      hangar.updateShip.and.callFake(async () => (order.push('update'), true));
      let imported = -1;
      fixture.componentInstance.imported.subscribe((n) => (imported = n));
      await fixture.componentInstance.loadRows([{ name: 'Carrack', ship_name: 'Big Bertha', ship_code: 'ANVL_Carrack' }]);
      fixture.detectChanges();

      await fixture.componentInstance.runImport();
      fixture.detectChanges();

      expect(hangar.addShip).toHaveBeenCalledWith('ANVL_Carrack', 'owned');
      expect(hangar.updateShip).toHaveBeenCalledWith('id-ANVL_Carrack', { customName: 'Big Bertha' });
      expect(order).toEqual(['add', 'update']);
      expect(imported).toBe(1);
      expect(badges()).toEqual(['hangar.add.already']);
      expect(analytics.capture).toHaveBeenCalled();
    });

    it('does not set a customName when the nickname equals the type name', async () => {
      setup();
      codex.getShipsByClassNames.and.resolveTo(new Map([['ANVL_Carrack', row('ANVL_Carrack', 'Carrack')]]));
      await fixture.componentInstance.loadRows([{ name: 'Carrack', ship_name: 'carrack', ship_code: 'ANVL_Carrack' }]);
      await fixture.componentInstance.runImport();
      expect(hangar.addShip).toHaveBeenCalled();
      expect(hangar.updateShip).not.toHaveBeenCalled();
    });

    it('counts only successful writes and leaves failed rows selected', async () => {
      setup();
      codex.getShipsByClassNames.and.resolveTo(new Map([['ANVL_Carrack', row('ANVL_Carrack', 'Carrack')]]));
      hangar.addShip.and.resolveTo(null);
      let imported = -1;
      fixture.componentInstance.imported.subscribe((n) => (imported = n));
      await fixture.componentInstance.loadRows([{ name: 'Carrack', ship_code: 'ANVL_Carrack' }]);
      await fixture.componentInstance.runImport();
      fixture.detectChanges();

      expect(imported).toBe(0);
      expect(analytics.capture).not.toHaveBeenCalled();
      expect(badges()).toEqual(['hangar.import.exact']);
    });
  });
});
