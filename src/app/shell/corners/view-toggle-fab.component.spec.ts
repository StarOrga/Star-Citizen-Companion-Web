import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BetaService } from '../../core/beta.service';
import { ShareButtonComponent } from '../../shared/share-button/share-button.component';
import { BetaFabComponent } from './beta-fab.component';
import { PageCornerService } from './page-corner.service';
import { VIEW_FAB_LANE_VAR, ViewToggleFabComponent } from './view-toggle-fab.component';

@Component({
  standalone: true,
  imports: [ViewToggleFabComponent, BetaFabComponent, ShareButtonComponent],
  template: `<sc-view-toggle-fab /><sc-beta-fab area="shell" /><sc-share-button />`,
})
class CornerHost {}

const betaStub = {
  isEnabled: () => signal(true),
  state: signal({ verse: false, codex: false, shell: true }),
  locked: signal({ verse: false, codex: false, shell: false }),
  toggle: () => undefined,
};
const rolesStub = { isCollaborator: () => false, isAdmin: () => false };

describe('ViewToggleFabComponent + the corner order (concept codex-kopf-besitz C4/C8)', () => {
  const root = document.documentElement;

  function setup() {
    TestBed.configureTestingModule({
      imports: [CornerHost],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: BetaService, useValue: betaStub },
        { provide: RoleService, useValue: rolesStub },
      ],
    });
    const fixture = TestBed.createComponent(CornerHost);
    fixture.detectChanges();
    return { fixture, corner: TestBed.inject(PageCornerService), el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => root.style.removeProperty(VIEW_FAB_LANE_VAR));

  it('is not drawn while no page registered a view switch', () => {
    const { el } = setup();
    expect(el.querySelector('sc-view-toggle-fab .fab')).toBeNull();
    expect(root.style.getPropertyValue(VIEW_FAB_LANE_VAR)).toBe('');
  });

  it('toggles the registered view and names the view the click leads to', () => {
    const { fixture, corner, el } = setup();
    const holo = signal(true);
    const toggle = jasmine.createSpy('toggle').and.callFake(() => holo.set(!holo()));
    corner.setView({ holo, toggle });
    fixture.detectChanges();
    const fab = el.querySelector<HTMLButtonElement>('sc-view-toggle-fab .fab')!;
    expect(fab.getAttribute('aria-label')).toBe('corner.view.toClassic');
    expect(fab.hasAttribute('title')).toBeFalse();
    fab.click();
    fixture.detectChanges();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(fab.getAttribute('aria-label')).toBe('corner.view.toHolo');
    expect(fab.dataset['view']).toBe('classic');
  });

  it('stacks launcher < view FAB < β in one column, the share on the launcher line to their left', () => {
    const { fixture, corner, el } = setup();
    const betaAlone = el.querySelector('sc-beta-fab .wrap')!.getBoundingClientRect();
    corner.setView({ holo: signal(true), toggle: () => undefined });
    fixture.detectChanges();
    expect(root.style.getPropertyValue(VIEW_FAB_LANE_VAR)).not.toBe('');
    const view = el.querySelector('sc-view-toggle-fab .wrap')!.getBoundingClientRect();
    const beta = el.querySelector('sc-beta-fab .wrap')!.getBoundingClientRect();
    const share = el.querySelector('sc-share-button .dock')!.getBoundingClientRect();
    // The view FAB takes β's old lane, β moves up by one lane.
    expect(Math.round(view.bottom)).toBe(Math.round(betaAlone.bottom));
    expect(beta.bottom).toBeLessThanOrEqual(view.top + 0.5);
    // Same column: centred on the same vertical line.
    expect(Math.abs((view.left + view.right) / 2 - (beta.left + beta.right) / 2)).toBeLessThan(1);
    // Share: left of the column and below the view FAB's lane (the launcher's line).
    expect(share.right).toBeLessThan(view.left);
    expect(share.top).toBeGreaterThanOrEqual(view.bottom);
  });

  it('a released page takes the FAB and its lane with it; a newer page keeps its own', () => {
    const { fixture, corner, el } = setup();
    const a = { holo: signal(true), toggle: () => undefined };
    const b = { holo: signal(false), toggle: () => undefined };
    corner.setView(a);
    corner.setView(b);
    corner.release(a, null);
    fixture.detectChanges();
    expect(corner.view()).toBe(b);
    corner.release(b, null);
    fixture.detectChanges();
    expect(el.querySelector('sc-view-toggle-fab .fab')).toBeNull();
    expect(root.style.getPropertyValue(VIEW_FAB_LANE_VAR)).toBe('');
  });

  it('the share FAB shares the page-registered URL instead of URL + anchor', async () => {
    const { corner, el } = setup();
    corner.setShare({ url: () => 'https://x.test/codex/ship/a?view=classic&loadout=abc' });
    const nav = navigator as Navigator & { share?: unknown };
    const hadShare = 'share' in nav;
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    if (hadShare) spyOn(nav as { share: (d: ShareData) => Promise<void> }, 'share').and.rejectWith(new Error('x'));
    el.querySelector<HTMLButtonElement>('sc-share-button .fab')!.click();
    await new Promise((r) => setTimeout(r));
    if (hadShare) {
      expect((nav as unknown as { share: jasmine.Spy }).share).toHaveBeenCalledWith(jasmine.objectContaining({ url: 'https://x.test/codex/ship/a?view=classic&loadout=abc' }));
    } else {
      expect(write).toHaveBeenCalledWith('https://x.test/codex/ship/a?view=classic&loadout=abc');
    }
  });
});

describe('ShareButtonComponent without the beta shell (F5)', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [ShareButtonComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' }), { provide: BetaService, useValue: { ...betaStub, isEnabled: () => signal(false) } }],
    });
    const fixture = TestBed.createComponent(ShareButtonComponent);
    fixture.detectChanges();
    return { fixture, corner: TestBed.inject(PageCornerService), el: fixture.nativeElement as HTMLElement };
  }

  it('is absent on a page without a registered share, present (beside the launcher) on a ship page', () => {
    const { fixture, corner, el } = setup();
    expect(el.querySelector('.dock')).toBeNull();
    corner.setShare({ url: () => 'u' });
    fixture.detectChanges();
    expect(el.querySelector('.dock.beside .fab')).not.toBeNull();
  });

  it('opens the page popover instead of sharing directly, and says so in aria', () => {
    const { fixture, corner, el } = setup();
    const open = jasmine.createSpy('open');
    const expanded = signal(false);
    corner.setShare({ url: () => 'u', open: (t) => { open(t); expanded.set(true); }, expanded });
    fixture.detectChanges();
    const fab = el.querySelector<HTMLButtonElement>('.fab')!;
    expect(fab.getAttribute('aria-haspopup')).toBe('dialog');
    expect(fab.getAttribute('aria-expanded')).toBe('false');
    const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    fab.click();
    fixture.detectChanges();
    expect(open).toHaveBeenCalledWith(fab);
    expect(write).not.toHaveBeenCalled();
    expect(fab.getAttribute('aria-expanded')).toBe('true');
  });
});
