import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { DesktopDownloadComponent } from './desktop-download.component';
import { DesktopReleaseService, ReleaseInfo } from './desktop-release.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { RoleService } from '../auth/role.service';
import { SupabaseClientProvider } from '../core/supabase.client';

/** Smoke tests for /uploader; they keep the later merge with /download (AUD-176) honest. */
describe('DesktopDownloadComponent', () => {
  const release = (version: string): ReleaseInfo => ({
    version,
    notes: 'notes',
    created_at: '2026-09-01T10:00:00Z',
    platforms: {
      'win-x64': { url: `https://example.test/${version}/setup.exe`, size_bytes: 2048, sha256: '0123456789abcdef' },
    },
  });

  let forChannel: jasmine.Spy;
  const role = signal<'viewer' | 'collaborator' | 'admin' | null>('viewer');

  function setup(r: 'viewer' | 'collaborator' | 'admin' = 'viewer') {
    role.set(r);
    forChannel = jasmine
      .createSpy('forChannel')
      .and.callFake((ch: string) => Promise.resolve({ release: release(`2.0.0-${ch}`), error: null }));
    const canInstall = signal(true);
    TestBed.configureTestingModule({
      imports: [DesktopDownloadComponent],
      providers: [
        provideTranslateService(),
        { provide: DesktopReleaseService, useValue: { forChannel } },
        { provide: RoleService, useValue: { role, isAdmin: computed(() => role() === 'admin') } },
        { provide: SupabaseClientProvider, useValue: { client: {}, realClient: {} } },
        {
          provide: DesktopCapabilityService,
          useValue: { canInstall, isMobileDevice: computed(() => !canInstall()) },
        },
      ],
    });
    const fixture = TestBed.createComponent(DesktopDownloadComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the release entries as real anchors', async () => {
    const f = setup();
    await f.whenStable();
    f.detectChanges();
    const links = f.nativeElement.querySelectorAll('a.ap-btn') as NodeListOf<HTMLAnchorElement>;
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://example.test/2.0.0-stable/setup.exe');
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(f.nativeElement.querySelector('h1').textContent).toContain('desktop.title');
  });

  it('switching the channel reloads the release', async () => {
    const f = setup('viewer');
    await f.whenStable();
    f.componentInstance.channel.set('beta');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(forChannel).toHaveBeenCalledWith('beta');
    expect(f.nativeElement.querySelector('a.ap-btn').getAttribute('href')).toContain('2.0.0-beta');
  });

  it('an admin lands on the top ring via the channel picker', async () => {
    const f = setup('admin');
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.channel()).toBe('alpha');
    expect(f.componentInstance.release()?.version).toBe('2.0.0-alpha');
  });

  it('the promote row is admin-only', async () => {
    const viewer = setup('viewer');
    await viewer.whenStable();
    viewer.detectChanges();
    expect(viewer.nativeElement.querySelector('.promote')).toBeNull();
    TestBed.resetTestingModule();
    const admin = setup('admin');
    await admin.whenStable();
    admin.detectChanges();
    expect(admin.nativeElement.querySelector('.promote')).not.toBeNull();
  });
});
