import { voteOrder } from './community-verdict.component';

describe('voteOrder', () => {
  it('is stable for the same id', () => {
    expect(voteOrder('user-1')).toEqual(voteOrder('user-1'));
  });
  it('is always a permutation of the three words', () => {
    for (const id of ['a', 'user-1', '7f3c9a10-2b4d-4e5f-8a6b-1c2d3e4f5a6b', 'zz']) {
      expect([...voteOrder(id)].sort()).toEqual(['instabil', 'stabil', 'wackelig']);
    }
  });
  it('keeps the scale order for anonymous users', () => {
    expect(voteOrder(null)).toEqual(['stabil', 'wackelig', 'instabil']);
  });
  it('differs between accounts', () => {
    const orders = new Set(Array.from({ length: 30 }, (_, i) => voteOrder('user-' + i).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});
