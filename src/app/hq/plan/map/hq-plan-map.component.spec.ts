import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { STEP_SHAPES } from '../../../shared/step/sc-step.component';
import { HqPlanMapComponent } from './hq-plan-map.component';
import { colorSlots, qtySize } from './hq-map-layout';
import type { MapNeed, MapPlace, PlanView, RouteStep } from './hq-map.types';
import { buildRoute } from './hq-route';

const place = (system: string, planet: string | null, location: string): MapPlace => ({
  id: [system, planet, location].filter(Boolean).join('/').toLowerCase(),
  system,
  planet,
  location,
});
const AREA18 = place('Stanton', 'ArcCorp', 'Area18');
const ORISON = place('Stanton', 'Crusader', 'Orison');
const LORVILLE = place('Stanton', 'Hurston', 'Lorville');
const RUIN = place('Pyro', 'Pyro V', 'Ruin Station');

const NEEDS: MapNeed[] = [
  { id: 'a', label: 'Laser', kind: 'buy', qty: 2, status: 'open', colorKey: 'set-1', colorLabel: 'Cutlass', place: AREA18 },
  { id: 'b', label: 'Quantainium', kind: 'mine', qty: 40, status: 'partial', colorKey: 'set-2', place: ORISON },
  { id: 'c', label: 'Medpen', kind: 'buy', qty: 10, status: 'done', colorKey: 'set-1', place: LORVILLE },
  { id: 'd', label: 'Hadanite', kind: 'refine', qty: 3, status: 'open', colorKey: 'note', place: RUIN },
  { id: 'e', label: 'Kein Ort', kind: 'craft', qty: 1, status: 'open', colorKey: 'note', place: null },
];

describe('HqPlanMapComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideTranslateService({ fallbackLang: 'en' })] }));

  function setup(opts: { needs?: MapNeed[]; route?: RouteStep[] | null; view?: PlanView; start?: MapPlace | null } = {}) {
    const f = TestBed.createComponent(HqPlanMapComponent);
    f.componentRef.setInput('needs', opts.needs ?? NEEDS);
    f.componentRef.setInput('route', opts.route ?? null);
    f.componentRef.setInput('view', opts.view ?? 'what');
    f.componentRef.setInput('start', opts.start === undefined ? AREA18 : opts.start);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return { f, el };
  }

  it('opens only the start system; others are collapsed strips with a step count (D29)', () => {
    const { el } = setup();
    const systems = [...el.querySelectorAll<HTMLElement>('.sys')];
    expect(systems.map((s) => s.dataset['system'])).toEqual(['stanton', 'pyro']);
    const strips = el.querySelectorAll<HTMLButtonElement>('.strip');
    expect(strips[0].getAttribute('aria-expanded')).toBe('true');
    expect(strips[1].getAttribute('aria-expanded')).toBe('false');
    expect(systems[1].querySelector('.stage')).toBeNull();
    expect(strips[1].querySelector('.count')?.textContent).toContain('hq.map.stepsOne');
  });

  it('expands a strip on click', () => {
    const { f, el } = setup();
    el.querySelectorAll<HTMLButtonElement>('.strip')[1].click();
    f.detectChanges();
    expect(el.querySelectorAll('.stage').length).toBe(2);
  });

  it('draws one focusable button per place and only the needs passed in', () => {
    const { el } = setup();
    const nodes = el.querySelectorAll<HTMLButtonElement>('.sys.open .node');
    expect(nodes.length).toBe(3);
    nodes.forEach((n) => expect(n.tagName).toBe('BUTTON'));
    nodes.forEach((n) => expect(n.getAttribute('aria-label')).toBeTruthy());
    expect(el.querySelectorAll('.sys.open .node .g').length).toBe(3);

    const { el: el2 } = setup({ needs: NEEDS.slice(0, 1) });
    expect(el2.querySelectorAll('.node .g').length).toBe(1);
  });

  it('encodes shape = kind, size = qty, fill = status, colour = need', () => {
    const { el } = setup();
    const g = (id: string) => el.querySelector<SVGElement>(`.sys.open .node .g[data-kind="${id}"]`)!;
    expect(g('mine').querySelector('polygon')?.getAttribute('points')).toBe(STEP_SHAPES.mine);
    expect(g('mine').dataset['size']).toBe('l');
    expect(g('mine').dataset['status']).toBe('partial');
    expect(g('mine').querySelector('.f')).not.toBeNull();
    const buys = el.querySelectorAll<SVGElement>('.sys.open .node .g[data-kind="buy"]');
    expect([...buys].map((b) => b.dataset['color'])).toEqual(['0', '0']);
    expect(g('mine').dataset['color']).toBe('1');
    expect(qtySize(5)).toBe('s');
    expect(qtySize(6)).toBe('m');
    expect(qtySize(26)).toBe('l');
    expect([...colorSlots(NEEDS).values()]).toEqual([0, 1, 2]);
  });

  it('always shows the legend with all seven shapes', () => {
    const { el } = setup({ needs: [] });
    expect(el.querySelector('.legend')).not.toBeNull();
    expect(el.querySelectorAll('.legend .lg')[0].querySelectorAll('.g').length).toBe(7);
    expect(el.querySelector('.empty')).toBeNull();
  });

  it('shows the empty hint when there is nothing at all', () => {
    const { el } = setup({ needs: [], start: null });
    expect(el.querySelector('.empty')).not.toBeNull();
  });

  it('numbers the route, draws legs and marks the current step in "how"', () => {
    const route = buildRoute(NEEDS, AREA18);
    const { el } = setup({ route, view: 'how' });
    const ords = [...el.querySelectorAll('.sys.open .ord')].map((o) => o.textContent?.trim());
    expect(ords).toEqual(['1', '2']);
    expect(el.querySelectorAll('.sys.open .leg').length).toBe(1);
    expect(el.querySelectorAll('.node.current').length).toBe(1);
    // Phones show this map too: no list twin any more, the map is the only view.
    expect(el.querySelector('.twin')).toBeNull();
  });

  it('emits the place when a node is pressed', () => {
    const { f, el } = setup();
    const got: MapPlace[] = [];
    f.componentInstance.placeSelected.subscribe((p) => got.push(p));
    el.querySelector<HTMLButtonElement>('.sys.open .node')!.click();
    expect(got.length).toBe(1);
  });

  it('counts needs without a place and lists them nowhere on the map', () => {
    const { el } = setup();
    expect(el.querySelector('.unplaced')).not.toBeNull();
  });
});
