import type { CodexKind, CodexListRow } from './codex.service';
import {
  PolySearchHit,
  polyHitLink,
  polyMatchScore,
  rankPolyHits,
  scopeForKind,
  toPolyHit,
} from './codex-poly-search';

function row(partial: Partial<CodexListRow>): CodexListRow {
  return {
    classNameSlug: 'AEGS_Gladius',
    nameLocalized: 'Gladius',
    manufacturerCode: 'AEGS',
    size: null,
    grade: null,
    role: null,
    crewSize: null,
    weaponClass: null,
    componentKind: null,
    subType: null,
    attachType: null,
    speed: null,
    isVariant: false,
    payload: null,
    blueprintCategory: null,
    blueprintTier: null,
    craftTimeSec: null,
    ...partial,
  };
}

function hit(kind: CodexKind, partial: Partial<PolySearchHit> = {}): PolySearchHit {
  return {
    kind,
    classNameSlug: 'X',
    nameLocalized: 'X',
    manufacturerCode: null,
    size: null,
    grade: null,
    scope: scopeForKind(kind),
    ...partial,
  };
}

describe('codex-poly-search', () => {
  describe('scopeForKind', () => {
    it('tints equipment kinds cyan', () => {
      for (const k of ['ship', 'weapon', 'component', 'item', 'ammunition'] as CodexKind[]) {
        expect(scopeForKind(k)).toBe('equipment');
      }
    });

    it('tints meta kinds violet', () => {
      expect(scopeForKind('manufacturer')).toBe('meta');
      expect(scopeForKind('blueprint')).toBe('meta');
    });
  });

  describe('polyHitLink', () => {
    it('routes blueprints to the dedicated blueprint detail', () => {
      expect(polyHitLink({ kind: 'blueprint', classNameSlug: 'BP_Foo' })).toEqual([
        '/codex',
        'blueprint',
        'BP_Foo',
      ]);
    });

    it('routes every other kind to the generic detail', () => {
      expect(polyHitLink({ kind: 'ship', classNameSlug: 'AEGS_Gladius' })).toEqual([
        '/codex',
        'ship',
        'AEGS_Gladius',
      ]);
      expect(polyHitLink({ kind: 'manufacturer', classNameSlug: 'AEGS' })).toEqual([
        '/codex',
        'manufacturer',
        'AEGS',
      ]);
    });
  });

  describe('toPolyHit', () => {
    it('carries display fields and derives the scope from the kind', () => {
      const h = toPolyHit('component', row({ classNameSlug: 'C', nameLocalized: 'Cooler', size: 2, grade: 'B' }));
      expect(h.kind).toBe('component');
      expect(h.classNameSlug).toBe('C');
      expect(h.nameLocalized).toBe('Cooler');
      expect(h.size).toBe(2);
      expect(h.grade).toBe('B');
      expect(h.scope).toBe('equipment');
    });
  });

  describe('polyMatchScore', () => {
    it('scores exact > prefix > substring > fuzzy', () => {
      const base = { classNameSlug: 'AEGS_Gladius' };
      expect(polyMatchScore('gladius', hit('ship', { ...base, nameLocalized: 'Gladius' }))).toBe(4);
      expect(polyMatchScore('glad', hit('ship', { ...base, nameLocalized: 'Gladius' }))).toBe(3);
      expect(polyMatchScore('adiu', hit('ship', { ...base, nameLocalized: 'Gladius' }))).toBe(2);
      expect(polyMatchScore('zzz', hit('ship', { ...base, nameLocalized: 'Gladius' }))).toBe(1);
    });

    it('matches against the className too, not just the localized name', () => {
      expect(polyMatchScore('aegs_', hit('ship', { classNameSlug: 'AEGS_Gladius', nameLocalized: null }))).toBe(3);
    });
  });

  describe('rankPolyHits', () => {
    it('orders by match quality, then kind priority, then name', () => {
      const hits: PolySearchHit[] = [
        hit('blueprint', { classNameSlug: 'BP_G', nameLocalized: 'Cooler for Gladius' }), // substring => 2
        hit('ship', { classNameSlug: 'AEGS_Gladius', nameLocalized: 'Gladius' }), // exact => 4
        hit('weapon', { classNameSlug: 'W_G', nameLocalized: 'Gladius Cannon' }), // prefix => 3
        hit('component', { classNameSlug: 'C_G', nameLocalized: 'Gladius Cooler' }), // prefix => 3
      ];
      const ranked = rankPolyHits('gladius', hits);
      // exact ship, then the two prefix hits by kind priority (weapon < component),
      // then the substring blueprint last.
      expect(ranked.map((h) => h.kind)).toEqual(['ship', 'weapon', 'component', 'blueprint']);
    });

    it('does not mutate the input array', () => {
      const hits = [hit('ship'), hit('weapon')];
      const copy = [...hits];
      rankPolyHits('x', hits);
      expect(hits).toEqual(copy);
    });
  });
});
