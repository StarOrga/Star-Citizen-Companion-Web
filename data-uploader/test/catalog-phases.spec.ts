import { describe, it, expect } from 'vitest';
import {
  CATALOG_PHASE_ORDER,
  CATALOG_PHASE_TOTAL,
  catalogPhaseIndex,
  nextCatalogPhase,
} from '../src/lib/catalog-phases.js';

describe('CATALOG_PHASE_ORDER', () => {
  it('brackets the data phases with init first and finalize last', () => {
    expect(CATALOG_PHASE_ORDER[0]).toBe('init');
    expect(CATALOG_PHASE_ORDER[CATALOG_PHASE_ORDER.length - 1]).toBe('finalize');
  });

  it('exposes its own length as the phase total', () => {
    expect(CATALOG_PHASE_TOTAL).toBe(CATALOG_PHASE_ORDER.length);
    expect(CATALOG_PHASE_TOTAL).toBe(16);
  });

  it('has no duplicate phases (a repeat would break index math)', () => {
    expect(new Set(CATALOG_PHASE_ORDER).size).toBe(CATALOG_PHASE_ORDER.length);
  });

  it('uploads in the category-bar order: Texte, Schiffe, Komponenten, Waffen, Gegenstände', () => {
    const at = (p: string): number => catalogPhaseIndex(p) ?? -1;
    const seq = ['codex_locale_strings', 'codex_ships', 'codex_components', 'codex_weapons', 'codex_items'].map(at);
    expect(seq.every((v, i) => v > 0 && (i === 0 || v > seq[i - 1]))).toBe(true);
  });
});

describe('catalogPhaseIndex', () => {
  it('is 1-based: init is step 1, finalize is the last step', () => {
    expect(catalogPhaseIndex('init')).toBe(1);
    expect(catalogPhaseIndex('finalize')).toBe(CATALOG_PHASE_TOTAL);
  });

  it('maps a mid-order data phase to its human step number', () => {
    expect(catalogPhaseIndex('codex_locale_strings')).toBe(2);
    expect(catalogPhaseIndex('codex_ships')).toBe(4);
    expect(catalogPhaseIndex('codex_item_ports')).toBe(12);
  });

  it('returns null for an unknown phase rather than a bogus 0', () => {
    expect(catalogPhaseIndex('codex_nonsense')).toBeNull();
    expect(catalogPhaseIndex('')).toBeNull();
  });
});

describe('nextCatalogPhase', () => {
  it('starts at the first data phase when nothing is done', () => {
    expect(nextCatalogPhase([])).toBe('codex_locale_strings');
  });

  it('skips over the phases already sent, in order', () => {
    expect(nextCatalogPhase(['codex_locale_strings', 'codex_manufacturers', 'codex_ships'])).toBe('codex_components');
  });

  it('never returns init or finalize — only data phases resume', () => {
    // init is done implicitly the moment a build id exists; finalize is not a
    // resumable data phase. A run that has sent every data phase has nothing
    // left to resume into.
    const allData = CATALOG_PHASE_ORDER.filter((p) => p !== 'init' && p !== 'finalize');
    expect(nextCatalogPhase(allData)).toBeNull();
  });
});
