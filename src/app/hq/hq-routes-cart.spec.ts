import { CART_PARAM, HQ_PICK_PARAM, cartLinkParams, hqCartLink, hqListLink, hqNachschubPickLink, hqPicksOf } from './hq-routes';

describe('hq-routes: cart and picks', () => {
  it('the cart is any page plus ?cart=1; the old wish-tab link leads there', () => {
    expect(cartLinkParams).toEqual({ [CART_PARAM]: '1' });
    expect(hqCartLink().queryParams).toEqual({ cart: '1' });
    expect(hqListLink('wish')).toEqual(hqCartLink());
    expect(hqListLink('nachschub').queryParams).toEqual({ list: 'nachschub' });
  });

  it('carries the selected positions to Planen and reads them back', () => {
    const link = hqNachschubPickLink([
      { key: 'item:klwe_rifle', qty: 2 },
      { key: 'material:alu@bp_gallant', qty: 20 },
    ]);
    expect(link.commands).toEqual(['/hq']);
    expect(link.fragment).toBe('planen');
    const v = link.queryParams![HQ_PICK_PARAM];
    expect(hqPicksOf(v)).toEqual([
      { key: 'item:klwe_rifle', qty: 2 },
      { key: 'material:alu@bp_gallant', qty: 20 },
    ]);
  });

  it('drops malformed picks', () => {
    expect(hqPicksOf('a~0|b|c~x|d~3')).toEqual([{ key: 'd', qty: 3 }]);
    expect(hqPicksOf(null)).toEqual([]);
    expect(hqPicksOf('')).toEqual([]);
  });
});
