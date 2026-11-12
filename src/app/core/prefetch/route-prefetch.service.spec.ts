import type { Mock } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { PREFETCH_WARMERS, PrefetchWarmer, prefetchBudget } from './prefetch.model';
import { HOVER_INTENT_MS, RoutePrefetchService } from './route-prefetch.service';

@Component({ selector: 'sc-leaf', template: '' })
class Leaf {}

describe('RoutePrefetchService', () => {
  let codexLoad: Mock<() => Promise<typeof Leaf>>;
  let warm: Mock<() => Promise<void>>;
  let pressWarm: Mock<() => Promise<void>>;
  let authed: ReturnType<typeof signal<boolean>>;
  let anchors: HTMLAnchorElement[];

  function setup(connection?: { saveData?: boolean; effectiveType?: string }): RoutePrefetchService {
    codexLoad = vi.fn(() => Promise.resolve(Leaf));
    warm = vi.fn(() => Promise.resolve());
    pressWarm = vi.fn(() => Promise.resolve());
    authed = signal(true);
    const warmers: PrefetchWarmer[] = [
      { id: 'landing', matches: (p) => p === '/codex', warm },
      { id: 'detail', trigger: 'press', matches: (p) => p.startsWith('/codex/ship/'), key: (p) => p, warm: pressWarm },
    ];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'codex', pathMatch: 'full', loadComponent: codexLoad },
          { path: 'codex/:kind/:className', loadComponent: () => Promise.resolve(Leaf) },
        ]),
        { provide: AuthService, useValue: { isAuthenticated: authed } },
        { provide: PREFETCH_WARMERS, useValue: warmers },
      ],
    });
    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => connection });
    vi.spyOn(window, 'requestIdleCallback').mockImplementation((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 0;
    });
    const svc = TestBed.inject(RoutePrefetchService);
    svc.start();
    return svc;
  }

  function link(href: string): HTMLAnchorElement {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = href;
    document.body.appendChild(a);
    anchors.push(a);
    return a;
  }

  const settle = () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

  beforeEach(() => (anchors = []));
  afterEach(() => {
    anchors.forEach((a) => a.remove());
    delete (navigator as { connection?: unknown }).connection;
    vi.useRealTimers();
  });

  it('loads code and warms data on a press at once', async () => {
    setup();
    link('/codex').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    await settle();
    expect(codexLoad).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('waits for the hover intent delay and drops a pointer that only passes', async () => {
    vi.useFakeTimers();
    setup();
    const a = link('/codex');
    a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    vi.advanceTimersByTime(HOVER_INTENT_MS - 10);
    a.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
    vi.advanceTimersByTime(200);
    expect(codexLoad).not.toHaveBeenCalled();

    a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    vi.advanceTimersByTime(HOVER_INTENT_MS + 5);
    vi.useRealTimers();
    await settle();
    expect(codexLoad).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('runs press-only warmers on a press, not on focus', async () => {
    setup();
    const a = link('/codex/ship/AEGS_Gladius');
    a.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(pressWarm).not.toHaveBeenCalled();
    a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    await settle();
    expect(pressWarm).toHaveBeenCalledTimes(1);
  });

  it('skips foreign, new-tab and download links and warms nothing signed out', async () => {
    setup();
    authed.set(false);
    const blank = link('/codex');
    blank.target = '_blank';
    blank.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    link('https://example.com/codex').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(codexLoad).not.toHaveBeenCalled();
    link('/codex').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(codexLoad).toHaveBeenCalledTimes(1);
    expect(warm).not.toHaveBeenCalled();
  });

  it('honours Save-Data and loads code only on 3G', async () => {
    setup({ saveData: true });
    link('/codex').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(codexLoad).not.toHaveBeenCalled();
    expect(prefetchBudget({ effectiveType: '3g' })).toBe('code');
    expect(prefetchBudget({ effectiveType: '2g' })).toBe('none');
    expect(prefetchBudget({ effectiveType: '4g' })).toBe('all');
    expect(prefetchBudget(undefined)).toBe('all');
  });

  it('holds idle prefetches through the flight window after a navigation', async () => {
    setup();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/codex/ship/x');
    link('/codex').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(warm).not.toHaveBeenCalled();
  });
});
