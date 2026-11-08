import { searchContextOf } from '../../shell/fusion-bar/search-context';
import { missionDescription } from '../mission-detail.component';
import type { PolyHitKind, PolySearchHit } from '../codex-poly-search';
import { CodexSearchGroup } from './codex-search-model';
import { composeSearchResult } from './search-compose';
import { SearchChip } from './search-result-model';
import { MissionRpcRow, mapMissionRows, missionTarget } from './search-sources';

function group(kind: PolyHitKind, hits: PolySearchHit[]): CodexSearchGroup {
  return { kind, hits, total: hits.length, count: hits.length, countIsFloor: false, folded: 0, foldedIsFloor: false, more: null };
}
const ship: PolySearchHit = {
  kind: 'ship', classNameSlug: 'C1', nameLocalized: 'Cargo Star', manufacturerCode: null, manufacturerName: null,
  size: null, grade: null, scope: 'equipment',
};
const rpc = (over: Partial<MissionRpcRow> = {}): MissionRpcRow => ({
  class_name: 'PU_Haul_A', title: 'Cargo Haul', type_name: 'Hauling', giver_name: 'Covalex',
  location_name: 'microTech', reward_amount: 12500, variants: 807, total: 3, ...over,
});

describe('missions as a search source', () => {
  it('maps search_missions rows to /codex/mission/:className targets and drops junk', () => {
    const r = mapMissionRows([rpc(), rpc({ class_name: '', title: 'x' }), rpc({ class_name: 'B', title: '  ' }), rpc({ class_name: 'C', reward_amount: 0, variants: null, type_name: ' ' })]);
    expect(r.rows.map((x) => x.className)).toEqual(['PU_Haul_A', 'C']);
    expect(r.rows[0].target.link).toEqual(['/codex', 'mission', 'PU_Haul_A']);
    expect(r.rows[0].variants).toBe(807);
    expect(r.rows[1].reward).toBeNull();
    expect(r.rows[1].variants).toBe(1);
    expect(r.rows[1].typeName).toBeNull();
    expect(r.total).toBe(3);
    expect(mapMissionRows(null)).toEqual({ rows: [], total: 0 });
    expect(missionTarget('X').queryParams).toBeNull();
  });

  it('adds a Missionen group after the catalog: CTA Zum Einsatz, no icons, no "Alle N"', () => {
    const missions = mapMissionRows([rpc(), rpc({ class_name: 'Z', title: 'Zeta' })]);
    const r = composeSearchResult({
      term: 'cargo', signedIn: true, groups: [group('ship', [ship])], context: searchContextOf('/codex'), chips: [], missions,
    });
    expect(r.groups.map((g) => g.id)).toEqual(['ship', 'mission']);
    const g = r.groups[1];
    expect(g.kind).toBeNull();
    expect(g.moreTarget).toBeNull();
    expect(g.total).toBe(3);
    for (const row of g.rows) {
      expect(row.cta?.id).toBe('toEinsatz');
      expect(row.icons).toEqual({ wishlist: false, lager: false });
    }
    expect(r.empty).toBeFalse();
  });

  it('a chip that names other groups keeps missions out', () => {
    const chip: SearchChip = { id: 'route:ship', source: 'route', labelKey: 'x', labelParams: null, filter: { groups: ['ship'] }, switchable: false };
    const r = composeSearchResult({
      term: 'cargo', signedIn: true, groups: [group('ship', [ship])], context: searchContextOf('/codex'), chips: [chip], missions: mapMissionRows([rpc()]),
    });
    expect(r.groups.some((g) => g.id === 'mission')).toBeFalse();
  });

  it('renders CIG descriptions with line breaks and marked runtime placeholders', () => {
    expect(missionDescription('Stolen from ~mission(Location|address).\\n\\nBring it to ~mission(DropOff).')).toEqual([
      'Stolen from ‹Location›.',
      'Bring it to ‹DropOff›.',
    ]);
    expect(missionDescription(null)).toEqual([]);
  });
});
