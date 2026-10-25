import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { UndoToastComponent } from './undo-toast.component';
import { UndoToastService } from './undo-toast.service';

describe('UndoToastComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideTranslateService({})] }));

  it('renders only while an offer is pending and its button undoes it', () => {
    const svc = TestBed.inject(UndoToastService);
    const commit = jasmine.createSpy('commit');
    const onUndo = jasmine.createSpy('onUndo');
    const f = TestBed.createComponent(UndoToastComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.toast')).toBeNull();

    svc.offer({ messageKey: 'starmap.guess.undoToast', messageParams: { name: 'Gladius' }, commit, onUndo });
    f.detectChanges();
    const toast = f.nativeElement.querySelector('.toast') as HTMLElement;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('starmap.guess.undoToast');
    const btn = toast.querySelector('button.undo') as HTMLButtonElement;
    expect(btn.textContent).toContain('common.undo');

    btn.click();
    f.detectChanges();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('.toast')).toBeNull();
  });

  it('hover holds the window', () => {
    const svc = TestBed.inject(UndoToastService);
    const f = TestBed.createComponent(UndoToastComponent);
    svc.offer({ messageKey: 'k', commit: () => undefined, onUndo: () => undefined });
    f.detectChanges();
    const toast = f.nativeElement.querySelector('.toast') as HTMLElement;
    toast.dispatchEvent(new MouseEvent('mouseenter'));
    f.detectChanges();
    expect(svc.held()).toBeTrue();
    expect(toast.classList).toContain('paused');
    toast.dispatchEvent(new MouseEvent('mouseleave'));
    expect(svc.held()).toBeFalse();
    svc.undo();
  });
});
