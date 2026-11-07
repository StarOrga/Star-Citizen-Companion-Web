import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import type { HangarShip } from '../../hangar/hangar.types';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { hqHangar } from '../../hq/hq-routes';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * The own-ship part of the Holotable's top panel (concept r1-hangar-panel):
 * rename + note, pin + remove - the actions that used to sit on the hangar
 * list row. Variant switching, loadout saving and the wish/supply/stock icons
 * are already on the page; this only adds what was missing, over the same
 * HangarService calls the hangar list uses. Rendered only by the Holotable
 * and only for a ship the reader owns.
 */
@Component({
  selector: 'sc-codex-own-ship-actions',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="own" role="group" [attr.aria-label]="'codex.own.group' | translate">
      <button type="button" scAction tier="tertiary" class="own-rename" [attr.aria-label]="'codex.own.rename' | translate"
              [scTooltip]="'codex.own.rename' | translate" scTooltipTier="label" (click)="rename()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" /></svg>
      </button>
      <button type="button" scAction tier="tertiary" class="own-note" [attr.aria-label]="'codex.own.note' | translate"
              [scTooltip]="'codex.own.note' | translate" scTooltipTier="label" (click)="note()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4" /></svg>
      </button>
      <button type="button" scAction tier="tertiary" class="own-pin" [attr.aria-pressed]="pinned()"
              [attr.aria-label]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate"
              [scTooltip]="(pinned() ? 'codex.own.unpin' : 'codex.own.pin') | translate" scTooltipTier="label" (click)="togglePin()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2h-4v6l-1 1-1-1v-6H7v-2l3-3-1-6z" [attr.fill]="pinned() ? 'currentColor' : 'none'" /></svg>
      </button>
      <button type="button" scAction tier="tertiary" tone="danger" class="own-remove" [attr.aria-label]="'codex.own.remove' | translate"
              [scTooltip]="'codex.own.remove' | translate" scTooltipTier="label" (click)="remove()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" /></svg>
      </button>
    </div>
    @if (hangar.error(); as err) {
      <span class="own-err" role="alert">{{ err | translate }}</span>
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 8px; }
    .own { display: inline-flex; align-items: center; gap: 2px; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .own-err { color: var(--sc-danger); font-size: max(0.74rem, var(--sc-fs-floor)); }
  `],
})
export class CodexOwnShipActionsComponent {
  protected readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly confirmDialog = inject(ScConfirmService);
  private readonly router = inject(Router);

  readonly ship = input.required<HangarShip>();
  protected readonly pinned = computed(() => this.ship().pinnedRank !== null);

  async rename(): Promise<void> {
    const s = this.ship();
    const v = await this.confirmDialog.prompt({
      titleKey: 'codex.own.renameTitle',
      inputLabelKey: 'codex.own.rename',
      inputMaxLength: 80,
      initialValue: s.customName ?? '',
      confirmKey: 'hangar.detail.save',
    });
    if (v === null) return;
    await this.hangar.updateShip(s.id, { customName: v.trim() || null });
  }

  async note(): Promise<void> {
    const s = this.ship();
    const v = await this.confirmDialog.prompt({
      titleKey: 'codex.own.noteTitle',
      inputLabelKey: 'hangar.detail.notes',
      inputMaxLength: 2000,
      initialValue: s.notes ?? '',
      confirmKey: 'hangar.detail.save',
    });
    if (v === null) return;
    await this.hangar.updateShip(s.id, { notes: v.trim() || null });
  }

  async togglePin(): Promise<void> {
    const s = this.ship();
    if (s.pinnedRank !== null) {
      await this.hangar.pinShip(s.id, null);
      return;
    }
    const taken = new Set(this.hangar.ships().map((x) => x.pinnedRank));
    const rank = ([1, 2, 3] as const).find((r) => !taken.has(r)) ?? 3;
    await this.hangar.pinShip(s.id, rank);
  }

  async remove(): Promise<void> {
    const s = this.ship();
    // Variants hang off the ship with ON DELETE CASCADE: the question names how many go with it.
    const n = this.ownership.configsForShip(s.id).length;
    const ok = await this.confirmDialog.confirm({
      titleKey: 'hangar.detail.removeConfirm.title',
      messageKey: n === 0 ? 'hangar.detail.removeConfirm.bodyNone' : n === 1 ? 'hangar.detail.removeConfirm.bodyOne' : 'hangar.detail.removeConfirm.bodyMany',
      params: { name: s.customName || s.shipClassName, count: n },
      confirmKey: 'hangar.detail.remove',
      tone: 'danger',
    });
    if (!ok) return;
    if (await this.hangar.removeShip(s.id)) {
      this.ownership.invalidate();
      void this.router.navigate([hqHangar]);
    }
  }
}
