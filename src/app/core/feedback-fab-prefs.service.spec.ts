import { TestBed } from '@angular/core/testing';
import { FeedbackFabPrefsService } from './feedback-fab-prefs.service';

const KEY = 'sc.feedback.fabHidden';

describe('FeedbackFabPrefsService', () => {
  function make(): FeedbackFabPrefsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(FeedbackFabPrefsService);
  }

  afterEach(() => localStorage.removeItem(KEY));

  it('shows the launcher when nothing is stored', () => {
    localStorage.removeItem(KEY);
    expect(make().show()).toBeTrue();
  });

  it('persists the opt-out and restores it on the next visit', () => {
    make().setShow(false);
    expect(localStorage.getItem(KEY)).toBe('1');
    // A fresh injector stands in for a reload.
    expect(make().show()).toBeFalse();
  });

  it('drops the key again when the launcher is switched back on', () => {
    make().setShow(false);
    const svc = make();
    svc.setShow(true);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(make().show()).toBeTrue();
  });

  it('fails open: anything but the opt-out marker still shows the launcher', () => {
    // The launcher is how a user reports that the app is broken, so a stray or
    // corrupted value must never be what hides it.
    localStorage.setItem(KEY, 'garbage');
    expect(make().show()).toBeTrue();
    localStorage.setItem(KEY, '0');
    expect(make().show()).toBeTrue();
  });
});
