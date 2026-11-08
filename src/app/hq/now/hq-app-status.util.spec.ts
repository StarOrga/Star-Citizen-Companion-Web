import { aussichtAutoOpen, appStatusVisible, hqAppAction, hqAppStatus, readAussichtSeen } from './hq-app-status.util';

const sig = (o: Partial<{ everConnected: boolean; remembered: boolean; connected: boolean; gameLive: boolean }> = {}) => ({
  everConnected: false,
  remembered: false,
  connected: false,
  gameLive: false,
  ...o,
});

describe('hqAppStatus', () => {
  it('is missing when the app never reported and this browser never saw it', () => {
    expect(hqAppStatus(sig())).toBe('missing');
  });

  it('is off once it reported before, or answered a launch in this browser, but has no fresh life sign', () => {
    expect(hqAppStatus(sig({ everConnected: true }))).toBe('off');
    expect(hqAppStatus(sig({ remembered: true }))).toBe('off');
  });

  it('is ready with a fresh life sign while the game is not running', () => {
    expect(hqAppStatus(sig({ everConnected: true, connected: true }))).toBe('ready');
  });

  it('is tracking while the game runs, whatever else is known', () => {
    expect(hqAppStatus(sig({ everConnected: true, connected: true, gameLive: true }))).toBe('tracking');
    expect(hqAppStatus(sig({ gameLive: true }))).toBe('tracking');
  });
});

describe('hqAppAction', () => {
  it('downloads when missing, starts when off, offers nothing while it runs', () => {
    expect(hqAppAction('missing')).toBe('download');
    expect(hqAppAction('off')).toBe('launch');
    expect(hqAppAction('ready')).toBeNull();
    expect(hqAppAction('tracking')).toBeNull();
  });
});

describe('appStatusVisible', () => {
  it('shows on every HQ page including Start, also before the app was ever connected', () => {
    for (const p of ['start', 'inventar', 'jetzt', 'planen', 'statistik'] as const) expect(appStatusVisible(p, true, true)).toBeTrue();
  });

  it('hides where nothing can be installed, outside the HQ pages and before the live data settled', () => {
    expect(appStatusVisible('start', false, true)).toBeFalse();
    expect(appStatusVisible(null, true, true)).toBeFalse();
    expect(appStatusVisible('jetzt', true, false)).toBeFalse();
  });
});

describe('Aussicht memory', () => {
  it('reads the dismissed pages leniently', () => {
    expect([...readAussichtSeen('["start","jetzt"]')]).toEqual(['start', 'jetzt']);
    expect(readAussichtSeen(null).size).toBe(0);
    expect(readAussichtSeen('{junk').size).toBe(0);
    expect(readAussichtSeen('{"a":1}').size).toBe(0);
    expect([...readAussichtSeen('["planen",3]')]).toEqual(['planen']);
  });

  it('opens by itself only while the app is missing, once per page', () => {
    const seen = new Set(['start'] as const);
    expect(aussichtAutoOpen('missing', 'jetzt', seen)).toBeTrue();
    expect(aussichtAutoOpen('missing', 'start', seen)).toBeFalse();
    expect(aussichtAutoOpen('off', 'jetzt', seen)).toBeFalse();
    expect(aussichtAutoOpen('missing', null, seen)).toBeFalse();
  });
});
