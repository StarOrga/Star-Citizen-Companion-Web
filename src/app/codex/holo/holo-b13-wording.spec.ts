import { rankBandOfPlace, rankRoleReadsAsGroup } from '../codex-rank';
import { tidyRoomLabel } from '../deck-plan';

describe('Holotisch wording (B13)', () => {
  it('derives the band word from the place: rank 1 is never "im Mittelfeld"', () => {
    expect(rankBandOfPlace(1, 16)).toBe('high');
    expect(rankBandOfPlace(16, 16)).toBe('low');
    expect(rankBandOfPlace(9, 26)).toBe('mid');
    expect(rankBandOfPlace(null, 16)).toBeNull();
    expect(rankBandOfPlace(1, 1)).toBeNull();
  });

  it('reads a German activity role as "Rolle …", a kind of ship as "Alle …"', () => {
    expect(rankRoleReadsAsGroup('Leichter Jäger', 'de')).toBe(true);
    expect(rankRoleReadsAsGroup('Bomber', 'de')).toBe(true);
    expect(rankRoleReadsAsGroup('Expedition', 'de')).toBe(false);
    expect(rankRoleReadsAsGroup('Schwere Reparatur', 'de')).toBe(false);
    expect(rankRoleReadsAsGroup('Expedition', 'en')).toBe(true);
  });

  it('spells every room name one way', () => {
    expect(tidyRoomLabel('TurretAccess')).toBe('Turret Access');
    expect(tidyRoomLabel('turret_access')).toBe('Turret access');
    expect(tidyRoomLabel('  Cargo   Pods ')).toBe('Cargo Pods');
    expect(tidyRoomLabel('Frachtraum')).toBe('Frachtraum');
  });
});
