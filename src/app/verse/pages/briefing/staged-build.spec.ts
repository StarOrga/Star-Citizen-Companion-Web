import { fakeAsync, tick } from '@angular/core/testing';
import { AFTER_PAINT_FALLBACK_MS, HUB_HEIGHT_KEY, afterPaint, readHubHeight, rememberHubHeight } from './staged-build';

describe('afterPaint', () => {
  it('runs behind the next frame, and only once', fakeAsync(() => {
    const run = vi.fn().mockName('run');
    afterPaint(run);
    expect(run).not.toHaveBeenCalled();
    tick(AFTER_PAINT_FALLBACK_MS + 50);
    expect(run).toHaveBeenCalledTimes(1);
  }));

  it('does not wait for a frame that never comes (hidden tab)', fakeAsync(() => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const run = vi.fn().mockName('run');
    afterPaint(run);
    tick(AFTER_PAINT_FALLBACK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    tick(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalledTimes(1);
  }));

  it('can be cancelled', fakeAsync(() => {
    const run = vi.fn().mockName('run');
    afterPaint(run)();
    tick(AFTER_PAINT_FALLBACK_MS + 50);
    expect(run).not.toHaveBeenCalled();
  }));
});

describe('hub height memory (placeholder height)', () => {
  afterEach(() => localStorage.removeItem(HUB_HEIGHT_KEY));

  it('remembers the built hub height per window width and reads it back', () => {
    expect(readHubHeight(1600)).toBeNull();
    rememberHubHeight(1600, 714.4);
    expect(readHubHeight(1600)).toBe(714);
    expect(readHubHeight(1610), 'same 40 px bucket').toBe(714);
    expect(readHubHeight(390), 'another width has its own height').toBeNull();
  });

  it('keeps only the newest buckets and survives broken storage', () => {
    for (let w = 400; w < 400 + 40 * 20; w += 40) rememberHubHeight(w, w);
    expect(readHubHeight(400), 'the oldest bucket is dropped').toBeNull();
    expect(readHubHeight(400 + 40 * 19)).toBe(400 + 40 * 19);
    localStorage.setItem(HUB_HEIGHT_KEY, '{not json');
    expect(readHubHeight(1600)).toBeNull();
    rememberHubHeight(1600, 0);
    expect(readHubHeight(1600), 'a zero height is never remembered').toBeNull();
  });
});
