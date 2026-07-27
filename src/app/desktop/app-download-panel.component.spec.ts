import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { AppDownloadEntry, AppDownloadPanelComponent } from './app-download-panel.component';

describe('AppDownloadPanelComponent', () => {
  function setup(inputs: Partial<Record<string, unknown>> = {}) {
    TestBed.configureTestingModule({
      imports: [AppDownloadPanelComponent, TranslateModule.forRoot()],
    });
    const fixture = TestBed.createComponent(AppDownloadPanelComponent);
    fixture.componentRef.setInput('title', 'desktop.appTitle');
    fixture.componentRef.setInput('desc', 'desktop.appDesc');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  const entry: AppDownloadEntry = {
    key: 'win-x64',
    label: 'win-x64',
    url: 'https://example.test/app.exe',
    sizeBytes: 3 * 1024 * 1024,
    hash: 'abcdef123456',
  };

  it('renders one download button per entry', () => {
    const f = setup({ entries: [entry, { ...entry, key: 'win-arm64', secondary: true }] });
    const links = f.nativeElement.querySelectorAll('a.ap-btn');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toBe('https://example.test/app.exe');
    expect(links[1].classList).toContain('secondary');
  });

  it('keeps size and hash out of the visible surface, in the tooltip', () => {
    const f = setup({ entries: [entry] });
    const link = f.nativeElement.querySelector('a.ap-btn') as HTMLAnchorElement;
    expect(link.textContent).not.toContain('MB');
    expect(link.getAttribute('title')).toContain('3.0 MB');
    expect(link.getAttribute('title')).toContain('abcdef123456');
  });

  it('hides the details toggle when there is nothing behind it', () => {
    const f = setup({ entries: [entry] });
    expect(f.nativeElement.querySelector('.ap-info')).toBeNull();
  });

  it('reveals notes and release notes behind the details toggle', () => {
    const f = setup({
      entries: [entry],
      notes: ['starscape.appNote'],
      releaseNotes: 'fixed the tray icon',
    });
    expect(f.nativeElement.querySelector('.ap-details')).toBeNull();

    (f.nativeElement.querySelector('.ap-info') as HTMLButtonElement).click();
    f.detectChanges();

    expect(f.nativeElement.querySelector('.ap-details')).not.toBeNull();
    expect(f.nativeElement.querySelector('.ap-rn').textContent).toContain('fixed the tray icon');
  });

  it('states "no release" instead of an empty button row', () => {
    const f = setup({ entries: [] });
    expect(f.nativeElement.querySelector('.ap-state')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('a.ap-btn').length).toBe(0);
  });
});
