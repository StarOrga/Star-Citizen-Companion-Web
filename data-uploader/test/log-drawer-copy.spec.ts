import { describe, it, expect, vi } from 'vitest';
import { createLogBudget } from '../src/lib/log-budget.js';
import { COPY_OUTCOME_KEY, copyTranscript } from '../src/lib/log-copy.js';

describe('copyTranscript', () => {
  it('copies the full transcript', async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    expect(await copyTranscript('first\n[err] boom\n', write)).toBe('copied');
    expect(write).toHaveBeenCalledWith('first\n[err] boom\n');
  });

  it('fails when the clipboard write rejects', async () => {
    const write = vi.fn().mockRejectedValue(new Error('denied'));
    expect(await copyTranscript('x\n', write)).toBe('failed');
  });

  it('fails when the main process answers ok: false', async () => {
    const write = vi.fn().mockResolvedValue({ ok: false });
    expect(await copyTranscript('x\n', write)).toBe('failed');
  });

  it('says so for an empty log and leaves the clipboard alone', async () => {
    const write = vi.fn();
    expect(await copyTranscript('  \n', write)).toBe('empty');
    expect(write).not.toHaveBeenCalled();
  });

  it('has a text for every outcome', () => {
    expect(COPY_OUTCOME_KEY).toEqual({ copied: 'run.copied', failed: 'run.copyFailed', empty: 'run.copyEmpty' });
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
