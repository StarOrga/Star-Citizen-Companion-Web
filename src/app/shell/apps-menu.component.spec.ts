import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { RoleService } from '../auth/role.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { DesktopReleaseService } from '../desktop/desktop-release.service';
import { AppsMenuComponent, formatAppSize } from './apps-menu.component';

describe('formatAppSize', () => {
  it('formats MB with one decimal, KB below 1 MB, nothing for empty sizes', () => {
    expect(formatAppSize(12.34 * 1024 * 1024)).toBe('12.3 MB');
    expect(formatAppSize(300 * 1024)).toBe('300 KB');
    expect(formatAppSize(0)).toBeNull();
    expect(formatAppSize(null)).toBeNull();
  });
});

describe('AppsMenuComponent', () => {
  let fixture: ComponentFixture<AppsMenuComponent>;
  const canInstall = signal(true);
  const role = signal<string>('viewer');
  let ringsFor: jasmine.Spy;

  const setup = (r: string) => {
    role.set(r);
    canInstall.set(true);
    ringsFor = jasmine.createSpy('ringsFor').and.callFake(async (app: string, rings: readonly string[]) => ({
      releases: rings.map((ring) => ({
        ring,
        version: app === 'starscape' ? '1.2.0' : '0.41.0',
        url: `https://example.test/${app}-${ring}.exe`,
        sizeBytes: 5 * 1024 * 1024,
      })),
    }));
    TestBed.configureTestingModule({
      imports: [AppsMenuComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: DesktopCapabilityService, useValue: { canInstall } },
        {
          provide: RoleService,
          useValue: { role, isCollaborator: computed(() => role() === 'admin' || role() === 'collaborator') },
        },
        { provide: DesktopReleaseService, useValue: { ringsFor } },
      ],
    });
    fixture = TestBed.createComponent(AppsMenuComponent);
    fixture.detectChanges();
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const openMenu = async () => {
    el().querySelector<HTMLButtonElement>('.trigger')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const hrefs = (sel: string) =>
    Array.from(el().querySelectorAll<HTMLAnchorElement>(sel)).map((a) => a.getAttribute('href'));

  it('renders nothing on a device that cannot install a desktop app', () => {
    setup('viewer');
    canInstall.set(false);
    fixture.detectChanges();
    expect(el().querySelector('.trigger')).toBeNull();
  });

  for (const r of ['viewer', 'anon']) {
    it(`${r}: SCC App + Starscape as plain stable downloads, no picker, no uploader`, async () => {
      setup(r);
      await openMenu();
      const entries = Array.from(el().querySelectorAll<HTMLAnchorElement>('.pop a.entry'));
      expect(entries.length).toBe(2);
      expect(entries.some((a) => a.classList.contains('elevated'))).toBeFalse();
      expect(entries[1].getAttribute('href')).toBe('https://example.test/starscape-stable.exe');
      expect(entries[1].textContent).toContain('v1.2.0 · 5.0 MB');
      expect(el().querySelector('.ring')).toBeNull();
      expect(ringsFor).toHaveBeenCalledTimes(1);
    });
  }

  it('collaborator: Starscape and Data Uploader offer stable + beta, no admin-only entry', async () => {
    setup('collaborator');
    await openMenu();
    expect(hrefs('.pop .app:not(.elevated) a.ring')).toEqual([
      'https://example.test/starscape-stable.exe',
      'https://example.test/starscape-beta.exe',
    ]);
    expect(hrefs('.pop .app.elevated a.ring')).toEqual([
      'https://example.test/uploader-stable.exe',
      'https://example.test/uploader-beta.exe',
    ]);
    expect(el().querySelector('.ring.admin-only')).toBeNull();
  });

  it('admin: all three channels per app, alpha in the hot accent and labelled admin only', async () => {
    setup('admin');
    await openMenu();
    expect(hrefs('.pop .app.elevated a.ring').length).toBe(3);
    const alphas = Array.from(el().querySelectorAll<HTMLAnchorElement>('.ring.admin-only'));
    expect(alphas.length).toBe(2);
    expect(alphas.every((a) => a.getAttribute('href')!.endsWith('-alpha.exe'))).toBeTrue();
    expect(alphas.every((a) => !!a.querySelector('.r-tag')?.textContent?.trim())).toBeTrue();
    expect(ringsFor).toHaveBeenCalledWith('uploader', ['stable', 'beta', 'alpha']);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    setup('viewer');
    await openMenu();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el().querySelector('.pop')).toBeNull();
    expect(document.activeElement).toBe(el().querySelector('.trigger'));
  });

  it('a modified click on an entry keeps the menu open (new tab)', async () => {
    setup('viewer');
    await openMenu();
    const a = el().querySelector<HTMLAnchorElement>('.pop a.entry')!;
    a.addEventListener('click', (e) => e.preventDefault());
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    fixture.detectChanges();
    expect(el().querySelector('.pop')).not.toBeNull();
  });
});
