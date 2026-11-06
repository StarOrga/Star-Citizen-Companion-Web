import { LIVE_PRESENCE_MAX_AGE_MS, disconnectedInSession, formatLocationName, isGameLive, presenceAt, sessionEndedSince } from './hq-live.util';

describe('formatLocationName', () => {
  it('drops the body prefix and spaces out camelCase', () => {
    expect(formatLocationName('Stanton4_NewBabbage')).toBe('New Babbage');
    expect(formatLocationName('Stanton1_Lorville')).toBe('Lorville');
    expect(formatLocationName('Pyro_RuinStation')).toBe('Ruin Station');
    expect(formatLocationName('Stanton2b_Daymar_Outpost')).toBe('Daymar Outpost');
  });

  it('keeps plain names and never returns an empty string', () => {
    expect(formatLocationName('Lorville')).toBe('Lorville');
    expect(formatLocationName('Area18')).toBe('Area18');
    expect(formatLocationName('Stanton4_')).toBe('Stanton4_');
  });
});

describe('isGameLive', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');
  const state = (gameRunning: boolean, ageMs: number): Record<string, unknown> => ({
    presence: { gameRunning, at: new Date(now - ageMs).toISOString() },
  });

  it('is true for a fresh life sign of a running game', () => {
    expect(isGameLive(state(true, 1000), [], now)).toBeTrue();
    expect(isGameLive(state(true, LIVE_PRESENCE_MAX_AGE_MS), [], now)).toBeTrue();
  });

  it('is false for a stale sign, a stopped game, a missing sign or no state', () => {
    expect(isGameLive(state(true, LIVE_PRESENCE_MAX_AGE_MS + 1), [], now)).toBeFalse();
    expect(isGameLive(state(false, 1000), [], now)).toBeFalse();
    expect(isGameLive({ location: 'x' }, [], now)).toBeFalse();
    expect(isGameLive({ presence: { gameRunning: true, at: 'nonsense' } }, [], now)).toBeFalse();
    expect(isGameLive(null, [], now)).toBeFalse();
  });

  const ago = (ms: number): string => new Date(now - ms).toISOString();

  it('is false when the game ended after the last life sign', () => {
    const events = [
      { type: 'session.quit', at: ago(500) },
      { type: 'session.joined', at: ago(60_000) },
    ];
    expect(sessionEndedSince(events, now - 1000)).toBeTrue();
    expect(isGameLive(state(true, 1000), events, now)).toBeFalse();
  });

  it('is true for a running session whose join event was never uploaded', () => {
    // The app attached to the log after the join: only the previous session's end is in the feed.
    const events = [{ type: 'qt.arrived', at: ago(5000) }, { type: 'session.quit', at: ago(86_400_000) }];
    expect(isGameLive(state(true, 1000), events, now)).toBeTrue();
  });

  it('is true after a joined session and on a new life sign after a quit', () => {
    expect(isGameLive(state(true, 1000), [{ type: 'session.joined', at: ago(500) }], now)).toBeTrue();
    expect(isGameLive(state(true, 1000), [{ type: 'session.quit', at: ago(2000) }], now)).toBeTrue();
  });

  it('is false while disconnected in this session, true again after the rejoin', () => {
    const inSession = {
      ...state(true, 1000),
      sessionStartedAt: ago(600_000),
      lastDisconnect: { is30k: true, at: ago(60_000) },
    };
    expect(disconnectedInSession(inSession)).toBeTrue();
    expect(isGameLive(inSession, [], now)).toBeFalse();
    const rejoined = { ...inSession, lastDisconnect: { ...inSession.lastDisconnect, recapConsumed: true } };
    expect(isGameLive(rejoined, [], now)).toBeTrue();
  });

  it('ignores a disconnect of an earlier session and a state without a session start', () => {
    const lastDisconnect = { at: ago(900_000) };
    expect(isGameLive({ ...state(true, 1000), sessionStartedAt: ago(600_000), lastDisconnect }, [], now)).toBeTrue();
    expect(isGameLive({ ...state(true, 1000), lastDisconnect }, [], now)).toBeTrue();
  });
});

describe('presenceAt', () => {
  it('reads the time of the life sign', () => {
    expect(presenceAt({ presence: { at: '2026-11-05T12:00:00.000Z' } })).toBe('2026-11-05T12:00:00.000Z');
    expect(presenceAt({ location: 'x' })).toBeNull();
    expect(presenceAt(null)).toBeNull();
  });
});
