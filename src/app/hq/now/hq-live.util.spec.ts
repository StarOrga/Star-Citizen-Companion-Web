import { LIVE_PRESENCE_MAX_AGE_MS, formatLocationName, isGameLive, presenceAt, sessionEnded } from './hq-live.util';

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

  it('is false when the newest session event says the game ended', () => {
    const events = [{ type: 'session.quit' }, { type: 'session.joined' }];
    expect(sessionEnded(events)).toBeTrue();
    expect(isGameLive(state(true, 1000), events, now)).toBeFalse();
    expect(isGameLive(state(true, 1000), [{ type: 'qt.arrived' }, { type: 'session.joined' }], now)).toBeTrue();
  });
});

describe('presenceAt', () => {
  it('reads the time of the life sign', () => {
    expect(presenceAt({ presence: { at: '2026-11-05T12:00:00.000Z' } })).toBe('2026-11-05T12:00:00.000Z');
    expect(presenceAt({ location: 'x' })).toBeNull();
    expect(presenceAt(null)).toBeNull();
  });
});
