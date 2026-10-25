import { isVerseHome } from './shell.component';

describe('isVerseHome', () => {
  it('matches exactly /verse, ignoring query, fragment and a trailing slash', () => {
    expect(isVerseHome('/verse')).toBeTrue();
    expect(isVerseHome('/verse/')).toBeTrue();
    expect(isVerseHome('/verse?x=1#top')).toBeTrue();
  });

  it('does not match sub-pages or other routes', () => {
    expect(isVerseHome('/verse/explorer')).toBeFalse();
    expect(isVerseHome('/verse/gallery?image=x')).toBeFalse();
    expect(isVerseHome('/codex')).toBeFalse();
  });
});
