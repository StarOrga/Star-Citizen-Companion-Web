import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UploaderAccessComponent } from './uploader-access.component';
import { DesktopReleaseService, ReleaseInfo } from './desktop-release.service';
import { RoleService } from '../auth/role.service';

const RELEASE: ReleaseInfo = {
  version: '0.21.2',
  platforms: { 'win-x64': { url: 'https://example.test/uploader.exe', size_bytes: 1024 * 1024 } },
  notes: null,
  created_at: '2026-07-01T00:00:00Z',
};

describe('UploaderAccessComponent', () => {
  function setup(role: 'admin' | 'collaborator' | 'viewer') {
    const forChannel = jasmine
      .createSpy('forChannel')
      .and.resolveTo({ release: RELEASE, error: null });
    TestBed.configureTestingModule({
      imports: [UploaderAccessComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: DesktopReleaseService, useValue: { forChannel } },
        {
          provide: RoleService,
          useValue: {
            role: signal(role).asReadonly(),
            isAdmin: signal(role === 'admin').asReadonly(),
            isCollaborator: signal(role !== 'viewer').asReadonly(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(UploaderAccessComponent);
    fixture.detectChanges();
    return { fixture, forChannel };
  }

  it('renders nothing for a viewer', () => {
    const { fixture } = setup('viewer');
    expect(fixture.nativeElement.querySelector('.ua-row')).toBeNull();
  });

  it('renders one collapsed line for a collaborator', () => {
    const { fixture } = setup('collaborator');
    expect(fixture.nativeElement.querySelector('.ua-row')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.ua-body')).toBeNull();
  });

  it('costs the Codex landing no release lookup while collapsed', () => {
    const { forChannel } = setup('collaborator');
    expect(forChannel).not.toHaveBeenCalled();
  });

  it('loads the release and shows the shared panel once expanded', async () => {
    const { fixture, forChannel } = setup('collaborator');
    (fixture.nativeElement.querySelector('.ua-row') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(forChannel).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('sc-app-download-panel')).not.toBeNull();
    expect(fixture.componentInstance.entries()[0].url).toBe('https://example.test/uploader.exe');
  });

  it('opens the bundle history as a popup, not inline', () => {
    const { fixture } = setup('admin');
    expect(fixture.nativeElement.querySelector('.hx-dialog')).toBeNull();

    fixture.componentInstance.historyOpen.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hx-dialog')).not.toBeNull();

    fixture.componentInstance.onEscape();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hx-dialog')).toBeNull();
  });
});
