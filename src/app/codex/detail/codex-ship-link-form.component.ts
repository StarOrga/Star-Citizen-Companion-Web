import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { ShipLinkFormStore } from './ship-link-form.store';

/**
 * The "pin your own RSI pledge link" form of a ship page (feedback f7d3bd9a),
 * shared by the classic view and the Holotable drawer (AUD-090, AUD-116).
 * Private to the reader; an admin can publish one for everyone, never
 * automatic. The admin block is an action inside the page, not admin
 * navigation, so it keeps the normal accent.
 *
 * All state lives in ShipLinkFormStore, provided by codex-detail; the parent
 * decides when the form is shown (store.open()).
 */
@Component({
  selector: 'sc-codex-ship-link-form',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="ship-link-form" (submit)="save($event)">
      <p class="sl-hint">{{ 'codex.shipLink.hint' | translate }}</p>
      <div class="sl-row">
        <input
          type="url"
          class="sl-input"
          [value]="store.input()"
          (input)="onInput($event)"
          [attr.placeholder]="'codex.shipLink.placeholder' | translate"
          [attr.aria-label]="'codex.shipLink.label' | translate"
          [attr.aria-invalid]="store.error() ? 'true' : null" />
        <button type="submit" class="btn" [disabled]="store.saving()">
          {{ 'codex.shipLink.save' | translate }}
        </button>
        @if (store.myPledgeLink()) {
          <button type="button" class="btn quiet" [disabled]="store.saving()"
                  (click)="store.remove()">
            {{ 'codex.shipLink.remove' | translate }}
          </button>
        }
        <button type="button" class="btn quiet" (click)="store.toggle()">
          {{ 'codex.shipLink.cancel' | translate }}
        </button>
      </div>
      @if (store.error(); as errKey) {
        <p class="sl-error" role="alert">
          {{ ('codex.shipLink.error.' + errKey) | translate }}
        </p>
      }
      @if (store.saved()) {
        <p class="sl-ok" role="status">{{ 'codex.shipLink.saved' | translate }}</p>
      }
      @if (role.isAdmin()) {
        <div class="sl-admin">
          <span class="sl-admin-tag">{{ 'codex.shipLink.adminTitle' | translate }}</span>
          <button type="button" class="btn quiet" [disabled]="store.saving()"
                  (click)="store.promote()">
            {{ 'codex.shipLink.promote' | translate }}
          </button>
          @if (store.globalPledgeLink()) {
            <button type="button" class="btn quiet" [disabled]="store.saving()"
                    (click)="store.unpromote()">
              {{ 'codex.shipLink.unpromote' | translate }}
            </button>
          }
          <span class="sl-admin-hint">{{ 'codex.shipLink.adminHint' | translate }}</span>
        </div>
      }
    </form>
  `,
  styles: [`
    :host { display: contents; }
    .ship-link-form { margin-top: 14px; padding: 12px 14px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .sl-hint { margin: 0 0 8px; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sl-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .sl-input { flex: 1 1 320px; min-width: 0; padding: 8px 12px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.82rem; }
    .sl-input:focus { outline: none; border-color: var(--sc-accent); }
    .sl-input[aria-invalid='true'] { border-color: var(--sc-danger); }
    .sl-error { margin: 8px 0 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-danger); }
    .sl-ok { margin: 8px 0 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-accent); }
    .sl-admin { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sc-border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .sl-admin-tag { font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .sl-admin-hint { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); flex: 1 1 220px; }

    /* The page's button (concept section 2, part-02:159), the .btn half of
       codex-detail's shared .btn/.pin rule. The 48px floor holds for coarse
       pointers (the mobile gate emulates one); a mouse gets the drawn 24px. */
    .btn { position: relative; display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 8px; min-height: 48px;
      border: 1px solid var(--sc-border); border-radius: 3px;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      color: var(--sc-fg-2); font-family: var(--sc-font-display); text-decoration: none;
      font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase;
      cursor: pointer; }
    @media (pointer: fine) {
      .btn { min-height: 24px; }
    }
    .btn:hover { color: var(--sc-fg-0);
      border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); }
    .btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .btn:disabled { opacity: 0.38; cursor: not-allowed; }
    .btn.quiet { text-transform: none; letter-spacing: 0; background: transparent; }
  `],
})
export class CodexShipLinkFormComponent {
  protected readonly store = inject(ShipLinkFormStore);
  protected readonly role = inject(RoleService);

  protected onInput(e: Event): void {
    this.store.onInput((e.target as HTMLInputElement).value);
  }

  protected save(e: Event): void {
    e.preventDefault();
    void this.store.save();
  }
}
