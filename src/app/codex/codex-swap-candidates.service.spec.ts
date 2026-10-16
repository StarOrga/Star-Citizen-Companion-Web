import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { CodexKind, CodexService, CompatibleItem, PortQuery } from './codex.service';
import {
  CodexSwapCandidatesService,
  SWAP_PRELOAD_IN_FLIGHT,
  SWAP_PRELOAD_SCHEDULER,
  SwapSourceQuery,
  parseSwapRpcRows,
  swapPreloadQueries,
} from './codex-swap-candidates.service';
import type { LayoutSection, LayoutSlot } from './codex-hardpoint-layout.component';

// Admin feedback #244: the swap picker's list loads in ONE call, is cached per
// build and shared by identical hardpoints, and a ship page warms the lists of
// its swappable slots in the background — throttled, because a cold page once
// drained the PostgREST pool with ~75 parallel reads (/unavailable).

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function rpcRow(className: string, role: 'candidate' | 'seed' = 'candidate', ammo = true): Record<string, unknown> {
  return {
    role,
    kind: 'weapon',
    class_name: className,
    name_localized: className,
    manufacturer_code: 'KLA',
    size: 3,
    sub_type: 'Gun',
    grade: 'A',
    payload: { attachType: 'WeaponGun', size: 3 },
    ammo_class_name: ammo ? `${className}_AMMO` : null,
    ammo_payload: ammo ? { speed: 1000 } : null,
  };
}

/** A PostgREST stand-in whose RPC answers can be held open per call. */
class RpcStub {
  readonly calls: Record<string, unknown>[] = [];
  readonly pending: Deferred<{ data: unknown; error: unknown; status: number }>[] = [];
  mode: 'ok' | 'hold' | 'missing' | 'error' = 'ok';
  readonly client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe('codex_swap_candidates');
      this.calls.push(args);
      if (this.mode === 'missing') {
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'not found' }, status: 404 });
      }
      if (this.mode === 'error') {
        return Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' }, status: 500 });
      }
      const rows = [rpcRow(String(args['p_installed'] ?? 'NONE'))];
      if (this.mode === 'hold') {
        const d = deferred<{ data: unknown; error: unknown; status: number }>();
        this.pending.push(d);
        return d.promise.then(() => ({ data: rows, error: null, status: 200 }));
      }
      return Promise.resolve({ data: rows, error: null, status: 200 });
    },
  };
}

class CodexStub {
  buildId = 'build-1';
  compatibleCalls: PortQuery[] = [];
  async loadCurrentBuild(): Promise<{ id: string }> {
    return { id: this.buildId };
  }
  async getEntityPayloads(names: string[]): Promise<Map<string, { kind: CodexKind; payload: unknown }>> {
    return new Map(names.map((n) => [n, { kind: 'weapon' as CodexKind, payload: { attachType: 'WeaponGun', size: 3 } }]));
  }
  async getCompatibleItems(port: PortQuery): Promise<CompatibleItem[]> {
    this.compatibleCalls.push(port);
    return [
      { kind: 'weapon', classNameSlug: 'GUN_A', nameLocalized: 'Gun A', manufacturerCode: null, size: 3, subType: 'Gun', grade: null },
    ];
  }
  async getAmmoPayloads(names: string[]): Promise<Map<string, unknown>> {
    return new Map(names.map((n) => [n, { speed: 1 }]));
  }
}

const q = (installed: string, size = 3): SwapSourceQuery => ({ installed, types: [], size });

