import { encodeManualSub, manualSubOf } from '../data/hq-codex-kind';
import { parseMinQuality } from '../nachschub/nachschub-min-quality';
import { deckKindOf, sameSlot, type DeckCrate } from './hq-stock-deck';

const mk = (name: string, className: string, over: Partial<DeckCrate> = {}): DeckCrate => ({ name, className, kind: 'weapons', sub: 'primary', unit: 'pcs', ...over }) as DeckCrate;

describe('Bestand gaps', () => {
  it('I9: a manual entry carries its lane and sub-kind in the class marker', () => {
    const ref = encodeManualSub('armor', 'helmet');
    expect(manualSubOf(ref)).toEqual({ area: 'armor', sub: 'helmet' });
    expect(manualSubOf('manual:armor.cape')).toBeNull();
    expect(manualSubOf('weapon:Foo')).toBeNull();
    expect(deckKindOf({ class_name: ref, unit: 'pcs' }, new Map())).toEqual({ kind: 'armor', sub: 'helmet' });
    expect(deckKindOf({ class_name: encodeManualSub('weapons', 'sidearm'), unit: 'pcs' }, new Map())).toEqual({ kind: 'weapons', sub: 'sidearm' });
  });

  it('I15: Ersatz needs the same swap archetype, not only the same Codex slot', () => {
    const cannon = mk('Laser Cannon S3', 'KLWE_LaserCannon_S3');
    const repeater = mk('Laser Repeater S3', 'KLWE_LaserRepeater_S3');
    expect(sameSlot(cannon, mk('Other Laser Cannon', 'AMRS_LaserCannon_S3'))).toBe(true);
    expect(sameSlot(cannon, repeater)).toBe(false);
    expect(sameSlot(cannon, mk('Cannon in armor', 'x', { kind: 'armor', sub: 'helmet' }))).toBe(false);
  });

  it('I15: the minimum quality is a whole 1..1000 or nothing', () => {
    expect(parseMinQuality(700)).toBe(700);
    expect(parseMinQuality('700.4')).toBe(700);
    expect(parseMinQuality(0)).toBeNull();
    expect(parseMinQuality(1001)).toBeNull();
    expect(parseMinQuality('x')).toBeNull();
  });
});
