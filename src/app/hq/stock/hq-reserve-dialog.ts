import { Injectable, inject } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { HqReserveDialogComponent } from './hq-reserve-dialog.component';
import type { DeckCrate } from './hq-stock-deck';

/** Opens the reservation dialog (D2 / I8) in a CDK overlay; resolves `true` when a reservation was written, changed or ended. */
@Injectable({ providedIn: 'root' })
export class HqReserveDialog {
  private readonly overlay = inject(Overlay);
  private isOpen = false;

  open(crates: readonly DeckCrate[]): Promise<boolean> {
    if (this.isOpen || crates.length === 0) return Promise.resolve(false);
    this.isOpen = true;
    const overlayRef = this.overlay.create({
      hasBackdrop: false,
      panelClass: 'sc-dialog-pane',
      positionStrategy: this.overlay.position().global(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
      disposeOnNavigation: true,
    });
    const ref = overlayRef.attach(new ComponentPortal(HqReserveDialogComponent));
    ref.setInput('crates', crates);
    ref.changeDetectorRef.detectChanges();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        this.isOpen = false;
        closedSub.unsubscribe();
        detachSub.unsubscribe();
        overlayRef.dispose();
        resolve(value);
      };
      const closedSub = ref.instance.closed.subscribe((v) => finish(v));
      const detachSub = overlayRef.detachments().subscribe(() => finish(false));
    });
  }
}
