import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { CodexListRow, CodexService } from '../codex/codex.service';
import { HangarService } from '../hangar/hangar.service';
import { QuickSearchComponent } from './quick-search.component';

/**
 * AUD-236: a failed search used to render "no results" — the reader could not
 * tell a broken connection from a term nobody matches.
 */
describe('QuickSearchComponent — failed search (AUD-236)', () => {
  let listByKind: jasmine.Spy;

  beforeEach(() => {
    spyOn(console, 'warn');
    listByKind = jasmine.createSpy('listByKind').and.rejectWith(new TypeError('Failed to fetch'));
    TestBed.configureTestingModule({
      imports: [QuickSearchComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: { listByKind } },
        { provide: HangarService, useValue: { ships: signal([]), loadAll: () => Promise.resolve() } },
        { provide: AuthService, useValue: { user: signal(null), isAuthenticated: signal(false) } },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => (n.innerHTML = ''));
  });

  it('shows the error state, not "no results"', fakeAsync(() => {
    const fixture = TestBed.createComponent(QuickSearchComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.open();
    fixture.detectChanges();
    cmp.onQuery('gladius');
    tick(1000);
    fixture.detectChanges();

    expect(listByKind).toHaveBeenCalled();
    expect(cmp.searchError()).toBe('errors.network');
    const panel = document.querySelector('.cdk-overlay-container .panel');
    const text = panel?.textContent ?? '';
    expect(panel?.querySelector('.state.err')).not.toBeNull();
    expect(text).toContain('quickSearch.error');
    expect(text).not.toContain('quickSearch.noResults');
    expect(text).not.toContain('Failed to fetch');
    cmp.close();
    fixture.detectChanges();
  }));
});

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

const SHIP_B = { ...SHIP, classNameSlug: 'aegs_sabre', nameLocalized: 'Sabre' } as unknown as CodexListRow;

/**
 * Keyboard paths of the quick search (AUD-054/073): Ctrl/Cmd+K toggles, "/"
 * opens only outside text fields, Escape closes via the panel (ScDialogDirective,
 * D07), arrows move the active row and Enter routes to it.
 */
describe('QuickSearchComponent — keyboard', () => {
  let fixture: ComponentFixture<QuickSearchComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [QuickSearchComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: HangarService, useValue: { ships: signal([]), loadAll: () => Promise.resolve() } },
        { provide: CodexService, useValue: { listByKind: () => Promise.resolve({ rows: [] }) } },
      ],
    });
    fixture = TestBed.createComponent(QuickSearchComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.componentInstance.close();
    fixture.destroy();
  });

  const key = (init: KeyboardEventInit, target: EventTarget = document) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    fixture.detectChanges();
  };
  const panel = () => document.querySelector('.cdk-overlay-container .panel');
  const visible = () => fixture.componentInstance.visible();

  it('toggles with Ctrl+K and with Cmd+K', () => {
    key({ key: 'k', ctrlKey: true });
    expect(visible()).toBeTrue();
    expect(panel()).not.toBeNull();
    key({ key: 'K', ctrlKey: true });
    expect(visible()).toBeFalse();
    key({ key: 'k', metaKey: true });
    expect(visible()).toBeTrue();
  });

  it('opens on "/" only when the focus is not in a text field', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    try {
      key({ key: '/' }, field);
      expect(visible()).withContext('typing a slash into a field').toBeFalse();
      key({ key: '/' });
      expect(visible()).toBeTrue();
    } finally {
      field.remove();
    }
  });

  it('closes on Escape from the focused search field', () => {
    fixture.componentInstance.open();
    fixture.detectChanges();
    const input = document.querySelector('.cdk-overlay-container .qs-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.focus();
    key({ key: 'Escape' }, input);
    expect(visible()).toBeFalse();
    expect(panel()).toBeNull();
  });

  it('moves the active row with the arrows and routes to it on Enter', () => {
    const c = fixture.componentInstance;
    c.open();
    c.query.set('a');
    c.results.set([
      { kind: 'ship', row: SHIP },
      { kind: 'ship', row: SHIP_B },
    ]);
    fixture.detectChanges();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const input = document.querySelector('.cdk-overlay-container .qs-input') as HTMLInputElement;

    key({ key: 'ArrowDown' }, input);
    expect(c.activeIndex()).toBe(1);
    key({ key: 'ArrowDown' }, input);
    expect(c.activeIndex()).withContext('clamped at the last row').toBe(1);
    key({ key: 'ArrowUp' }, input);
    expect(c.activeIndex()).toBe(0);
    key({ key: 'ArrowDown' }, input);

    // The rows themselves are real links to the same target.
    const links = Array.from(document.querySelectorAll('.cdk-overlay-container .qs-row a.qs-hit')) as HTMLAnchorElement[];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/codex/ship/aegs_gladius', '/codex/ship/aegs_sabre']);

    key({ key: 'Enter' }, input);
    expect(navigate).toHaveBeenCalledOnceWith(['/codex', 'ship', 'aegs_sabre']);
    expect(visible()).toBeFalse();
  });
});
