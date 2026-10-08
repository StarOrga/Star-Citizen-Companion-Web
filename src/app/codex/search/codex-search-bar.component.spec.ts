import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { CodexService } from '../codex.service';
import { CodexBuildDiffService } from '../codex-build-diff.service';
import { scopeForKind } from '../codex-poly-search';
import { provideNoShipBlueprints } from '../ship-blueprint/ship-blueprint.testing';
import { CodexSearchBarComponent } from './codex-search-bar.component';
import { CodexSearchHub } from './codex-search-hub.service';

describe('CodexSearchBarComponent', () => {
  let fixture: ComponentFixture<CodexSearchBarComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    const hits = ['AEGS_Gladius', 'AEGS_Gladius_Valiant'].map((slug) => ({
      kind: 'ship' as const,
      classNameSlug: slug,
      nameLocalized: slug.replace(/_/g, ' '),
      manufacturerCode: 'AEGS',
      manufacturerName: { de: 'Aegis Dynamics', en: 'Aegis Dynamics', key: '' },
      size: 1,
      grade: null,
      scope: scopeForKind('ship'),
    }));
    TestBed.configureTestingModule({
      imports: [CodexSearchBarComponent],
      providers: [
        provideNoShipBlueprints(),
        provideRouter([{ path: '**', children: [] }]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: CodexService,
          useValue: {
            searchAll: jasmine.createSpy('searchAll').and.resolveTo({ hits, totals: { ship: 14 } }),
            suggestNames: () => Promise.resolve([]),
            isPinned: () => false,
            togglePin: jasmine.createSpy('togglePin'),
          },
        },
        { provide: CodexBuildDiffService, useValue: { addedShipsMemo: () => Promise.resolve([]) } },
        { provide: HangarService, useValue: { ships: signal([]), loadAll: () => Promise.resolve() } },
        { provide: AuthService, useValue: { user: signal(null) } },
      ],
    });
    fixture = TestBed.createComponent(CodexSearchBarComponent);
    fixture.componentRef.setInput('variant', 'compact');
    fixture.detectChanges();
    host = fixture.nativeElement;
  });


  const input = () => host.querySelector<HTMLInputElement>('input')!;
  const keydown = (k: string, init: KeyboardEventInit = {}) =>
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

  it('registers with the hub; activation (Ctrl+K / typing) expands, focuses and seeds the field', fakeAsync(() => {
    const scroll = spyOn(window, 'scrollTo');
    expect(TestBed.inject(CodexSearchHub).activate('g')).toBeTrue();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(host.classList).toContain('active');
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe('g');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.dim')).not.toBeNull();
    expect(scroll).toHaveBeenCalled();
    tick(1000);
  }));

  it('expanding never moves the page: the host keeps its slim height', fakeAsync(() => {
    const before = host.getBoundingClientRect().height;
    fixture.componentInstance.activate(undefined, true);
    fixture.componentInstance.engine.searchFor('gladius');
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(host.querySelector('.panel')).not.toBeNull();
    expect(host.getBoundingClientRect().height).toBe(before);
  }));

  it('renders grouped hits as anchor options, with the total and an "all N in the index" link', fakeAsync(() => {
    fixture.componentInstance.activate();
    fixture.componentInstance.engine.searchFor('gladius');
    tick();
    fixture.detectChanges();

    const options = Array.from(host.querySelectorAll<HTMLAnchorElement>('[role="option"]'));
    expect(options.length).toBe(3);
    expect(options.every((a) => a.tagName === 'A' && !!a.getAttribute('href'))).toBeTrue();
    expect(options[0].getAttribute('href')).toBe('/codex/ship/AEGS_Gladius');
    expect(options[2].getAttribute('href')).toBe('/codex/index?kind=ship&q=gladius');
    expect(host.querySelector('.group-head .count')?.textContent?.trim()).toBe('14');
  }));

  it('ArrowDown sets aria-activedescendant on the field; Enter opens the active hit and collapses', fakeAsync(() => {
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.componentInstance.activate();
    fixture.componentInstance.engine.searchFor('gladius');
    tick();
    fixture.detectChanges();

    keydown('ArrowDown');
    keydown('ArrowDown');
    fixture.detectChanges();
    const id = input().getAttribute('aria-activedescendant')!;
    expect(host.querySelector(`#${id}`)?.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius_Valiant');

    keydown('Enter');
    fixture.detectChanges();
    expect(nav).toHaveBeenCalledWith(['/codex', 'ship', 'AEGS_Gladius_Valiant'], { queryParams: undefined });
    expect(host.classList).not.toContain('active');
    tick(1000);
  }));

  it('Escape clears the term first, then collapses', fakeAsync(() => {
    fixture.componentInstance.activate();
    fixture.componentInstance.engine.searchFor('gladius');
    tick();
    fixture.detectChanges();

    keydown('Escape');
    fixture.detectChanges();
    expect(input().value).toBe('');
    expect(host.classList).toContain('active');

    keydown('Escape');
    fixture.detectChanges();
    expect(host.classList).not.toContain('active');
  }));

  it('blur with an empty field collapses; a click on the dimmed page does too', fakeAsync(() => {
    fixture.componentInstance.activate();
    fixture.detectChanges();
    input().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    fixture.detectChanges();
    expect(host.classList).not.toContain('active');

    fixture.componentInstance.activate();
    fixture.componentInstance.engine.setInput('glad');
    fixture.detectChanges();
    host.querySelector<HTMLElement>('.dim')!.click();
    fixture.detectChanges();
    expect(host.classList).not.toContain('active');
    tick(1000);
  }));
  it('a click inside the field keeps the caret and selection the user placed', fakeAsync(() => {
    fixture.componentInstance.activate();
    fixture.componentInstance.engine.setInput('gladius');
    fixture.detectChanges();
    tick(1000);
    fixture.detectChanges();
    const el = input();
    el.focus();
    el.setSelectionRange(0, 4);
    el.click();
    fixture.detectChanges();
    tick();

    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4]);
  }));

  it('a click on the field chrome (not the input) still focuses the input', fakeAsync(() => {
    host.querySelector<HTMLElement>('.field')!.click();
    fixture.detectChanges();
    tick();

    expect(document.activeElement).toBe(input());
    expect(host.classList).toContain('active');
  }));

  it('caps the results panel at the room left below the field', fakeAsync(() => {
    fixture.componentInstance.activate();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const max = parseFloat(host.style.getPropertyValue('--panel-max'));
    const fieldBottom = host.querySelector('.field')!.getBoundingClientRect().bottom;
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    expect(max).toBeGreaterThanOrEqual(180);
    expect(max).toBeLessThanOrEqual(Math.max(180, viewport - fieldBottom));
  }));

  it('a partial search keeps its hits and says quietly which part is missing, with retry', fakeAsync(() => {
    const codex = TestBed.inject(CodexService) as unknown as { searchAll: jasmine.Spy };
    spyOn(console, 'warn');
    const hit = {
      kind: 'ship' as const,
      classNameSlug: 'AEGS_Gladius',
      nameLocalized: 'Aegis Gladius',
      manufacturerCode: 'AEGS',
      size: 1,
      grade: null,
      scope: scopeForKind('ship'),
    };
    codex.searchAll.and.resolveTo({
      hits: [hit],
      totals: { ship: 1 },
      failed: ['item'],
      failure: new Error('canceling statement due to statement timeout'),
    });
    fixture.componentInstance.activate();
    fixture.componentInstance.engine.searchFor('gladius');
    tick();
    fixture.detectChanges();

    const note = host.querySelector('.partial');
    expect(note).not.toBeNull();
    expect(note?.getAttribute('role')).toBe('status');
    expect(note?.closest('[role="listbox"]')).toBeNull();
    expect(host.querySelectorAll('.hit').length).toBe(1);

    codex.searchAll.calls.reset();
    codex.searchAll.and.resolveTo({ hits: [hit], totals: { ship: 1 } });
    host.querySelector<HTMLButtonElement>('.partial-retry')!.click();
    tick();
    fixture.detectChanges();
    expect(codex.searchAll).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.partial')).toBeNull();
  }));

  it('the group pill counts the cards it lists; folded variants get a quiet hint, "all N" keeps the raw total', fakeAsync(() => {
    const codex = TestBed.inject(CodexService) as unknown as { searchAll: jasmine.Spy };
    const weapon = {
      kind: 'weapon' as const,
      classNameSlug: 'behr_rifle_p4ar',
      nameLocalized: 'P4-AR Rifle',
      manufacturerCode: 'BEHR',
      size: null,
      grade: null,
      scope: scopeForKind('weapon'),
    };
    codex.searchAll.and.resolveTo({ hits: [weapon], totals: { weapon: 49 }, distinct: { weapon: 1 }, read: { weapon: 49 } });
    fixture.componentInstance.activate();
    fixture.componentInstance.engine.searchFor('p4');
    tick();
    fixture.detectChanges();

    expect(host.querySelector('.group-head .count')?.textContent?.trim()).toBe('1');
    expect(host.querySelector('.group-head .folded')?.textContent?.trim()).toBe('codex.search.bar.folded');
    expect(host.querySelectorAll('.hit').length).toBe(1);
    expect(host.querySelector('.more')?.getAttribute('href')).toBe('/codex/index?kind=weapon&q=p4');
  }));

  it('the key legend renders keycaps, the return glyph on its own size step', fakeAsync(() => {
    fixture.componentInstance.activate();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    const keys = Array.from(host.querySelectorAll<HTMLElement>('.nav-hint kbd'));
    expect(keys.map((k) => k.textContent?.trim())).toEqual(['↑', '↓', '↵', 'codex.search.bar.keys.ctrl', '↵', 'Esc']);
    const px = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(px(keys[0])).toBeGreaterThanOrEqual(0.75 * rootPx);
    expect(px(keys[2])).toBeGreaterThan(px(keys[0]));
  }));

  describe('tucked (the page header carries the compact trigger)', () => {
    let unregister: () => void;
    let trigger: HTMLButtonElement;

    beforeEach(() => {
      trigger = document.createElement('button');
      document.body.appendChild(trigger);
      unregister = TestBed.inject(CodexSearchHub).registerTrigger({ focus: () => trigger.focus() });
      fixture.detectChanges();
    });

    afterEach(() => {
      unregister();
      trigger.remove();
    });

    it('draws no slim row: zero height, no visible field', () => {
      expect(host.classList).toContain('tucked');
      expect(host.getBoundingClientRect().height).toBe(0);
      expect(getComputedStyle(host.querySelector('.shell')!).display).toBe('none');
    });

    it('a call brings it forward, focused; the hub reports it expanded', fakeAsync(() => {
      spyOn(window, 'scrollTo');
      const hub = TestBed.inject(CodexSearchHub);
      trigger.focus();
      expect(hub.activate()).toBeTrue();
      fixture.detectChanges();
      tick();
      fixture.detectChanges();

      expect(getComputedStyle(host.querySelector('.shell')!).display).not.toBe('none');
      expect(document.activeElement).toBe(input());
      expect(hub.expanded()).toBeTrue();
      tick(1000);
    }));

    it('Esc on an empty field collapses and hands focus back to where it came from', fakeAsync(() => {
      spyOn(window, 'scrollTo');
      trigger.focus();
      TestBed.inject(CodexSearchHub).activate();
      fixture.detectChanges();
      tick();
      fixture.detectChanges();

      keydown('Escape');
      fixture.detectChanges();

      expect(host.classList).not.toContain('active');
      expect(TestBed.inject(CodexSearchHub).expanded()).toBeFalse();
      expect(document.activeElement).toBe(trigger);
      tick(1000);
    }));

    it('type-to-search (no field focused) also lands focus back on the trigger after Esc', fakeAsync(() => {
      spyOn(window, 'scrollTo');
      (document.activeElement as HTMLElement | null)?.blur();
      TestBed.inject(CodexSearchHub).activate('g');
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(input().value).toBe('g');

      keydown('Escape'); // clears the term
      keydown('Escape'); // collapses
      fixture.detectChanges();
      expect(document.activeElement).toBe(trigger);
      tick(1000);
    }));
  });

  it('the landing terminal keeps a real height on a mouse pointer — the field never hangs over the next row', () => {
    const t = TestBed.createComponent(CodexSearchBarComponent);
    t.componentRef.setInput('variant', 'terminal');
    t.detectChanges();
    const el = t.nativeElement as HTMLElement;
    const field = el.querySelector('.field')!.getBoundingClientRect();
    expect(el.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(field.height).toBeLessThanOrEqual(el.getBoundingClientRect().height);
    t.destroy();
  });
});
