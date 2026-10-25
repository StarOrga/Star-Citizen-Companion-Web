import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { UNDO_TOAST_MS, UndoToastService } from './undo-toast.service';

describe('UndoToastService', () => {
  let svc: UndoToastService;
  let commit: jasmine.Spy;
  let onUndo: jasmine.Spy;

  beforeEach(() => {
    svc = TestBed.inject(UndoToastService);
    commit = jasmine.createSpy('commit');
    onUndo = jasmine.createSpy('onUndo');
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
    const second = jasmine.createSpy('second');
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
    svc.hold(true);
    tick(UNDO_TOAST_MS * 2);
    expect(commit).not.toHaveBeenCalled();
    svc.hold(false);
    tick(UNDO_TOAST_MS - 2001);
    expect(commit).not.toHaveBeenCalled();
    tick(1);
    expect(commit).toHaveBeenCalledTimes(1);
  }));

  it('flush and undo are no-ops without a pending offer', () => {
    svc.flush();
    svc.undo();
    expect(commit).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();
  });
});
