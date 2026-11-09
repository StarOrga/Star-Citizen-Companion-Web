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

  it('keeps Admin out of the nav for admins too: it lives in the account menu', async () => {
    const fixture = await setup('/verse', true);
    const links = slots(fixture.nativeElement);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/verse', '/codex', '/hq']);
    expect(fixture.nativeElement.querySelector('a[href="/admin/hub"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/admin/telemetry"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.subrow, .slot.adm, .ind.elevated')).toBeNull();
  });

  it('holds the header back only during the first-visit hub intro, scaled by k', async () => {
    const fixture = await setup('/verse', false);
    const host = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    expect(host.classList.contains('hero-intro')).toBe(false);
    const chrome = TestBed.inject(ShellChromeService);
    chrome.startHeroIntro(1, true);
    fixture.detectChanges();
    expect(host.classList.contains('hero-intro')).toBe(true);
    expect(host.hasAttribute('inert')).toBe(true);
    expect(host.style.getPropertyValue('--sc-intro-k')).toBe('1');
    // Without beats the header keeps the k-scaled default; the entrance sets its own beat after the search.
    expect(host.style.getPropertyValue('--sc-intro-header-at')).toBe('');
    chrome.startHeroIntro(1.52, true, { searchAtMs: 3500, headerAtMs: 4300 });
    fixture.detectChanges();
    expect(host.style.getPropertyValue('--sc-intro-header-at')).toBe('4300ms');
    chrome.endHeroIntro();
    fixture.detectChanges();
    expect(host.classList.contains('hero-intro')).toBe(false);
  });

  it('does not delay the header on a repeat visit of the hub', async () => {
    const fixture = await setup('/verse', false);
    const host = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    TestBed.inject(ShellChromeService).startHeroIntro(0.1765, false);
    fixture.detectChanges();
    expect(host.classList.contains('hero-intro')).toBe(false);
  });

  it('hides the admin entry from non-admins', async () => {
    const fixture = await setup('/codex', false);
    expect(slots(fixture.nativeElement).map((a) => a.getAttribute('href'))).toEqual(['/verse', '/codex', '/hq']);
  });

  it('marks the active area and keeps every slot the same fixed width', async () => {
    const fixture = await setup('/admin/hub', true);
    const links = slots(fixture.nativeElement);
    // The admin hub is no nav slot, so no slot is the current page there.
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page')).toEqual([]);
    const widths = links
      .map((a) => Math.round(a.getBoundingClientRect().width))
      .filter((w) => w > 0);
    // The phone branch spreads the slots evenly, wider screens (the 1280px test window) pin them.
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
    expect(header.classList, 'half docked is still reachable').not.toContain('compressed');
    expect(header.hasAttribute('inert')).toBe(false);
    chrome.setDockProgress(1);
    fixture.detectChanges();
    expect(header.classList).toContain('compressed');
    expect(header.hasAttribute('inert')).toBe(true);
    chrome.setDockProgress(0.3);
    fixture.detectChanges();
    expect(header.classList).not.toContain('compressed');
    chrome.setStageSearch('none');
    fixture.detectChanges();
    expect(header.classList).toContain('compressed');
  });

  it('corner layout: brand top-left, account top-right, nothing hanging below the account', async () => {
    const fixture = await setup('/verse', true);
    const header = fixture.nativeElement.querySelector('sc-main-header') as HTMLElement;
    const account = header.querySelector('.account') as HTMLElement;
    expect(account.children.length, 'only the apps + profile row').toBe(1);
    if (window.innerWidth > 720) {
      expect(getComputedStyle(header.querySelector('.brand')!).position).toBe('absolute');
      expect(getComputedStyle(account).position).toBe('absolute');
    }
  });
});
