// The power dock's draft-only mirrors (MASTER §8, D §5). Kept in their own spec
// so `codex-loadout-draft.spec.ts` stays the regression net for the loadout
// param it must never break.
import {
  DEFAULT_POWER_DRAFT,
  decodeDraftParam,
  decodePowerParam,
  encodePowerParam,
  parseLocalPowerDraft,
  serializeLocalPowerDraft,
  LOCAL_POWER_STORAGE_KEY,
} from './codex-loadout-draft';

describe('power URL param', () => {
  it('stays out of the URL while the dock is untouched', () => {
    expect(encodePowerParam(DEFAULT_POWER_DRAFT)).toBeNull();
  });

  it('round-trips cut groups, mode, preset and dock position', () => {
    const state = {
      cutGroups: ['weapons', 'radar'],
      levels: {},
      mode: 'nav' as const,
      preset: 'stealth' as const,
      dock: 'left' as const,
    };
    const raw = encodePowerParam(state)!;
    // no pins → byte-for-byte the p1 format every already-shared link uses
    expect(raw).toBe('p1.nav.stealth.left.weapons-radar');
    expect(decodePowerParam(raw)).toEqual(state);
  });

  it('carries pinned levels in an optional sixth part (590230e3)', () => {
    const state = {
      cutGroups: [],
      levels: { shields: 2, coolers: 6 },
      mode: 'scm' as const,
      preset: 'auto' as const,
      dock: 'center' as const,
    };
    const raw = encodePowerParam(state)!;
    expect(raw).toBe('p1.scm.auto.center..coolers~6-shields~2');
    expect(decodePowerParam(raw)).toEqual(state);
    // a five-part link from before pins existed decodes with no pins
    expect(decodePowerParam('p1.scm.auto.center.weapons')!.levels).toEqual({});
    // junk pins are dropped, not fatal
    expect(decodePowerParam('p1.scm.auto.center..shields~x-coolers~-life-radar~2')!.levels).toEqual({ radar: 2 });
  });

  it('accepts the inline dock position (the PO addition) in a stored draft', () => {
    expect(decodePowerParam('p1.scm.auto.inline.')!.dock).toBe('inline');
  });

  it('rejects a malformed or foreign-version param instead of throwing', () => {
    expect(decodePowerParam(null)).toBeNull();
    expect(decodePowerParam('garbage')).toBeNull();
    expect(decodePowerParam('p9.scm.auto.center.')).toBeNull();
    expect(decodePowerParam('p1.warp.auto.center.')).toBeNull();
    expect(decodePowerParam('p1.scm.auto.middle.')).toBeNull();
  });

  it('leaves the existing loadout param decodable — old links keep working', () => {
    const decoded = decodeDraftParam('v1.build-7.hardpoint_weapon_left~KLWE_Panther');
    expect(decoded).toEqual({
      version: 'v1',
      buildId: 'build-7',
      entries: [['hardpoint_weapon_left', 'KLWE_Panther']],
    });
  });
});

describe('power localStorage mirror', () => {
  it('has its own key, separate from the loadout draft', () => {
    expect(LOCAL_POWER_STORAGE_KEY).toBe('scc-codex-power:v1');
  });

  it('round-trips through storage', () => {
    const raw = serializeLocalPowerDraft('CNOU_Nomad', {
      cutGroups: ['shields'],
      levels: { coolers: 5 },
      mode: 'scm',
      preset: 'auto',
      dock: 'right',
    });
    expect(parseLocalPowerDraft(raw)).toEqual({
      shipClassName: 'CNOU_Nomad',
      cutGroups: ['shields'],
      levels: { coolers: 5 },
      mode: 'scm',
      preset: 'auto',
      dock: 'right',
    });
  });

  it('reads a stored draft from before pins existed', () => {
    const raw = JSON.stringify({ shipClassName: 'CNOU_Nomad', cutGroups: ['radar'], mode: 'nav', preset: 'auto', dock: 'left' });
    expect(parseLocalPowerDraft(raw)).toEqual({
      shipClassName: 'CNOU_Nomad',
      cutGroups: ['radar'],
      levels: {},
      mode: 'nav',
      preset: 'auto',
      dock: 'left',
    });
  });

  it('returns null for junk', () => {
    expect(parseLocalPowerDraft('{')).toBeNull();
    expect(parseLocalPowerDraft('{"mode":"scm"}')).toBeNull();
  });
});
