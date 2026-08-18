import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * The save/discard affordance for the codex ship-detail draft write path
 * (PR B). Split out of `codex-detail.component.ts` so that file's inline
 * styles stay under its 18kb budget (06-fallen.md notes it already sits at
 * ~17.9kb) — this is the only place new loadout-write CSS goes.
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
        <p class="summary">
          {{ 'codex.loadout.changesSummary' | translate: { changed: changed(), saveable: saveable() } }}
          @if (saveable() < changed()) {
            <span class="hint">{{ 'codex.loadout.unsaveableHint' | translate }}</span>
          }
        </p>
        @if (error()) {
          <p class="err">{{ error() }}</p>
        }
        <div class="actions">
          <button type="button" class="discard" [disabled]="saving()" (click)="discard.emit()">
            {{ 'codex.loadout.discard' | translate }}
          </button>
          @if (inHangar()) {
            <button type="button" class="save" [disabled]="saving() || saveable() === 0" (click)="save.emit()">
              {{ (saving() ? 'codex.loadout.saving' : 'codex.loadout.save') | translate }}
            </button>
          } @else {
            <button type="button" class="save" [disabled]="saving() || saveable() === 0" (click)="addAndSave.emit()">
              {{ (saving() ? 'codex.loadout.saving' : 'codex.loadout.addToHangarAndSave') | translate }}
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
      border-color: color-mix(in srgb, var(--sc-accent-gold, #c8a84b) 45%, transparent); }
    .summary { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
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
