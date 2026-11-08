import { defaultItemScope, itemRankKindOf, itemRankRecordOf, rankItem, readItemRankMetrics, type ItemRankRecord } from './codex-item-rank';

function weapon(name: string, size: number, alpha: number | null, fireRate: number | null, speed: number | null): ItemRankRecord {
  const weaponParams: Record<string, unknown> = {};
  if (alpha != null) weaponParams['impactDamage'] = { energy: alpha };
  if (fireRate != null) weaponParams['fireRate'] = fireRate;
  if (speed != null) weaponParams['projectileSpeed'] = speed;
  const rec = itemRankRecordOf('weapon', { class_name: name, name_localized: name, size, sub_type: 'Gun' }, { weaponParams });
  if (!rec) throw new Error('weapon record');
  return rec;
}

function shield(name: string, hp: number | null, regen: number | null, damaged: number | null, downed: number | null): ItemRankRecord {
  const s: Record<string, number> = {};
  if (hp != null) s['MaxShieldHealth'] = hp;
  if (regen != null) s['MaxShieldRegen'] = regen;
  if (damaged != null) s['DamagedRegenDelay'] = damaged;
  if (downed != null) s['DownedRegenDelay'] = downed;
  const rec = itemRankRecordOf('component', { class_name: name, name_localized: name, size: 1, sub_type: 'Shield' }, { kind: 'Shield', stats: { SCItemShieldGeneratorParams: s } });
  if (!rec) throw new Error('shield record');
  return rec;
}

describe('codex-item-rank (Holotisch rail graphs for weapons and components)', () => {
  it('reads DPS, alpha, fire rate and projectile speed from a weapon payload', () => {
    const w = weapon('KLWE_A', 1, 100, 600, 1500);
    expect(w.metrics).toEqual({ alpha: 100, fireRate: 600, dps: 1000, projectileSpeed: 1500 });
  });

  it('ranks one weapon against its same-size peers on all four values', () => {
    const peers = [weapon('A', 1, 100, 600, 1500), weapon('B', 1, 50, 300, 1000), weapon('C', 1, 70, 900, 2000), weapon('D', 3, 500, 100, 500)];
    expect(defaultItemScope(peers[0], peers)).toBe('sizeClass');
    const r = rankItem(peers[0], peers, 'sizeClass');
    expect(r).not.toBeNull();
    expect(r!.axes.map((a) => a.key).sort()).toEqual(['alpha', 'dps', 'fireRate', 'projectileSpeed']);
    expect(r!.axes.find((a) => a.key === 'alpha')!.percentile).not.toBeNull();
  });

  it('draws nothing for a value the payload lacks: no zero, no axis', () => {
    const noSpeed = weapon('A', 1, 100, 600, null);
    expect(noSpeed.metrics.projectileSpeed).toBeUndefined();
    const peers = [noSpeed, weapon('B', 1, 50, 300, 1000), weapon('C', 1, 70, 900, 2000)];
    const r = rankItem(noSpeed, peers, 'all');
    expect(r!.axes.map((a) => a.key)).not.toContain('projectileSpeed');
    // a record with only one value has too few corners for a graph at all
    const sparse = weapon('E', 1, null, 600, null);
    expect(rankItem(sparse, [...peers, sparse], 'all')).toBeNull();
  });

  it('ranks a shield generator on HP and regen, a smaller delay ranking higher', () => {
    const mine = shield('S1', 2000, 50, 4, 9);
    const peers = [mine, shield('S2', 1000, 40, 8, 12), shield('S3', 3000, 70, 6, 15)];
    expect(itemRankKindOf('component', { kind: 'Shield' })).toBe('Shield');
    const r = rankItem(mine, peers, 'all')!;
    expect(r.axes.map((a) => a.key)).toEqual(['shieldHp', 'shieldRegen', 'damagedDelay', 'downedDelay']);
    const delay = r.axes.find((a) => a.key === 'damagedDelay')!;
    expect(delay.lowerIsBetter).toBeTrue();
    expect(delay.percentile!).toBeGreaterThan(50);
  });

  it('reads power output and cooling from the resource group, and sentinels and zeros are absent', () => {
    const res = { 'online.power.generateSegments': 20, 'online.em.nominal': 0, 'online.ir.nominal': 1e38 };
    const m = readItemRankMetrics('PowerPlant', { stats: { ItemResourceComponentParams: res, SHealthComponentParams: { Health: 500 } } });
    expect(m).toEqual({ powerOutput: 20, health: 500 });
    const c = readItemRankMetrics('Cooler', { stats: { ItemResourceComponentParams: { 'online.coolant.generate': 3 } } });
    expect(c).toEqual({ coolingRate: 3 });
  });

  it('has no graph for other kinds', () => {
    expect(itemRankKindOf('item', {})).toBeNull();
    expect(itemRankKindOf('component', { kind: 'Radar' })).toBeNull();
  });
});
