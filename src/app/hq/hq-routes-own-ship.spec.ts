import { ownShipLink } from './hq-routes';

describe('ownShipLink', () => {
  it('leads to the active variant in the Codex', () => {
    const l = ownShipLink({ shipClassName: 'AEGS_Gladius' }, [{ id: 'a', isActive: false }, { id: 'b', isActive: true }]);
    expect(l.commands).toEqual(['/codex/ship', 'AEGS_Gladius']);
    expect(l.queryParams).toEqual({ v: 'b' });
  });

  it('falls back to the first variant, then to the plain mine view', () => {
    expect(ownShipLink({ shipClassName: 'X' }, [{ id: 'a', isActive: false }]).queryParams).toEqual({ v: 'a' });
    expect(ownShipLink({ shipClassName: 'X' }, []).queryParams).toEqual({ mine: '' });
  });
});
