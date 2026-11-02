import { ChangeDetectionStrategy, Component, TemplateRef, input, output, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BetaService } from '../../core/beta.service';
import { LayoutService } from '../../core/layout/layout.service';
import type { PageLayout } from '../../core/layout/page-layout';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { FusionBarComponent } from './fusion-bar.component';
import { FusionSearchComponent } from './fusion-search.component';
import { fakeEngine, setupFusionSearch } from './fusion-search.testing';
import { ShellChromeService } from './shell-chrome.service';

@Component({ selector: 'sc-fusion-search', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '<ng-content />' })
class FusionSearchStub {
  readonly placement = input<'top' | 'bottom'>('top');
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

  it('docked on a main page: the demo only while staged (chips are always shown, concept 2026-11-02 C3)', async () => {
    layout.set('cinematic');
    const fixture = await setup('/verse');
    const search = () => fixture.debugElement.query(By.directive(FusionSearchStub)).componentInstance as FusionSearchStub;
    expect(search().demo()).toBeTrue();
    fixture.componentInstance.onScroll(200);
    fixture.detectChanges();
    expect(fixture.nativeElement.getAttribute('data-mode')).toBe('docked');
    expect(search().demo()).withContext('docked: no demo').toBeFalse();
    // Ruhige Leiste (concept 2026-11-01): no light line along the docked bar any more, depth only;
    // the echo frames belong to the staged field.
    expect(fixture.nativeElement.querySelector('.cap .band')).toBeNull();
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
    const engine = fakeEngine();
    const { fixture } = setupFusionSearch(engine);
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
