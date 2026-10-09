import { describe, it, expect } from 'vitest';
import { catalogHooks, skinHooks, type Pacer } from '../src/lib/upload-hooks.js';
import { UploadJobStore, createJob, type TextIO } from '../src/lib/upload-job.js';
import { createPauseControl, PausedError } from '../src/lib/pause-control.js';
import { pacingMs, type ResourceLimits } from '../src/lib/resource-limits.js';

function memStore(): UploadJobStore {
  let text: string | null = null;
  const io: TextIO = {
    read: () => text,
    write: (t) => {
      text = t;
    },
    remove: () => {
      text = null;
    },
  };
  const store = new UploadJobStore(io);
  store.save(createJob('job-1', '/out', { channel: 'LIVE', patchVersion: '4.0', buildNumber: '1' }, 0));
  return store;
}

/** A pacer over mutable limits, recording the sleeps it would take. */
function livePacer(initial: ResourceLimits): { pacer: Pacer; set: (l: ResourceLimits) => void; sleeps: number[] } {
  let limits = initial;
  const sleeps: number[] = [];
  return {
    sleeps,
    set: (l) => {
      limits = l;
    },
    pacer: {
      pace: async () => {
        const ms = pacingMs(limits);
        if (ms > 0) sleeps.push(ms);
      },
    },
  };
}

const generous: ResourceLimits = { cpuPct: 80, ramMb: 8192, readMBs: 500, writeMBs: 400, iops: 5000 };
const gaming: ResourceLimits = { cpuPct: 15, ramMb: 2048, readMBs: 30, writeMBs: 20, iops: 300 };

describe('upload hooks bind the pacer live', () => {
  it('re-reads the CURRENT limits at every work unit', async () => {
    const p = livePacer(generous);
    // Hooks are built ONCE at stage start — exactly where a snapshot would bake in.
    const hooks = catalogHooks(memStore(), createPauseControl(), p.pacer);
    await hooks.pace?.();
    p.set(gaming);
    await hooks.pace?.();
    expect(p.sleeps).toEqual([pacingMs(gaming)]);
  });

  it('gives the skin stage the same live pacer', async () => {
    const p = livePacer(gaming);
    await skinHooks(memStore(), createPauseControl(), p.pacer).pace?.();
    expect(p.sleeps).toEqual([150]);
  });

  it('omits the pacer when none is bound', () => {
    expect(catalogHooks(memStore(), createPauseControl()).pace).toBeUndefined();
  });

  it('leaves pause in charge — a paused job never reaches the pacing sleep', async () => {
    const p = livePacer(gaming);
    const pause = createPauseControl();
    const hooks = catalogHooks(memStore(), pause, p.pacer);
    pause.pause();
    await expect(
      (async () => {
        hooks.control?.checkpoint();
        await hooks.pace?.();
      })(),
    ).rejects.toThrow(PausedError);
    expect(p.sleeps).toEqual([]);
  });
});
