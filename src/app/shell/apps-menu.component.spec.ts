import { signal } from '@angular/core';
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
  const collaborator = signal(false);
  let ringsFor: jasmine.Spy;

  beforeEach(() => {
    canInstall.set(true);
    collaborator.set(false);
    ringsFor = jasmine.createSpy('ringsFor').and.callFake(async (app: string) => ({
      releases: [{ version: app === 'starscape' ? '1.2.0' : '0.41.0', url: `https://example.test/${app}.exe`, sizeBytes: 5 * 1024 * 1024 }],
    }));
    TestBed.configureTestingModule({
      imports: [AppsMenuComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: DesktopCapabilityService, useValue: { canInstall } },
        { provide: RoleService, useValue: { isCollaborator: collaborator, role: signal('admin') } },
        { provide: DesktopReleaseService, useValue: { ringsFor } },
      ],
    });
    fixture = TestBed.createComponent(AppsMenuComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const openMenu = async () => {
    el().querySelector<HTMLButtonElement>('.trigger')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('renders nothing on a device that cannot install a desktop app', () => {
    canInstall.set(false);
    fixture.detectChanges();
    expect(el().querySelector('.trigger')).toBeNull();
  });

  it('lists the public apps as real download anchors in the normal accent, no uploader for a viewer', async () => {
    await openMenu();
    const entries = Array.from(el().querySelectorAll<HTMLAnchorElement>('.pop a.entry'));
    expect(entries.length).toBe(2);
    expect(entries.every((a) => a.hasAttribute('href') && !a.classList.contains('elevated'))).toBeTrue();
    expect(entries[1].getAttribute('href')).toBe('https://example.test/starscape.exe');
    expect(entries[1].textContent).toContain('v1.2.0 · 5.0 MB');
    expect(ringsFor).toHaveBeenCalledTimes(1);
  });

  it('adds the Data Uploader in the hot accent for a collaborator', async () => {
    collaborator.set(true);
    await openMenu();
    const up = el().querySelector<HTMLAnchorElement>('.pop a.entry.elevated');
    expect(up).not.toBeNull();
    expect(up!.getAttribute('href')).toBe('https://example.test/uploader.exe');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    await openMenu();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el().querySelector('.pop')).toBeNull();
    expect(document.activeElement).toBe(el().querySelector('.trigger'));
  });

  it('a modified click on an entry keeps the menu open (new tab)', async () => {
    await openMenu();
    const a = el().querySelector<HTMLAnchorElement>('.pop a.entry')!;
    a.addEventListener('click', (e) => e.preventDefault());
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    fixture.detectChanges();
    expect(el().querySelector('.pop')).not.toBeNull();
  });
});
