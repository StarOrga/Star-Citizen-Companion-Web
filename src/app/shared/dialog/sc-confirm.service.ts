import { Injectable, inject } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { ScConfirmDialogComponent } from './sc-confirm-dialog.component';

export type ScConfirmTone = 'default' | 'danger';

export interface ScConfirmOptions {
  readonly titleKey: string;
  readonly messageKey?: string;
  /** Interpolation parameters for titleKey AND messageKey. */
  readonly params?: Record<string, unknown>;
  readonly confirmKey?: string; // default 'common.dialog.confirm'
  readonly cancelKey?: string; // default 'common.dialog.cancel'
  readonly tone?: ScConfirmTone; // default 'default'
}

export interface ScPromptOptions extends ScConfirmOptions {
  readonly inputLabelKey: string;
  readonly inputMaxLength?: number;
}

export const SC_CONFIRM_DEFAULT_CONFIRM_KEY = 'common.dialog.confirm';
export const SC_CONFIRM_DEFAULT_CANCEL_KEY = 'common.dialog.cancel';

/**
 * App-styled replacement for `window.confirm` / `window.prompt`. Renders
 * `sc-confirm-dialog` in a CDK overlay (top layer via popover in CDK 22,
 * centred, backdrop, scroll blocked) and resolves a Promise once the user
 * decides. Backdrop click, Escape and a navigation all count as "cancel".
 *
 * Only one dialog at a time: a second call while one is open resolves as
 * cancelled right away, so a double click on "Delete" never stacks two.
 */
@Injectable({ providedIn: 'root' })
export class ScConfirmService {
  private readonly overlay = inject(Overlay);
  private open = false;

  confirm(o: ScConfirmOptions): Promise<boolean> {
    return this.show(o, 'confirm').then((r) => r !== null);
  }

  /** null = cancelled, '' = confirmed without text. The caller trims. */
  prompt(o: ScPromptOptions): Promise<string | null> {
    return this.show(o, 'prompt');
  }

  private show(o: ScConfirmOptions | ScPromptOptions, mode: 'confirm' | 'prompt'): Promise<string | null> {
    if (this.open) return Promise.resolve(null);
    this.open = true;

    const overlayRef: OverlayRef = this.overlay.create({
      hasBackdrop: true,
      backdropClass: 'sc-dialog-backdrop',
      panelClass: 'sc-dialog-pane',
      positionStrategy: this.overlay.position().global().centerHorizontally().centerVertically(),
      scrollStrategy: this.overlay.scrollStrategies.block(),
      disposeOnNavigation: true,
    });
    const ref = overlayRef.attach(new ComponentPortal(ScConfirmDialogComponent));
    ref.setInput('titleKey', o.titleKey);
    ref.setInput('messageKey', o.messageKey);
    ref.setInput('params', o.params);
    ref.setInput('confirmKey', o.confirmKey ?? SC_CONFIRM_DEFAULT_CONFIRM_KEY);
    ref.setInput('cancelKey', o.cancelKey ?? SC_CONFIRM_DEFAULT_CANCEL_KEY);
    ref.setInput('tone', o.tone ?? 'default');
    ref.setInput('mode', mode);
    if (mode === 'prompt') {
      const p = o as ScPromptOptions;
      ref.setInput('inputLabelKey', p.inputLabelKey);
      ref.setInput('inputMaxLength', p.inputMaxLength);
    }
    ref.changeDetectorRef.detectChanges();

    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        this.open = false;
        closedSub.unsubscribe();
        backdropSub.unsubscribe();
        detachSub.unsubscribe();
        overlayRef.dispose();
        resolve(value);
      };
      const closedSub = ref.instance.closed.subscribe((v) => finish(v));
      const backdropSub = overlayRef.backdropClick().subscribe(() => finish(null));
      const detachSub = overlayRef.detachments().subscribe(() => finish(null));
    });
  }
}
