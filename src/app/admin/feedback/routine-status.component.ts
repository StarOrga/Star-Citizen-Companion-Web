import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { HEARTBEAT_POLL_MS, RoutineHeartbeatService, relativeFromNow } from './routine-heartbeat.service';

/**
 * "Is the dev PC reachable?" — one dot and three words next to the feedback
 * board's name (feedback a7573f0e).
 *
 * The admin asked for something deliberately unimportant-looking, and that is
 * the whole design brief: this is not a dashboard tile, it is the difference
 * between "my topic is queued" and "my topic is queued at a machine that is
 * switched off".
 *
 * Accessibility: the colour is never the only carrier. Each state has its own
 * wording, its own dot shape (filled / filled-red / hollow ring), and a full
 * sentence in `title` + `aria-label` naming the last check-in.
 *
 * Self-contained by design — it mounts into the panel with a single tag, owns
 * its own polling, and knows nothing about the board around it.
 */
@Component({
  selector: 'sc-routine-status',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p
      class="rs"
      [class.ok]="state() === 'online'"
      [class.down]="state() === 'offline'"
      role="status"
      [attr.title]="detail()"
      [attr.aria-label]="detail()">
      <span class="rs-dot" aria-hidden="true"></span>
      <span class="rs-label">{{ 'adminFeedback.heartbeat.' + state() | translate }}</span>
    </p>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .rs {
        display: inline-flex;
        align-items: center;
        gap: 0.4em;
        margin: 0 0 0.35rem;
        font-size: 0.72rem;
        line-height: 1.2;
        letter-spacing: 0.02em;
        cursor: help;
        /* Unknown is the resting look: quiet, grey, easy to ignore. */
        color: var(--sc-text-dim, #94a3b8);
        opacity: 0.85;
      }
      .rs.ok {
        color: var(--sc-success, #4ade80);
      }
      .rs.down {
        color: var(--sc-danger, #ef4444);
        opacity: 1;
      }
      .rs-dot {
        width: 0.5em;
        height: 0.5em;
        border-radius: 50%;
        /* Hollow ring = unknown; the two known states fill it in, so the dot
           differs by shape and not only by hue. */
        border: 1px solid currentColor;
        background: transparent;
        flex: none;
      }
      .rs.ok .rs-dot,
      .rs.down .rs-dot {
        background: currentColor;
      }
      @media (prefers-contrast: more) {
        .rs {
          opacity: 1;
        }
      }
    `,
  ],
})
export class RoutineStatusComponent {
  private readonly heartbeat = inject(RoutineHeartbeatService);
  private readonly translate = inject(TranslateService);
  /** Re-runs `detail()` when the UI language flips (board-wide pattern). */
  private readonly langChange = toSignal(this.translate.onLangChange, { initialValue: null });

  readonly state = this.heartbeat.state;

  /** Full sentence for the tooltip / screen reader, incl. the relative time. */
  readonly detail = computed(() => {
    this.langChange();
    const locale = this.translate.currentLang || 'en';
    const state = this.state();
    const when = relativeFromNow(this.heartbeat.lastSeen(), this.heartbeat.checkedAt(), locale);
    // No usable timestamp means we cannot name a moment — fall back to the
    // neutral wording rather than printing a sentence with a hole in it.
    if (state === 'unknown' || !when) {
      return this.translate.instant('adminFeedback.heartbeat.unknownTitle');
    }
    return this.translate.instant(`adminFeedback.heartbeat.${state}Title`, { time: when });
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    void this.heartbeat.refresh();
    // The component only exists while the panel is open, so its lifetime IS
    // the "while open" the polling is scoped to.
    if (typeof window !== 'undefined') {
      const id = window.setInterval(() => void this.heartbeat.refresh(), HEARTBEAT_POLL_MS);
      destroyRef.onDestroy(() => window.clearInterval(id));
    }
  }
}
