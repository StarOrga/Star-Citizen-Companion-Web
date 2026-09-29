import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { CodexListRow, CodexService } from '../codex/codex.service';
import { HangarService } from '../hangar/hangar.service';
import { QuickSearchComponent } from './quick-search.component';

const SHIP = {
  classNameSlug: 'aegs_gladius',
  nameLocalized: 'Gladius',
  manufacturerCode: null,
  componentKind: null,
  weaponClass: null,
  size: null,
  grade: null,
  crewSize: null,
  payload: undefined,
} as unknown as CodexListRow;

/**
 * "→ Hangar" in the quick search (AUD-065, AUD-268): while the insert runs the
 * button is locked, so a double click adds the ship once, and a failed insert
 * says so instead of doing nothing.
 */
describe('QuickSearchComponent — add to hangar', () => {
  let fixture: ComponentFixture<QuickSearchComponent>;
  let addShip: jasmine.Spy;

  beforeEach(() => {
    addShip = jasmine.createSpy('addShip');
    TestBed.configureTestingModule({
      imports: [QuickSearchComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        {
          provide: HangarService,
          useValue: { ships: signal([]), loadAll: () => Promise.resolve(), addShip },
        },
        { provide: CodexService, useValue: { listByKind: () => Promise.resolve({ rows: [] }) } },
      ],
    });
    fixture = TestBed.createComponent(QuickSearchComponent);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    c.open();
    c.query.set('glad');
    c.results.set([{ kind: 'ship', row: SHIP }]);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.componentInstance.close();
    fixture.destroy();
  });

  const addBtn = () => document.querySelector('.qs-row .add-btn') as HTMLButtonElement | null;

  it('locks the button while the insert runs, so a double click adds once', async () => {
    let resolve!: (v: unknown) => void;
    addShip.and.returnValue(new Promise((r) => (resolve = r)));
    expect(addBtn()).withContext('add button rendered').not.toBeNull();

    addBtn()!.click();
    fixture.detectChanges();
    expect(addBtn()!.disabled).toBeTrue();
    expect(addBtn()!.getAttribute('aria-busy')).toBe('true');
    // The disabled button swallows a real click; call through as well to
    // prove the guard holds even when the handler fires twice.
    void fixture.componentInstance.addToHangar(new Event('click'), SHIP);
    expect(addShip).toHaveBeenCalledTimes(1);

    resolve({ id: 's1' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(addBtn()!.disabled).toBeFalse();
    expect(document.querySelector('.state.err')).toBeNull();
  });

  it('shows the translated alert when the insert fails', async () => {
    addShip.and.resolveTo(null);
    addBtn()!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const alert = document.querySelector('.state.err[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('codex.card.addToHangarFailed');
    // The alert sits outside the listbox — never inside an option row.
    expect(alert!.closest('[role="listbox"]')).toBeNull();
  });
});
