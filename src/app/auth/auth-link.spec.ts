import { captureAuthLinkType, capturedAuthLinkType, readAuthLinkType, resetCapturedAuthLinkType } from './auth-link';

describe('auth-link', () => {
  afterEach(() => resetCapturedAuthLinkType());

  it('reads the type out of the implicit-grant fragment', () => {
    expect(
      readAuthLinkType('https://app.example/#access_token=abc&expires_in=3600&type=invite'),
    ).toBe('invite');
    expect(readAuthLinkType('https://app.example/#access_token=abc&type=recovery')).toBe('recovery');
  });

  it('reads the type out of the query string too', () => {
    expect(readAuthLinkType('https://app.example/set-password?type=recovery')).toBe('recovery');
  });

  it('ignores a query string that belongs to the fragment', () => {
    // Everything after '#' is the fragment — a '?' inside it is not a query.
    expect(readAuthLinkType('https://app.example/#/route?type=invite')).toBeNull();
  });

  it('is null for an ordinary visit and for unrelated types', () => {
    expect(readAuthLinkType('https://app.example/news')).toBeNull();
    expect(readAuthLinkType('https://app.example/news?tab=rsi#top')).toBeNull();
    expect(readAuthLinkType('https://app.example/#type=signup')).toBeNull();
  });

  it('captures once — a later, already-cleaned URL cannot erase the answer', () => {
    expect(captureAuthLinkType('https://app.example/#type=invite')).toBe('invite');
    // supabase-js strips the fragment right after consuming it; a second read
    // must not turn the visit back into an ordinary one.
    expect(captureAuthLinkType('https://app.example/news')).toBe('invite');
    expect(capturedAuthLinkType()).toBe('invite');
  });
});
