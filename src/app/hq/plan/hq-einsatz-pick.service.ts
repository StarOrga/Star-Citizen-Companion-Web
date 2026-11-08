import { Injectable, inject } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { EinsatzPick, EinsatzPickOption, HqEinsatzPickDialogComponent } from './hq-einsatz-pick-dialog.component';

/**
 * Opens the "Zum Einsatz" picker in a CDK overlay (same frame as
 * ScConfirmService: centred, backdrop, scroll blocked, closed by a navigation).
 * Resolves with the choice, or null for cancel / backdrop / Escape.
 */
@Injectable({ providedIn: 'root' })
export class HqEinsatzPickService {
  private readonly overlay = inject(Overlay);
  private open = false;

  pick(missionTitle: string, options: readonly EinsatzPickOption[]): Promise<EinsatzPick | null> {
    if (this.open) return Promise.resolve(null);
    this.open = true;
    const overlayRef = this.overlay.create({
      hasBackdrop: true,
      backdropClass: 'sc-dialog-backdrop',
      panelClass: 'sc-dialog-pane',
      positionStrategy: this.overlay.position().global().centerHorizontally().centerVertically(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
      disposeOnNavigation: true,
    });
    const ref = overlayRef.attach(new ComponentPortal(HqEinsatzPickDialogComponent));
    ref.setInput('missionTitle', missionTitle);
    ref.setInput('options', options);
    ref.changeDetectorRef.detectChanges();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v: EinsatzPick | null) => {
        if (settled) return;
        settled = true;
        this.open = false;
        subs.forEach((s) => s.unsubscribe());
        overlayRef.dispose();
        resolve(v);
      };
      const subs = [
        ref.instance.closed.subscribe((v) => finish(v)),
        overlayRef.detachments().subscribe(() => finish(null)),
      ];
    });
  }
}
