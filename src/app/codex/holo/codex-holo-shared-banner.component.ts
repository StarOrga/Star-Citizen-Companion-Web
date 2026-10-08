import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** The read-only banner while a shared link's loadout is on the table (#646). */
export interface HoloSharedBanner {
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  ownerName: string | null;
  configName: string;
  /** `errors.*` / i18n key of a failed read or a failed adopt. */
  errorKey: string | null;
}

/**
 * "Shared by X — adopt to edit" above the Holotable (#646): who shared the
 * loadout on the table, the adopt action, the way back to the reader's own
 * draft — or why the link shows nothing (dead link, failed read + retry).
 * Purely presentational; the page owns the peek, the adopt and the exit.
 */
@Component({
  selector: 'sc-codex-holo-shared-banner',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let sb = banner();
    <div class="shared-banner" [class.warn]="sb.status === 'unavailable' || sb.status === 'error'"
         [attr.role]="sb.status === 'error' ? 'alert' : 'status'">
      <span class="sb-glyph" aria-hidden="true">⇄</span>
      @switch (sb.status) {
        @case ('loading') { <span class="sb-text">{{ 'codex.holo.shared.loading' | translate }}</span> }
        @case ('ready') {
          <span class="sb-text">{{ 'codex.holo.shared.banner' | translate: { owner: sb.ownerName ?? '—', name: sb.configName } }}</span>
          <button type="button" class="btn sb-adopt" [disabled]="adopting()" [attr.aria-busy]="adopting()" (click)="adopt.emit()">
            {{ (adopting() ? 'hangar.shared.adopting' : 'codex.holo.shared.adopt') | translate }}
          </button>
        }
        @case ('unavailable') { <span class="sb-text">{{ 'codex.holo.shared.unavailable' | translate }}</span> }
        @case ('error') {
          <span class="sb-text">{{ 'codex.holo.shared.loadError' | translate }} {{ (sb.errorKey ?? 'errors.generic') | translate }}</span>
          <button type="button" class="btn sb-retry" (click)="retry.emit()">{{ 'codex.error.retry' | translate }}</button>
        }
      }
      @if (sb.status === 'ready' && sb.errorKey) {
        <span class="sb-err" role="alert">{{ sb.errorKey | translate }}</span>
      }
      <button type="button" class="btn quiet sb-exit" (click)="exit.emit()">{{ 'codex.holo.shared.exit' | translate }}</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .shared-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 12px; border: 1px solid var(--sc-accent);
      border-radius: var(--holo-r, 6px); background: color-mix(in srgb, var(--sc-accent) 7%, transparent);
      font-size: max(12px, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    .shared-banner.warn { border-color: var(--sc-warning); background: color-mix(in srgb, var(--sc-warning) 8%, transparent); }
    .sb-glyph { color: var(--sc-accent); }
    .sb-text { flex: 1 1 240px; min-width: 0; }
    .sb-err { flex-basis: 100%; color: var(--sc-danger); }
    .btn { min-height: max(32px, var(--sc-tap-min, 0px)); padding: 5px 12px; border-radius: 3px; cursor: pointer; font-family: var(--sc-font-display);
      text-transform: uppercase; font-size: max(11px, var(--sc-fs-floor)); letter-spacing: 0.08em; color: var(--sc-fg-0);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent);
      transition: border-color 160ms ease, color 160ms ease; }
    .btn.quiet { background: none; border-color: var(--sc-border); color: var(--sc-fg-1); }
    .btn:hover, .btn:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  `],
})
export class CodexHoloSharedBannerComponent {
  readonly banner = input.required<HoloSharedBanner>();
  readonly adopting = input(false);
  readonly adopt = output<void>();
  readonly exit = output<void>();
  readonly retry = output<void>();
}
