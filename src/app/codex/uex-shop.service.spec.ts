import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UexShopService } from './uex-shop.service';

describe('UexShopService', () => {
  let svc: UexShopService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UexShopService, provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(UexShopService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  // A synchronous flush() resolves the fetch's promise, but the service's own
  // `await` continuation only runs on the NEXT microtask — yield the queue
  // (a couple of ticks, since fetchList itself awaits once) before the
  // subsequent HTTP request is expected to exist.
  async function tick(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function flushEnvelope<T>(match: (url: string) => boolean, data: T[]): Promise<void> {
    http.expectOne((r) => match(r.url)).flush({ status: 'ok', http_code: 200, data });
    await tick();
  }

  it('resolves purchase options for an armor piece, sorted by price', async () => {
    const pending = svc.whereToBuy({ name: 'ADP-mk4 Helmet', attachType: 'Char_Armor_Helmet' });
    await tick();

    await flushEnvelope((u) => u.includes('resource=items') && u.includes('id_category=3'), [
      { id: 111, id_category: 3, name: 'ADP-MK4 Helmet' },
    ]);
    await flushEnvelope((u) => u.includes('resource=items_prices') && u.includes('id_item=111'), [
      { id_item: 111, id_terminal: 5, id_star_system: 1, id_planet: null, id_city: null, price_buy: 500, price_buy_avg: 480 },
      { id_item: 111, id_terminal: 6, id_star_system: 1, id_planet: null, id_city: null, price_buy: 300, price_buy_avg: 300 },
      { id_item: 111, id_terminal: 7, id_star_system: 1, id_planet: null, id_city: null, price_buy: 0, price_buy_avg: 0 },
    ]);
    await flushEnvelope((u) => u.includes('resource=terminals'), [
      { id: 5, name: 'CentermassA', fullname: 'CentermassA', nickname: null, id_star_system: 1, id_planet: null, id_city: null, id_space_station: 9 },
      { id: 6, name: 'CentermassB', fullname: 'CentermassB', nickname: null, id_star_system: 1, id_planet: null, id_city: null, id_space_station: 9 },
      { id: 7, name: 'CentermassC', fullname: 'CentermassC', nickname: null, id_star_system: 1, id_planet: null, id_city: null, id_space_station: 9 },
    ]);
    await flushEnvelope((u) => u.includes('resource=star_systems'), [{ id: 1, name: 'Stanton' }]);
    await flushEnvelope((u) => u.includes('resource=planets'), []);
    await flushEnvelope((u) => u.includes('resource=cities'), []);
    await flushEnvelope((u) => u.includes('resource=space_stations'), [{ id: 9, name: 'Everus Harbor' }]);

    const result = await pending;
    expect(result.length).toBe(2); // price_buy=0 row is filtered out
    expect(result[0].price).toBe(300);
    expect(result[0].terminal).toBe('CentermassB');
    expect(result[0].location).toContain('Stanton');
    expect(result[1].price).toBe(500);
  });

  it('returns empty when the entity has no mapped UEX category', async () => {
    const result = await svc.whereToBuy({ name: 'Some Component' });
    expect(result).toEqual([]);
  });

  it('never throws when the upstream call fails', async () => {
    const pending = svc.whereToBuy({ name: 'Whatever Rifle', weaponClass: 'FPS', subType: 'Rifle' });
    http.expectOne((r) => r.url.includes('resource=items') && r.url.includes('id_category=18')).flush(
      { error: 'upstream error' },
      { status: 502, statusText: 'Bad Gateway' },
    );
    const result = await pending;
    expect(result).toEqual([]);
  });
});
