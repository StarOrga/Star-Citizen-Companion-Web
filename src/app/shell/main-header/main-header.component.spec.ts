import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { BetaService } from '../../core/beta.service';
import { SameRouteRefreshService } from '../../core/same-route-refresh.service';
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
    const widths = links.map((a) => Math.round(a.getBoundingClientRect().width));
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
});
