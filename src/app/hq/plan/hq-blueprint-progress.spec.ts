import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HqSuppliesService, type SupplyItem } from '../hq-supplies.service';
import { HqBlueprintProgressComponent } from './hq-blueprint-progress.component';
import { blueprintProgress } from './hq-blueprint-progress';

const line = (o: Partial<SupplyItem>): SupplyItem =>
  ({ id: o.name ?? 'x', name: 'x', qty: 1, done: false, entityKind: null, className: null, setKind: null, setId: null, stepKind: null, wanted: false, source: 'search', amount: null, unit: null, forClassName: null, updatedAt: '', deletedAt: null, dirty: false, ...o }) as SupplyItem;

describe('blueprintProgress', () => {
  it('counts done material lines per blueprint and ignores unlinked lines', () => {
    const r = blueprintProgress([
      line({ name: 'Rifle BP', entityKind: 'blueprint', className: 'BP_Rifle' }),
      line({ name: 'Iron', forClassName: 'BP_Rifle', done: true }),
      line({ name: 'Copper', forClassName: 'bp_rifle' }),
      line({ name: 'Gold', forClassName: 'BP_Rifle' }),
      line({ name: 'Loose' }),
    ]);
    expect(r).toEqual([{ className: 'BP_Rifle', name: 'Rifle BP', have: 1, total: 3 }]);
  });
  it('is empty without material lines', () => {
    expect(blueprintProgress([line({ name: 'Rifle BP', entityKind: 'blueprint', className: 'BP_Rifle' })])).toEqual([]);
  });
});

describe('HqBlueprintProgressComponent', () => {
  function make(items: SupplyItem[], ready = true, error: string | null = null) {
    const sync = jasmine.createSpy('sync').and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: HqSuppliesService, useValue: { items: signal(items), ready: signal(ready), syncError: signal<string | null>(error), sync } },
      ],
    });
    const f = TestBed.createComponent(HqBlueprintProgressComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, sync };
  }

  it('renders one anchor card per blueprint to its Codex page', () => {
    const { el } = make([line({ name: 'Iron', forClassName: 'BP_Rifle', done: true }), line({ name: 'Gold', forClassName: 'BP_Rifle' })]);
    const a = el.querySelectorAll('a.bp-card');
    expect(a.length).toBe(1);
    expect(a[0].getAttribute('href')).toBe('/codex/blueprint/BP_Rifle');
  });
  it('shows the empty state', () => {
    const { el } = make([]);
    expect(el.querySelector('.bp-empty')).not.toBeNull();
    expect(el.querySelector('a.bp-card')).toBeNull();
  });
  it('shows a load error with retry instead of the empty state', () => {
    const { f, el, sync } = make([], true, 'errors.supplies.load');
    expect(el.querySelector('.bp-empty')).toBeNull();
    (el.querySelector('.bp-err button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(sync).toHaveBeenCalled();
  });
});
