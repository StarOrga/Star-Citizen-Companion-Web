import { ROLE_SLOT_SUGGESTIONS, SLOT_WEAPON_FACET, SlotCandidate, slotAccepts, slotHasArchiveSource } from './hangar.types';

// Honest slot fitting (archive audit 2026-09-25) as one table: which on-foot
// archive piece may go into which non-anatomical set position.
describe('slotAccepts', () => {
  const piece = (className: string, subType: string | null): SlotCandidate => ({ className, subType });

  const RIFLE = piece('behr_rifle_ballistic_01', 'Medium');
  const LMG = piece('ksar_lmg_ballistic_01', 'Large');
  const PISTOL = piece('klwe_pistol_energy_01', 'Small');
  const MEDGUN = piece('crlf_medgun_01', 'Small');
  const MULTITOOL = piece('grin_multitool_01', 'Gadget');
  const MINING = piece('grin_multitool_01_default_mining', 'Gadget');
  const HEALING = piece('grin_multitool_01_default_healing', 'Gadget');
  const CAMBIO = piece('grin_salvage_repair_01', 'Gadget');
  const TRACTOR = piece('grin_tractor_01', 'Gadget');
  const KNIFE = piece('kdid_knife_01', 'Knife');
  const GRENADE = piece('bhnd_grenade_frag_01', 'Grenade');
  const ALL = { RIFLE, LMG, PISTOL, MEDGUN, MULTITOOL, MINING, HEALING, CAMBIO, TRACTOR, KNIFE, GRENADE };

  const accepted = (slot: string): string[] =>
    Object.entries(ALL)
      .filter(([, p]) => slotAccepts(slot, p))
      .map(([name]) => name);

  it('takes long guns as primary, any gun but the medgun as secondary, pistols as sidearm', () => {
    expect(accepted('primary')).toEqual(['RIFLE', 'LMG']);
    expect(accepted('secondary')).toEqual(['RIFLE', 'LMG', 'PISTOL']);
    expect(accepted('sidearm')).toEqual(['PISTOL']);
  });

  it('gives the knife and the grenades positions of their own', () => {
    expect(accepted('melee')).toEqual(['KNIFE']);
    expect(accepted('throwable')).toEqual(['GRENADE']);
    expect(ROLE_SLOT_SUGGESTIONS.fps).toContain('melee');
    expect(ROLE_SLOT_SUGGESTIONS.fps).toContain('throwable');
  });

  it('fills the tool positions with the multi-tool and the tools made for them', () => {
    expect(accepted('multitool')).toEqual(['MULTITOOL', 'MINING', 'HEALING']);
    expect(accepted('mining-attachment')).toEqual(['MULTITOOL', 'MINING', 'HEALING']);
    expect(accepted('salvage-attachment')).toEqual(['MULTITOOL', 'MINING', 'HEALING', 'CAMBIO']);
    expect(accepted('repair-attachment')).toEqual(['MULTITOOL', 'MINING', 'HEALING', 'CAMBIO']);
    expect(accepted('tractor')).toEqual(['TRACTOR']);
    expect(accepted('gadget')).toEqual(['MULTITOOL', 'MINING', 'HEALING', 'CAMBIO', 'TRACTOR']);
  });

  it('puts only the ParaMed into the medgun slot', () => {
    expect(accepted('medgun')).toEqual(['MEDGUN']);
  });

  it('refuses everything for a slot it does not know, and survives a missing sub-type', () => {
    expect(accepted('Grenade belt')).toEqual([]);
    expect(slotAccepts('primary', piece('odd_weapon_01', null))).toBeFalse();
  });

  it('narrows every facet-backed slot to a weapon type that slot actually takes', () => {
    for (const [slot, facet] of Object.entries(SLOT_WEAPON_FACET)) {
      const fits = Object.values(ALL).some((p) => p.subType === facet && slotAccepts(slot, p));
      expect(fits).withContext(`${slot} → ${facet}`).toBeTrue();
    }
  });

  it('marks only the medpen as a position the archive cannot fill', () => {
    const slots = new Set(Object.values(ROLE_SLOT_SUGGESTIONS).flat());
    expect([...slots].filter((s) => !slotHasArchiveSource(s))).toEqual(['medpen']);
  });
});
