import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { HqAppConnectionService } from './hq-app-connection.service';
import { HqLiveService } from './hq-live.service';

describe('HqAppConnectionService', () => {
  beforeEach(() => localStorage.removeItem('sc.sccApp.launchedBefore'));
  afterEach(() => localStorage.removeItem('sc.sccApp.launchedBefore'));

  function setup(state: Record<string, unknown> | null) {
    const live = { state: signal(state), stateUpdatedAt: signal<string | null>(null), events: signal<unknown[]>([]), loaded: signal(true), error: signal<string | null>(null) };
    // A Starscape check-in must never count: the service does not even look at it.
    const conn = { stateFor: () => 'connected', refresh: () => Promise.resolve() };
    TestBed.configureTestingModule({
      providers: [
        { provide: HqLiveService, useValue: live },
        { provide: DesktopConnectionService, useValue: conn },
      ],
    });
    return TestBed.inject(HqAppConnectionService);
  }

  it('nothing connected, or only Starscape: not connected', () => {
    const s = setup(null);
    expect(s.everConnected()).toBeFalse();
    expect(s.connected()).toBeFalse();
  });

  it('SCC app reporting a fresh life sign: connected', () => {
    const s = setup({ presence: { at: new Date().toISOString(), gameRunning: false } });
    expect(s.everConnected()).toBeTrue();
    expect(s.connected()).toBeTrue();
  });

  it('an old signal: ever connected but off', () => {
    const s = setup({ presence: { at: new Date(Date.now() - 3_600_000).toISOString(), gameRunning: true } });
    expect(s.everConnected()).toBeTrue();
    expect(s.connected()).toBeFalse();
  });

  it('derives the four states', () => {
    expect(setup(null).status()).toBe('missing');
    TestBed.resetTestingModule();
    expect(setup({ presence: { at: new Date(Date.now() - 3_600_000).toISOString(), gameRunning: true } }).status()).toBe('off');
    TestBed.resetTestingModule();
    expect(setup({ presence: { at: new Date().toISOString(), gameRunning: false } }).status()).toBe('ready');
    TestBed.resetTestingModule();
    expect(setup({ presence: { at: new Date().toISOString(), gameRunning: true } }).status()).toBe('tracking');
  });

  it('reads the last life sign for "zuletzt"', () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    expect(setup({ presence: { at, gameRunning: false } }).lastSignAt()).toBe(at);
  });
});
