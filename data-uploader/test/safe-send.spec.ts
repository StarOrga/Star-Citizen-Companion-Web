import { describe, it, expect, vi } from 'vitest';
import { safeSend, canSend, type SendableContents } from '../src/lib/safe-send.js';

function fake(over: Partial<SendableContents> = {}): SendableContents & { send: ReturnType<typeof vi.fn> } {
  return {
    isDestroyed: () => false,
    mainFrame: { isDestroyed: () => false },
    send: vi.fn(),
    ...over,
  } as SendableContents & { send: ReturnType<typeof vi.fn> };
}

describe('safeSend', () => {
  it('delivers to a live renderer', () => {
    const wc = fake();
    expect(safeSend(wc, 'ch', { a: 1 })).toBe(true);
    expect(wc.send).toHaveBeenCalledWith('ch', { a: 1 });
  });
  it('skips a destroyed webContents, a crashed one and a missing frame', () => {
    for (const over of [
      { isDestroyed: () => true },
      { isCrashed: () => true },
      { mainFrame: null },
      { mainFrame: { isDestroyed: () => true } },
    ]) {
      const wc = fake(over);
      expect(safeSend(wc, 'ch')).toBe(false);
      expect(wc.send).not.toHaveBeenCalled();
    }
    expect(safeSend(null, 'ch')).toBe(false);
    expect(safeSend(undefined, 'ch')).toBe(false);
  });
  it('treats a throwing mainFrame getter as gone', () => {
    const wc = fake();
    Object.defineProperty(wc, 'mainFrame', {
      get() {
        throw new Error('Render frame was disposed');
      },
    });
    expect(canSend(wc)).toBe(false);
    expect(safeSend(wc, 'ch')).toBe(false);
  });
  it('swallows a send that throws', () => {
    const wc = fake({ send: vi.fn(() => { throw new Error('boom'); }) });
    expect(safeSend(wc, 'ch')).toBe(false);
  });
});
