import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AccountPrefsService } from '../core/account-prefs.service';
import { AuthService } from '../auth/auth.service';
import { ReleaseNotes, ReleaseNotesService } from './release-notes.service';
import { ReleaseSeenService } from './release-seen.service';

describe('ReleaseSeenService', () => {
  const KEY = 'releaseNotesSeen';
  let notes: ReturnType<typeof signal<ReleaseNotes | null>>;
  let prefs: ReturnType<typeof signal<Record<string, unknown> | null>>;
  let user: ReturnType<typeof signal<object | null>>;
  let prefSet: jasmine.Spy;

  const release = (version: string): ReleaseNotes => ({
    generatedFrom: 'CHANGELOG.md',
    current: version,
    releases: [{ version, date: '2026-10-25', sections: [] }],
  });

  function setup(): ReleaseSeenService {
    TestBed.configureTestingModule({
      providers: [
        { provide: ReleaseNotesService, useValue: { notes, load: () => Promise.resolve(notes()) } },
        { provide: AccountPrefsService, useValue: { prefs, set: prefSet } },
        { provide: AuthService, useValue: { user } },
      ],
    });
    return TestBed.inject(ReleaseSeenService);
  }

  beforeEach(() => {
    localStorage.removeItem(KEY);
    notes = signal<ReleaseNotes | null>(null);
    prefs = signal<Record<string, unknown> | null>(null);
    user = signal<object | null>(null);
    prefSet = jasmine.createSpy('set');
  });

  afterEach(() => localStorage.removeItem(KEY));

  it('counts history as seen on first contact (signed out) and shows no dot', () => {
    notes.set(release('0.2.0'));
    const svc = setup();
    TestBed.flushEffects();
    expect(svc.unseen()).toBeFalse();
    expect(localStorage.getItem(KEY)).toBe('0.2.0');
  });

  it('shows the dot for a newer release and clears it on markSeen', () => {
    localStorage.setItem(KEY, '0.1.0');
    notes.set(release('0.2.0'));
    const svc = setup();
    TestBed.flushEffects();
    expect(svc.unseen()).toBeTrue();
    svc.markSeen();
    TestBed.flushEffects();
    expect(svc.unseen()).toBeFalse();
    expect(localStorage.getItem(KEY)).toBe('0.2.0');
  });

  it('shows no dot while the account prefs are still loading', () => {
    user.set({ id: 'u1' });
    notes.set(release('0.2.0'));
    const svc = setup();
    TestBed.flushEffects();
    expect(svc.unseen()).toBeFalse();
    expect(prefSet).not.toHaveBeenCalled();
  });

  it('reads and writes the account value when signed in', () => {
    user.set({ id: 'u1' });
    prefs.set({ [KEY]: '0.1.0' });
    notes.set(release('0.2.0'));
    const svc = setup();
    TestBed.flushEffects();
    expect(svc.unseen()).toBeTrue();
    svc.markSeen();
    TestBed.flushEffects();
    expect(prefSet).toHaveBeenCalledWith(KEY, '0.2.0');
  });
});
