import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { NewsService, VerseStatus } from './news.service';
import { VerseStatusChipComponent } from './verse-status-chip.component';

const PLAYABLE: VerseStatus = {
  overall: 'operational',
  label: 'operational',
  components: [{ name: 'Persistent Universe', status: 'operational' }],
  updatedAt: '2026-09-06T00:00:00.000Z',
};

/**
 * The Companion app's installer hangs off the "Playable" chip: the panel that
 * tells you the verse is up is also where you pick up the desktop app.
 *
 * Two things have to hold for that link to be worth anything — it must point at
 * the never-stale alias asset (no version in the URL, or it rots the moment the
 * app ships again), and it must not be offered to a device that cannot install
 * a Windows application at all.
 */
describe('VerseStatusChipComponent — Companion app download', () => {
  let fixture: ComponentFixture<VerseStatusChipComponent>;

  function setup(canInstall: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [VerseStatusChipComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: NewsService,
          useValue: {
            feed: signal({ status: PLAYABLE, fetchedAt: new Date().toISOString() }),
            refresh: () => Promise.resolve(),
          },
        },
        { provide: DesktopCapabilityService, useValue: { canInstall: signal(canInstall) } },
      ],
    });
    fixture = TestBed.createComponent(VerseStatusChipComponent);
    fixture.detectChanges();
    return fixture;
  }

  function openPanel(): HTMLElement {
    const chip = fixture.nativeElement.querySelector('button.vs-chip') as HTMLButtonElement;
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => fixture?.destroy());

  it('offers the installer as a real anchor at the never-stale alias URL', () => {
    setup(true);
    const link = openPanel().querySelector('a.app-dl') as HTMLAnchorElement | null;
    expect(link).withContext('download entry rendered').not.toBeNull();
    expect(link!.getAttribute('href')).toBe(
      'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/scc-app-latest/SCC-Standalone-Setup.exe',
    );
    // No version anywhere in the URL — that is what "always the newest" means.
    expect(link!.getAttribute('href')).not.toMatch(/v\d+\.\d+\.\d+/);
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('collapses the panel once the download starts, without swallowing the click', () => {
    setup(true);
    const link = openPanel().querySelector('a.app-dl') as HTMLAnchorElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    // Keep karma on this page: the anchor is a real navigation by design.
    link.addEventListener('click', (e) => e.preventDefault());
    link.dispatchEvent(ev);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.vs-panel')).toBeNull();
  });

  it('says nothing about a desktop installer on a device that cannot install one', () => {
    setup(false);
    const root = openPanel();
    expect(root.querySelector('.vs-panel')).withContext('panel still opens').not.toBeNull();
    expect(root.querySelector('a.app-dl')).toBeNull();
  });
});
