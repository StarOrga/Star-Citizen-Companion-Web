import { ItemPathService } from '../hq/data/item-path.service';
import { fakeItemPath } from '../shared/item-path/item-path.testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HQ_TABS, HqShellComponent } from './hq-shell.component';
import { HqOpsComponent } from './hq-ops.component';

describe('HqShellComponent', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [HqShellComponent],
      providers: [ { provide: ItemPathService, useValue: fakeItemPath() },provideRouter([]), provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(HqShellComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the category tabs as real anchors: Übersicht, Spind, Hangar, Einsätze', () => {
    const el: HTMLElement = setup().nativeElement;
    const hrefs = Array.from(el.querySelectorAll('nav.hq-tabs a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/hq', '/hq/locker', '/hq/hangar', '/hq/ops']);
    expect(HQ_TABS.length).toBe(4);
  });

  it('shows the Nachschub link to Planen with the number of active slots (zero without any)', () => {
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector<HTMLAnchorElement>('a.supplies-btn')!;
    expect(link.querySelector('.supplies-count')?.textContent?.trim()).toBe('0');
    expect(link.getAttribute('href')).toBe('/hq#planen');
    // The old popup is retired here: Nachschub is the slots of Planen.
    expect(el.querySelector('sc-hq-supplies-popup')).toBeNull();
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
