import { ChangeDetectionStrategy, Component, TemplateRef, input, output, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { RoleService } from '../../auth/role.service';
import { CodexService } from '../../codex/codex.service';
import { CodexSearchHub } from '../../codex/search/codex-search-hub.service';
import { CodexSearchEngine } from '../../codex/search/codex-search-engine';
import { BetaService } from '../../core/beta.service';
import { LayoutService } from '../../core/layout/layout.service';
import type { PageLayout } from '../../core/layout/page-layout';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { FusionBarComponent } from './fusion-bar.component';
import { FusionSearchComponent } from './fusion-search.component';
import { ShellChromeService } from './shell-chrome.service';

@Component({ selector: 'sc-fusion-search', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '<ng-content />' })
class FusionSearchStub {
  readonly placement = input<'top' | 'bottom'>('top');
  readonly hideContext = input(false);
  readonly compact = input(false);
  readonly demo = input(false);
  readonly openChange = output<boolean>();
}

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-template #tb><div class="tool-row">FILTERS</div></ng-template>',
})
class ToolbarHost {
  readonly tb = viewChild.required<TemplateRef<unknown>>('tb');
}

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

const baseProviders = () => [
  provideTranslateService(),
  provideRouter([{ path: '**', component: Blank }]),
  { provide: RoleService, useValue: { isAdmin: signal(false), isCollaborator: signal(false) } },
  { provide: SameRouteRefreshService, useValue: { request: () => true } },
  {
    provide: BetaService,
    useValue: { state: signal({ verse: true, codex: true, shell: true }), isEnabled: () => () => true },
  },
];

describe('FusionBarComponent, wave B parity', () => {
  const layout = signal<PageLayout>('tool');

  async function setup(url: string, before?: () => void) {
    TestBed.configureTestingModule({
      imports: [FusionBarComponent, ToolbarHost],
      providers: [...baseProviders(), { provide: LayoutService, useValue: { layout, track: () => 'wide' } }],
    });
    TestBed.overrideComponent(FusionBarComponent, {
      remove: { imports: [FusionSearchComponent] },
      add: { imports: [FusionSearchStub] },
    });
    await TestBed.inject(Router).navigateByUrl(url);
    // Fixtures created later reset TestBed's root elements: build them first.
    before?.();
    const fixture = TestBed.createComponent(FusionBarComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => document.querySelectorAll('sc-fusion-bar').forEach((n) => n.remove()));

  it('docked on a main page: no context chip in the field (the plate names the area), the demo only while staged', async () => {
    layout.set('cinematic');
    const fixture = await setup('/verse');
    const search = () => fixture.debugElement.query(By.directive(FusionSearchStub)).componentInstance as FusionSearchStub;
    expect(search().demo()).toBeTrue();
    expect(search().hideContext()).toBeTrue();
    fixture.componentInstance.onScroll(200);
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-mode')).toBe('docked');
    expect(search().hideContext()).withContext('docked: no chip').toBeTrue();
    expect(search().demo()).withContext('docked: no demo').toBeFalse();
    // The deck glow band runs along the docked bar; the staged field has echo frames instead.
    expect(fixture.nativeElement.querySelector('.cap .band')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cap .echo')).toBeNull();
  });

  it('the filter panel is an overlay: opening it does not move what follows the bar', async () => {
    layout.set('tool');
    let tb: TemplateRef<unknown> | null = null;
    const fixture = await setup('/codex/index?kind=ship', () => {
      const host = TestBed.createComponent(ToolbarHost);
      host.detectChanges();
      tb = host.componentInstance.tb();
    });
    const chrome = TestBed.inject(ShellChromeService);
    const offTb = chrome.registerToolbar(tb!);
    const picked: (string | null)[] = [];
    const offF = chrome.registerFilters({}, () => ({
      count: 12,
      kindTotal: 368,
      tokens: [],
      facets: [
        {
          id: 'manufacturer',
          labelKey: 'codex.filters.manufacturer',
          options: [
            { value: 'AEGS', label: 'Aegis' },
            { value: 'ANVL', label: 'Anvil' },
          ],
          selected: null,
          set: (v) => picked.push(v),
        },
      ],
      reset: () => undefined,
    }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const after = document.createElement('div');
    after.textContent = 'page';
    el.after(after);
    const before = after.getBoundingClientRect().top;
    (el.querySelector('.fbtn') as HTMLButtonElement).click();
    fixture.detectChanges();
    const panel = el.querySelector('.fpanel') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(getComputedStyle(panel).position).toBe('absolute');
    expect(after.getBoundingClientRect().top).withContext('no layout shift').toBe(before);
    // Checkbox columns instead of the page's toolbar.
    expect(panel.querySelector('.fcols')).toBeNull();
    const boxes = Array.from(panel.querySelectorAll<HTMLInputElement>('.fcol input[type="checkbox"]'));
    expect(boxes.length).toBe(2);
    boxes[0].click();
    expect(picked).toEqual(['AEGS']);
    // A press outside the bar closes it.
    after.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.fpanel')).toBeNull();
    after.remove();
    offF();
    offTb();
  });
});

describe('FusionSearchComponent typed demo', () => {
  function setup() {
    const input = signal('');
    const engine = {
      input,
      term: signal(''),
      loading: signal(false),
      error: signal<string | null>(null),
      groups: signal([]),
      recent: signal<string[]>([]),
      opening: signal(false),
      setInput: (v: string) => input.set(v),
      ensureSuggestions: () => undefined,
      clear: () => input.set(''),
      retry: () => undefined,
      commit: () => undefined,
      searchFor: () => undefined,
      href: () => '',
    };
    TestBed.configureTestingModule({
      imports: [FusionSearchComponent],
      providers: [
        ...baseProviders(),
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: CodexService, useValue: {} },
        { provide: HangarService, useValue: {} },
        { provide: HqOwnershipService, useValue: { ensureLoaded: async () => undefined, owns: () => false } },
        { provide: CodexSearchHub, useValue: { register: () => () => undefined } },
      ],
    });
    TestBed.overrideComponent(FusionSearchComponent, {
      set: { providers: [{ provide: CodexSearchEngine, useValue: engine }] },
    });
    const fixture = TestBed.createComponent(FusionSearchComponent);
    fixture.componentRef.setInput('demo', true);
    fixture.detectChanges();
    return { fixture, engine };
  }

  it('types example searches while idle, aria-hidden, the placeholder staying the accessible name', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    const demo = el.querySelector('.demo');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      expect(demo).toBeNull();
      return;
    }
    expect(demo).not.toBeNull();
    expect(demo!.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelectorAll('.demo .demo-t').length).toBe(3);
    const field = el.querySelector('input.input') as HTMLInputElement;
    expect(field.getAttribute('aria-label')).toBeTruthy();
    expect(field.getAttribute('placeholder')).toBeTruthy();
  });

  it('stops on focus and on input', () => {
    const { fixture, engine } = setup();
    const el = fixture.nativeElement as HTMLElement;
    engine.setInput('gla');
    fixture.detectChanges();
    expect(el.querySelector('.demo')).withContext('input').toBeNull();
    engine.setInput('');
    fixture.detectChanges();
    fixture.componentInstance.openPanel();
    fixture.detectChanges();
    expect(el.querySelector('.demo')).withContext('focus').toBeNull();
  });
});
