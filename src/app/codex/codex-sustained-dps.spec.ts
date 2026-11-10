import { sustainedDps } from './codex-sustained-dps';

describe('codex-sustained-dps — sustainedDps (#343)', () => {
  it('energy weapon: the pool drains, regen waits for its cooldown, then refills', () => {
    // KLWE-like repeater: 750 rpm = 12.5 shots/s, burst 545.63 DPS.
    // Pool 50 at 1 per shot → 4 s firing; 0.5 s cooldown + 50 / 25 per s = 2.5 s down.
    const r = sustainedDps(545.63, 750, {
      'regen.maxAmmoLoad': 50,
      'regen.requestedRegenPerSec': 25,
      'regen.regenerationCooldown': 0.5,
      'regen.regenerationCostPerBullet': 1,
    });
    expect(r.limit).toBe('energyPool');
    expect(r.fireTime).toBeCloseTo(4, 6);
    expect(r.downtime).toBeCloseTo(2.5, 6);
    expect(r.value).toBe(335.77); // 545.63 × 4 / 6.5
  });

  it('ballistic weapon with a reload: magazine time over magazine time + reload', () => {
    // 200 rpm = 3.33 shots/s, 100-round magazine → 30 s firing, 5 s reload.
    const r = sustainedDps(455.4, 200, { ammoCapacity: 100, reloadTime: 5 });
    expect(r.limit).toBe('magazine');
    expect(r.fireTime).toBeCloseTo(30, 6);
    expect(r.value).toBe(390.34); // 455.4 × 30 / 35
  });

  it('heat: fires until overheat, then waits out the fix time', () => {
    // 200 rpm, 3 heat per shot → 10 heat/s; 100 headroom → 10 s, fix 4 s.
    const r = sustainedDps(455.4, 200, {
      heatPerShot: 3,
      'heat.overheatTemperature': 100,
      'heat.overheatFixTime': 4,
    });
    expect(r.limit).toBe('heat');
    expect(r.value).toBe(325.29); // 455.4 × 10 / 14
  });

  it('several limits: the binding (lowest) cycle wins', () => {
    const r = sustainedDps(455.4, 200, {
      ammoCapacity: 100,
      reloadTime: 5,
      heatPerShot: 3,
      'heat.overheatTemperature': 100,
      'heat.overheatFixTime': 4,
    });
    expect(r.limit).toBe('heat');
    expect(r.value).toBe(325.29);
  });

  it('missing data: no cycle means no value — never a copy of burst', () => {
    // Today's payload: a magazine size but no reload time, no regen, no heat model.
    expect(sustainedDps(455.4, 200, { fireRate: 200, ammoCapacity: 324, heatPerShot: 3 })).toEqual({
      value: null,
      limit: null,
      fireTime: null,
      downtime: null,
    });
    expect(sustainedDps(545.63, 750, {}).value).toBeNull();
    expect(sustainedDps(null, 750, { 'regen.maxAmmoLoad': 50, 'regen.requestedRegenPerSec': 25 }).value).toBeNull();
    expect(sustainedDps(545.63, null, { 'regen.maxAmmoLoad': 50, 'regen.requestedRegenPerSec': 25 }).value).toBeNull();
  });
});
