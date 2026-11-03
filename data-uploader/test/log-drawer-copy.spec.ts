import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogBudget } from '../src/lib/log-budget.js';

function fakeButton() {
  const classes = new Set<string>();
  return {
    textContent: 'Kopieren',
    classList: {
      add: (c: string) => classes.add(c),
      remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      has: (c: string) => classes.has(c),
    },
  } as unknown as HTMLButtonElement & { classList: { has(c: string): boolean } };
}

describe('copyLog', () => {
  let write: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('document', { getElementById: () => null });
    write = vi.fn();
    vi.stubGlobal('window', { sc: { clipboard: { writeText: write } } });
  });

  it('copies the full transcript and shows the copied state', async () => {
    const mod = await import('../src/renderer/log-drawer.js');
    mod.resetLog();
    mod.appendLog('first');
    mod.appendLog('boom', 'error');
    write.mockResolvedValue({ ok: true });
    const btn = fakeButton();
    expect(await mod.copyLog(btn)).toBe('copied');
    expect(write).toHaveBeenCalledWith('first\n[err] boom\n');
    expect(btn.classList.has('copied')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(btn.classList.has('copied')).toBe(false);
  });

  it('shows the failed state when the clipboard write rejects', async () => {
    const mod = await import('../src/renderer/log-drawer.js');
    mod.resetLog();
    mod.appendLog('x');
    write.mockRejectedValue(new Error('denied'));
    const btn = fakeButton();
    expect(await mod.copyLog(btn)).toBe('failed');
    expect(btn.classList.has('copy-failed')).toBe(true);
    expect(btn.classList.has('copied')).toBe(false);
  });

  it('says so for an empty log and leaves the clipboard alone', async () => {
    const mod = await import('../src/renderer/log-drawer.js');
    mod.resetLog();
    const btn = fakeButton();
    expect(await mod.copyLog(btn)).toBe('empty');
    expect(write).not.toHaveBeenCalled();
    expect(btn.classList.has('copied')).toBe(false);
  });
});

describe('createLogBudget', () => {
  it('always passes warn and error, caps info and counts the drops', () => {
    const b = createLogBudget(2);
    expect([b.take('info'), b.take('info'), b.take('info')]).toEqual([true, true, false]);
    expect(b.take('warn')).toBe(true);
    expect(b.take('error')).toBe(true);
    expect(b.dropped).toBe(1);
  });
});
