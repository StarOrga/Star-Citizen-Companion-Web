import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { ConsentService } from '../core/consent.service';
import { NewsService, VerseFeed } from './news.service';

/**
 * Guards the request coalescing in `NewsService.refresh` (feedback #79).
 *
 * The playability chip lives in the app header now, so on a cold start of /news
 * two independent consumers ask for the same feed in the same tick — the chip
 * (because it has nothing to show) and the page (in its ngOnInit). Without
 * coalescing that is two identical edge-function calls on every session start.
 */
describe('NewsService.refresh coalescing', () => {
  let responses: Subject<VerseFeed>;
  let get: jasmine.Spy;
  let service: NewsService;

  const feed = (fetchedAt: string): VerseFeed => ({
    status: null,
    news: [],
    fetchedAt,
  });

  beforeEach(() => {
    responses = new Subject<VerseFeed>();
    get = jasmine.createSpy('get').and.returnValue(responses.asObservable());
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
      ],
    });
    service = TestBed.inject(NewsService);
  });

  it('serves two concurrent callers from a single request', async () => {
    const a = service.refresh();
    const b = service.refresh(true);

    expect(get).toHaveBeenCalledTimes(1);

    responses.next(feed('2026-07-30T10:00:00.000Z'));
    responses.complete();
    await Promise.all([a, b]);

    expect(service.feed()?.fetchedAt).toBe('2026-07-30T10:00:00.000Z');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fetches again once the in-flight request has settled', async () => {
    const first = service.refresh();
    responses.next(feed('2026-07-30T10:00:00.000Z'));
    responses.complete();
    await first;

    responses = new Subject<VerseFeed>();
    get.and.returnValue(responses.asObservable());

    const second = service.refresh(true);
    expect(get).toHaveBeenCalledTimes(2);

    responses.next(feed('2026-07-30T10:05:00.000Z'));
    responses.complete();
    await second;

    expect(service.feed()?.fetchedAt).toBe('2026-07-30T10:05:00.000Z');
  });

  it('releases the in-flight latch when the request fails', async () => {
    const failing = service.refresh();
    responses.error(new Error('offline'));
    await failing;

    expect(service.error()).toBe('offline');

    responses = new Subject<VerseFeed>();
    get.and.returnValue(responses.asObservable());
    const retry = service.refresh();
    expect(get).toHaveBeenCalledTimes(2);

    responses.next(feed('2026-07-30T10:10:00.000Z'));
    responses.complete();
    await retry;

    expect(service.error()).toBeNull();
    expect(service.feed()?.fetchedAt).toBe('2026-07-30T10:10:00.000Z');
  });
});
