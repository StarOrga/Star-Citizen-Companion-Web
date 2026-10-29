import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BetaService } from '../../core/beta.service';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
import { ShellChromeService } from '../fusion-bar/shell-chrome.service';
import { MAIN_NAV_SLOT_PX, MainHeaderComponent } from './main-header.component';

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

@Component({
  standalone: true,
  imports: [MainHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<sc-main-header><button mhAccount type="button" class="acct">J</button></sc-main-header>',
})
class Host {}

describe('MainHeaderComponent', () => {
  async function setup(url: string, admin: boolean) {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideTranslateService(),
        provideRouter([{ path: '**', component: Blank }]),
        { provide: RoleService, useValue: { isAdmin: signal(admin), isCollaborator: signal(admin) } },
        { provide: SameRouteRefreshService, useValue: { request: () => true } },
        { provide: BetaService, useValue: { state: signal({ verse: true, codex: true, shell: true }), isEnabled: () => () => true } },
      ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    // A main page at its top: the bar reports its staged field, the header stands expanded.
    TestBed.inject(ShellChromeService).setStageSearch('stage');
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const slots = (el: HTMLElement) => Array.from(el.querySelectorAll('.nav a.slot')) as HTMLAnchorElement[];

  it('shows ONE admin entry for admins — a red anchor to the hub that says admin in words', async () => {
    const fixture = await setup('/verse', true);
    const links = slots(fixture.nativeElement);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/verse', '/codex', '/hq', '/admin/hub']);
    const admin = links[3];
    expect(admin.classList.contains('elevated')).toBeTrue();
    expect(admin.querySelector('.sr-only')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/admin/telemetry"]')).toBeNull();
  });

  it('holds the header back only during the first-visit hub intro, scaled by k', async () => {
    const fixture = await setup('/verse', false);
    const host = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    expect(host.classList.contains('hero-intro')).toBeFalse();
    const chrome = TestBed.inject(ShellChromeService);
    chrome.startHeroIntro(1, true);
    fixture.detectChanges();
    expect(host.classList.contains('hero-intro')).toBeTrue();
    expect(host.hasAttribute('inert')).toBeTrue();
    expect(host.style.getPropertyValue('--sc-intro-k')).toBe('1');
    chrome.endHeroIntro();
    fixture.detectChanges();
    expect(host.classList.contains('hero-intro')).toBeFalse();
  });

  it('does not delay the header on a repeat visit of the hub', async () => {
    const fixture = await setup('/verse', false);
    const host = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    TestBed.inject(ShellChromeService).startHeroIntro(0.1765, false);
    fixture.detectChanges();
    expect(host.classList.contains('hero-intro')).toBeFalse();
  });

  it('hides the admin entry from non-admins', async () => {
    const fixture = await setup('/codex', false);
    expect(slots(fixture.nativeElement).map((a) => a.getAttribute('href'))).toEqual(['/verse', '/codex', '/hq']);
  });

  it('marks the active area and keeps every slot the same fixed width', async () => {
    const fixture = await setup('/admin/hub', true);
    const links = slots(fixture.nativeElement);
    const active = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(active.map((a) => a.getAttribute('href'))).toEqual(['/admin/hub']);
    expect(fixture.nativeElement.querySelector('.ind.elevated')).not.toBeNull();
    // Desktop keeps Admin out of the nav (it lives in the sub row), so only the shown slots count.
    const widths = links
      .map((a) => Math.round(a.getBoundingClientRect().width))
      .filter((w) => w > 0);
    // Karma renders at 749px: the phone branch spreads the slots evenly, wider screens pin them.
    expect(new Set(widths).size).toBe(1);
    if (window.innerWidth > 720) expect(widths[0]).toBe(MAIN_NAV_SLOT_PX);
  });

  it('projects the account menu and draws no box behind the header', async () => {
    const fixture = await setup('/hq', true);
    const header = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    expect(header.querySelector('.account .acct')).not.toBeNull();
    const row = header.querySelector('.row') as HTMLElement;
    const cs = getComputedStyle(row);
    expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(cs.borderTopWidth).toBe('0px');
  });

  it('condenses into the bar only once the progress has landed (or off the main pages)', async () => {
    const fixture = await setup('/verse', false);
    const header = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    const chrome = TestBed.inject(ShellChromeService);
    expect(header.classList).not.toContain('compressed');
    chrome.setStageSearch('docked');
    chrome.setDockProgress(0.5);
    fixture.detectChanges();
    expect(header.classList).withContext('half docked is still reachable').not.toContain('compressed');
    expect(header.hasAttribute('inert')).toBeFalse();
    chrome.setDockProgress(1);
    fixture.detectChanges();
    expect(header.classList).toContain('compressed');
    expect(header.hasAttribute('inert')).toBeTrue();
    chrome.setDockProgress(0.3);
    fixture.detectChanges();
    expect(header.classList).not.toContain('compressed');
    chrome.setStageSearch('none');
    fixture.detectChanges();
    expect(header.classList).toContain('compressed');
  });

  it('corner layout: brand top-left, account top-right, Admin in a row directly below the account', async () => {
    const fixture = await setup('/verse', true);
    const header = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    const account = header.querySelector('.account') as HTMLElement;
    const admin = account.querySelector('.subrow a.admin') as HTMLAnchorElement;
    expect(admin).withContext('admin entry in the sub row').not.toBeNull();
    expect(admin.getAttribute('href')).toBe('/admin/hub');
    expect(admin.querySelector('.sr-only')).withContext('says admin-only in words').not.toBeNull();
    expect(header.querySelector('.row .admin')).toBeNull();
    if (window.innerWidth > 720) {
      expect(getComputedStyle(header.querySelector('.brand')!).position).toBe('absolute');
      expect(getComputedStyle(account).position).toBe('absolute');
      const main = account.querySelector('.acc-main')!.getBoundingClientRect();
      expect(admin.getBoundingClientRect().top).toBeGreaterThanOrEqual(main.bottom - 1);
      // The nav keeps Admin out of its centred run on desktop.
      expect(getComputedStyle(header.querySelector('.slot.adm')!).display).toBe('none');
    } else {
      // Phone: the sub row yields to the nav slot, brand and account share the top row.
      expect(getComputedStyle(header.querySelector('.subrow')!).display).toBe('none');
      expect(getComputedStyle(header.querySelector('.slot.adm')!).display).toBe('block');
    }
  });

  it('shows no Admin row to non-admins', async () => {
    const fixture = await setup('/verse', false);
    expect(fixture.nativeElement.querySelector('sc-main-header .subrow')).toBeNull();
  });
});
