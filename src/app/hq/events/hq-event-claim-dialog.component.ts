import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { HQ_DIALOG_STYLES } from '../plan/hq-dialog.styles';
import { EventHqService } from './event-hq.service';
import { looksLikeShip } from './event-hq.util';
import { defaultClaimChannel, type ClaimChannel } from './event-nachschub';
import type { EventReward } from './event-sheet';

export const CLAIM_CHANNELS: readonly ClaimChannel[] = ['pledge', 'ingame', 'both'];

/**
 * Claim dialog (F10, ev-a9): which channel the reward came through (pledge / ingame / both, preselected from the sheet),
 * put it into Bestand (origin = channel; ships go to the Hangar), and optionally tick the whole event "erledigt".
 * The SCC-App can change the channel later by itself; the dialog shows what it set.
 */
@Component({
  selector: 'sc-hq-event-claim-dialog',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScDialogDirective, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" scDialog (scDialogEscape)="closed.emit()" aria-labelledby="claim-title">
        <header class="dlg-head">
          <span class="dlg-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2 6.2 6.2 2.8-6.2 2.8L12 21l-2-6.2L3.8 12 10 9.2z" /></svg></span>
          <h2 id="claim-title" class="dlg-title">{{ 'hq.events.claim.title' | translate: { name: reward().name } }}</h2>
        </header>
        <div class="dlg-body">
          <fieldset class="chan">
            <legend>{{ 'hq.events.claim.channel' | translate }}</legend>
            <span class="seg" role="group">
              @for (c of channels; track c) {
                <button type="button" [attr.aria-pressed]="channel() === c" (click)="channel.set(c)">{{ 'hq.events.channel.' + c | translate }}</button>
              }
            </span>
            @if (byApp()) { <small class="dlg-msg">{{ 'hq.events.claim.byApp' | translate }}</small> }
          </fieldset>
          <div class="opt">
            <sc-tristate variant="checkbox" [label]="'hq.events.claim.store' | translate" [value]="store() ? 1 : 0" (toggled)="store.set(!store())" />
            <span>{{ 'hq.events.claim.store' | translate }}</span>
          </div>
          @if (store() && reward().className) {
            <div class="opt sub">
              <sc-tristate variant="checkbox" [label]="'hq.events.claim.isShip' | translate" [value]="ship() ? 1 : 0" (toggled)="ship.set(!ship())" />
              <span>{{ 'hq.events.claim.isShip' | translate }}</span>
            </div>
            <p class="dlg-msg hint">{{ (ship() ? 'hq.events.claim.toHangar' : 'hq.events.claim.toInventory') | translate }}</p>
          }
          <div class="opt">
            <sc-tristate variant="checkbox" [label]="'hq.events.claim.complete' | translate" [value]="complete() ? 1 : 0" (toggled)="complete.set(!complete())" />
            <span>{{ 'hq.events.claim.complete' | translate }}</span>
          </div>
          @if (error(); as e) { <p class="dlg-err" role="alert">{{ e | translate }}</p> }
        </div>
        <footer class="dlg-foot">
          <span class="sp"></span>
          <button type="button" scAction tier="secondary" (click)="closed.emit()">{{ 'common.dialog.cancel' | translate }}</button>
          <button type="button" scAction tier="primary" [busy]="busy()" [disabled]="busy()" (click)="confirm()">{{ 'hq.events.claim.confirm' | translate }}</button>
        </footer>
      </div>
    </div>
  `,
  styles: [
    HQ_DIALOG_STYLES,
    `.chan { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
     .chan legend { padding: 0; font-weight: 600; margin-bottom: 4px; }
     .seg { display: inline-flex; gap: 4px; flex-wrap: wrap; }
     .seg button { padding: 6px 12px; border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); color: var(--sc-fg-1); font: inherit; cursor: pointer; }
     .seg button[aria-pressed='true'] { border-color: var(--sc-accent); color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
     .seg button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
     .opt span { flex: 1; } .sub { margin-inline-start: 28px; } .hint { color: var(--sc-fg-2); font-size: 0.85rem; }`,
  ],
})
export class HqEventClaimDialogComponent {
  readonly eventId = input.required<string>();
  readonly reward = input.required<EventReward>();
  readonly closed = output<void>();
  readonly claimed = output<void>();

  private readonly events = inject(EventHqService);
  protected readonly channels = CLAIM_CHANNELS;
  private readonly existing = computed(() => this.events.stateOf(this.eventId()).claimed[this.reward().id] ?? null);
  /** The SCC-App set the channel (a live claim) - shown, still changeable here. */
  protected readonly byApp = computed(() => this.existing()?.by === 'live');
  protected readonly channel = signal<ClaimChannel>('ingame');
  protected readonly store = signal(true);
  protected readonly ship = signal(false);
  protected readonly complete = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    queueMicrotask(() => {
      this.channel.set(this.existing()?.channel ?? defaultClaimChannel(this.reward()));
      this.ship.set(looksLikeShip(this.reward().className));
    });
  }

  protected async confirm(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const ok = await this.events.claim(this.eventId(), this.reward(), this.channel(), this.store(), this.ship());
      if (!ok) {
        this.error.set(this.events.claimError() ?? this.events.error() ?? 'errors.generic');
        return;
      }
      if (this.complete()) await this.events.complete(this.eventId());
      this.claimed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
