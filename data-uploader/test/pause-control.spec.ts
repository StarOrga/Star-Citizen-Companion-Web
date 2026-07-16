import { describe, it, expect, vi } from 'vitest';
import {
  createPauseControl,
  isInterrupt,
  PausedError,
  CancelledError,
} from '../src/lib/pause-control.js';

describe('createPauseControl', () => {
  it('starts running and lets checkpoints through', () => {
    const c = createPauseControl();
    expect(c.state()).toBe('running');
    expect(() => c.checkpoint()).not.toThrow();
  });

  it('throws PausedError at a checkpoint once paused', () => {
    const c = createPauseControl();
    c.pause();
    expect(c.state()).toBe('paused');
    expect(() => c.checkpoint()).toThrow(PausedError);
  });

  it('throws CancelledError at a checkpoint once cancelled', () => {
    const c = createPauseControl();
    c.cancel();
    expect(() => c.checkpoint()).toThrow(CancelledError);
  });

  it('lets checkpoints through again after resume', () => {
    const c = createPauseControl();
    c.pause();
    c.resume();
    expect(c.state()).toBe('running');
    expect(() => c.checkpoint()).not.toThrow();
  });

  it('treats cancellation as terminal — pause/resume cannot revive it', () => {
    const c = createPauseControl();
    c.cancel();
    c.resume();
    expect(c.state()).toBe('cancelled');
    c.pause();
    expect(c.state()).toBe('cancelled');
    expect(() => c.checkpoint()).toThrow(CancelledError);
  });

  it('notifies subscribers on change, and only on actual changes', () => {
    const c = createPauseControl();
    const seen: string[] = [];
    c.onChange((s) => seen.push(s));
    c.pause();
    c.pause(); // no-op — already paused
    c.resume();
    expect(seen).toEqual(['paused', 'running']);
  });

  it('stops notifying after unsubscribe', () => {
    const c = createPauseControl();
    const cb = vi.fn();
    const off = c.onChange(cb);
    off();
    c.pause();
    expect(cb).not.toHaveBeenCalled();
  });

  it('survives a listener that throws', () => {
    const c = createPauseControl();
    const good = vi.fn();
    c.onChange(() => {
      throw new Error('bad listener');
    });
    c.onChange(good);
    expect(() => c.pause()).not.toThrow();
    expect(good).toHaveBeenCalledWith('paused');
  });
});

describe('isInterrupt', () => {
  it('identifies both control-flow signals', () => {
    expect(isInterrupt(new PausedError())).toBe(true);
    expect(isInterrupt(new CancelledError())).toBe(true);
  });

  it('does not swallow real failures', () => {
    // The whole point: a network error must NOT be mistaken for a pause, or a
    // genuine upload failure would be silently reported as "paused".
    expect(isInterrupt(new Error('ECONNRESET'))).toBe(false);
    expect(isInterrupt(new TypeError('fetch failed'))).toBe(false);
    expect(isInterrupt('paused')).toBe(false);
    expect(isInterrupt(null)).toBe(false);
  });
});
