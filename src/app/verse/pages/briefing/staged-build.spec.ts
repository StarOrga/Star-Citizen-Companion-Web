import { fakeAsync, tick } from '@angular/core/testing';
import { AFTER_PAINT_FALLBACK_MS, afterPaint } from './staged-build';

describe('afterPaint', () => {
  it('runs behind the next frame, and only once', fakeAsync(() => {
    const run = jasmine.createSpy('run');
    afterPaint(run);
    expect(run).not.toHaveBeenCalled();
    tick(AFTER_PAINT_FALLBACK_MS + 50);
    expect(run).toHaveBeenCalledTimes(1);
  }));

  it('does not wait for a frame that never comes (hidden tab)', fakeAsync(() => {
    const raf = spyOn(window, 'requestAnimationFrame').and.returnValue(1);
    const run = jasmine.createSpy('run');
    afterPaint(run);
    tick(AFTER_PAINT_FALLBACK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    tick(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalledTimes(1);
  }));

  it('can be cancelled', fakeAsync(() => {
    const run = jasmine.createSpy('run');
    afterPaint(run)();
    tick(AFTER_PAINT_FALLBACK_MS + 50);
    expect(run).not.toHaveBeenCalled();
  }));
});
