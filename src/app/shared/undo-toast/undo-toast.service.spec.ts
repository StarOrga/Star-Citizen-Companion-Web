import type { Mock } from 'vitest';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { UNDO_TOAST_MS, UndoToastService } from './undo-toast.service';

describe('UndoToastService', () => {
  let svc: UndoToastService;
  let commit: Mock;
  let onUndo: Mock;

  beforeEach(() => {
    svc = TestBed.inject(UndoToastService);
    commit = vi.fn().mockName('commit');
    onUndo = vi.fn().mockName('onUndo');
  });

  const offer = (c = commit, u = onUndo) => svc.offer({ messageKey: 'k', commit: c, onUndo: u });

  it('commits only once the window closes', fakeAsync(() => {
    offer();
    expect(svc.current()?.messageKey).toBe('k');
    tick(UNDO_TOAST_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    tick(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(svc.current()).toBeNull();
  }));

  it('undo reverts the client state and never commits', fakeAsync(() => {
    offer();
    svc.undo();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(svc.current()).toBeNull();
    tick(UNDO_TOAST_MS * 2);
    expect(commit).not.toHaveBeenCalled();
  }));

  it('a newer offer commits the pending one first', fakeAsync(() => {
    const second = vi.fn().mockName('second');
    offer();
    offer(second);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    tick(UNDO_TOAST_MS);
    expect(second).toHaveBeenCalledTimes(1);
  }));

  it('holding pauses the window and resumes with the time left', fakeAsync(() => {
    offer();
    tick(2000);
    svc.hold('hover', true);
    tick(UNDO_TOAST_MS * 2);
    expect(commit).not.toHaveBeenCalled();
    svc.hold('hover', false);
    tick(UNDO_TOAST_MS - 2001);
    expect(commit).not.toHaveBeenCalled();
    tick(1);
    expect(commit).toHaveBeenCalledTimes(1);
  }));

  it('hover and focus hold independently', fakeAsync(() => {
    offer();
    svc.hold('focus', true);
    svc.hold('hover', true);
    svc.hold('hover', false);
    expect(svc.held()).toBe(true);
    tick(UNDO_TOAST_MS * 2);
    expect(commit).not.toHaveBeenCalled();
    svc.hold('focus', false);
    expect(svc.held()).toBe(false);
    tick(UNDO_TOAST_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  }));

  it('leaving the page commits a pending offer', () => {
    offer();
    window.dispatchEvent(new Event('pagehide'));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(svc.current()).toBeNull();
  });

  it('the tab turning hidden commits a pending offer', () => {
    offer();
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    spy.mockRestore();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(svc.current()).toBeNull();
  });

  it('flush and undo are no-ops without a pending offer', () => {
    svc.flush();
    svc.undo();
    expect(commit).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();
  });
});
