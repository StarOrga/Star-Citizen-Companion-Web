import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { DownloadComponent } from './download.component';
import { DesktopReleaseService, ReleaseInfo } from './desktop-release.service';
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { RoleService } from '../auth/role.service';

/** Smoke tests for the viewer-accessible /download page (see AUD-176 for the planned merge with /uploader). */
describe('DownloadComponent', () => {
  const release = (version: string): ReleaseInfo => ({
    version,
    notes: null,
    created_at: '2026-09-01T10:00:00Z',
    platforms: {
      'win-x64': { url: `https://example.test/${version}/setup.exe`, size_bytes: 1024, sha512: 'abcdef1234567890' },
    },
  });

  let forChannel: jasmine.Spy;
  const role = signal<'viewer' | 'collaborator' | 'admin' | null>('viewer');

  function setup(r: 'viewer' | 'collaborator' | 'admin' = 'viewer') {
    role.set(r);
    forChannel = jasmine
      .createSpy('forChannel')
      .and.callFake((ch: string) => Promise.resolve({ release: release(`1.0.0-${ch}`), error: null }));
    const canInstall = signal(true);
    TestBed.configureTestingModule({
      imports: [DownloadComponent],
      providers: [
        provideTranslateService(),
        { provide: DesktopReleaseService, useValue: { forChannel } },
        { provide: RoleService, useValue: { role } },
        {
          provide: DesktopCapabilityService,
          useValue: { canInstall, isMobileDevice: computed(() => !canInstall()) },
        },
      ],
    });
    const fixture = TestBed.createComponent(DownloadComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the entries of the release as real anchors', async () => {
    const f = setup();
    await f.whenStable();
    f.detectChanges();
    const links = f.nativeElement.querySelectorAll('a.ap-btn') as NodeListOf<HTMLAnchorElement>;
    expect(links.length).toBe(1);
    expect(links[0].getAttribute('href')).toBe('https://example.test/1.0.0-stable/setup.exe');
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0].textContent).toContain('win-x64');
    expect(f.componentInstance.release()?.version).toBe('1.0.0-stable');
  });

  it('a viewer only ever asks for stable', async () => {
    const f = setup('viewer');
    await f.whenStable();
    expect(forChannel.calls.allArgs()).toEqual([['stable']]);
  });

  it('switching the channel reloads the release', async () => {
    const f = setup('viewer');
    await f.whenStable();
    f.componentInstance.channel.set('beta');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(forChannel).toHaveBeenCalledWith('beta');
    expect(f.componentInstance.release()?.version).toBe('1.0.0-beta');
    expect(f.nativeElement.querySelector('a.ap-btn').getAttribute('href')).toContain('1.0.0-beta');
  });

  it('a load error shows the error key and no download link', async () => {
    const f = setup();
    forChannel.and.resolveTo({ release: null, error: 'errors.desktop.release' });
    f.componentInstance.channel.set('beta');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role="alert"]').textContent).toContain('errors.desktop.release');
  });
});
