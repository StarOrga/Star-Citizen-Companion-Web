import type { Mock } from 'vitest';
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
  let ringsFor: Mock;

  const setup = (r: string) => {
    role.set(r);
    canInstall.set(true);
    ringsFor = vi.fn().mockName('ringsFor').mockImplementation(async (app: string, rings: readonly string[]) => ({
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
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(
        JSON.stringify({ version: 'v0.100.0', sizeBytes: 100 * 1024 * 1024 }),
      ));
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
      expect(entries.some((a) => a.classList.contains('elevated'))).toBe(false);
      expect(entries[1].getAttribute('href')).toBe('https://example.test/starscape-stable.exe');
      expect(entries[1].textContent).toContain('v1.2.0 · 5.0 MB');
      expect(ringsFor).toHaveBeenCalledTimes(1);
    });
  }

  for (const r of ['collaborator', 'admin']) {
    it(`${r}: stable only for every app, the uploader in the hot accent`, async () => {
      setup(r);
      await openMenu();
      expect(hrefs('.pop a.entry:not(.elevated)')[1]).toBe('https://example.test/starscape-stable.exe');
      expect(hrefs('.pop a.entry.elevated')).toEqual(['https://example.test/uploader-stable.exe']);
      expect(ringsFor).toHaveBeenCalledWith('starscape', ['stable']);
      expect(ringsFor).toHaveBeenCalledWith('uploader', ['stable']);
      expect(el().querySelector('.pop .hint')?.textContent).toContain('appsMenu.footer');
    });
  }

  it('SCC App meta reads "Windows · vX · MB" from the alias release; no collaborator badge', async () => {
    setup('collaborator');
    await openMenu();
    await new Promise((r) => setTimeout(r, 20)); // Response.json() settles on a macrotask
    fixture.detectChanges();
    const entries = Array.from(el().querySelectorAll<HTMLAnchorElement>('.pop a.entry'));
    expect(entries[0].querySelector('.meta')?.textContent).toContain('Windows · v0.100.0 · 100.0 MB');
    expect(el().querySelector('.pop em')).toBeNull();
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
