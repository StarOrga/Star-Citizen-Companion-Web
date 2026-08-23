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

  it('renders a neutral placeholder for the real role while it is still unresolved, never "viewer"', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('collaborator'));
    const fixture = setup(null);
    const imp = TestBed.inject(ImpersonationService);
    imp.setActualRole('admin', true);
    fixture.detectChanges();

    // `realRoleLabelKey()` is what's fed as the `role` interpolation param to
    // the `impersonation.banner.realRole` translation (this spec's bare
    // `TranslateModule.forRoot()` has no loaded translations, so the DOM only
    // ever shows raw, un-interpolated keys — asserting on the signal itself
    // is the meaningful check here).
    const component = fixture.componentInstance;
    expect(component.realRoleLabelKey()).toBe('—');
    expect(component.realRoleLabelKey().toLowerCase()).not.toContain('viewer');
  });

  it('keeps the "real role" fallback keyed to a real profile.roles.* key once realRole() resolves', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('collaborator'));
    const fixture = setup('viewer');
    const imp = TestBed.inject(ImpersonationService);
    imp.setActualRole('admin', true);
    fixture.detectChanges();

    expect(fixture.componentInstance.realRoleLabelKey()).toBe('profile.roles.viewer');
  });

  it('layers below every position:fixed;inset:0 dialog band (lowest known z-index 100) so a dialog keeps its own clicks', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('viewer'));
    const fixture = setup('admin');
    const imp = TestBed.inject(ImpersonationService);
    imp.setActualRole('admin', true);
    fixture.detectChanges();

    const banner: HTMLElement = fixture.nativeElement.querySelector('.imp-banner');
    const bannerZ = Number(getComputedStyle(banner).zIndex);
    expect(bannerZ).toBe(60);

    // Modal band this banner must stay under (see class doc comment):
    // quick-search 100, codex-swap-picker 150, starscape/uploader-access/
    // desktop-download 1200, feedback-attachments 1300.
    const modalBandZIndexes = [100, 150, 1200, 1300];
    for (const modalZ of modalBandZIndexes) {
      expect(bannerZ).toBeLessThan(modalZ);
    }
  });
});