describe('CodexSwapCandidatesService', () => {
  let rpc: RpcStub;
  let codex: CodexStub;
  let svc: CodexSwapCandidatesService;
  let scheduled: { run: () => void; first: boolean }[];

  /** Run every scheduled preload step (and what they schedule) until quiet. */
  async function drain(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      await flush();
      const step = scheduled.shift();
      if (!step) {
        await flush();
        if (scheduled.length === 0) return;
        continue;
      }
      step.run();
    }
  }

  beforeEach(() => {
    rpc = new RpcStub();
    codex = new CodexStub();
    scheduled = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: rpc },
        { provide: CodexService, useValue: codex },
        { provide: SWAP_PRELOAD_SCHEDULER, useValue: (run: () => void, first: boolean) => scheduled.push({ run, first }) },
      ],
    });
    svc = TestBed.inject(CodexSwapCandidatesService);
  });

  it('loads a list in one RPC call with the slot inputs', async () => {
    const data = await svc.load({ installed: 'GUN_A', types: ['WeaponGun'], size: 3 });
    expect(rpc.calls.length).toBe(1);
    expect(rpc.calls[0]).toEqual({ p_build_id: 'build-1', p_installed: 'GUN_A', p_types: ['WeaponGun'], p_size: 3 });
    expect(data.items.map((i) => i.classNameSlug)).toEqual(['GUN_A']);
    expect(data.ammo.get('GUN_A_AMMO')).toEqual({ speed: 1000 });
  });

  it('serves a second opening of the same slot from the cache', async () => {
    await svc.load(q('GUN_A'));
    await svc.load(q('GUN_A'));
    expect(rpc.calls.length).toBe(1);
  });

  it('shares one in-flight request between identical slots', async () => {
    rpc.mode = 'hold';
    const a = svc.load(q('GUN_A'));
    const b = svc.load({ installed: 'GUN_A', types: [], size: 3 });
    await flush();
    expect(rpc.calls.length).toBe(1);
    rpc.pending.forEach((d) => d.resolve({ data: null, error: null, status: 200 }));
    expect(await a).toBe(await b);
  });

  it('keys by installed item, accepted types and size', async () => {
    await svc.load(q('GUN_A', 3));
    await svc.load(q('GUN_A', 4));
    await svc.load(q('GUN_B', 3));
    await svc.load({ installed: null, types: ['Shield', 'Cooler'], size: 2 });
    await svc.load({ installed: null, types: ['Cooler', 'Shield'], size: 2 });
    expect(rpc.calls.length).toBe(4);
  });

  it('drops the cache when the current build changes', async () => {
    await svc.load(q('GUN_A'));
    codex.buildId = 'build-2';
    await svc.load(q('GUN_A'));
    expect(rpc.calls.length).toBe(2);
    expect(rpc.calls[1]['p_build_id']).toBe('build-2');
  });

  it('never caches a failure — the retry asks again', async () => {
    rpc.mode = 'error';
    await expectAsync(svc.load(q('GUN_A'))).toBeRejected();
    rpc.mode = 'ok';
    const data = await svc.load(q('GUN_A'));
    expect(data.items.length).toBe(1);
    expect(rpc.calls.length).toBe(2);
  });

  it('falls back to the chained load when the RPC is missing (PGRST202) and stops asking for it', async () => {
    rpc.mode = 'missing';
    const data = await svc.load(q('GUN_A'));
    expect(data.items.map((i) => i.classNameSlug)).toEqual(['GUN_A']);
    expect(data.payloads.has('GUN_A')).toBeTrue();
    expect(codex.compatibleCalls).toEqual([{ types: ['WeaponGun'], minSize: 3, maxSize: 3 }]);
    await svc.load(q('GUN_B'));
    expect(rpc.calls.length).toBe(1);
    expect(codex.compatibleCalls.length).toBe(2);
  });

  it('the fallback asks for nothing when the slot has no accepted type', async () => {
    rpc.mode = 'missing';
    codex.getEntityPayloads = async () => new Map();
    const data = await svc.load({ installed: null, types: [], size: 2 });
    expect(data.items).toEqual([]);
    expect(codex.compatibleCalls).toEqual([]);
  });

  describe('preload', () => {
    it('waits for the scheduler and gives the first step a head start', async () => {
      svc.preload([q('GUN_A')]);
      await flush();
      expect(rpc.calls.length).toBe(0);
      expect(scheduled.length).toBe(1);
      expect(scheduled[0].first).toBeTrue();
      await drain();
      expect(rpc.calls.length).toBe(1);
    });

    it(`keeps at most ${SWAP_PRELOAD_IN_FLIGHT} lists in flight`, async () => {
      rpc.mode = 'hold';
      svc.preload(['A', 'B', 'C', 'D', 'E'].map((n) => q(n)));
      await drain();
      expect(rpc.calls.length).toBe(SWAP_PRELOAD_IN_FLIGHT);
      rpc.pending.shift()!.resolve({ data: null, error: null, status: 200 });
      await drain();
      expect(rpc.calls.length).toBe(SWAP_PRELOAD_IN_FLIGHT + 1);
      while (rpc.pending.length > 0) {
        rpc.pending.shift()!.resolve({ data: null, error: null, status: 200 });
        await drain();
      }
      expect(rpc.calls.length).toBe(5);
    });

    it('deduplicates queued, cached and repeated keys', async () => {
      await svc.load(q('GUN_A'));
      svc.preload([q('GUN_A'), q('GUN_B'), q('GUN_B')]);
      svc.preload([q('GUN_B')]);
      await drain();
      expect(rpc.calls.map((c) => c['p_installed'])).toEqual(['GUN_A', 'GUN_B']);
    });

    it('a picker opened meanwhile reuses the preloaded request', async () => {
      rpc.mode = 'hold';
      svc.preload([q('GUN_A')]);
      await drain();
      expect(rpc.calls.length).toBe(1);
      const opened = svc.load(q('GUN_A'));
      await flush();
      expect(rpc.calls.length).toBe(1);
      rpc.pending.shift()!.resolve({ data: null, error: null, status: 200 });
      expect((await opened).items.length).toBe(1);
    });

    it('cancelPreload drops everything not yet started', async () => {
      rpc.mode = 'hold';
      svc.preload(['A', 'B', 'C', 'D'].map((n) => q(n)));
      await drain();
      expect(rpc.calls.length).toBe(2);
      svc.cancelPreload();
      while (rpc.pending.length > 0) {
        rpc.pending.shift()!.resolve({ data: null, error: null, status: 200 });
        await drain();
      }
      expect(rpc.calls.length).toBe(2);
    });

    it('keeps the queue while any view holds it and drops it after the last release', async () => {
      rpc.mode = 'hold';
      const releaseA = svc.retainPreload();
      const releaseB = svc.retainPreload();
      svc.preload(['A', 'B', 'C', 'D'].map((n) => q(n)));
      await drain();
      expect(rpc.calls.length).toBe(2);
      releaseA();
      releaseA(); // idempotent
      rpc.pending.shift()!.resolve({ data: null, error: null, status: 200 });
      await drain();
      expect(rpc.calls.length).toBe(3);
      releaseB();
      while (rpc.pending.length > 0) {
        rpc.pending.shift()!.resolve({ data: null, error: null, status: 200 });
        await drain();
      }
      expect(rpc.calls.length).toBe(3);
    });

    it('stops preloading once the RPC turns out to be missing', async () => {
      rpc.mode = 'missing';
      svc.preload(['A', 'B', 'C', 'D', 'E'].map((n) => q(n)));
      await drain();
      // The first step(s) discover the gap; nothing after that runs the
      // multi-request fallback chain in the background.
      expect(codex.compatibleCalls.length).toBeLessThanOrEqual(SWAP_PRELOAD_IN_FLIGHT);
      svc.preload([q('F')]);
      await drain();
      expect(codex.compatibleCalls.length).toBeLessThanOrEqual(SWAP_PRELOAD_IN_FLIGHT);
    });
  });
});

