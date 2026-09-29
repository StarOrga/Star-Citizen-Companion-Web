import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarShipDetailComponent } from './hangar-ship-detail.component';
import { HangarService } from './hangar.service';
import { CodexService } from '../codex/codex.service';
import { CodexHoloForkGuard } from '../codex/holo/codex-holo-fork-guard';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';

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
