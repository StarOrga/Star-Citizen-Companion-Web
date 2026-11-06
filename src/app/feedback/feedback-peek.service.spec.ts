import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FeedbackPeekService, PEEK_DELAY_MS } from './feedback-peek.service';
import { FeedbackSpotService } from './feedback-spot.service';

describe('FeedbackPeekService (hold Ctrl/Alt to dissolve the panel)', () => {
  let peek: FeedbackPeekService;
  let spots: FeedbackSpotService;
  let detachListeners: () => void;
  let detachComposer: (() => void) | null;
  let panel: HTMLElement;

  const key = (type: 'keydown' | 'keyup', k: string, init: KeyboardEventInit = {}) =>
    document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, ...init }));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    peek = TestBed.inject(FeedbackPeekService);
    spots = TestBed.inject(FeedbackSpotService);
    panel = document.createElement('div');
    spots.setPanel('admin', panel, 'admin-new');
    detachComposer = spots.attachTarget({ insertReferenceLine: () => undefined });
    detachListeners = peek.listen();
  });

  afterEach(() => {
    detachListeners();
    detachComposer?.();
    spots.setPanel('admin', null, 'admin-new');
  });

  it('dissolves only after the bare modifier was held a short moment', fakeAsync(() => {
    key('keydown', 'Control', { ctrlKey: true });
    tick(PEEK_DELAY_MS - 10);
    expect(peek.peeking()).toBeFalse();
    tick(10);
    expect(peek.peeking()).toBeTrue();
  }));

  it('works for Alt as well, and a key repeat does not restart the wait', fakeAsync(() => {
    key('keydown', 'Alt', { altKey: true });
    tick(100);
    key('keydown', 'Alt', { altKey: true, repeat: true });
    tick(50);
    expect(peek.peeking()).toBeTrue();
  }));

  it('is cancelled by any other key (Ctrl+V, Ctrl+A)', fakeAsync(() => {
    key('keydown', 'Control', { ctrlKey: true });
    tick(60);
    key('keydown', 'v', { ctrlKey: true });
    tick(500);
    expect(peek.peeking()).toBeFalse();
  }));

  it('restores when another key arrives while dissolved', fakeAsync(() => {
    key('keydown', 'Alt', { altKey: true });
    tick(PEEK_DELAY_MS);
    expect(peek.peeking()).toBeTrue();
    key('keydown', 'a', { altKey: true });
    expect(peek.peeking()).toBeFalse();
  }));

  it('does not fire for AltGr (Ctrl+Alt while typing @ or the euro sign)', fakeAsync(() => {
    key('keydown', 'Control', { ctrlKey: true, altKey: true });
    key('keydown', 'AltGraph', { ctrlKey: true, altKey: true });
    key('keydown', '@', { ctrlKey: true, altKey: true });
    tick(500);
    expect(peek.peeking()).toBeFalse();
  }));

  it('restores on key release, but not while the other modifier is still down', fakeAsync(() => {
    key('keydown', 'Control', { ctrlKey: true });
    tick(PEEK_DELAY_MS);
    key('keyup', 'Alt', { ctrlKey: true });
    expect(peek.peeking()).toBeTrue();
    key('keyup', 'Control');
    expect(peek.peeking()).toBeFalse();
  }));

  it('a release before the delay cancels the pending dissolve', fakeAsync(() => {
    key('keydown', 'Control', { ctrlKey: true });
    tick(50);
    key('keyup', 'Control');
    tick(500);
    expect(peek.peeking()).toBeFalse();
  }));

  it('restores on the click and on window blur (Alt+Tab)', fakeAsync(() => {
    key('keydown', 'Alt', { altKey: true });
    tick(PEEK_DELAY_MS);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    expect(peek.peeking()).toBeFalse();

    key('keydown', 'Alt', { altKey: true });
    tick(PEEK_DELAY_MS);
    expect(peek.peeking()).toBeTrue();
    window.dispatchEvent(new Event('blur'));
    expect(peek.peeking()).toBeFalse();
  }));

  it('stays out of it without an open composer or an open admin panel', fakeAsync(() => {
    detachComposer?.();
    detachComposer = null;
    key('keydown', 'Control', { ctrlKey: true });
    tick(500);
    expect(peek.peeking()).toBeFalse();
    key('keyup', 'Control');

    detachComposer = spots.attachTarget({ insertReferenceLine: () => undefined });
    spots.setPanel('admin', null, 'admin-new');
    key('keydown', 'Control', { ctrlKey: true });
    tick(500);
    expect(peek.peeking()).toBeFalse();
  }));

  it('restores when the composer closes while dissolved', fakeAsync(() => {
    key('keydown', 'Control', { ctrlKey: true });
    tick(PEEK_DELAY_MS);
    expect(peek.peeking()).toBeTrue();
    detachComposer?.();
    detachComposer = null;
    expect(peek.peeking()).toBeFalse();
  }));

  it('does not dissolve again from key repeats after the pick click', fakeAsync(() => {
    key('keydown', 'Control', { ctrlKey: true });
    tick(PEEK_DELAY_MS);
    expect(peek.peeking()).toBeTrue();
    peek.end();
    expect(peek.peeking()).toBeFalse();
    key('keydown', 'Control', { ctrlKey: true, repeat: true });
    key('keydown', 'Control', { ctrlKey: true, repeat: true });
    tick(PEEK_DELAY_MS * 3);
    expect(peek.peeking()).toBeFalse();
  }));

  it('repeats during the wait change nothing; a fresh press after keyup dissolves again', fakeAsync(() => {
    key('keydown', 'Alt', { altKey: true });
    tick(60);
    key('keydown', 'Alt', { altKey: true, repeat: true });
    tick(PEEK_DELAY_MS - 60);
    expect(peek.peeking()).toBeTrue();
    key('keydown', 'Alt', { altKey: true, repeat: true });
    expect(peek.peeking()).toBeTrue();
    key('keyup', 'Alt');
    expect(peek.peeking()).toBeFalse();
    key('keydown', 'Alt', { altKey: true });
    tick(PEEK_DELAY_MS);
    expect(peek.peeking()).toBeTrue();
  }));
});
