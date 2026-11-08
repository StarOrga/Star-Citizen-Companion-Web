import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { HqAppConnectionService } from './hq-app-connection.service';
import { HqLiveService } from './hq-live.service';

describe('HqAppConnectionService', () => {
  function setup(state: Record<string, unknown> | null) {
    const live = { state: signal(state), events: signal<unknown[]>([]) };
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
    expect(s.everConnected()).toBe(false);
    expect(s.connected()).toBe(false);
  });

  it('SCC app reporting a fresh life sign: connected', () => {
    const s = setup({ presence: { at: new Date().toISOString(), gameRunning: false } });
    expect(s.everConnected()).toBe(true);
    expect(s.connected()).toBe(true);
  });

  it('an old signal: ever connected but off', () => {
    const s = setup({ presence: { at: new Date(Date.now() - 3_600_000).toISOString(), gameRunning: true } });
    expect(s.everConnected()).toBe(true);
    expect(s.connected()).toBe(false);
  });
});
