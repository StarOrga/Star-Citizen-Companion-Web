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
});
