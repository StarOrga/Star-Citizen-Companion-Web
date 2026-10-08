import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { PageHeaderComponent } from './page-header.component';
import { CODEX_ROOT_CRUMB, HANGAR_ROOT_CRUMB, NavOriginService, PageCrumb, originCrumb, originTrail } from './nav-origin.service';

@Component({ standalone: true, template: '' })
class BlankComponent {}

@Component({
  standalone: true,
  imports: [PageHeaderComponent],
  template: `
    <sc-page-header [crumbs]="crumbs()" [title]="title()" [eyebrow]="eyebrow()" [subtitle]="subtitle()">
      <span phAside class="aside-probe">pill</span>
      <button phActions class="action-probe" type="button">act</button>
    </sc-page-header>
  `,
})
class HostComponent {
  readonly crumbs = signal<PageCrumb[]>([CODEX_ROOT_CRUMB, { label: 'Gladius', link: '/codex/ship/AEGS_Gladius' }]);
  readonly title = signal<string | null>('Mantis GT-220');
  readonly eyebrow = signal<string | null>('Gatling · S3');
  readonly subtitle = signal<string | null>(null);
}

describe('PageHeaderComponent', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTranslateService({}),
        provideRouter([
          { path: 'codex', component: BlankComponent },
          { path: 'codex/index', component: BlankComponent },
          { path: 'codex/fps', component: BlankComponent },
          { path: 'hangar', component: BlankComponent },
          { path: 'hangar/ship/:id', component: BlankComponent },
          { path: 'codex/:kind/:className', component: BlankComponent },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    TestBed.inject(NavOriginService);
  });

  it('renders the crumbs as real anchors, the title as the only h1, and both slots', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav.crumbs a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/codex', '/codex/ship/AEGS_Gladius']);
    expect(links[1].textContent?.trim()).toBe('Gladius');
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Mantis GT-220');
    expect(el.querySelector('.eyebrow')?.textContent?.trim()).toBe('Gatling · S3');
    expect(el.querySelector('.sub')).toBeNull();
    expect(el.querySelector('.ph-aside .aside-probe')).not.toBeNull();
    expect(el.querySelector('.ph-actions .action-probe')).not.toBeNull();
  });

  it('renders the crumb row only when the page title lives elsewhere', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.title.set(null);
    fixture.componentInstance.eyebrow.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')).toBeNull();
    expect(el.querySelector('.ph-main')).toBeNull();
    expect(el.querySelectorAll('nav.crumbs a').length).toBe(2);
  });

  describe('originCrumb', () => {
    const fallback: PageCrumb = { labelKey: 'codex.kinds.weapon', link: '/codex/index', queryParams: { kind: 'weapon' } };

    it('falls back on a deep link (no previous page)', async () => {
      await router.navigateByUrl('/codex/weapon/X');
      expect(originCrumb(TestBed.inject(NavOriginService), fallback)).toEqual(fallback);
    });

    it('leads back to the index with its filters, named after the category', async () => {
      await router.navigateByUrl('/codex/index?kind=ship&q=gladius');
      await router.navigateByUrl('/codex/index?kind=weapon&q=mantis');
      await router.navigateByUrl('/codex/weapon/X');
      expect(originCrumb(TestBed.inject(NavOriginService), fallback)).toEqual({
        labelKey: 'codex.kinds.weapon',
        link: '/codex/index',
        queryParams: { kind: 'weapon', q: 'mantis' },
      });
    });

    it('steps over filter-only url changes on the current page', async () => {
      await router.navigateByUrl('/codex/fps');
      await router.navigateByUrl('/codex/weapon/X');
      await router.navigateByUrl('/codex/weapon/X?tab=2');
      expect(originCrumb(TestBed.inject(NavOriginService), fallback)?.labelKey).toBe('pageHeader.crumb.fps');
    });

    it('names a detail page by the title its header registered', async () => {
      const origin = TestBed.inject(NavOriginService);
      await router.navigateByUrl('/codex/ship/AEGS_Gladius');
      origin.rememberTitle('/codex/ship/AEGS_Gladius', 'Gladius');
      await router.navigateByUrl('/codex/weapon/X');
      expect(originCrumb(origin, fallback)).toEqual({ label: 'Gladius', link: '/codex/ship/AEGS_Gladius', queryParams: null });
    });

    it('leads back to the search results when a search hit opened the page', async () => {
      const origin = TestBed.inject(NavOriginService);
      await router.navigateByUrl('/codex/index?kind=weapon');
      origin.noteSearchArrival('mantis', ['/codex', 'weapon', 'X']);
      await router.navigateByUrl('/codex/weapon/X');
      expect(originCrumb(origin, fallback)).toEqual({
        labelKey: 'pageHeader.crumb.search',
        labelParams: { term: 'mantis' },
        link: '/codex',
        queryParams: { q: 'mantis' },
      });
      // A filter-only url change on the page keeps it.
      await router.navigateByUrl('/codex/weapon/X?tab=2');
      expect(originCrumb(origin, fallback)?.labelKey).toBe('pageHeader.crumb.search');
    });

    it('drops a search note the next navigation does not land on (Ctrl+click opened a tab)', async () => {
      const origin = TestBed.inject(NavOriginService);
      await router.navigateByUrl('/codex/fps');
      origin.noteSearchArrival('mantis', ['/codex', 'weapon', 'X']);
      await router.navigateByUrl('/codex/weapon/Y');
      expect(originCrumb(origin, fallback)?.labelKey).toBe('pageHeader.crumb.fps');
      await router.navigateByUrl('/codex/weapon/X');
      expect(originCrumb(origin, fallback)?.labelKey).not.toBe('pageHeader.crumb.search');
    });

    it('starts the trail at the hangar for a page opened from the hangar', async () => {
      const origin = TestBed.inject(NavOriginService);
      await router.navigateByUrl('/hangar/ship/s1');
      origin.rememberTitle('/hangar/ship/s1', 'Rusty Bucket');
      await router.navigateByUrl('/codex/ship/AEGS_Avenger_Titan');
      expect(originTrail(origin, fallback)).toEqual([
        HANGAR_ROOT_CRUMB,
        { label: 'Rusty Bucket', link: '/hangar/ship/s1', queryParams: null },
      ]);

      await router.navigateByUrl('/hangar');
      await router.navigateByUrl('/codex/weapon/X');
      expect(originTrail(origin, fallback)).toEqual([HANGAR_ROOT_CRUMB]);
    });

    it('uses the fallback when the reader came from the Codex front door', async () => {
      await router.navigateByUrl('/codex');
      await router.navigateByUrl('/codex/weapon/X');
      expect(originCrumb(TestBed.inject(NavOriginService), fallback)).toEqual(fallback);
    });
  });
});
