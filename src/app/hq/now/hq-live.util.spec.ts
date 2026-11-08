import {
  LIVE_PRESENCE_MAX_AGE_MS,
  SHIP_DESTROYED_MAX_AGE_MS,
  disconnectedInSession,
  formatLocationName,
  isGameLive,
  lastDestroyedAt,
  presenceAt,
  readZones,
  sessionEndedSince,
} from './hq-live.util';

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
    expect(isGameLive(state(true, 1000), [], now)).toBe(true);
    expect(isGameLive(state(true, LIVE_PRESENCE_MAX_AGE_MS), [], now)).toBe(true);
  });

  it('is false for a stale sign, a stopped game, a missing sign or no state', () => {
    expect(isGameLive(state(true, LIVE_PRESENCE_MAX_AGE_MS + 1), [], now)).toBe(false);
    expect(isGameLive(state(false, 1000), [], now)).toBe(false);
    expect(isGameLive({ location: 'x' }, [], now)).toBe(false);
    expect(isGameLive({ presence: { gameRunning: true, at: 'nonsense' } }, [], now)).toBe(false);
    expect(isGameLive(null, [], now)).toBe(false);
  });

  const ago = (ms: number): string => new Date(now - ms).toISOString();

  it('is false when the game ended after the last life sign', () => {
    const events = [
      { type: 'session.quit', at: ago(500) },
      { type: 'session.joined', at: ago(60_000) },
    ];
    expect(sessionEndedSince(events, now - 1000)).toBe(true);
    expect(isGameLive(state(true, 1000), events, now)).toBe(false);
  });

  it('is true for a running session whose join event was never uploaded', () => {
    // The app attached to the log after the join: only the previous session's end is in the feed.
    const events = [{ type: 'qt.arrived', at: ago(5000) }, { type: 'session.quit', at: ago(86_400_000) }];
    expect(isGameLive(state(true, 1000), events, now)).toBe(true);
  });

  it('is true after a joined session and on a new life sign after a quit', () => {
    expect(isGameLive(state(true, 1000), [{ type: 'session.joined', at: ago(500) }], now)).toBe(true);
    expect(isGameLive(state(true, 1000), [{ type: 'session.quit', at: ago(2000) }], now)).toBe(true);
  });

  it('is false while disconnected in this session, true again after the rejoin', () => {
    const inSession = {
      ...state(true, 1000),
      sessionStartedAt: ago(600_000),
      lastDisconnect: { is30k: true, at: ago(60_000) },
    };
    expect(disconnectedInSession(inSession)).toBe(true);
    expect(isGameLive(inSession, [], now)).toBe(false);
    const rejoined = { ...inSession, lastDisconnect: { ...inSession.lastDisconnect, recapConsumed: true } };
    expect(isGameLive(rejoined, [], now)).toBe(true);
  });

  it('ignores a disconnect of an earlier session and a state without a session start', () => {
    const lastDisconnect = { at: ago(900_000) };
    expect(isGameLive({ ...state(true, 1000), sessionStartedAt: ago(600_000), lastDisconnect }, [], now)).toBe(true);
    expect(isGameLive({ ...state(true, 1000), lastDisconnect }, [], now)).toBe(true);
  });
});

describe('readZones', () => {
  const ev = (...types: string[]) => types.map((type) => ({ type }));

  it('lets the newest event of each family decide and lists the important zones first', () => {
    expect(readZones(ev('armistice.entered', 'armistice.exited', 'session.joined'))).toEqual(['armistice']);
    expect(readZones(ev('monitored.down', 'armistice.entered', 'restricted.entered', 'session.joined'))).toEqual([
      'restricted',
      'commDown',
      'armistice',
    ]);
    expect(readZones(ev('monitored.restored', 'monitored.down', 'session.joined'))).toEqual(['monitored']);
    expect(readZones(ev('monitored.exited', 'session.joined'))).toEqual(['unmonitored']);
  });

  it('never carries a zone over from before the session start', () => {
    expect(readZones(ev('session.joined', 'armistice.entered'))).toBeNull();
    expect(readZones(ev('qt.arrived', 'session.joined', 'restricted.entered'))).toBeNull();
    expect(readZones(ev('session.quit', 'armistice.entered'))).toBeNull();
  });

  it('is unknown when the session left every zone or has no zone event', () => {
    expect(readZones(ev('armistice.exited', 'armistice.entered', 'session.joined'))).toBeNull();
    expect(readZones([])).toBeNull();
  });
});

describe('lastDestroyedAt', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');
  const destroyed = (ship: unknown, ageMs: number) => ({
    type: 'vehicle.destroyed',
    data: { ship } as Record<string, unknown>,
    at: new Date(now - ageMs).toISOString(),
  });

  it('matches the ship class, also with an entity number on the log name', () => {
    const newest = destroyed('ANVL_Hornet_F7A_Mk2_1234567', 1000);
    expect(lastDestroyedAt([newest, destroyed('ANVL_Hornet_F7A_Mk2', 5000)], 'anvl_hornet_f7a_mk2', now)).toBe(newest.at);
  });

  it('ignores other ships, other events, a missing name and an old loss', () => {
    expect(lastDestroyedAt([destroyed('RSI_Aurora', 1000)], 'ANVL_Hornet_F7A_Mk2', now)).toBeNull();
    expect(lastDestroyedAt([{ ...destroyed('RSI_Aurora', 1000), type: 'qt.arrived' }], 'RSI_Aurora', now)).toBeNull();
    expect(lastDestroyedAt([destroyed(null, 1000)], 'RSI_Aurora', now)).toBeNull();
    expect(lastDestroyedAt([destroyed('RSI_Aurora', SHIP_DESTROYED_MAX_AGE_MS + 1)], 'RSI_Aurora', now)).toBeNull();
  });
});

describe('presenceAt', () => {
  it('reads the time of the life sign', () => {
    expect(presenceAt({ presence: { at: '2026-11-05T12:00:00.000Z' } })).toBe('2026-11-05T12:00:00.000Z');
    expect(presenceAt({ location: 'x' })).toBeNull();
    expect(presenceAt(null)).toBeNull();
  });
});
