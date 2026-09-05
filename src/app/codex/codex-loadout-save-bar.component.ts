import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * The draft half of the mission bar's right side (MASTER §5) — shown ONLY
 * while `changed() > 0`; the page swaps it in for `<sc-codex-mission-bar>`'s
 * own idle controls (persistence select / Zurücksetzen / inert Übernehmen).
 *
 * R8: shows explicitly how many of the draft's changes are actually
 * persistable (`n von m`) — a restored-but-unsaveable draft entry must never
 * read as "saved" just because it exists.
 */
@Component({
  selector: 'sc-codex-loadout-save-bar',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (changed() > 0) {
      <div class="bar sc-card">
        <div class="lead">
          <span class="label">{{ 'codex.detail.draftLabel' | translate }}</span>
          <span class="chip">{{ (changed() === 1 ? 'codex.detail.draftChanged' : 'codex.detail.draftChangedPlural') | translate: { n: changed() } }}</span>
        </div>
        <p class="notice">
          {{ 'codex.detail.draftNotice' | translate }}
          @if (saveable() < changed()) {
            <span class="hint">
              {{ 'codex.loadout.changesSummary' | translate: { changed: changed(), saveable: saveable() } }}
              — {{ 'codex.loadout.unsaveableHint' | translate }}
            </span>
          }
        </p>
        @if (error()) {
          <p class="err">{{ error() }}</p>
        }
        <div class="actions">
          <button type="button" class="discard" [disabled]="saving()" (click)="discard.emit()">
            {{ 'codex.detail.draftDiscard' | translate }}
          </button>
          @if (inHangar()) {
            <button type="button" class="save" [disabled]="saving() || saveable() === 0" (click)="save.emit()">
              {{ (saving() ? 'codex.loadout.saving' : 'codex.detail.draftApplyAndSave') | translate }}
            </button>
          } @else {
            <button type="button" class="save" [disabled]="saving() || saveable() === 0" (click)="addAndSave.emit()">
              {{ (saving() ? 'codex.loadout.saving' : 'codex.detail.draftApplyAndSave') | translate }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 10px; padding: 10px 14px; margin-bottom: 10px;
      border-color: color-mix(in srgb, var(--sc-warn) 45%, transparent); }
    .lead { display: flex; align-items: center; gap: 8px; flex: none; }
    .label { font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .chip { padding: 3px 10px; border-radius: 999px; background: color-mix(in srgb, var(--sc-warn) 22%, var(--sc-bg-2)); color: var(--sc-warn); font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600; }
    .notice { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-0); flex: 1 1 auto; min-width: 180px; }
    .hint { display: block; margin-top: 2px; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .err { margin: 4px 0 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-danger, #ff5252); }
    .actions { display: flex; gap: 8px; flex: 0 0 auto; }
    .discard, .save { padding: 7px 14px; border-radius: 6px; font: inherit; font-size: max(0.76rem, var(--sc-fs-floor));
      cursor: pointer; }
    .discard { background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
    .discard:hover { border-color: var(--sc-danger, #ff5252); color: var(--sc-danger, #ff5252); }
    .save { background: var(--sc-accent); border: 1px solid var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; }
    .save:hover { filter: brightness(1.08); }
    .save:disabled, .discard:disabled { opacity: 0.6; cursor: not-allowed; }
  `],
})
export class CodexLoadoutSaveBarComponent {
  readonly changed = input.required<number>();
  readonly saveable = input.required<number>();
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly inHangar = input(false);

  readonly save = output<void>();
  readonly discard = output<void>();
  readonly addAndSave = output<void>();
}