describe('parseSwapRpcRows', () => {
  it('lists candidates in order, keeps seed payloads out of the list and maps ammo by round', () => {
    const data = parseSwapRpcRows([rpcRow('SEED', 'seed'), rpcRow('A'), rpcRow('B', 'candidate', false)]);
    expect(data.items.map((i) => i.classNameSlug)).toEqual(['A', 'B']);
    expect([...data.payloads.keys()]).toEqual(['SEED', 'A', 'B']);
    expect([...data.ammo.keys()]).toEqual(['SEED_AMMO', 'A_AMMO']);
    expect(data.items[0]).toEqual({
      kind: 'weapon',
      classNameSlug: 'A',
      nameLocalized: 'A',
      manufacturerCode: 'KLA',
      size: 3,
      subType: 'Gun',
      grade: 'A',
    });
  });
});

describe('swapPreloadQueries', () => {
  const slot = (className: string | null, size: number | null, children: LayoutSlot['children'] = []): LayoutSlot =>
    ({ port: 'p', className, kind: className ? 'weapon' : null, name: null, size, grade: null, manufacturerCode: null, children }) as LayoutSlot;

  it('takes fitted slots and sub-slots of swappable sections only, once per key', () => {
    const child = { port: 'c', typeLabel: null, size: 2, className: 'GUN_S2', kind: 'weapon', name: null, count: 1, rawPorts: [], rawTypes: [] } as NonNullable<LayoutSlot['children']>[number];
    const sections = [
      { section: 'weapons', slots: [slot('MOUNT_S3', 3, [child]), slot('MOUNT_S3', 3, [child]), slot(null, 3)] },
      { section: 'structure', slots: [slot('HULL_PART', 1)] },
    ] as unknown as LayoutSection[];
    const out = swapPreloadQueries(sections);
    expect(out).toEqual([
      { installed: 'MOUNT_S3', types: [], size: 3 },
      { installed: 'GUN_S2', types: [], size: 2 },
    ]);
  });
});
