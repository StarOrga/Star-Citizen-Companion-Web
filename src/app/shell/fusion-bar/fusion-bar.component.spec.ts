import { ChangeDetectionStrategy, Component, TemplateRef, input, output, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BetaService } from '../../core/beta.service';
import { LayoutService } from '../../core/layout/layout.service';
import type { PageLayout } from '../../core/layout/page-layout';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { FusionBarComponent } from './fusion-bar.component';
import { FusionSearchComponent } from './fusion-search.component';
import { ShellChromeService } from './shell-chrome.service';
import { DOCK_SCROLL_PX } from './fusion-bar.model';

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

describe('FusionBarComponent', () => {
  const layout = signal<PageLayout>('tool');

  async function setup(url: string) {
    TestBed.configureTestingModule({
      imports: [FusionBarComponent, ToolbarHost],
      providers: [
        provideTranslateService(),
        provideRouter([{ path: '**', component: Blank }]),
        { provide: LayoutService, useValue: { layout, track: () => 'wide' } },
        { provide: RoleService, useValue: { isAdmin: signal(false), isCollaborator: signal(false) } },
        { provide: SameRouteRefreshService, useValue: { request: () => true } },
        {
          provide: BetaService,
          useValue: { state: signal({ verse: true, codex: true, shell: true }), isEnabled: () => () => true },
        },
      ],
    });
    TestBed.overrideComponent(FusionBarComponent, {
      remove: { imports: [FusionSearchComponent] },
      add: { imports: [FusionSearchStub] },
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(FusionBarComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the kind switch on a Codex tool page; its panel carries the seven kinds as real anchors', async () => {
    layout.set('tool');
    const fixture = await setup('/codex/index?kind=weapon');
    const el = fixture.nativeElement as HTMLElement;
    const sw = el.querySelector('.kindsw') as HTMLButtonElement;
    expect(sw.textContent).toContain('codex.kinds.weapon');
    expect(sw.getAttribute('aria-expanded')).toBe('false');
    sw.click();
    fixture.detectChanges();
    const kinds = Array.from(el.querySelectorAll('.fpanel .kindrow a.kind')) as HTMLAnchorElement[];
    expect(kinds.length).toBe(7);
    expect(kinds.every((a) => !!a.getAttribute('href'))).toBeTrue();
    const active = kinds.filter((a) => a.classList.contains('active'));
    expect(active.length).toBe(1);
    expect(active[0].getAttribute('href')).toContain('kind=weapon');
    expect(active[0].getAttribute('aria-current')).toBe('page');
  });

  it('integrates the tool filters into the bar: tokens in the field, hit count, Filter button and the hanging panel', async () => {
    layout.set('tool');
    const fixture = await setup('/codex/index?kind=ship');
    const host = TestBed.createComponent(ToolbarHost);
    host.detectChanges();
    const chrome = TestBed.inject(ShellChromeService);
    const offTb = chrome.registerToolbar(host.componentInstance.tb());
    const removed: string[] = [];
    let resets = 0;
    const offF = chrome.registerFilters({}, () => ({
      count: 212,
      kindTotal: 368,
      tokens: [
        { id: 'manufacturer', labelKey: 'codex.filters.manufacturer', value: 'Aegis', remove: () => removed.push('manufacturer') },
      ],
      reset: () => resets++,
    }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.kindsw i')?.textContent).toContain('368');
    expect(el.querySelector('.count')?.textContent).toContain('fusionBar.hits');
    expect(el.querySelector('sc-fusion-search .tok .tok-v')?.textContent).toContain('Aegis');
    (el.querySelector('.tok-x') as HTMLButtonElement).click();
    expect(removed).toEqual(['manufacturer']);

    const fbtn = el.querySelector('.fbtn') as HTMLButtonElement;
    expect(fbtn.querySelector('i')?.textContent).toContain('1');
    fbtn.click();
    fixture.detectChanges();
    expect(fbtn.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('.cap')?.classList).toContain('open');
    expect(el.querySelector('.fpanel .fcols .tool-row')?.textContent).toContain('FILTERS');
    (el.querySelector('.fpanel .freset') as HTMLButtonElement).click();
    expect(resets).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('.fpanel')).toBeNull();
    offF();
    offTb();
    fixture.detectChanges();
    expect(el.querySelector('.fbtn')).toBeNull();
    expect(el.querySelector('.tok')).toBeNull();
  });

  it('plate: category on line one, "◂ origin" as a real anchor on line two, the full path on hover', async () => {
    layout.set('content');
    const fixture = await setup('/codex/ship/AEGS_Avenger');
    TestBed.inject(ShellChromeService).publishCrumbs({}, {
      crumbs: [
        { labelKey: 'nav.codex', link: ['/codex'] },
        { label: 'Schiffe', link: ['/codex', 'index'], queryParams: { kind: 'ship' } },
      ],
      title: 'Avenger Stalker',
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.plate .cat')?.textContent).toContain('nav.codex');
    const back = el.querySelector('.plate a.back') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/codex/index?kind=ship');
    expect(back.textContent).toContain('◂');
    expect(back.textContent).toContain('Schiffe');
    const path = Array.from(el.querySelectorAll('.plate .path li')).map((li) => li.textContent?.trim());
    expect(path).toEqual(['nav.codex', 'Schiffe', 'Avenger Stalker']);
    expect(el.querySelector('.blogo')?.getAttribute('href')).toBe('/verse');
    // No page title row, filter hint, patch chip or main-menu switching in the subheader.
    expect(el.querySelector('.seg, .menu, .nav, .kindsw')).toBeNull();
  });

  it('on a main page the condense follows the scroll: staged at the top, half docked half way, docked past the distance', async () => {
    layout.set('cinematic');
    const fixture = await setup('/verse');
    const chrome = TestBed.inject(ShellChromeService);
    const el = fixture.nativeElement as HTMLElement;
    const bar = fixture.componentInstance;
    expect(el.getAttribute('data-mode')).toBe('stage');
    expect(el.querySelector('sc-fusion-search')).not.toBeNull();
    // Logo slot and plate stay mounted while staged (collapsed and inert), so docking can grow them.
    expect(el.querySelector('.blogo')?.hasAttribute('inert')).toBeTrue();
    expect(el.querySelector('.plate')?.hasAttribute('inert')).toBeTrue();
    expect(chrome.stageSearch()).toBe('stage');

    bar.onScroll(DOCK_SCROLL_PX / 2);
    fixture.detectChanges();
    expect(el.getAttribute('data-mode')).toBe('docked');
    expect(el.classList).toContain('condensing');
    expect(chrome.dockProgress).toBeCloseTo(0.5, 5);
    expect(chrome.dockFull()).withContext('not landed yet').toBeFalse();
    expect(el.querySelector('.account')?.classList).toContain('pending');

    bar.onScroll(DOCK_SCROLL_PX + 40);
    fixture.detectChanges();
    expect(el.getAttribute('data-mode')).toBe('docked');
    expect(el.classList).not.toContain('condensing');
    expect(el.querySelector('.plate .cat')?.textContent).toContain('nav.verse');
    expect(chrome.stageSearch()).toBe('docked');
    expect(chrome.dockProgress).toBe(1);
    expect(chrome.dockFull()).toBeTrue();
    expect(el.classList).toContain('settled');
    expect(el.querySelector('.account')?.classList).not.toContain('pending');

    // Reversible mid-scroll: no hysteresis band, the same depth gives the same state.
    bar.onScroll(DOCK_SCROLL_PX / 4);
    fixture.detectChanges();
    expect(chrome.dockProgress).toBeCloseTo(0.25, 5);
    expect(chrome.dockFull()).toBeFalse();
    expect(el.getAttribute('data-mode')).toBe('docked');
    bar.onScroll(0);
    fixture.detectChanges();
    expect(el.getAttribute('data-mode')).toBe('stage');
    expect(chrome.stageSearch()).toBe('stage');
    expect(chrome.dockProgress).toBe(0);
  });

  it('is docked from the start on a sub-page, its back link leading to the area root without crumbs', async () => {
    layout.set('cinematic');
    const fixture = await setup('/verse/news');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.getAttribute('data-mode')).toBe('hub');
    expect(el.querySelector('.plate a.back')?.getAttribute('href')).toBe('/verse');
    expect(el.querySelector('sc-fusion-search')).not.toBeNull();
  });
});
