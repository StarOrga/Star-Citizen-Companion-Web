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
          const all = names[buildIdOf(call) ?? ''] ?? [];
          const [from, to] = (chainArgs(call, 'range') ?? [0, 999]) as [number, number];
          return { data: all.slice(from, to + 1).map((class_name) => ({ class_name })) };
        }),
    });
    const codex = {
      recentLiveBuilds: jasmine.createSpy('recentLiveBuilds').and.resolveTo(opts.builds),
      getShipsByClassNames: jasmine
        .createSpy('getShipsByClassNames')
        .and.callFake(async (cns: string[]) => new Map(cns.map((cn) => [cn, row(cn)] as const))),
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
    expect(codex.getShipsByClassNames).toHaveBeenCalledOnceWith(['KRIG_S65_Stingray', 'RSI_Zeus']);
  });

  it('applies the default browse filters and selects only class_name', async () => {
    const { svc, sb } = setup({ builds: [CUR, PREV], names: { 'b-cur': ['A'], 'b-prev': [] } });
    await svc.addedShips();
    expect(sb.calls.length).toBe(2);
    for (const call of sb.calls) {
      expect(call.target).toBe('codex_ships');
      expect(chainArgs(call, 'select')).toEqual(['class_name']);
      expect(call.chain).toContain(['eq', ['is_variant', false]]);
      expect(call.chain).toContain(['or', ['name_localized.is.null,name_localized.not.like.!*']]);
      expect(call.chain).toContain(['not', ['class_name', 'ilike', 'SalvageableDebris*']]);
      expect(call.chain).toContain(['not', ['class_name', 'ilike', 'Orbital_Sentry*']]);
      expect(call.chain).toContain(['not', ['class_name', 'ilike', 'probe_*']]);
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
});
