import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

/**
 * The technical class name of a Codex entry (`AEGS_Avenger_Stalker`,
 * `gmed_medpen_01`) as a small mono chip — never as a title or a subtitle.
 * The readable name is the title; the class name is reference data for the
 * people who want it (datamining, wiki edits, bug reports), so it stays
 * small and one click away from the clipboard.
 *
 * `copyable` (default) renders a button that copies the name. Inside a card
 * that is itself a link, interactive content is not allowed, so cards pass
 * `[copyable]="false"` and get a plain chip whose full name is the tooltip.
 */
@Component({
  selector: 'sc-class-chip',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (copyable()) {
      <button type="button" class="chip copy" (click)="copy()"
              [attr.aria-label]="'classChip.copyAria' | translate: { name: value() }"
              [scTooltip]="(copied() ? 'classChip.copied' : 'classChip.copy') | translate" scTooltipTier="label">
        <span class="txt">{{ value() }}</span>
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          @if (copied()) {
            <path d="M5 12.5 10 17.5 19 7.5" />
          } @else {
            <path d="M9 9h10v12H9z" /><path d="M5 15V3h10" />
          }
        </svg>
      </button>
      <span class="sr" role="status">{{ copied() ? ('classChip.copied' | translate) : '' }}</span>
    } @else {
      <span class="chip" [scTooltip]="value()" scTooltipTier="label">
        <span class="txt">{{ value() }}</span>
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; max-width: 100%; min-width: 0; vertical-align: middle; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0;
      padding: 2px 8px; border-radius: 4px;
      border: 1px solid var(--sc-border); background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
      color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace);
      font-size: max(0.7rem, var(--sc-fs-floor)); line-height: 1.5; letter-spacing: 0;
    }
    .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .copy { cursor: pointer; font: inherit; font-family: var(--sc-font-mono, monospace);
      font-size: max(0.7rem, var(--sc-fs-floor)); min-height: var(--sc-tap-min);
      transition: color 0.16s, border-color 0.16s; }
    .copy:hover, .copy:focus-visible { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 50%, transparent); }
    .copy:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .ic { width: 12px; height: 12px; flex: none; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  `],
})
export class ClassChipComponent {
  readonly value = input.required<string>();
  readonly copyable = input(true);

  readonly copied = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  /** Best-effort: a denied clipboard simply shows no confirmation. */
  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value());
    } catch {
      return;
    }
    this.copied.set(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), 1800);
  }
}
