import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { HqSuppliesService, SupplyItem } from '../../hq/hq-supplies.service';
import { ResolvedEntity } from '../codex.service';
import { SetSuppliesComponent, missingParts } from './set-supplies.component';

const SET = '11111111-1111-1111-1111-111111111111';
const items = [
  { slot: 'primary', className: 'KSAR_Rifle_01', kind: 'weapon' },
  { slot: 'helmet', className: 'Helmet_A', kind: 'armor' },
  { slot: 'core', className: 'Core_A', kind: 'armor' },
  { slot: 'legs', className: null, kind: null },
  { slot: 'secondary', className: 'ksar_rifle_01', kind: 'weapon' },
];
const supply = (p: Partial<SupplyItem>): SupplyItem =>
  ({ id: 'x', name: 'n', qty: 1, done: false, className: null, setId: null, setKind: null, ...p }) as SupplyItem;

describe('missingParts', () => {
  it('skips empty slots, owned classes, open lines of this set and duplicates; names from the codex', () => {
    const resolved = new Map([['Core_A', { nameLocalized: 'Kern A' } as ResolvedEntity]]);
    const out = missingParts(SET, items, new Set(['helmet_a']), [supply({ className: 'KSAR_Rifle_01', setId: SET })], resolved);
    expect(out.map((p) => p.className)).toEqual(['Core_A']);
    expect(out[0].name).toBe('Kern A');
  });

  it('a done line or another set does not count as already in Nachschub', () => {
    const out = missingParts(SET, items, new Set(), [supply({ className: 'Core_A', setId: SET, done: true }), supply({ className: 'Helmet_A', setId: 'other' })], new Map());
    expect(out.length).toBe(3);
  });
});

describe('SetSuppliesComponent', () => {
  it('adds every missing part as a set line in one click and then links to Planen', () => {
    const lines = signal<SupplyItem[]>([]);
    const add = jasmine.createSpy('add').and.callFake((name: string, _q: number, meta: Partial<SupplyItem>) => {
      lines.set([...lines(), supply({ name, ...meta })]);
      return true;
    });
    TestBed.configureTestingModule({
      imports: [SetSuppliesComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: HqSuppliesService, useValue: { items: lines, add } },
        { provide: HqInventoryService, useValue: { items: signal([]), loaded: signal(true), load: () => Promise.resolve() } },
      ],
    });
    const f = TestBed.createComponent(SetSuppliesComponent);
    f.componentRef.setInput('setId', SET);
    f.componentRef.setInput('items', items);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    (el.querySelector('button.add') as HTMLButtonElement).click();
    f.detectChanges();
    expect(add).toHaveBeenCalledTimes(3);
    expect(add.calls.argsFor(0)[2]).toEqual(jasmine.objectContaining({ setKind: 'fps', setId: SET, source: 'set', className: 'KSAR_Rifle_01' }));
    expect(el.querySelector('button.add')).toBeNull();
    expect(el.querySelector('a.plan')?.getAttribute('href')).toBe('/hq#planen');
  });
});
