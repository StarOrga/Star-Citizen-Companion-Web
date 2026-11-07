import { hqShipLink, ownShipLink, ownVariantLink, personalItemLink } from './hq-routes';

describe('ownShipLink', () => {
  const gladius = { id: 's1', shipClassName: 'AEGS_Gladius' };

  it('leads to the active variant in the Codex', () => {
    const l = ownShipLink(gladius, [{ id: 'a', isActive: false }, { id: 'b', isActive: true }]);
    expect(l.commands).toEqual(['/codex/ship', 'AEGS_Gladius']);
    expect(l.queryParams).toEqual({ v: 'b' });
  });

  it('falls back to the first variant, then to the plain mine view', () => {
    expect(ownShipLink({ id: 'x', shipClassName: 'X' }, [{ id: 'a', isActive: false }]).queryParams).toEqual({ v: 'a' });
    expect(ownShipLink({ id: 'x', shipClassName: 'X' }, []).queryParams).toEqual({ mine: '' });
  });

  describe('shell beta (hq)', () => {
    it('leads to the ship\'s HQ page with its active variant', () => {
      const l = ownShipLink(gladius, [{ id: 'a', isActive: false }, { id: 'b', isActive: true }], true);
      expect(l.commands).toEqual(['/hq/hangar', 's1']);
      expect(l.queryParams).toEqual({ v: 'b' });
    });

    it('is the bare HQ page for a ship without variants', () => {
      const l = ownShipLink(gladius, [], true);
      expect(l.commands).toEqual(['/hq/hangar', 's1']);
      expect(l.queryParams).toEqual({});
    });

    it('ownVariantLink / hqShipLink / personalItemLink follow the same switch', () => {
      expect(ownVariantLink(gladius, 'c', true)).toEqual(hqShipLink('s1', 'c'));
      expect(ownVariantLink(gladius, 'c').commands).toEqual(['/codex/ship', 'AEGS_Gladius']);
      expect(personalItemLink('item', 'X', true).queryParams).toEqual({});
      expect(personalItemLink('item', 'X').queryParams).toEqual({ mine: '' });
    });
  });
});
