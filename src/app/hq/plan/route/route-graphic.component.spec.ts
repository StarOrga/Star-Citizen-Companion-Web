import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HqRouteGraphicComponent } from './route-graphic.component';
import { ROUTE_FILTER_KEY, RouteFilterStore } from './route-filter.store';
import type { RouteGraphStep } from './route-layout';

const step = (ord: number, kind: RouteGraphStep['kind'], location: string, system: string, state: 'todo' | 'done' = 'todo'): RouteGraphStep => ({
  ord,
  kind,
  label: `${kind} ${ord}`,
  location,
  system,
  state,
});

const STEPS: RouteGraphStep[] = [
  step(1, 'buy', 'Area18', 'Stanton', 'done'),
  step(2, 'transport', 'Pyro-Gateway', 'Stanton'),
  step(3, 'mine', 'Pyro I', 'Pyro'),
  step(4, 'refine', 'Ruin Station', 'Pyro'),
  step(5, 'craft', 'Area18', 'Stanton'),
];

describe('HqRouteGraphicComponent', () => {
  beforeEach(() => localStorage.removeItem(ROUTE_FILTER_KEY));
  afterEach(() => localStorage.removeItem(ROUTE_FILTER_KEY));

  function mount(extra: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const f = TestBed.createComponent(HqRouteGraphicComponent);
    f.componentRef.setInput('steps', STEPS);
    f.componentRef.setInput('current', 2);
    for (const [k, v] of Object.entries(extra)) f.componentRef.setInput(k, v);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  const click = (f: { detectChanges(): void }, b: Element | null) => {
    (b as HTMLElement).click();
    f.detectChanges();
  };

  it('draws one area per star system, a node per place and the jump legs', () => {
    const { el } = mount();
    expect(el.querySelectorAll('ellipse.sys').length).toBe(2);
    expect(el.querySelectorAll('.node').length).toBe(4);
    expect(el.querySelectorAll('.leg.jump').length).toBe(2);
    expect(el.querySelector('.node.cur')).not.toBeNull();
  });

  it('keeps the legend hidden until asked; it lists the kinds present and hides a kind on click', () => {
    const { f, el } = mount();
    expect(el.querySelector('.pop')).toBeNull();
    click(f, el.querySelector('.lg-btn'));
    const rows = el.querySelectorAll('.pop .row');
    expect(rows.length).toBe(5);
    const badgesBefore = el.querySelectorAll('.badge').length;
    click(f, rows[0]);
    expect(el.querySelectorAll('.badge').length).toBe(badgesBefore - 1);
    expect(el.querySelector('.pop .row.off')).not.toBeNull();
  });

  it('remembers the hidden kinds per route key, not across routes', () => {
    const { f, el } = mount({ filterKey: 'n1:e1' });
    click(f, el.querySelector('.lg-btn'));
    click(f, el.querySelectorAll('.pop .row')[2]);
    expect([...TestBed.inject(RouteFilterStore).hidden('n1:e1')]).toEqual(['refine']);
    TestBed.resetTestingModule();
    const other = mount({ filterKey: 'n1:e2' });
    expect(other.el.querySelectorAll('.badge').length).toBe(5);
    TestBed.resetTestingModule();
    const same = mount({ filterKey: 'n1:e1' });
    expect(same.el.querySelectorAll('.badge').length).toBe(4);
  });

  it('zooms in and out within limits and fits back', () => {
    const { f, el } = mount();
    const [zin, zout, fit] = Array.from(el.querySelectorAll('.ctl button'));
    click(f, zin);
    expect(f.componentInstance.zoom()).toBeCloseTo(1.25);
    for (let i = 0; i < 20; i++) click(f, zin);
    expect(f.componentInstance.zoom()).toBe(4);
    click(f, fit);
    expect(f.componentInstance.zoom()).toBe(1);
    for (let i = 0; i < 20; i++) click(f, zout);
    expect(f.componentInstance.zoom()).toBe(0.6);
  });

  it('is keyboard operable: + - 0 on the focused map', () => {
    const { f, el } = mount();
    const map = el.querySelector('.map') as HTMLElement;
    map.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.zoom()).toBeGreaterThan(1);
    map.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.zoom()).toBe(1);
  });

  it('puts a small clickable hint on a place that also serves another Nachschub', () => {
    const { f, el } = mount({ shared: [{ location: 'Area18', nachschubId: 'n2', name: 'Medpens' }] });
    const picked: string[] = [];
    f.componentInstance.sharedPick.subscribe((s) => picked.push(s.nachschubId));
    const hint = el.querySelector('.shared') as SVGGElement;
    expect(hint).not.toBeNull();
    expect(hint.getAttribute('role')).toBe('button');
    hint.dispatchEvent(new Event('click'));
    expect(picked).toEqual(['n2']);
  });
});
