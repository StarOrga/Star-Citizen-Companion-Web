import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScDialogDirective } from './sc-dialog.directive';

@Component({
  standalone: true,
  imports: [ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <button type="button" class="opener">Open</button>
    <button type="button" class="other">Other</button>
    @if (open()) {
      <div
        class="dlg"
        scDialog
        [scDialogModal]="modal()"
        [scDialogInitialFocus]="initialFocus()"
        [scDialogReturnFocus]="returnTo()"
        (scDialogEscape)="escapes = escapes + 1"
      >
        <p>Text</p>
        <button type="button" class="first">First</button>
        @if (withInitial()) {
          <button type="button" class="initial" cdkFocusInitial>Initial</button>
        }
        <button type="button" class="last">Last</button>
      </div>
    }
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly modal = signal(true);
  readonly initialFocus = signal<'first' | 'container'>('first');
  readonly withInitial = signal(false);
  readonly returnTo = signal<HTMLElement | null>(null);
  escapes = 0;
}

describe('ScDialogDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = <T extends HTMLElement>(sel: string) =>
    fixture.nativeElement.querySelector(sel) as T;
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  async function openFrom(sel = '.opener'): Promise<void> {
    el(sel).focus();
    host.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function close(): Promise<void> {
    host.open.set(false);
    fixture.detectChanges();
    await frame();
  }

  it('focuses the first tabbable element on open', async () => {
    await openFrom();
    expect(document.activeElement).toBe(el('.first'));
  });

  it('lets cdkFocusInitial win', async () => {
    host.withInitial.set(true);
    await openFrom();
    expect(document.activeElement).toBe(el('.initial'));
  });

  it("focuses the host for 'container' and makes it focusable without a tab stop", async () => {
    host.initialFocus.set('container');
    await openFrom();
    const dlg = el('.dlg');
    expect(document.activeElement).toBe(dlg);
    expect(dlg.getAttribute('tabindex')).toBe('-1');
    expect(dlg.classList).toContain('sc-dialog');
  });

  it('traps Tab via the CDK anchors when modal', async () => {
    await openFrom();
    const dlg = el('.dlg');
    const before = dlg.previousElementSibling as HTMLElement;
    const after = dlg.nextElementSibling as HTMLElement;
    expect(before.classList).toContain('cdk-focus-trap-anchor');
    expect(after.classList).toContain('cdk-focus-trap-anchor');
    after.focus();
    expect(document.activeElement).toBe(el('.first'));
  });

  it('disables the anchors when not modal', async () => {
    host.modal.set(false);
    await openFrom();
    const dlg = el('.dlg');
    const anchors = [dlg.previousElementSibling, dlg.nextElementSibling].filter((a) =>
      a?.classList.contains('cdk-focus-trap-anchor'),
    ) as HTMLElement[];
    expect(anchors.length).toBe(2);
    for (const a of anchors) {
      expect(a.getAttribute('tabindex') === null || a.getAttribute('tabindex') === '-1').toBeTrue();
    }
  });

  it('emits Escape exactly once and keeps it away from document listeners', async () => {
    await openFrom();
    const docSpy = jasmine.createSpy('docKeydown');
    document.addEventListener('keydown', docSpy);
    try {
      el('.first').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } finally {
      document.removeEventListener('keydown', docSpy);
    }
    expect(host.escapes).toBe(1);
    expect(docSpy).not.toHaveBeenCalled();
  });

  it('ignores an Escape an inner widget already consumed', async () => {
    await openFrom();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    ev.preventDefault();
    el('.first').dispatchEvent(ev);
    expect(host.escapes).toBe(0);
  });

  it('returns focus to the opener on close', async () => {
    await openFrom();
    // Focus vanishes with the dialog: blur to body like a removed element does.
    await close();
    expect(document.activeElement).toBe(el('.opener'));
  });

  it('does not steal focus the user moved elsewhere', async () => {
    await openFrom();
    el('.other').focus();
    await close();
    expect(document.activeElement).toBe(el('.other'));
  });

  it('lets scDialogReturnFocus win over the opener', async () => {
    host.returnTo.set(el('.other'));
    await openFrom();
    await close();
    expect(document.activeElement).toBe(el('.other'));
  });
});
