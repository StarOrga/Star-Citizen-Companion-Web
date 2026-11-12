import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AdminHubComponent, adminStationSlot } from './admin-hub.component';

describe('AdminHubComponent', () => {
  it('links every admin page as a real anchor, grouped: people, operations, content', () => {
    TestBed.configureTestingModule({
      imports: [AdminHubComponent],
      providers: [provideTranslateService(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AdminHubComponent);
    fixture.detectChanges();
    const tiles = Array.from(fixture.nativeElement.querySelectorAll('a.tile')) as HTMLAnchorElement[];
    expect(tiles.map((a) => a.getAttribute('href'))).toEqual([
      '/admin',
      '/admin/api-tokens',
      '/admin/feedback',
      '/admin/telemetry',
      '/admin/events',
      '/admin/translations',
      '/apps/uploader',
    ]);
    const groups = Array.from(fixture.nativeElement.querySelectorAll('section.group')) as HTMLElement[];
    expect(groups.map((g) => g.dataset['group'])).toEqual(['people', 'operations', 'content']);
    for (const g of groups) {
      expect(g.querySelector('h2'), `${g.dataset['group']} has an eyebrow heading`).not.toBeNull();
    }
    expect(fixture.nativeElement.querySelectorAll('h1').length).toBe(1);
  });
});

describe('AdminHubComponent stage slot (beta shell)', () => {
  afterEach(() => localStorage.removeItem('sc.beta'));

  function render(shell: boolean) {
    localStorage.setItem('sc.beta', JSON.stringify({ shell }));
    TestBed.configureTestingModule({
      imports: [AdminHubComponent],
      providers: [provideTranslateService(), provideRouter([])],
    });
    const fixture = TestBed.createComponent(AdminHubComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('stands the search slot UNDER the hero title, not above it', () => {
    const el = render(true);
    const h1 = el.querySelector('h1')!;
    const slot = el.querySelector('[data-stage-slot]')!;
    expect(slot, 'slot rendered with the shell β on').not.toBeNull();
    expect(h1.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves no sized slot behind with the shell β off', () => {
    const el = render(false);
    expect(el.querySelector('[data-stage-slot]')).toBeNull();
  });
});

describe('adminStationSlot (scene station beside the cards)', () => {
  function host(cols: number): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;width:1200px';
    const group = (n: number) =>
      `<section class="group"><ul class="tiles" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px;margin:0;padding:0">` +
      Array.from({ length: n }, () => '<li class="tile" style="height:80px;list-style:none"></li>').join('') +
      '</ul></section>';
    el.innerHTML = group(2) + group(2) + group(3);
    document.body.appendChild(el);
    return el;
  }

  it('lends the free third column beside the two-tile groups', () => {
    const el = host(3);
    const slot = adminStationSlot(el, 0, 1200)!;
    el.remove();
    expect(slot).not.toBeNull();
    const [l, , w, h] = slot;
    expect(l).toBeGreaterThan(60); // right of two columns (vw of a 1200 px viewport)
    expect(w).toBeGreaterThan(25);
    expect(h).toBeGreaterThan(10);
  });

  it('lends nothing when no column is free', () => {
    const el = host(1);
    const slot = adminStationSlot(el, 0, 1200);
    el.remove();
    expect(slot).toBeNull();
  });
});
