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
    await tick();
    // FPS weapons search both Personal Weapons (18) and Gadgets (28).
    const reqs = http.match(
      (r) =>
        r.url.includes('resource=items') &&
        (r.url.includes('id_category=18') || r.url.includes('id_category=28')),
    );
    expect(reqs.length).toBe(2);
    reqs.forEach((req) => req.flush({ error: 'upstream error' }, { status: 502, statusText: 'Bad Gateway' }));
    const result = await pending;
    expect(result).toEqual([]);
  });

  it('matches a livery variant by token-subset (extra paint word in our name)', async () => {
    // Our name carries an extra livery word ("Hurston") the bare UEX name lacks.
    const pending = svc.whereToBuy({ name: 'Pyro RYT "Hurston" Multi-Tool', weaponClass: 'FPS', subType: 'Gadget' });
    await tick();
    // Personal Weapons (18) holds the base multi-tool; Gadgets (28) is empty here.
    await flushEnvelope((u) => u.includes('resource=items') && u.includes('id_category=18'), [
      { id: 900, id_category: 18, name: 'Pyro RYT Multi-Tool' },
      { id: 901, id_category: 18, name: 'LH86 Pistol' },
    ]);
    await flushEnvelope((u) => u.includes('resource=items') && u.includes('id_category=28'), []);
    await flushEnvelope((u) => u.includes('resource=items_prices') && u.includes('id_item=900'), [
      { id_item: 900, id_terminal: 5, id_star_system: 1, id_planet: null, id_city: null, price_buy: 1200, price_buy_avg: 1200 },
    ]);
    await flushEnvelope((u) => u.includes('resource=terminals'), [
      { id: 5, name: 'T', fullname: 'T', nickname: null, id_star_system: 1, id_planet: null, id_city: null, id_space_station: null },
    ]);
    await flushEnvelope((u) => u.includes('resource=star_systems'), [{ id: 1, name: 'Stanton' }]);
    await flushEnvelope((u) => u.includes('resource=planets'), []);
    await flushEnvelope((u) => u.includes('resource=cities'), []);
    await flushEnvelope((u) => u.includes('resource=space_stations'), []);
    const result = await pending;
    expect(result.length).toBe(1);
    expect(result[0].price).toBe(1200);
  });
});
