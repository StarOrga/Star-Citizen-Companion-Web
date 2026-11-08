import { isVerseHome } from './shell.component';

describe('isVerseHome', () => {
  it('matches exactly /verse, ignoring query, fragment and a trailing slash', () => {
    expect(isVerseHome('/verse')).toBe(true);
    expect(isVerseHome('/verse/')).toBe(true);
    expect(isVerseHome('/verse?x=1#top')).toBe(true);
  });

  it('does not match sub-pages or other routes', () => {
    expect(isVerseHome('/verse/explorer')).toBe(false);
    expect(isVerseHome('/verse/gallery?image=x')).toBe(false);
    expect(isVerseHome('/codex')).toBe(false);
  });
});
