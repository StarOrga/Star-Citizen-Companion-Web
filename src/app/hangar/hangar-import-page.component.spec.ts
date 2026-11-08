import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarImportPageComponent } from './hangar-import-page.component';
import { HangarImportComponent } from './hangar-import.component';
import { ExtensionBridgeService } from './extension-bridge.service';
import { AnalyticsService } from '../core/analytics.service';
import { LocaleService } from '../core/locale/locale.service';
import { CodexService } from '../codex/codex.service';
import { HangarService } from './hangar.service';

// Smoke for /hangar/import: waits for the extension, hands the rows to the
// shared import UI, and shows the empty state when nothing arrives.
describe('HangarImportPageComponent', () => {
  let fixture: ComponentFixture<HangarImportPageComponent>;
  let bridge: { waitForExtension: Mock; requestPayload: Mock; confirmImported: Mock; discard: Mock };

  const SHIPS = [{ name: 'Carrack', ship_name: null, ship_code: 'ANVL_Carrack', entity_type: 'ship' }];

  async function setup(payload: unknown): Promise<void> {
    bridge = {
      waitForExtension: vi.fn().mockResolvedValue(true),
      requestPayload: vi.fn().mockResolvedValue(payload),
      confirmImported: vi.fn(),
      discard: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [HangarImportPageComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ExtensionBridgeService, useValue: bridge },
        { provide: AnalyticsService, useValue: { capture: vi.fn(), flags: () => ({}) } },
        { provide: LocaleService, useValue: { language: () => 'en', region: () => 'DE' } },
        {
          provide: CodexService,
          useValue: {
            getShipsByClassNames: vi.fn().mockResolvedValue(new Map()),
            listByKind: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
          },
        },
        { provide: HangarService, useValue: { ships: signal([]), addShip: vi.fn(), updateShip: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(HangarImportPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it('hands the received ships to the embedded import', async () => {
    await setup({ version: 1, source: 'rsi', capturedAt: 1700000000000, fingerprint: 'fp', ships: SHIPS });
    const importEl = fixture.nativeElement.querySelector('sc-hangar-import');
    expect(importEl).toBeTruthy();
    const child = fixture.debugElement.children
      .flatMap((c) => c.queryAll((d) => d.componentInstance instanceof HangarImportComponent))[0]
      .componentInstance as HangarImportComponent;
    expect(child.preloadedRows()).toEqual(SHIPS);
    expect(child.embedded()).toBe(true);
  });

  it('shows the empty state when the extension sends nothing', async () => {
    await setup(null);
    expect(fixture.nativeElement.querySelector('sc-hangar-import')).toBeNull();
    expect(fixture.nativeElement.querySelector('.state.empty')).toBeTruthy();
  });

  it('cancel discards the stash and shows the empty state', async () => {
    await setup({ version: 1, source: 'rsi', capturedAt: 1700000000000, fingerprint: 'fp', ships: SHIPS });
    (fixture.nativeElement.querySelector('.review .link-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(bridge.discard).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.state.empty')).toBeTruthy();
  });
});
