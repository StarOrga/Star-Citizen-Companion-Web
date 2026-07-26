import { TestBed } from '@angular/core/testing';
import { ComposerPrefsService } from './composer-prefs.service';

const KEY = 'sc.composer.sendOnEnter';

describe('ComposerPrefsService', () => {
  function make(): ComposerPrefsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(ComposerPrefsService);
  }

  afterEach(() => localStorage.removeItem(KEY));

  it('defaults to Enter-sends when nothing is stored', () => {
    localStorage.removeItem(KEY);
    expect(make().sendOnEnter()).toBeTrue();
  });

  it('persists the choice and restores it on the next visit', () => {
    make().setSendOnEnter(false);
    expect(localStorage.getItem(KEY)).toBe('0');
    // A fresh injector stands in for a reload.
    expect(make().sendOnEnter()).toBeFalse();

    make().setSendOnEnter(true);
    expect(localStorage.getItem(KEY)).toBe('1');
    expect(make().sendOnEnter()).toBeTrue();
  });

  it('treats any unknown stored value as the Enter-sends default', () => {
    localStorage.setItem(KEY, 'garbage');
    expect(make().sendOnEnter()).toBeTrue();
  });
});
