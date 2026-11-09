import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SLOW_NAVIGATION_MS, SlowNavigationService } from './slow-navigation.service';
import { SlowNavigationComponent } from './slow-navigation.component';

@Component({ template: '', standalone: true })
class Dummy {}

describe('SlowNavigationService', () => {
  let release: () => void;
  let gate: Promise<void>;

  beforeEach(() => {
    vi.useFakeTimers();
    gate = new Promise<void>((r) => (release = r));
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        provideLocationMocks(),
        provideRouter([
          { path: 'fast', component: Dummy },
          {
            path: 'slow',
            loadComponent: async () => {
              await gate;
              return Dummy;
            },
          },
        ]),
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('stays hidden before the threshold, shows after it and hides on completion', async () => {
    const svc = TestBed.inject(SlowNavigationService);
    const router = TestBed.inject(Router);
    const nav = router.navigateByUrl('/slow');
    await vi.advanceTimersByTimeAsync(SLOW_NAVIGATION_MS - 100);
    expect(svc.slow()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(svc.slow()).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await nav;
    expect(svc.slow()).toBe(false);
  });

  it('never shows for a quick navigation', async () => {
    const svc = TestBed.inject(SlowNavigationService);
    await TestBed.inject(Router).navigateByUrl('/fast');
    await vi.advanceTimersByTimeAsync(SLOW_NAVIGATION_MS * 2);
    expect(svc.slow()).toBe(false);
  });

  it('renders the card with retry and home, and retry re-runs the pending URL', async () => {
    const svc = TestBed.inject(SlowNavigationService);
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(SlowNavigationComponent);
    const nav = router.navigateByUrl('/slow');
    await vi.advanceTimersByTimeAsync(SLOW_NAVIGATION_MS + 10);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="status"]')).not.toBeNull();
    expect(el.querySelector('a[href="/"]')).not.toBeNull();
    const spy = vi.spyOn(router, 'navigateByUrl');
    (el.querySelector('button') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledWith('/slow', { onSameUrlNavigation: 'reload' });
    release();
    await vi.advanceTimersByTimeAsync(0);
    await nav.catch(() => undefined);
    fixture.detectChanges();
    expect(svc.slow()).toBe(false);
    expect(el.querySelector('[role="status"]')).toBeNull();
  });
});
