import type { CodexKind, CodexListRow } from './codex.service';
import {
  PolySearchHit,
  UPCOMING_HIT_KIND,
  isUpcomingHit,
  polyHitIconKind,
  polyHitLink,
  polyHitQueryParams,
  polyMatchScore,
  rankPolyHits,
  scopeForKind,
  toPolyHit,
  toUpcomingHit,
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
    manufacturerName: null,
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

    it('carries the payload manufacturer name so the hit can spell the maker out', () => {
      const h = toPolyHit(
        'ship',
        row({
          payload: {
            manufacturer: { code: 'AEG', name: { de: 'Aegis Dynamics', en: 'Aegis Dynamics', key: '@manufacturer_NameAEGS' } },
          },
        }),
      );
      expect(h.manufacturerName?.en).toBe('Aegis Dynamics');
    });

    it('leaves the manufacturer name null when the payload carries no maker', () => {
      expect(toPolyHit('ship', row({ payload: {} })).manufacturerName).toBeNull();
      expect(toPolyHit('ship', row({ payload: null })).manufacturerName).toBeNull();
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

  // ── announced (RSI-only) ships ────────────────────────────────────────────
  // Admin feedback 7b91c5ae: the Drake Arrastra is a concept hull. It is in no
  // codex_ships row of any build, so the terminal used to answer "no matches"
  // for a ship the app demonstrably knows about.
  describe('upcoming hits', () => {
    const arrastra = {
      id: 'drake-arrastra',
      name: 'Arrastra',
      manufacturer: 'Drake Interplanetary',
      manufacturerCode: 'DRAK',
    };

    it('maps an announced ship to an amber, upcoming-kind hit', () => {
      const h = toUpcomingHit(arrastra);
      expect(h.kind).toBe(UPCOMING_HIT_KIND);
      expect(h.scope).toBe('upcoming');
      expect(h.nameLocalized).toBe('Arrastra');
      expect(h.manufacturerCode).toBe('DRAK');
      expect(h.manufacturerName).toEqual({
        de: 'Drake Interplanetary',
        en: 'Drake Interplanetary',
        key: '',
      });
      // No build row backs it, so there is nothing to state.
      expect(h.size).toBeNull();
      expect(h.grade).toBeNull();
      expect(isUpcomingHit(h)).toBe(true);
    });

    it('carries no manufacturer record when RSI listed none', () => {
      expect(toUpcomingHit({ ...arrastra, manufacturer: null }).manufacturerName).toBeNull();
      expect(toUpcomingHit({ ...arrastra, manufacturer: '  ' }).manufacturerName).toBeNull();
    });

    it('links to the upcoming category with the name seeded as ?q=', () => {
      const h = toUpcomingHit(arrastra);
      expect(polyHitLink(h)).toEqual(['/codex', 'upcoming']);
      expect(polyHitQueryParams(h)).toEqual({ q: 'Arrastra' });
    });

    it('gives non-upcoming hits no query params', () => {
      expect(polyHitQueryParams(hit('ship', { nameLocalized: 'Gladius' }))).toBeNull();
      expect(polyHitQueryParams(hit('blueprint'))).toBeNull();
    });

    it('borrows the ship glyph — an announced hull is still a ship', () => {
      expect(polyHitIconKind(toUpcomingHit(arrastra))).toBe('ship');
      expect(polyHitIconKind(hit('weapon'))).toBe('weapon');
    });

    it('scores on the name only — the slug is an opaque feed id', () => {
      // 'dr' occurs in the id 'drake-arrastra' but not in the name: a substring
      // match on the id must not inflate the score to 2.
      expect(polyMatchScore('dr', toUpcomingHit(arrastra))).toBe(1);
      expect(polyMatchScore('arrastra', toUpcomingHit(arrastra))).toBe(4);
    });

    it('surfaces the announced ship when nothing in the build matches better', () => {
      const ranked = rankPolyHits('arrastra', [
        // What the trigram query actually returns for "arrastra": fuzzy noise.
        hit('ship', { classNameSlug: 'DRAK_Caterpillar', nameLocalized: 'Caterpillar' }),
        hit('weapon', { classNameSlug: 'W_Arrow', nameLocalized: 'Arrow' }),
        toUpcomingHit(arrastra),
      ]);
      expect(ranked[0].kind).toBe(UPCOMING_HIT_KIND);
      expect(ranked[0].nameLocalized).toBe('Arrastra');
    });

    it('still lets a ship you can fly today lead on an equal match', () => {
      const ranked = rankPolyHits('vulture', [
        toUpcomingHit({ ...arrastra, id: 'drake-vulture-x', name: 'Vulture' }),
        hit('ship', { classNameSlug: 'DRAK_Vulture', nameLocalized: 'Vulture' }),
      ]);
      expect(ranked.map((h) => h.kind)).toEqual(['ship', UPCOMING_HIT_KIND]);
    });
  });
});
