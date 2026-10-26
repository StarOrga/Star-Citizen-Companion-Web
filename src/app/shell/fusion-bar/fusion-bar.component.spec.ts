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

@Component({ selector: 'sc-fusion-search', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '<ng-content />' })
class FusionSearchStub {
  readonly placement = input<'top' | 'bottom'>('top');
  readonly compact = input(false);
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

  it('shows the seven Codex kinds as real anchors on a Codex tool page, the active one marked', async () => {
    layout.set('tool');
    const fixture = await setup('/codex/index?kind=weapon');
    const kinds = Array.from(fixture.nativeElement.querySelectorAll('.kinds a.kind')) as HTMLAnchorElement[];
    expect(kinds.length).toBe(7);
    expect(kinds.every((a) => !!a.getAttribute('href'))).toBeTrue();
    const active = kinds.filter((a) => a.classList.contains('active'));
    expect(active.length).toBe(1);
    expect(active[0].getAttribute('href')).toContain('kind=weapon');
    expect(active[0].getAttribute('aria-current')).toBe('page');
  });

  it('renders a registered tool toolbar as the drawer, toggled from the search', async () => {
    layout.set('tool');
    const fixture = await setup('/codex/index');
    const host = TestBed.createComponent(ToolbarHost);
    host.detectChanges();
    const off = TestBed.inject(ShellChromeService).registerToolbar(host.componentInstance.tb());
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.drawer-toggle') as HTMLButtonElement;
    // Starts open on a roomy desktop window, folded elsewhere (Karma runs narrow).
    if (toggle.getAttribute('aria-expanded') !== 'true') {
      toggle.click();
      fixture.detectChanges();
    }
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.drawer .tool-row')?.textContent).toContain('FILTERS');
    toggle.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.drawer')).toBeNull();
    off();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.drawer-toggle')).toBeNull();
  });

  it('shows the published crumbs + title on a content page', async () => {
    layout.set('content');
    const fixture = await setup('/codex/ship/AEGS_Avenger');
    TestBed.inject(ShellChromeService).publishCrumbs({}, {
      crumbs: [{ label: 'Codex', link: ['/codex'] }],
      title: 'Avenger Stalker',
    });
    fixture.detectChanges();
    const crumb = fixture.nativeElement.querySelector('.crumbs a.crumb') as HTMLAnchorElement;
    expect(crumb.getAttribute('href')).toBe('/codex');
    expect(fixture.nativeElement.querySelector('.crumbs .here')?.textContent).toContain('Avenger Stalker');
    expect(fixture.nativeElement.querySelector('.kinds')).toBeNull();
  });

  it('leaves the search to the stage line on a cinematic hub, docks it once passed', async () => {
    layout.set('cinematic');
    const fixture = await setup('/verse');
    const chrome = TestBed.inject(ShellChromeService);
    chrome.setStageSearch('stage');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('sc-fusion-search')).toBeNull();
    expect(fixture.nativeElement.querySelector('.brand')).not.toBeNull();
    chrome.setStageSearch('docked');
    fixture.detectChanges();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('sc-fusion-search')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).classList.contains('morph')).toBeTrue();
    expect(fixture.nativeElement.getAttribute('data-mode')).toBe('docked');
    chrome.setStageSearch('none');
  });
});
