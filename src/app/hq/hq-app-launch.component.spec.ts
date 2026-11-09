import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SccAppLauncherService } from '../desktop/scc-app-launcher.service';
import { SCC_INSTALLER_URL } from '../news/verse-status-chip.component';
import { HqAppLaunchComponent } from './hq-app-launch.component';

describe('HqAppLaunchComponent', () => {
  function mount(answered: boolean, launchedBefore = false, mode: 'launch' | 'download' = 'launch') {
    const launcher = {
      launch: vi.fn().mockName('launch').mockResolvedValue(answered),
      launchedBefore: () => launchedBefore,
      downloadInstaller: vi.fn().mockName('downloadInstaller'),
    };
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), { provide: SccAppLauncherService, useValue: launcher }],
    });
    const f = TestBed.createComponent(HqAppLaunchComponent);
    f.componentRef.setInput('mode', mode);
    f.detectChanges();
    return { f, launcher };
  }

  const anchor = (f: ComponentFixture<HqAppLaunchComponent>) =>
    (f.nativeElement as HTMLElement).querySelector('a.go') as HTMLAnchorElement;

  async function clickPlain(f: ComponentFixture<HqAppLaunchComponent>): Promise<MouseEvent> {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    anchor(f).dispatchEvent(ev);
    // Not whenStable: it would wait out the hint's own hide timer.
    await new Promise((resolve) => setTimeout(resolve));
    f.detectChanges();
    return ev;
  }

  it('is one real anchor at the installer', () => {
    const { f } = mount(true);
    expect(anchor(f).getAttribute('href')).toBe(SCC_INSTALLER_URL);
    expect((f.nativeElement as HTMLElement).querySelectorAll('a').length).toBe(1);
  });

  it('does not download when the app answers', async () => {
    const { f, launcher } = mount(true);
    const ev = await clickPlain(f);
    expect(ev.defaultPrevented).toBe(true);
    expect(launcher.downloadInstaller).not.toHaveBeenCalled();
    expect(f.componentInstance.status()).toBe('started');
  });

  it('downloads right away and says so when the app does not answer', async () => {
    const { f, launcher } = mount(false);
    await clickPlain(f);
    expect(launcher.downloadInstaller).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.status()).toBe('downloading');
    expect((f.nativeElement as HTMLElement).querySelector('[role="status"] .hint')).toBeTruthy();
  });

  it('never auto-downloads once this browser has seen the app answer', async () => {
    const { f, launcher } = mount(false, true);
    await clickPlain(f);
    expect(launcher.downloadInstaller).not.toHaveBeenCalled();
    expect(f.componentInstance.status()).toBe('noResponse');
    expect((f.nativeElement as HTMLElement).querySelector('.hint a')?.getAttribute('href')).toBe(SCC_INSTALLER_URL);
  });

  it('leaves a modified click to the browser', () => {
    const { f, launcher } = mount(true);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    let leftToBrowser = false;
    // Runs after the component's handler; stopping here keeps the test page in place.
    anchor(f).addEventListener(
      'click',
      (e) => {
        leftToBrowser = !e.defaultPrevented;
        e.preventDefault();
      },
      { once: true },
    );
    anchor(f).dispatchEvent(ev);
    expect(leftToBrowser).toBe(true);
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it('download mode says downloaden and downloads on a plain click without trying the app', async () => {
    const { f, launcher } = mount(false, false, 'download');
    expect(anchor(f).textContent).toContain('hq.app.downloadCta');
    const ev = await clickPlain(f);
    expect(ev.defaultPrevented).toBe(true);
    expect(launcher.launch).not.toHaveBeenCalled();
    expect(launcher.downloadInstaller).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.status()).toBe('downloadStarted');
    f.componentInstance.dismiss();
  });

  it('download mode stays a real anchor at the installer', () => {
    const { f } = mount(false, false, 'download');
    expect(anchor(f).getAttribute('href')).toBe(SCC_INSTALLER_URL);
  });

  it('closes the hint', async () => {
    const { f } = mount(false);
    await clickPlain(f);
    f.componentInstance.dismiss();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.hint')).toBeNull();
  });
});
