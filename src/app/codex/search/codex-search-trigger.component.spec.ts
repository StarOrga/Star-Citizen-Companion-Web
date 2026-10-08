import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { CodexService } from '../codex.service';
import { CodexBuildDiffService } from '../codex-build-diff.service';
import { provideNoShipBlueprints } from '../ship-blueprint/ship-blueprint.testing';
import { CodexSearchBarComponent } from './codex-search-bar.component';
import { CodexSearchHub } from './codex-search-hub.service';
import { CodexSearchTriggerComponent } from './codex-search-trigger.component';

/** The shell's slim bar above a page whose header carries the trigger (/codex/index, /codex/fps). */
@Component({
  standalone: true,
  imports: [CodexSearchBarComponent, CodexSearchTriggerComponent],
  template: `
    <sc-codex-search-bar variant="compact" />
    @if (withTrigger()) {
      <header><sc-codex-search-trigger /></header>
    }
    <input class="page-filter" type="search" />
  `,
})
class PageHostComponent {
  readonly withTrigger = signal(true);
}

describe('CodexSearchTriggerComponent', () => {
  let fixture: ComponentFixture<PageHostComponent>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PageHostComponent],
      providers: [
        provideNoShipBlueprints(),
        provideRouter([{ path: '**', children: [] }]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: CodexService,
          useValue: {
            searchAll: () => Promise.resolve({ hits: [], totals: {} }),
            suggestNames: () => Promise.resolve([]),
            isPinned: () => false,
            togglePin: () => undefined,
          },
        },
        { provide: CodexBuildDiffService, useValue: { addedShipsMemo: () => Promise.resolve([]) } },
        { provide: HangarService, useValue: { ships: signal([]), loadAll: () => Promise.resolve() } },
        { provide: AuthService, useValue: { user: signal(null) } },
      ],
    });
    fixture = TestBed.createComponent(PageHostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    el = fixture.nativeElement;
    spyOn(window, 'scrollTo');
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  const bar = () => el.querySelector<HTMLElement>('sc-codex-search-bar')!;
  const button = () => el.querySelector<HTMLButtonElement>('sc-codex-search-trigger button')!;
  const field = () => bar().querySelector<HTMLInputElement>('input')!;
  const settle = () => {
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  };

  it('is a named button with its shortcut, and tucks the slim bar away while mounted', () => {
    expect(button().getAttribute('aria-label')).toBe('codex.search.trigger.label');
    expect(button().getAttribute('aria-keyshortcuts')).toBe('Control+K /');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(bar().classList).toContain('tucked');

    fixture.componentInstance.withTrigger.set(false);
    fixture.detectChanges();
    expect(bar().classList).not.toContain('tucked');
  });

  it('a click expands the global bar big and focused; aria-expanded follows', fakeAsync(() => {
    button().click();
    settle();

    expect(bar().classList).toContain('active');
    expect(document.activeElement).toBe(field());
    expect(button().getAttribute('aria-expanded')).toBe('true');
    tick(1000);
  }));

  it('Esc collapses it and focus returns to the trigger', fakeAsync(() => {
    button().focus();
    button().click();
    settle();

    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(bar().classList).not.toContain('active');
    expect(document.activeElement).toBe(button());
    expect(button().getAttribute('aria-expanded')).toBe('false');
    tick(1000);
  }));

  it('Ctrl+K from the page filter returns focus to that filter on Esc', fakeAsync(() => {
    const filter = el.querySelector<HTMLInputElement>('.page-filter')!;
    filter.focus();
    TestBed.inject(CodexSearchHub).activate();
    settle();
    expect(document.activeElement).toBe(field());

    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(filter);
    tick(1000);
  }));
});
