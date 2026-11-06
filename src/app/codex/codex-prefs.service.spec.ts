import { TestBed } from '@angular/core/testing';
import { CodexPrefsService } from './codex-prefs.service';

describe('CodexPrefsService', () => {
  afterEach(() => localStorage.removeItem('sc.codex.showNonUsable'));

  it('hides non-usable items by default and remembers the opt-in', () => {
    localStorage.removeItem('sc.codex.showNonUsable');
    const prefs = TestBed.inject(CodexPrefsService);
    expect(prefs.showNonUsable()).toBeFalse();
    prefs.setShowNonUsable(true);
    expect(prefs.showNonUsable()).toBeTrue();
    expect(localStorage.getItem('sc.codex.showNonUsable')).toBe('1');
    prefs.setShowNonUsable(false);
    expect(localStorage.getItem('sc.codex.showNonUsable')).toBeNull();
  });
});
