import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { CodexService } from '../codex/codex.service';
import { CodexBuildDiffService } from '../codex/codex-build-diff.service';
import { HangarService } from '../hangar/hangar.service';
import { CodexSearchHub, isTypeToSearchKey } from '../codex/search/codex-search-hub.service';
import { QuickSearchComponent } from './quick-search.component';

describe('QuickSearchComponent', () => {
  let searchAll: jasmine.Spy;

  beforeEach(() => {
    searchAll = jasmine.createSpy('searchAll').and.resolveTo({ hits: [], totals: {} });
    TestBed.configureTestingModule({
      imports: [QuickSearchComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: { searchAll, suggestNames: () => Promise.resolve([]), isPinned: () => false } },
        { provide: CodexBuildDiffService, useValue: { addedShipsMemo: () => Promise.resolve([]) } },
        { provide: HangarService, useValue: { ships: signal([]), loadAll: () => Promise.resolve() } },
        { provide: AuthService, useValue: { user: signal(null), isAuthenticated: signal(false) } },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => (n.innerHTML = ''));
  });

  function create() {
    const fixture = TestBed.createComponent(QuickSearchComponent);
    fixture.detectChanges();
    return fixture;
  }

  function press(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  }

  describe('Ctrl+K routing', () => {
    it('off the Codex (no bar mounted) Ctrl+K opens the overlay', () => {
      const fixture = create();
      const ev = press('k', { ctrlKey: true });
      fixture.detectChanges();

      expect(ev.defaultPrevented).toBeTrue();
      expect(fixture.componentInstance.visible()).toBeTrue();
      expect(document.querySelector('.cdk-overlay-container .qs-input')).not.toBeNull();
    });

    it('on a Codex page Ctrl+K, "/" and the header button bring the page bar forward, no overlay', () => {
      const fixture = create();
      const bar = { activate: jasmine.createSpy('activate') };
      const unregister = TestBed.inject(CodexSearchHub).register(bar);

      press('k', { metaKey: true });
      press('/');
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.trigger')!.click();
      fixture.detectChanges();

      expect(bar.activate).toHaveBeenCalledTimes(3);
      expect(fixture.componentInstance.visible()).toBeFalse();
      expect(document.querySelector('.cdk-overlay-container .qs-input')).toBeNull();
      unregister();
    });

    it('once the bar is gone (left the Codex), Ctrl+K falls back to the overlay', () => {
      const fixture = create();
      const unregister = TestBed.inject(CodexSearchHub).register({ activate: () => undefined });
      unregister();
      press('k', { ctrlKey: true });
      fixture.detectChanges();
      expect(fixture.componentInstance.visible()).toBeTrue();
    });
  });

  describe('type-to-search', () => {
    it('a letter typed on a Codex page starts the bar with that letter', () => {
      create();
      const bar = { activate: jasmine.createSpy('activate') };
      const unregister = TestBed.inject(CodexSearchHub).register(bar);

      const ev = press('g');

      expect(bar.activate).toHaveBeenCalledOnceWith('g');
      expect(ev.defaultPrevented).toBeTrue();
      unregister();
    });

    it('ignores inputs, textareas, contenteditable, chords, digits and pages without a bar', () => {
      create();
      const input = document.createElement('input');
      const area = document.createElement('textarea');
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      document.body.append(input, area, editable);
      const bar = { activate: jasmine.createSpy('activate') };
      const unregister = TestBed.inject(CodexSearchHub).register(bar);

      press('g', {}, input);
      press('g', {}, area);
      press('g', {}, editable);
      press('g', { altKey: true });
      press('3'); // digits are the pages' own hotkeys
      press(' ');
      expect(bar.activate).not.toHaveBeenCalled();

      unregister();
      press('g');
      expect(bar.activate).not.toHaveBeenCalled();
      input.remove();
      area.remove();
      editable.remove();
    });

    it('stays out of the way while a dialog is open', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);
      const ev = new KeyboardEvent('keydown', { key: 'g' });
      Object.defineProperty(ev, 'target', { value: document.body });
      expect(isTypeToSearchKey(ev)).toBeFalse();
      dialog.remove();
      expect(isTypeToSearchKey(ev)).toBeTrue();
    });
  });

  it('a failed search shows the error state with retry, not "no results" (AUD-236)', fakeAsync(() => {
    spyOn(console, 'warn');
    searchAll.and.rejectWith(new TypeError('Failed to fetch'));
    const fixture = create();
    fixture.componentInstance.open();
    fixture.detectChanges();
    fixture.componentInstance.engine.setInput('gladius');
    tick(1000);
    fixture.detectChanges();

    const text = document.querySelector('.cdk-overlay-container')?.textContent ?? '';
    expect(text).toContain('codex.search.bar.failed');
    expect(text).not.toContain('codex.search.bar.empty');
    fixture.componentInstance.close();
  }));

  it('Escape clears a typed term first and closes on an empty field', fakeAsync(() => {
    const fixture = create();
    fixture.componentInstance.open();
    fixture.componentInstance.engine.setInput('glad');
    fixture.detectChanges();
    const input = document.querySelector<HTMLInputElement>('.cdk-overlay-container .qs-input')!;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    tick();
    expect(fixture.componentInstance.engine.input()).toBe('');
    expect(fixture.componentInstance.visible()).toBeTrue();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    tick();
    expect(fixture.componentInstance.visible()).toBeFalse();
  }));
});
