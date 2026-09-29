import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { CodexService } from '../codex/codex.service';
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
