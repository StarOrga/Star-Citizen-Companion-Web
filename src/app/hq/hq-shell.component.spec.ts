import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HQ_TABS, HqShellComponent } from './hq-shell.component';
import { HqOpsComponent } from './hq-ops.component';

describe('HqShellComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [HqShellComponent],
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(HqShellComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the category tabs as real anchors: Übersicht, Spind, Hangar, Einsätze', () => {
    const el: HTMLElement = setup().nativeElement;
    const hrefs = Array.from(el.querySelectorAll('nav.hq-tabs a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/hq', '/hq/spind', '/hq/hangar', '/hq/einsaetze']);
    expect(HQ_TABS.length).toBe(4);
  });

  it('shows the supplies button with a zero counter and opens/closes the empty panel', () => {
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector<HTMLButtonElement>('button.supplies-btn')!;
    expect(btn.querySelector('.supplies-count')?.textContent?.trim()).toBe('0');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('sc-hq-supplies-panel')).toBeNull();

    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const panel = el.querySelector('sc-hq-supplies-panel [role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('hq.supplies.empty');

    el.querySelector<HTMLButtonElement>('sc-hq-supplies-panel button.close')!.click();
    fixture.detectChanges();
    expect(el.querySelector('sc-hq-supplies-panel')).toBeNull();
  });
});

describe('HqOpsComponent', () => {
  it('renders the "coming soon" empty state with one h1', () => {
    TestBed.configureTestingModule({
      imports: [HqOpsComponent],
      providers: [provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(HqOpsComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('hq.ops.soon');
  });
});
