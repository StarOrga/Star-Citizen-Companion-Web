import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CommodityPriceService, priceAge, type CommodityPrice } from './commodity-price.service';
import { HqCommodityPricesComponent } from './hq-commodity-prices.component';

const price = (o: Partial<CommodityPrice> = {}): CommodityPrice => ({
  commodityId: 1, commodity: 'Agricium', terminalId: 7, terminal: 'TDD Area 18', buy: null, sell: 2750, buyAvg: null, sellAvg: 2600,
  updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), ...o,
});

describe('priceAge', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  it('uses the largest whole unit', () => {
    expect(priceAge('2026-11-07T11:30:00Z', now)).toEqual({ unit: 'minutes', n: 30 });
    expect(priceAge('2026-11-07T09:00:00Z', now)).toEqual({ unit: 'hours', n: 3 });
    expect(priceAge('2026-11-01T12:00:00Z', now)).toEqual({ unit: 'days', n: 6 });
  });
  it('is null without a real timestamp', () => {
    expect(priceAge(null, now)).toBeNull();
    expect(priceAge('nope', now)).toBeNull();
  });
});

describe('CommodityPriceService', () => {
  let http: HttpTestingController;
  let svc: CommodityPriceService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(CommodityPriceService);
  });

  it('loads prices per terminal with source for the picked commodity', async () => {
    const p = svc.select(1);
    const req = http.expectOne((r) => r.url.endsWith('/commodity-prices?id_commodity=1'));
    req.flush({ source: 'uex', fetchedAt: 'x', prices: [price()] });
    await p;
    expect(svc.source()).toBe('uex');
    expect(svc.prices()[0].terminal).toBe('TDD Area 18');
    expect(svc.error()).toBeNull();
  });

  it('maps a failure to a translated key and retries the selected commodity', async () => {
    svc.commodities.set([{ id: 1, name: 'Agricium' }]);
    const p = svc.select(1);
    http.expectOne((r) => r.url.includes('id_commodity=1')).flush('boom', { status: 502, statusText: 'Bad Gateway' });
    await p;
    expect(svc.error()).toMatch(/^errors\./);
    const again = svc.retry();
    http.expectOne((r) => r.url.includes('id_commodity=1')).flush({ source: 'uex', fetchedAt: 'x', prices: [] });
    await again;
    expect(svc.error()).toBeNull();
  });
});

describe('HqCommodityPricesComponent', () => {
  function make(state: { prices?: CommodityPrice[]; selected?: number | null; loading?: boolean; error?: string | null }) {
    const retry = jasmine.createSpy('retry').and.resolveTo();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        {
          provide: CommodityPriceService,
          useValue: {
            commodities: signal([{ id: 1, name: 'Agricium' }]),
            prices: signal(state.prices ?? []),
            selectedId: signal(state.selected ?? null),
            loading: signal(state.loading ?? false),
            error: signal(state.error ?? null),
            loadCommodities: () => Promise.resolve(),
            select: () => Promise.resolve(),
            retry,
          },
        },
      ],
    });
    const f = TestBed.createComponent(HqCommodityPricesComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, retry };
  }

  it('shows the source label and a price row with its age', () => {
    const { el } = make({ selected: 1, prices: [price()] });
    expect(el.querySelector('.cp-source')).not.toBeNull();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('.sc-table-scroll')).not.toBeNull();
  });
  it('shows loading, idle and empty states', () => {
    expect(make({ loading: true }).el.querySelector('[role=status]')).not.toBeNull();
    TestBed.resetTestingModule();
    expect(make({}).el.querySelector('.cp-note')).not.toBeNull();
    TestBed.resetTestingModule();
    const empty = make({ selected: 1, prices: [] }).el;
    expect(empty.querySelector('.cp-note')).not.toBeNull();
    expect(empty.querySelector('table')).toBeNull();
  });
  it('shows an error with retry instead of the empty state', () => {
    const { f, el, retry } = make({ selected: 1, error: 'errors.unknown' });
    expect(el.querySelector('table')).toBeNull();
    (el.querySelector('.cp-err button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(retry).toHaveBeenCalled();
  });
});
