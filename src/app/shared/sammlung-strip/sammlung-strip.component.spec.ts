import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { SammlungStripComponent, type SammlungStripItem } from './sammlung-strip.component';

function mount(items: SammlungStripItem[], wide = false) {
  TestBed.configureTestingModule({ imports: [SammlungStripComponent], providers: [provideRouter([]), provideTranslateService({})] });
  const f = TestBed.createComponent(SammlungStripComponent);
  f.componentRef.setInput('items', items);
  f.componentRef.setInput('wide', wide);
  f.componentRef.setInput('ariaLabel', 'Gesammelt');
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement };
}

const item = (id: string, title = `Post ${id}`): SammlungStripItem => ({ id, title, sub: 'Comm-Link · heute', thumb: null, link: ['/verse/news', id] });

describe('SammlungStripComponent', () => {
  it('renders nothing while nothing is collected', () => {
    expect(mount([]).el.querySelector('section')).toBeNull();
  });

  it('shows the count and one real anchor per collected thing', () => {
    const { el } = mount([item('a'), item('b')]);
    expect(el.querySelector('h3 small')!.textContent).toBe('2');
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.tile'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/verse/news/a', '/verse/news/b']);
  });

  it('handles overflow inside the strip: the row scrolls sideways, the title clamps to two lines', () => {
    const many = Array.from({ length: 40 }, (_, i) => item(String(i), 'A very long collected title '.repeat(8)));
    const { el } = mount(many, true);
    const row = el.querySelector<HTMLElement>('.row')!;
    expect(getComputedStyle(row).overflowX).toBe('auto');
    expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
    const b = el.querySelector<HTMLElement>('.t b')!;
    expect(b.className).toBe('');
    expect(getComputedStyle(b).overflow).toBe('hidden');
    expect(el.clientHeight).toBeLessThan(220);
  });

  it('keeps the query params of a wallpaper link (the deep link opens the lightbox)', () => {
    const { el } = mount([{ id: 'w1', title: 'Pyro', thumb: 'x.jpg', link: [], queryParams: { image: 'w1' }, queryParamsHandling: 'merge' }]);
    expect(el.querySelector('a.tile')!.getAttribute('href')).toContain('image=w1');
    expect(el.querySelector('img')!.getAttribute('alt')).toBe('');
  });
});
