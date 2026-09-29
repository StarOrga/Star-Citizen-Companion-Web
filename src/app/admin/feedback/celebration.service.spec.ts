import { fakeAsync, flush, TestBed } from '@angular/core/testing';
import { CelebrationService } from './celebration.service';

describe('CelebrationService', () => {
  let original: typeof window.matchMedia;

  function stubMotion(reduce: boolean): void {
    window.matchMedia = ((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  }

  const layers = () => document.body.querySelectorAll(':scope > div[aria-hidden="true"]');

  beforeEach(() => {
    original = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = original;
    document.body
      .querySelectorAll(':scope > div[aria-hidden="true"][style*="z-index:9999"], :scope > div[aria-hidden="true"][style*="z-index: 9999"]')
      .forEach((n) => n.remove());
  });

  it('reports reduced motion from the media query', () => {
    stubMotion(true);
    expect(TestBed.inject(CelebrationService).reducedMotion).toBeTrue();
    stubMotion(false);
    expect(TestBed.inject(CelebrationService).reducedMotion).toBeFalse();
  });

  it('treats a throwing matchMedia as no preference', () => {
    window.matchMedia = (() => {
      throw new Error('boom');
    }) as unknown as typeof window.matchMedia;
    expect(TestBed.inject(CelebrationService).reducedMotion).toBeFalse();
  });

  it('attaches a decorative layer with the requested particles and removes it afterwards', fakeAsync(() => {
    stubMotion(false);
    const before = layers().length;
    TestBed.inject(CelebrationService).burst({ x: 10, y: 20 }, 7);
    expect(layers().length).toBe(before + 1);
    const layer = layers()[before] as HTMLElement;
    expect(layer.querySelectorAll('i').length).toBe(7);
    expect(layer.style.pointerEvents).toBe('none');
    flush();
    expect(layer.isConnected).toBeFalse();
    expect(layers().length).toBe(before);
  }));

  it('is a no-op under prefers-reduced-motion', fakeAsync(() => {
    stubMotion(true);
    const before = layers().length;
    TestBed.inject(CelebrationService).burst();
    expect(layers().length).toBe(before);
    flush();
  }));

  it('burstFrom(null) does not throw and still bursts', fakeAsync(() => {
    stubMotion(false);
    const before = layers().length;
    expect(() => TestBed.inject(CelebrationService).burstFrom(null)).not.toThrow();
    expect(layers().length).toBe(before + 1);
    flush();
  }));

  it('burstFrom(element) originates at the element centre', fakeAsync(() => {
    stubMotion(false);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:100px;top:50px;width:40px;height:20px';
    document.body.appendChild(el);
    try {
      const before = layers().length;
      TestBed.inject(CelebrationService).burstFrom(el, 1);
      const particle = layers()[before].querySelector('i') as HTMLElement;
      expect(particle.style.left).toBe('120px');
      expect(particle.style.top).toBe('60px');
      flush();
    } finally {
      el.remove();
    }
  }));
});
