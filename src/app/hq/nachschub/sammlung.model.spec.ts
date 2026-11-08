import { NEWS_COPY_MAX, bookmarksToCopy, isCollected } from './sammlung.model';

describe('sammlung.model', () => {
  it('copies only what the account does not have yet, de-duplicated', () => {
    expect(bookmarksToCopy('["a","b","a"," c ",""]', new Set(['b']))).toEqual(['a', 'c']);
  });

  it('ignores unreadable, non-array and non-string input', () => {
    expect(bookmarksToCopy(null, new Set())).toEqual([]);
    expect(bookmarksToCopy('{bad', new Set())).toEqual([]);
    expect(bookmarksToCopy('{"a":1}', new Set())).toEqual([]);
    expect(bookmarksToCopy('[1,null,"x"]', new Set())).toEqual(['x']);
  });

  it('caps the copy at the table limit and drops over-long ids', () => {
    const many = JSON.stringify(Array.from({ length: NEWS_COPY_MAX + 20 }, (_, i) => `n${i}`));
    expect(bookmarksToCopy(many, new Set()).length).toBe(NEWS_COPY_MAX);
    expect(bookmarksToCopy(JSON.stringify(['x'.repeat(301)]), new Set())).toEqual([]);
  });

  it('news and gallery are collected by the account sets, blueprints and Ruf are not decided here', () => {
    const sets = { news: new Set(['n1']), gallery: new Set(['g1']) };
    expect(isCollected('news', 'n1', sets)).toBeTrue();
    expect(isCollected('gallery', 'g1', sets)).toBeTrue();
    expect(isCollected('news', 'g1', sets)).toBeFalse();
    expect(isCollected('rep', 'x', sets)).toBeFalse();
  });
});
