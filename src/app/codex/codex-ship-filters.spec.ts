import { CREW_BANDS, CREW_BAND_RANGE, SHIP_ROLES, SHIP_ROLE_CAREERS, crewBandOf, shipRoleOf } from './codex-ship-filters';

describe('codex ship filters', () => {
  it('maps every career key of build 4.10.2 to one role', () => {
    const seen = new Map<string, string>();
    for (const role of SHIP_ROLES) {
      for (const career of SHIP_ROLE_CAREERS[role]) {
        expect(seen.has(career), career).toBe(false);
        seen.set(career, role);
      }
    }
    expect(shipRoleOf('@vehicle_focus_combat')).toBe('combat');
    expect(shipRoleOf('@vehicle_focus_resources')).toBe('industrial');
    expect(shipRoleOf('@item_ShipFocus_Starter')).toBe('multirole');
    expect(shipRoleOf('@VEHICLE_FOCUS_GROUND')).toBe('ground');
    expect(shipRoleOf('@vehicle_focus_unknown')).toBeNull();
    expect(shipRoleOf(null)).toBeNull();
  });

  it('puts every crew size into exactly one band', () => {
    for (let n = 1; n <= 40; n++) {
      const hits = CREW_BANDS.filter((b) => {
        const r = CREW_BAND_RANGE[b];
        return n >= r.min && (r.max === null || n <= r.max);
      });
      expect(hits.length, String(n)).toBe(1);
    }
    expect(crewBandOf(1)).toBe('solo');
    expect(crewBandOf(3)).toBe('small');
    expect(crewBandOf(8)).toBe('medium');
    expect(crewBandOf(28)).toBe('large');
    expect(crewBandOf(0)).toBeNull();
    expect(crewBandOf(null)).toBeNull();
  });
});
