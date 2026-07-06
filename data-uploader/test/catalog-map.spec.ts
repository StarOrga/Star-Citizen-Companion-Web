import { describe, it, expect } from 'vitest';
import {
  localizedName,
  isVariant,
  manuCode,
  makeTagger,
  collectStrings,
  collectPorts,
  collectIngredients,
  dedupeStrings,
  hasViableCatalog,
  mapShips,
  mapManufacturers,
  type Nat,
  type StringRow,
  type PortRow,
} from '../src/lib/catalog-map.js';

const nat: Nat = { channel: 'LIVE', patch_version: '4.8.0', build_number: 'desktop' };
const BUILD = 'build-123';
const tag = makeTagger(BUILD, nat);

describe('localizedName', () => {
  it('prefers EN, falls back to DE, drops unresolved @keys', () => {
    expect(localizedName({ en: 'Gladius', de: 'Gladius' })).toBe('Gladius');
    expect(localizedName({ en: '', de: 'Adler' })).toBe('Adler');
    expect(localizedName({ en: '@item_Name', de: '' })).toBeNull();
    expect(localizedName(null)).toBeNull();
  });
});

describe('isVariant', () => {
  it('flags AI/template/unmanned variants', () => {
    expect(isVariant('ANVL_Gladius_PU_AI_CRIM')).toBe(true);
    expect(isVariant('MASTER_Something')).toBe(true);
    expect(isVariant('AEGS_Gladius')).toBe(false);
  });
});

describe('manuCode', () => {
  it('reads the nested manufacturer code or null', () => {
    expect(manuCode({ manufacturer: { code: 'AEGS' } })).toBe('AEGS');
    expect(manuCode({})).toBeNull();
    expect(manuCode({ manufacturer: 'AEGS' })).toBeNull();
  });
});

describe('mapShips', () => {
  it('produces a build-tagged codex_ships row with derived fields', () => {
    const rows = mapShips(
      [{ className: 'AEGS_Gladius', guid: 'g1', role: 'fighter', crew: { size: 1 }, name: { en: 'Gladius' }, manufacturer: { code: 'AEGS' } }],
      tag,
    );
    expect(rows[0]).toMatchObject({
      build_id: BUILD,
      channel: 'LIVE',
      patch_version: '4.8.0',
      build_number: 'desktop',
      class_name: 'AEGS_Gladius',
      entity_kind: 'ship',
      manufacturer_code: 'AEGS',
      crew_size: 1,
      is_variant: false,
      name_localized: 'Gladius',
    });
    expect(rows[0].payload).toBeTruthy();
  });
});

describe('mapManufacturers', () => {
  it('maps className + code + localized name', () => {
    const rows = mapManufacturers([{ className: 'AEGS', code: 'AEGS', name: { en: 'Aegis Dynamics' } }], tag);
    expect(rows[0]).toMatchObject({ class_name: 'AEGS', manufacturer_code: 'AEGS', name_localized: 'Aegis Dynamics' });
  });
});

describe('collectStrings + dedupe', () => {
  it('collects en/de per field and dedupes by class|lang|field', () => {
    const out: StringRow[] = [];
    collectStrings(out, BUILD, nat, 'AEGS_Gladius', 'ship', [
      { field: 'name', loc: { en: 'Gladius', de: 'Gladius', key: '@k' } },
      { field: 'description', loc: { en: 'A fighter' } },
    ]);
    // name → en+de (2), description → en (1) = 3
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ build_id: BUILD, entity_class_name: 'AEGS_Gladius', lang: 'en', field: 'name', value: 'Gladius', loc_key: '@k' });

    // add a duplicate (class|en|name) — dedupe keeps last
    collectStrings(out, BUILD, nat, 'AEGS_Gladius', 'ship', [{ field: 'name', loc: { en: 'Gladius Mk II' } }]);
    const deduped = dedupeStrings(out);
    const enName = deduped.find((s) => s.lang === 'en' && s.field === 'name');
    expect(enName?.value).toBe('Gladius Mk II');
    expect(deduped).toHaveLength(3);
  });
});

describe('collectPorts', () => {
  it('emits an indexed port row per hardpoint', () => {
    const out: PortRow[] = [];
    collectPorts(out, BUILD, nat, 'AEGS_Gladius', 'ship', [
      { portName: 'hardpoint_weapon_left', minSize: 1, maxSize: 3, types: ['WeaponGun'], flags: [] },
    ]);
    expect(out[0]).toMatchObject({
      parent_class_name: 'AEGS_Gladius', parent_kind: 'ship', port_name: 'hardpoint_weapon_left',
      min_size: 1, max_size: 3, types: ['WeaponGun'], port_index: 0,
    });
    // non-array itemPorts is a no-op
    collectPorts(out, BUILD, nat, 'X', 'ship', undefined);
    expect(out).toHaveLength(1);
  });
});

describe('hasViableCatalog', () => {
  it('is viable when ships or manufacturers were produced', () => {
    expect(hasViableCatalog({ ships: 308, manufacturers: 0 })).toBe(true);
    expect(hasViableCatalog({ ships: 0, manufacturers: 12 })).toBe(true);
  });
  it('is NOT viable when both core kinds are empty (protects is_current)', () => {
    expect(hasViableCatalog({ ships: 0, manufacturers: 0, weapons: 5 })).toBe(false);
    expect(hasViableCatalog({})).toBe(false);
  });
});

describe('collectIngredients', () => {
  it('flattens blueprint ingredients with an index', () => {
    const rows = collectIngredients(BUILD, nat, [
      { className: 'bp_1', ingredients: [{ className: 'ore_a', quantity: 2 }, { className: 'ore_b', quantity: 5 }] },
      { className: 'bp_2' }, // no ingredients → skipped
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ blueprint_class_name: 'bp_1', ingredient_class_name: 'ore_a', quantity: 2, ingredient_index: 0 });
    expect(rows[1]).toMatchObject({ ingredient_class_name: 'ore_b', ingredient_index: 1 });
  });
});
