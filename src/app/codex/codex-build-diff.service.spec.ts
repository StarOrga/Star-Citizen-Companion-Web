import { TestBed } from '@angular/core/testing';
import { CodexListRow, CodexService } from './codex.service';
import { CodexBuild } from './codex.types';
import {
  ADDED_SHIPS_LIMIT,
  BUILD_DIFF_PAGE_SIZE,
  CodexBuildDiffService,
  addedClassNames,
} from './codex-build-diff.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../testing/fake-supabase';

const CUR = { id: 'b-cur' } as CodexBuild;
const PREV = { id: 'b-prev' } as CodexBuild;

function row(cn: string): CodexListRow {
  return { classNameSlug: cn, nameLocalized: cn } as CodexListRow;
}

function buildIdOf(call: FakeCall): string | undefined {
  return call.chain.find(([m, a]) => m === 'eq' && a[0] === 'build_id')?.[1][1] as string | undefined;
}

describe('addedClassNames', () => {
  it('is current minus previous, in current order, deduped', () => {
    expect(addedClassNames(['C', 'A', 'B', 'C', ''], ['A'])).toEqual(['C', 'B']);
  });
});

describe('CodexBuildDiffService', () => {
  function setup(opts: {
    builds: CodexBuild[];
    names?: Record<string, string[]>;
    answer?: (call: FakeCall) => FakeResult | Promise<FakeResult>;
  }) {
    const names = opts.names ?? {};
    const sb = fakeSupabase({
      answer:
        opts.answer ??
        ((call) => {
          // The RPC is "not deployed" unless a spec says otherwise: these specs cover the paged fallback.
          if (call.op === 'rpc') return { data: null, error: { code: 'PGRST202', message: 'not found' } };
          const all = names[buildIdOf(call) ?? ''] ?? [];
          const [from, to] = (chainArgs(call, 'range') ?? [0, 999]) as [number, number];
          return { data: all.slice(from, to + 1).map((class_name) => ({ class_name })) };
        }),
    });
    const codex = {
      build: () => CUR,
      recentLiveBuilds: vi.fn().mockName('recentLiveBuilds').mockResolvedValue(opts.builds),
      getShipsByClassNames: vi.fn().mockName('getShipsByClassNames').mockImplementation(async (cns: string[]) => new Map(cns.map((cn) => [cn, row(cn)] as const))),
    };
    TestBed.configureTestingModule({
      providers: [sb.provider, { provide: CodexService, useValue: codex }],
    });
    return { svc: TestBed.inject(CodexBuildDiffService), sb, codex };
  }

  it('returns the ships of the current build missing from the previous one', async () => {
    const { svc, codex } = setup({
      builds: [CUR, PREV],
      names: { 'b-cur': ['AEGS_Gladius', 'KRIG_S65_Stingray', 'RSI_Zeus'], 'b-prev': ['AEGS_Gladius'] },
    });
    const rows = await svc.addedShips();
    expect(rows.map((r) => r.classNameSlug)).toEqual(['KRIG_S65_Stingray', 'RSI_Zeus']);
    expect(codex.getShipsByClassNames).toHaveBeenCalledTimes(1);
    expect(codex.getShipsByClassNames).toHaveBeenCalledWith(['KRIG_S65_Stingray', 'RSI_Zeus'], ['name', 'previewImage', 'manufacturer', 'dimensions']);
  });

  it('applies the default browse filters and selects only class_name', async () => {
    const { svc, sb } = setup({ builds: [CUR, PREV], names: { 'b-cur': ['A'], 'b-prev': [] } });
    await svc.addedShips();
    const reads = sb.calls.filter((c) => c.op === 'from');
    expect(reads.length).toBe(2);
    for (const call of reads) {
      expect(call.target).toBe('codex_ships');
      expect(chainArgs(call, 'select')).toEqual(['class_name']);
      expect(call.chain).toContainEqual(['eq', ['is_variant', false]]);
      expect(call.chain).toContainEqual(['or', ['name_localized.is.null,name_localized.not.like.!*']]);
      expect(call.chain).toContainEqual(['not', ['class_name', 'ilike', 'SalvageableDebris*']]);
      expect(call.chain).toContainEqual(['not', ['class_name', 'ilike', 'Orbital_Sentry*']]);
      expect(call.chain).toContainEqual(['not', ['class_name', 'ilike', 'probe_*']]);
    }
  });

  it('pages past the 1000-row cap', async () => {
    const many = Array.from({ length: BUILD_DIFF_PAGE_SIZE + 5 }, (_, i) => `S_${String(i).padStart(5, '0')}`);
    const { svc, sb } = setup({
      builds: [CUR, PREV],
      names: { 'b-cur': many, 'b-prev': many.slice(0, BUILD_DIFF_PAGE_SIZE + 2) },
    });
    const rows = await svc.addedShips();
    expect(rows.map((r) => r.classNameSlug)).toEqual(many.slice(BUILD_DIFF_PAGE_SIZE + 2));
    const curRanges = sb.calls.filter((c) => buildIdOf(c) === 'b-cur').map((c) => chainArgs(c, 'range'));
    expect(curRanges).toEqual([
      [0, BUILD_DIFF_PAGE_SIZE - 1],
      [BUILD_DIFF_PAGE_SIZE, 2 * BUILD_DIFF_PAGE_SIZE - 1],
    ]);
  });

  it('caps the resolved rows', async () => {
    const many = Array.from({ length: ADDED_SHIPS_LIMIT + 10 }, (_, i) => `N_${i}`);
    const { svc } = setup({ builds: [CUR, PREV], names: { 'b-cur': many, 'b-prev': [] } });
    expect((await svc.addedShips()).length).toBe(ADDED_SHIPS_LIMIT);
  });

  it('returns [] without a previous build and reads no ships', async () => {
    const { svc, sb } = setup({ builds: [CUR] });
    expect(await svc.addedShips()).toEqual([]);
    expect(sb.calls.length).toBe(0);
  });

  it('returns [] when a read fails', async () => {
    const { svc, codex } = setup({
      builds: [CUR, PREV],
      answer: () => ({ data: null, error: { message: 'statement timeout' } }),
    });
    expect(await svc.addedShips()).toEqual([]);
    expect(codex.getShipsByClassNames).not.toHaveBeenCalled();
  });

  describe('addedClassNamesMemo', () => {
    it('diffs class names of the kind table, unfiltered, in current order', async () => {
      const { svc, sb } = setup({
        builds: [CUR, PREV],
        names: { 'b-cur': ['COMP_B', 'COMP_A', 'COMP_C'], 'b-prev': ['COMP_A'] },
      });
      expect(await svc.addedClassNamesMemo('component')).toEqual(['COMP_B', 'COMP_C']);
      for (const call of sb.calls.filter((c) => c.op === 'from')) {
        expect(call.target).toBe('codex_components');
        expect(chainArgs(call, 'select')).toEqual(['class_name']);
        expect(call.chain.some(([m]) => m === 'not' || m === 'or')).toBe(false);
      }
    });

    it('reads each build once per kind', async () => {
      const { svc, sb } = setup({ builds: [CUR, PREV], names: { 'b-cur': ['W_1'], 'b-prev': [] } });
      await svc.addedClassNamesMemo('weapon');
      await svc.addedClassNamesMemo('weapon');
      const reads = sb.calls.filter((c) => c.op === 'from');
      expect(reads.length).toBe(2);
      expect(reads.every((c) => c.target === 'codex_weapons')).toBe(true);
      expect(sb.calls.filter((c) => c.op === 'rpc').length).toBe(1);
    });

    it('answers ships from the ship diff', async () => {
      const { svc } = setup({ builds: [CUR, PREV], names: { 'b-cur': ['AEGS_Gladius', 'RSI_Zeus'], 'b-prev': ['AEGS_Gladius'] } });
      expect(await svc.addedClassNamesMemo('ship')).toEqual(['RSI_Zeus']);
    });

    it('returns [] for a kind without a diff table and reads nothing', async () => {
      const { svc, sb } = setup({ builds: [CUR, PREV] });
      expect(await svc.addedClassNamesMemo('blueprint')).toEqual([]);
      expect(sb.calls.length).toBe(0);
    });

    it('returns [] when a read fails', async () => {
      const { svc } = setup({ builds: [CUR, PREV], answer: () => ({ data: null, error: { message: 'boom' } }) });
      expect(await svc.addedClassNamesMemo('item')).toEqual([]);
    });
  });

  describe('changedClassNamesMemo', () => {
    it('asks codex_changed_class_names once per build and kind', async () => {
      const { svc, sb } = setup({ builds: [CUR, PREV], answer: () => ({ data: ['SHIP_A', '', 'SHIP_B'] }) });
      expect(await svc.changedClassNamesMemo('ship')).toEqual(['SHIP_A', 'SHIP_B']);
      await svc.changedClassNamesMemo('ship');
      expect(sb.calls.length).toBe(1);
      expect(sb.calls[0].target).toBe('codex_changed_class_names');
      expect(sb.calls[0].args).toEqual({ p_kind: 'ship', p_current: 'b-cur', p_previous: 'b-prev' });
    });

    it('returns [] without a previous build, for an unknown kind, and when the RPC is missing or fails', async () => {
      const one = setup({ builds: [CUR], answer: () => ({ data: ['X'] }) });
      expect(await one.svc.changedClassNamesMemo('weapon')).toEqual([]);
      expect(one.sb.calls.length).toBe(0);
      expect(await one.svc.changedClassNamesMemo('blueprint')).toEqual([]);
    });

    it('swallows a missing function', async () => {
      const { svc } = setup({ builds: [CUR, PREV] });
      expect(await svc.changedClassNamesMemo('item')).toEqual([]);
    });
  });

  describe('codex_added_class_names RPC', () => {
    function rpcAnswer(names: string[]) {
      return (call: FakeCall): FakeResult =>
        call.op === 'rpc' ? { data: names } : { data: null, error: { message: 'must not page' } };
    }

    it('asks for the ship diff in one request and resolves the rows', async () => {
      const { svc, sb, codex } = setup({ builds: [CUR, PREV], answer: rpcAnswer(['RSI_Zeus', 'KRIG_X']) });
      const rows = await svc.addedShips();
      expect(rows.map((r) => r.classNameSlug)).toEqual(['RSI_Zeus', 'KRIG_X']);
      expect(sb.calls.length).toBe(1);
      expect(sb.calls[0].target).toBe('codex_added_class_names');
      expect(sb.calls[0].args).toEqual({ p_kind: 'ship', p_current: 'b-cur', p_previous: 'b-prev' });
      expect(codex.getShipsByClassNames).toHaveBeenCalledTimes(1);
    });

    it('caps the resolved ships but not the kind diffs', async () => {
      const many = Array.from({ length: 12_000 }, (_, i) => `I_${i}`);
      const { svc } = setup({ builds: [CUR, PREV], answer: rpcAnswer(many) });
      expect((await svc.addedClassNamesMemo('item')).length).toBe(12_000);
    });

    it('falls back to the paged diff when the function is missing, and remembers it', async () => {
      const { svc, sb } = setup({
        builds: [CUR, PREV],
        names: { 'b-cur': ['W_1', 'W_2'], 'b-prev': ['W_1'] },
      });
      expect(await svc.addedClassNamesMemo('weapon')).toEqual(['W_2']);
      expect(await svc.addedClassNamesMemo('component')).toEqual(['W_2']);
      expect(sb.calls.filter((c) => c.op === 'rpc').length).toBe(1);
    });

    it('returns [] without paging when the RPC fails for another reason', async () => {
      const { svc, sb } = setup({
        builds: [CUR, PREV],
        answer: (call) =>
          call.op === 'rpc' ? { data: null, error: { code: '57014', message: 'timeout' } } : { data: [] },
      });
      expect(await svc.addedClassNamesMemo('item')).toEqual([]);
      expect(sb.calls.filter((c) => c.op === 'from').length).toBe(0);
    });
  });
});
