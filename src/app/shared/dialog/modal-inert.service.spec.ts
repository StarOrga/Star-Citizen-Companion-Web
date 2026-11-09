import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScDialogDirective } from './sc-dialog.directive';
import { ModalInertService } from './modal-inert.service';

@Component({
  standalone: true,
  imports: [ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <header class="shell-top"><button class="fab">FAB</button></header>
    <main class="page"><button class="page-btn">Page</button></main>
    <div class="live" role="status">toast</div>
    <aside class="tray"><button class="tray-btn">Undo</button><div class="tray-live" aria-live="polite">saved</div></aside>
    @if (a()) {
      <div class="scrim">
        <div class="dlg-a" role="dialog" aria-modal="true" scDialog>
          <button class="a-btn">A</button>
        </div>
      </div>
    }
    @if (b()) {
      <div class="scrim-b">
        <div class="dlg-b" role="dialog" aria-modal="true" scDialog>
          <button class="b-btn">B</button>
        </div>
      </div>
    }
    @if (pop()) {
      <div class="pop" role="dialog" scDialog>
        <button class="pop-btn">P</button>
      </div>
    }
    @if (softModal()) {
      <div class="soft" role="dialog" scDialog [scDialogModal]="false" aria-modal="true">
        <button class="soft-btn">S</button>
      </div>
    }
  `,
})
class HostComponent {
  readonly a = signal(false);
  readonly b = signal(false);
  readonly pop = signal(false);
  readonly softModal = signal(false);
}

describe('modal background inert', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const q = (sel: string) => fixture.nativeElement.querySelector(sel) as HTMLElement;
  const inert = (sel: string) => q(sel).hasAttribute('inert');

  async function flush(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('marks the shell and floating buttons inert while a modal is open, and restores on close', async () => {
    host.a.set(true);
    await flush();
    expect(inert('.shell-top')).toBe(true);
    expect(inert('.page')).toBe(true);
    expect(inert('.scrim')).toBe(false);
    expect(inert('.dlg-a')).toBe(false);
    expect(inert('.live')).toBe(false);
    host.a.set(false);
    await flush();
    expect(fixture.nativeElement.querySelectorAll('[inert]').length).toBe(0);
  });

  it('keeps a live region nested in an outside region announcing: its container is not inert, its other children are', async () => {
    host.a.set(true);
    await flush();
    expect(inert('.tray')).toBe(false);
    expect(inert('.tray-live')).toBe(false);
    expect(inert('.tray-btn')).toBe(true);
    host.a.set(false);
    await flush();
    expect(fixture.nativeElement.querySelectorAll('[inert]').length).toBe(0);
  });

  it('keeps the focus-trap anchors live', async () => {
    host.a.set(true);
    await flush();
    const anchors = fixture.nativeElement.querySelectorAll('.cdk-focus-trap-anchor');
    expect(anchors.length).toBe(2);
    anchors.forEach((a: Element) => expect(a.hasAttribute('inert')).toBe(false));
  });

  it('nested modals: only the topmost is live, and closing it re-opens the one below', async () => {
    host.a.set(true);
    await flush();
    host.b.set(true);
    await flush();
    expect(inert('.scrim')).toBe(true);
    expect(inert('.scrim-b')).toBe(false);
    expect(inert('.shell-top')).toBe(true);
    host.b.set(false);
    await flush();
    expect(inert('.scrim')).toBe(false);
    expect(inert('.shell-top')).toBe(true);
    host.a.set(false);
    await flush();
    expect(fixture.nativeElement.querySelectorAll('[inert]').length).toBe(0);
  });

  it('does not touch the page for a popover without aria-modal or a non-modal dialog', async () => {
    host.pop.set(true);
    host.softModal.set(true);
    await flush();
    expect(fixture.nativeElement.querySelectorAll('[inert]').length).toBe(0);
  });

  it('leaves elements that were already inert alone', async () => {
    q('.page').setAttribute('inert', '');
    host.a.set(true);
    await flush();
    host.a.set(false);
    await flush();
    expect(inert('.page')).toBe(true);
  });

  it('restores everything when the whole host is destroyed while a modal is open', async () => {
    host.a.set(true);
    await flush();
    const svc = TestBed.inject(ModalInertService);
    expect(svc.depth).toBe(1);
    const shell = q('.shell-top');
    fixture.destroy();
    expect(svc.depth).toBe(0);
    expect(shell.hasAttribute('inert')).toBe(false);
  });
});
