import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The Holotable "Einordnung" before a ranking exists (holodeck polish
 * 2026-10-08). The ranking compares against the WHOLE fleet, so on a first
 * visit per build that read takes a while: until it lands the panel says what
 * it is doing (never an empty chart box), a failed read offers the retry, and
 * a fleet without values says so.
 */
@Component({
  selector: 'sc-codex-holo-rank-state',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="rank-state loading" role="status" aria-live="polite">
        <svg class="rs-radar" viewBox="0 0 100 100" aria-hidden="true">
          <polygon points="50,6 92,36 76,88 24,88 8,36" />
          <polygon points="50,28 71,43 63,69 37,69 29,43" />
          <line class="sweep" x1="50" y1="50" x2="50" y2="6" />
        </svg>
        <p>{{ 'codex.holo.stage.rankLoading' | translate }}</p>
      </div>
    } @else {
      <div class="rank-state" [attr.role]="failed() ? 'alert' : null">
        <p>{{ (failed() ? 'codex.holo.stage.rankFailed' : 'codex.holo.stage.rankEmpty') | translate }}</p>
        @if (failed()) {
          <button type="button" class="rank-retry" (click)="retry.emit()">{{ 'codex.error.retry' | translate }}</button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .rank-state { display: grid; justify-items: center; gap: 8px; padding: 18px 8px; text-align: center; border-radius: 4px;
      border: 1px dashed color-mix(in srgb, var(--sc-accent) 30%, transparent); font-size: max(11.5px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .rank-state p { margin: 0; line-height: 1.4; }
    .rs-radar { width: 96px; height: 96px; }
    .rs-radar polygon { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke-width: 1; }
    .rs-radar .sweep { stroke: var(--sc-accent); stroke-width: 1.5; stroke-linecap: round; transform-origin: 50px 50px; animation: rs-sweep 1.8s linear infinite; }
    @keyframes rs-sweep { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .rs-radar .sweep { animation: none; } }
    .rank-retry { min-height: max(32px, var(--sc-tap-min, 0px)); padding: 5px 12px; border-radius: 3px; border: 1px solid var(--sc-border); background: none;
      color: var(--sc-fg-1); cursor: pointer; font-family: var(--sc-font-display); text-transform: uppercase; font-size: max(11px, var(--sc-fs-floor));
      letter-spacing: 0.08em; transition: border-color 160ms ease, color 160ms ease; }
    .rank-retry:hover, .rank-retry:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
  `],
})
export class CodexHoloRankStateComponent {
  readonly loading = input(false);
  readonly failed = input(false);
  readonly retry = output<void>();
}
