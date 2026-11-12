import { CODEX_DETAIL_WARMER, CODEX_LANDING_WARMER, CODEX_SHIP_OUTLINE_WARMER, codexDetailOf } from './codex-prefetch';
import { arrivalThumbOf } from './ship-arrival/arrival-thumb';

describe('codex prefetch warmers', () => {
  it('reads kind and class of a detail path, never a static Codex page', () => {
    expect(codexDetailOf('/codex/ship/AEGS_Gladius')).toEqual(['ship', 'AEGS_Gladius']);
    expect(codexDetailOf('/codex/weapon/a%20b')).toEqual(['weapon', 'a b']);
    expect(codexDetailOf('/codex/blueprint/x')).toBeNull();
    expect(codexDetailOf('/codex/upcoming/12')).toBeNull();
    expect(codexDetailOf('/codex/foo/x')).toBeNull();
    expect(codexDetailOf('/codex')).toBeNull();
  });

  it('routes each path to the right warmer', () => {
    expect(CODEX_LANDING_WARMER.matches('/codex')).toBe(true);
    expect(CODEX_LANDING_WARMER.matches('/codex/ship/x')).toBe(false);
    expect(CODEX_SHIP_OUTLINE_WARMER.matches('/codex/ship/x')).toBe(true);
    expect(CODEX_SHIP_OUTLINE_WARMER.matches('/codex/weapon/x')).toBe(false);
    expect(CODEX_DETAIL_WARMER.matches('/codex/weapon/x')).toBe(true);
    expect(CODEX_DETAIL_WARMER.trigger).toBe('press');
    expect(CODEX_DETAIL_WARMER.key?.('/codex/ship/x')).toBe('ship:x');
  });

  it('turns the detail silhouette into a nose-up arrival thumb', () => {
    expect(arrivalThumbOf(null)).toBeNull();
    expect(arrivalThumbOf({ viewBox: '', path: 'M0 0' })).toBeNull();
    const t = arrivalThumbOf({ viewBox: '0 0 100 40', path: 'M0 0L1 1' });
    expect(t?.path).toBe('M0 0L1 1');
    expect(t?.transform).toContain('rotate(90');
  });
});
