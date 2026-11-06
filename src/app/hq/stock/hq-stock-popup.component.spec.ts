import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService } from '../../codex/codex.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { ItemPathService } from '../data/item-path.service';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import { SignInAskService } from '../../shared/item-path/sign-in-ask.service';
import { fakeItemPath, fakeSignIn } from '../../shared/item-path/item-path.testing';
import { HqLiveService } from '../now/hq-live.service';
import { HqStockPopupComponent, StockStart } from './hq-stock-popup.component';

describe('HqStockPopupComponent: capture and links', () => {
  interface Hit { kind: string; classNameSlug: string; nameLocalized: string }
  interface Row { location: string; name: string; class_name: string | null; qty: number; unit: 'pcs' | 'scu' }

  function mount(start: StockStart, opts: { hits?: Hit[]; items?: Row[] } = {}) {
    const items = opts.items ?? [];
    const path = fakeItemPath();
    const inv = {
      loaded: signal(true),
      error: signal<string | null>(null),
      snapshots: signal(items.length ? [{ location: items[0].location, taken_at: new Date().toISOString(), source: 'manual' }] : []),
      locations: signal([]),
      items: signal(items),
      shipStorage: signal([]),
      load: jasmine.createSpy('load').and.resolveTo(),
      addManual: jasmine.createSpy('addManual').and.resolveTo(true),
    };
    TestBed.configureTestingModule({
      imports: [HqStockPopupComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: HangarService, useValue: { ships: signal([]), roleLoadouts: signal([]) } },
        { provide: HqInventoryService, useValue: inv },
        { provide: ItemPathService, useValue: path },
        { provide: SignInAskService, useValue: fakeSignIn() },
        { provide: HqLiveService, useValue: { state: signal({ location: 'Area18' }) } },
        { provide: CodexService, useValue: { searchAll: () => Promise.resolve({ hits: opts.hits ?? [], totals: {} }) } },
      ],
    });
    const fixture = TestBed.createComponent(HqStockPopupComponent);
    fixture.componentRef.setInput('start', start);
    fixture.detectChanges();
    return { fixture, inv, path };
  }

  async function type(fixture: ReturnType<typeof mount>['fixture'], text: string) {
    await fixture.whenStable();
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('#hq-stock-item') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('says it does not exist and keeps Add disabled for text without a Codex match', async () => {
    const { fixture } = mount({ mode: 'add' });
    const el: HTMLElement = fixture.nativeElement;
    fixture.componentInstance.location = 'Area18';
    await type(fixture, 'q34tqaergv');
    expect(el.querySelector('#hq-stock-item-msg')?.textContent).toContain('hq.stock.capture.unknown');
    expect((el.querySelector('form.capture button[type=submit]') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('saves a picked suggestion with its kind and class name', async () => {
    const { fixture, inv } = mount({ mode: 'add' }, { hits: [{ kind: 'ship', classNameSlug: 'AEGS_Idris_P', nameLocalized: 'Idris-P' }] });
    const c = fixture.componentInstance;
    c.location = 'Area18';
    await type(fixture, 'Idr');
    expect(((fixture.nativeElement as HTMLElement).querySelector('[role=option]') as HTMLElement).textContent).toContain('Idris-P');
    c.pick(c.suggestions()[0]);
    fixture.detectChanges();
    expect(c.valid()).toBeTrue();
    await c.add();
    expect(inv.addManual).toHaveBeenCalledWith('Area18', 'Idris-P', 1, 'pcs', 'ship:AEGS_Idris_P');
  });

  it('renders a result with a target as an anchor and one without as plain text', async () => {
    const { fixture } = mount(
      { mode: 'browse' },
      {
        items: [
          { location: 'Lorville', name: 'Gold', class_name: 'item:Gold', qty: 3, unit: 'scu' },
          { location: 'Lorville', name: 'Notiz', class_name: null, qty: 1, unit: 'scu' },
        ],
      },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li.row')];
    const gold = rows.find((r) => r.textContent?.includes('Gold'));
    const note = rows.find((r) => r.textContent?.includes('Notiz'));
    expect(gold?.querySelector('a.entry')?.getAttribute('href')).toBe('/codex/item/Gold');
    expect(note?.querySelector('a')).toBeNull();
  });

  it('gives each row with a class name the tertiary path and a Nachholen action; a row without one has neither', async () => {
    const { fixture } = mount(
      { mode: 'browse' },
      {
        items: [
          { location: 'Lorville', name: 'Gold', class_name: 'item:Gold', qty: 3, unit: 'scu' },
          { location: 'Lorville', name: 'Notiz', class_name: null, qty: 1, unit: 'scu' },
        ],
      },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('li.row')];
    const gold = rows.find((r) => r.textContent?.includes('Gold'))!;
    const note = rows.find((r) => r.textContent?.includes('Notiz'))!;
    expect(gold.querySelector('sc-item-path')).not.toBeNull();
    expect(gold.querySelector('button.again.sc-action--secondary')).not.toBeNull();
    expect(note.querySelector('sc-item-path')).toBeNull();
    expect(note.querySelector('.again')).toBeNull();
  });

  it('Nachholen puts the quantity back into Nachschub through the path service and offers an undo; stock is not written', async () => {
    const { fixture, inv, path } = mount(
      { mode: 'browse' },
      { items: [{ location: 'Lorville', name: 'Medpen', class_name: 'Medpen_01', qty: 4, unit: 'pcs' }] },
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('li.row button.again') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(path.nachholen).toHaveBeenCalledOnceWith('item', 'Medpen_01', 'Medpen', 4);
    expect(inv.addManual).not.toHaveBeenCalled();
    const toast = TestBed.inject(UndoToastService);
    expect(toast.current()?.messageKey).toBe('itemPath.done.nachholen');
    toast.undo();
    expect(el.querySelector('[role=alert].warn')).toBeNull();
  });

  it('Nachholen shows the failure inline when the path refuses', async () => {
    const { fixture, path } = mount(
      { mode: 'browse' },
      { items: [{ location: 'Lorville', name: 'Medpen', class_name: 'Medpen_01', qty: 1, unit: 'pcs' }] },
    );
    path.nachholen.and.returnValue({ ok: false, key: 'itemPath.err.listFull' });
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('li.row button.again') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert].warn')?.textContent).toContain('itemPath.err.listFull');
  });
});
