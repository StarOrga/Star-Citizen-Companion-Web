import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ExtensionInstallComponent } from './extension-install.component';
import { ExtensionBridgeService } from '../hangar/extension-bridge.service';

describe('ExtensionInstallComponent', () => {
  async function setup(installed = false) {
    TestBed.configureTestingModule({
      imports: [ExtensionInstallComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: ExtensionBridgeService, useValue: { waitForExtension: () => Promise.resolve(installed) } },
      ],
    });
    const fixture = TestBed.createComponent(ExtensionInstallComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('the download and source links are new-tab anchors with noopener noreferrer', async () => {
    const f = await setup();
    const anchors = Array.from(f.nativeElement.querySelectorAll('a[href^="http"]')) as HTMLAnchorElement[];
    const zip = anchors.find((a) => a.href.endsWith('sc-hangar-extension.zip'));
    const repo = anchors.filter((a) => a.href.includes('/tree/main/browser-extension'));
    expect(zip).toBeDefined();
    expect(zip!.target).toBe('_blank');
    expect(zip!.rel).toBe('noopener noreferrer');
    expect(repo.length).toBeGreaterThan(0);
    for (const a of repo) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toBe('noopener noreferrer');
    }
  });

  it('every external anchor on the page opens safely', async () => {
    const f = await setup(true);
    const external = Array.from(f.nativeElement.querySelectorAll('a[href^="http"]')) as HTMLAnchorElement[];
    expect(external.length).toBeGreaterThan(2);
    for (const a of external) {
      expect(a.target).withContext(a.href).toBe('_blank');
      expect(a.rel).withContext(a.href).toContain('noopener');
      expect(a.rel).withContext(a.href).toContain('noreferrer');
    }
  });

  it('the in-app links are real router anchors', async () => {
    const f = await setup();
    const hrefs = (Array.from(f.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[]).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/hangar');
    expect(hrefs).toContain('/legal/privacy');
  });

  it('shows the detected notice only when the extension answered', async () => {
    const without = await setup(false);
    expect(without.nativeElement.querySelector('.ok')).toBeNull();
    TestBed.resetTestingModule();
    const withExt = await setup(true);
    expect(withExt.nativeElement.querySelector('.ok')).not.toBeNull();
  });
});
