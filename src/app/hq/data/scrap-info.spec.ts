import { scrapInfo, scrapInfoOf, type ScrapRow } from './scrap-info';

describe('scrapInfo', () => {
  it('is unknown without a row or without data (never a guessed yes/no)', () => {
    expect(scrapInfo(undefined)).toEqual({ state: 'unknown' });
    expect(scrapInfo(null)).toEqual({ state: 'unknown' });
    expect(scrapInfo({ dismantlable: null, dismantle_yield: null })).toEqual({ state: 'unknown' });
    expect(scrapInfo({ dismantle_yield: [] })).toEqual({ state: 'unknown' });
  });

  it('is no only on an explicit false', () => {
    expect(scrapInfo({ dismantlable: false })).toEqual({ state: 'no' });
  });

  it('is yes with the yield lines, dropping malformed entries', () => {
    const info = scrapInfo({
      dismantlable: true,
      dismantle_yield: [{ material: 'MAT_Iron', amount: 2.5 }, { material: 'x' }, 'junk', { amount: 1 }],
    });
    expect(info).toEqual({ state: 'yes', yield: [{ material: 'MAT_Iron', amount: 2.5 }] });
  });

  it('is yes without lines when the record only flags it', () => {
    expect(scrapInfo({ dismantlable: true })).toEqual({ state: 'yes' });
  });

  it('a recorded yield implies yes even without the flag', () => {
    expect(scrapInfo({ dismantle_yield: [{ material: 'MAT_Tungsten', amount: 1 }] }).state).toBe('yes');
  });

  it('looks an item up by class name in an index', () => {
    const index = new Map<string, ScrapRow>([['helmet_01', { dismantlable: false }]]);
    expect(scrapInfoOf('helmet_01', index).state).toBe('no');
    expect(scrapInfoOf('other', index).state).toBe('unknown');
    expect(scrapInfoOf(null, index).state).toBe('unknown');
  });
});
