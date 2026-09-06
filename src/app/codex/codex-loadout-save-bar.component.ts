import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../core/desktop-capability.service';

/**
 * ENTWURFSLEISTE — the draft half of the mission bar's right side (MASTER §5),
 * shown ONLY while `changed() > 0`.
 *
 * The concept (`docs/concepts/codex-schiffsseite-ui-spec.md` §5) draws exactly
 * three parts: the word *Entwurf*, a gold chip *n Slot geändert*, and the
 * sentence *Nicht gespeichert. Nur diese Sitzung.* The bar used to carry a
 * fourth, implementation-shaped line on top of those — "3 Änderungen davon 0
 * speicherbar — verschachtelte und geleerte Slots bleiben vorerst Entwurf".
 * That sentence is the REASON the save button is blocked, so it now lives on
 * the save button (title + `aria-describedby`) instead of in the bar.
 *
 * R8 still holds: a restored-but-unsaveable draft must never read as "saved".
 * It is answered where the question is asked — you find out when you reach for
 * the button, not by reading a status line you did not ask for.
 *
 * The known weakness of that move is touch: a `title` tooltip is unreachable
 * with a finger, and a greyed-out button explains nothing. So the blocked save
 * control is never `disabled` — it is `aria-disabled`, stays focusable and
 * pressable, and pressing it reveals the reason as an inline note under the
 * bar. On a coarse pointer it is not greyed out either: it looks pressable
 * because it IS pressable, it just answers with a sentence instead of a save.
 */
@Component({
  selector: 'sc-codex-loadout-save-bar',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (changed() > 0) {
      <div class="bar sc-card">
        <!-- The three parts the concept draws, and nothing else. -->
        <div class="lead">
          <span class="label">{{ 'codex.detail.draftLabel' | translate }}</span>
          <span class="chip">{{ (changed() === 1 ? 'codex.detail.draftChanged' : 'codex.detail.draftChangedPlural') | translate: { n: changed() } }}</span>
        </div>
        <p class="notice">{{ 'codex.detail.draftNotice' | translate }}</p>
        @if (error()) {
          <p class="err">{{ error() }}</p>
        }
        <div class="actions">
          <button type="button" class="discard" [disabled]="saving()" (click)="discard.emit()">
            {{ 'codex.detail.draftDiscard' | translate }}
          </button>
          <button
            type="button"
            class="save"
            [class.blocked]="blocked()"
            [class.dimmed]="blocked() && !coarsePointer()"
            [disabled]="saving()"
            [attr.aria-disabled]="blocked() ? 'true' : null"
            [attr.aria-describedby]="partial() ? reasonId : null"
            [attr.title]="partial()
              ? (('codex.loadout.changesSummary' | translate: { changed: changed(), saveable: saveable() })
                 + ' — ' + ('codex.loadout.unsaveableHint' | translate))
              : null"
            (click)="onSave()"
          >
            {{ (saving() ? 'codex.loadout.saving' : 'codex.detail.draftApplyAndSave') | translate }}
          </button>
        </div>
        <!-- One element, two jobs: the accessible description the blocked
             button points at, and — once pressed — the visible answer to
             "why can I not save this?" on a device with no hover. -->
        @if (partial()) {
          <p [id]="reasonId" class="reason" [class.sr-only]="!reasonShown()" role="status">
            {{ 'codex.loadout.changesSummary' | translate: { changed: changed(), saveable: saveable() } }}
            — {{ 'codex.loadout.unsaveableHint' | translate }}
          </p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 10px; padding: 10px 14px; margin-bottom: 10px;
      border-color: color-mix(in srgb, var(--sc-warn) 45%, transparent); }
    .lead { display: flex; align-items: center; gap: 8px; flex: none; }
    .label { font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .chip { padding: 3px 10px; border-radius: 999px; background: color-mix(in srgb, var(--sc-warn) 22%, var(--sc-bg-2)); color: var(--sc-warn); font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600; }
    .notice { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-0); flex: 1 1 auto; min-width: 180px; }
    .err { margin: 4px 0 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-danger, #ff5252); }
    /* The reason, once revealed: a quiet note, not an error. The data is fine,
       this part of the draft simply has nowhere to be saved yet. */
    .reason { flex-basis: 100%; margin: 2px 0 0; font-size: max(0.72rem, var(--sc-fs-floor));
      color: var(--sc-fg-2); font-style: italic;
      border-left: 2px solid color-mix(in srgb, var(--sc-warn) 55%, transparent); padding-left: 8px; }
    .actions { display: flex; gap: 8px; flex: 0 0 auto; }
    .discard, .save { min-height: 48px; padding: 7px 14px; border-radius: 6px; font: inherit; font-size: max(0.76rem, var(--sc-fs-floor));
      cursor: pointer; }
    .discard { background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
    .discard:hover { border-color: var(--sc-danger, #ff5252); color: var(--sc-danger, #ff5252); }
    .save { background: var(--sc-accent); border: 1px solid var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; }
    .save:hover { filter: brightness(1.08); }
    /* Greyed out only where a tooltip can actually be read. On a coarse
       pointer the control keeps its full contrast and answers on press. */
    .save.dimmed { opacity: 0.6; }
    .save.blocked { cursor: help; }
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

  /** The one place the app asks whether a hover tooltip can be reached. */
  private readonly capability = inject(DesktopCapabilityService);
  readonly coarsePointer = this.capability.hasCoarsePointer;

  readonly reasonId = 'codex-draft-block-reason';

  /**
   * Part of this draft cannot be persisted (R8). The button says so — in its
   * title and, hover-free, through `aria-describedby`.
   */
  readonly partial = computed(() => this.saveable() < this.changed());
  /** NOTHING can be persisted — pressing save would do nothing at all. */
  readonly blocked = computed(() => this.saveable() === 0);

  /** The reason has been asked for (the blocked control was pressed). */
  readonly reasonShown = signal(false);

  onSave(): void {
    if (this.blocked()) {
      // Not a dead end and not an error: say why, in place, and stay pressable
      // so a second press after a fixable change actually saves.
      this.reasonShown.set(true);
      return;
    }
    this.reasonShown.set(false);
    (this.inHangar() ? this.save : this.addAndSave).emit();
  }
}
