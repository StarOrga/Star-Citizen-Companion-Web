import { Injectable, inject } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { NachschubTargetDialogComponent } from './nachschub-target-dialog.component';
import type { NachschubLineInput } from './nachschub.model';

/**
 * Contract between the Bestand (caller) and the Nachschub side (owner of the dialog).
 *
 * The Bestand hands over what the player selected and why; the picker asks where it goes —
 * an existing active Nachschub (repeatedly, R3 q-route note) or a new one — and, for `sell`,
 * the aUEC goal. It performs the write itself (`NachschubService.addToNachschub` /
 * `createSellNachschub`) and resolves with what happened, or `null` when the player cancelled.
 *
 * No stop merging across Nachschübe (R3 q-route = none): each Nachschub keeps its own route.
 */
export type NachschubTargetIntent = 'pickup' | 'sell' | 'buy';

export interface NachschubTargetRequest {
  readonly intent: NachschubTargetIntent;
  readonly lines: readonly NachschubLineInput[];
}

export interface NachschubTargetResult {
  /** Id of the Nachschub the lines landed in. */
  readonly nachschubId: string;
  /** True when a new Nachschub was created for them. */
  readonly created: boolean;
}

@Injectable({ providedIn: 'root' })
export class NachschubTargetPicker {
  private readonly overlay = inject(Overlay);
  private isOpen = false;

  /**
   * Opens the target dialog in a CDK overlay (the scrim and the sheet are the dialog's own, like the other HQ dialogs)
   * and resolves with where the lines landed, or null when the player cancelled. A second call while one is open
   * resolves as cancelled, so a double click never stacks two.
   */
  open(request: NachschubTargetRequest): Promise<NachschubTargetResult | null> {
    if (this.isOpen || request.lines.length === 0) return Promise.resolve(null);
    this.isOpen = true;
    const overlayRef = this.overlay.create({
      hasBackdrop: false,
      panelClass: 'sc-dialog-pane',
      positionStrategy: this.overlay.position().global(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
      disposeOnNavigation: true,
    });
    const ref = overlayRef.attach(new ComponentPortal(NachschubTargetDialogComponent));
    ref.setInput('intent', request.intent);
    ref.setInput('lines', request.lines);
    ref.changeDetectorRef.detectChanges();
    return new Promise<NachschubTargetResult | null>((resolve) => {
      let settled = false;
      const finish = (value: NachschubTargetResult | null) => {
        if (settled) return;
        settled = true;
        this.isOpen = false;
        closedSub.unsubscribe();
        detachSub.unsubscribe();
        overlayRef.dispose();
        resolve(value);
      };
      const closedSub = ref.instance.closed.subscribe((v) => finish(v));
      const detachSub = overlayRef.detachments().subscribe(() => finish(null));
    });
  }
}
