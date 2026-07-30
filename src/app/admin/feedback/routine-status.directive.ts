import { DestroyRef, Directive, ElementRef, Renderer2, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { HEARTBEAT_POLL_MS, HeartbeatState, RoutineHeartbeatService, relativeFromNow } from './routine-heartbeat.service';

/** Marker class the global tint rules hang off (see `src/styles.scss`). */
const TINT_CLASS = 'sc-routine-tint';
/** Class carrying the visually hidden state wording. */
const SR_CLASS = 'sc-routine-tint__sr';
/** State → modifier class. `unknown` deliberately has none: grey is the resting look. */
const STATE_CLASS: Record<HeartbeatState, string | null> = {
  online: 'is-online',
  offline: 'is-offline',
  unknown: null,
};

/**
 * "Is the dev PC reachable?" painted onto the feedback panel's own title
 * (feedback a7573f0e).
 *
 * The first cut of this feature was a separate line — a dot plus the words
 * "Dev-PC erreichbar" above the view switch. The admin sent it back: *"Es soll
 * nicht stehen 'Dev PC erreichbar' sondern nur der Titel oben 'Feedback' soll
 * grün oder Rot markiert sein, also nichts stark Offensichtliches sondern was
 * dezentes aber bemerkbares"*. So the signal moved into the heading itself and
 * lost its own real estate: nothing new appears on screen, an existing word
 * just changes colour.
 *
 * That is why this is a directive and not a component. It owns no markup of its
 * own — it decorates whichever element already says "Feedback" (the FAB panel
 * head when docked or maximized, the `<h1>` on the full board page), so the
 * three states render identically in all three places without any of them
 * growing a status row.
 *
 * Accessibility: colour is never the only carrier. The element keeps a visually
 * hidden state wording (so the heading reads "Feedback (Dev-PC nicht
 * erreichbar)" to a screen reader, and becomes visible under forced colours,
 * where the tint itself is stripped away), plus a `title` naming the last
 * check-in — the "zuletzt gesehen vor …" tooltip the first version had.
 *
 * All DOM work goes through `Renderer2` from a single `effect`: the hidden
 * wording is a child node the directive has to create anyway, so class, tooltip
 * and text are kept on one code path instead of split across host bindings.
 * The host's own title text is never touched.
 */
@Directive({
  selector: '[scRoutineStatus]',
  standalone: true,
})
export class RoutineStatusDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly heartbeat = inject(RoutineHeartbeatService);
  private readonly translate = inject(TranslateService);
  /** Re-runs the wording when the UI language flips (board-wide pattern). */
  private readonly langChange = toSignal(this.translate.onLangChange, { initialValue: null });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const host = this.el.nativeElement;
    this.renderer.addClass(host, TINT_CLASS);

    // Appended once and only ever re-texted, so the host's own content (a
    // translated title that may itself re-render) is left untouched.
    const sr = this.renderer.createElement('span') as HTMLElement;
    this.renderer.addClass(sr, SR_CLASS);
    this.renderer.appendChild(host, sr);

    effect(() => {
      const state = this.heartbeat.state();
      this.langChange();
      const locale = this.translate.currentLang || 'en';
      const when = relativeFromNow(this.heartbeat.lastSeen(), this.heartbeat.checkedAt(), locale);
      // No usable timestamp means we cannot name a moment — fall back to the
      // neutral sentence rather than printing one with a hole in it.
      const detail =
        state === 'unknown' || !when
          ? this.translate.instant('adminFeedback.heartbeat.unknownTitle')
          : this.translate.instant(`adminFeedback.heartbeat.${state}Title`, { time: when });

      for (const cls of Object.values(STATE_CLASS)) {
        if (cls) this.renderer.removeClass(host, cls);
      }
      const active = STATE_CLASS[state];
      if (active) this.renderer.addClass(host, active);

      this.renderer.setAttribute(host, 'title', detail);
      this.renderer.setProperty(sr, 'textContent', ` (${this.translate.instant('adminFeedback.heartbeat.' + state)})`);
    });

    void this.heartbeat.refresh();
    // The directive only lives while the panel is mounted, so its lifetime IS
    // the "while open" the polling is scoped to.
    if (typeof window !== 'undefined') {
      const id = window.setInterval(() => void this.heartbeat.refresh(), HEARTBEAT_POLL_MS);
      destroyRef.onDestroy(() => window.clearInterval(id));
    }
  }
}
