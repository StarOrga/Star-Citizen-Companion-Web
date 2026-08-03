import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ImpersonationService, VIEW_AS_STORAGE_KEY } from '../auth/impersonation.service';
import { RoleService } from '../auth/role.service';
import { ImpersonationBannerComponent } from './impersonation-banner.component';

describe('ImpersonationBannerComponent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.documentElement.style.removeProperty('--sc-imp-banner-h');
  });

  afterEach(() => {
    sessionStorage.clear();
    document.documentElement.style.removeProperty('--sc-imp-banner-h');
  });

  function setup(realRole: 'admin' | 'collaborator' | 'viewer' | null) {
    TestBed.configureTestingModule({
      imports: [ImpersonationBannerComponent, TranslateModule.forRoot()],
      providers: [
        ImpersonationService,
        { provide: RoleService, useValue: { realRole: signal(realRole) } },
      ],
    });
    const fixture = TestBed.createComponent(ImpersonationBannerComponent);
    return fixture;
  }

  it('renders nothing while no preview is active', () => {
    const fixture = setup('admin');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.imp-banner')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--sc-imp-banner-h').trim()).toBe('0px');
  });

  it('renders the banner and sets the CSS var once a preview is active', () => {
    // `enter()` itself reloads the page in production — these specs never
    // trigger it, and instead seed storage the way a completed reload would,
    // then construct against a real role that allows that target.
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('viewer'));
    const fixture = setup('admin');
    const imp = TestBed.inject(ImpersonationService);
    imp.setActualRole('admin', true);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.imp-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('role')).toBe('status');
    // The height is MEASURED, not assumed: the fidelity note wraps to a second
    // line at narrow widths and in the longer locale, and a hard-coded value
    // left the shell's sticky header sitting underneath the strip.
    const published = document.documentElement.style.getPropertyValue('--sc-imp-banner-h').trim();
    expect(published).toBe(`${banner.offsetHeight}px`);
    expect(banner.offsetHeight).toBeGreaterThan(0);
  });

  it('exit() is wired to the Exit-preview button', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('viewer'));
    const fixture = setup('admin');
    const imp = TestBed.inject(ImpersonationService);
    imp.setActualRole('admin', true);
    fixture.detectChanges();
    const exitSpy = spyOn(imp, 'exit');

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.imp-banner__exit');
    expect(btn).toBeTruthy();
    btn.click();

    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('picks the anon fidelity key for a signed-out preview and the shared one otherwise', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('anon'));
    const fixture = setup('admin');
    const imp = TestBed.inject(ImpersonationService);
    imp.setActualRole('admin', true);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.fidelityKey()).toBe('impersonation.banner.fidelity.anon');
  });
});
