import { discardPeriodicTasks, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { throwError } from 'rxjs';

import { ConsentService } from '../core/consent.service';
import { NewsService } from './news.service';

const POLL_MS = 5 * 60 * 1000;

describe('NewsService polling', () => {
  let service: NewsService;
  let refresh: jasmine.Spy;
  let visibility: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: () => throwError(() => new TypeError('Failed to fetch')) } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
      ],
    });
    service = TestBed.inject(NewsService);
    refresh = spyOn(service, 'refresh').and.returnValue(Promise.resolve());
    visibility = spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
  });

  it('refreshes silently once per five-minute interval', fakeAsync(() => {
    service.startPolling();
    tick(POLL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    tick(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(true);
    service.stopPolling();
    discardPeriodicTasks();
  }));

  it('does not start a second timer when called twice', fakeAsync(() => {
    service.startPolling();
    service.startPolling();
    tick(POLL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    service.stopPolling();
    discardPeriodicTasks();
  }));

  it('skips the tick while the tab is hidden', fakeAsync(() => {
    visibility.and.returnValue('hidden');
    service.startPolling();
    tick(POLL_MS);
    expect(refresh).not.toHaveBeenCalled();
    service.stopPolling();
    discardPeriodicTasks();
  }));

  it('refreshes when the tab becomes visible again, not when it hides', fakeAsync(() => {
    service.startPolling();
    visibility.and.returnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
    visibility.and.returnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledOnceWith(true);
    service.stopPolling();
    discardPeriodicTasks();
  }));

  it('stopPolling clears the timer and removes the visibilitychange listener', fakeAsync(() => {
    service.startPolling();
    service.stopPolling();
    tick(POLL_MS * 2);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(refresh).not.toHaveBeenCalled();
    discardPeriodicTasks();
  }));
});

describe('NewsService feed error', () => {
  it('stores an i18n key, never raw transport text, when the feed request fails', async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get: () => throwError(() => new TypeError('Failed to fetch')) } },
        { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
      ],
    });
    const service = TestBed.inject(NewsService);
    spyOn(console, 'warn');
    await service.refresh();
    expect(service.error()).toMatch(/^errors\./);
    expect(service.loading()).toBeFalse();
  });
});
