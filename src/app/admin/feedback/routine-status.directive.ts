import { DestroyRef, Directive, ElementRef, Renderer2, effect, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { HEARTBEAT_POLL_MS, HeartbeatState, RoutineHeartbeatService, relativeFromNow } from './routine-heartbeat.service';

/** Marker class the global tint rules hang off (see `src/styles.scss`). */
const TINT_CLASS = 'sc-routine-tint';
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
 * **The directive adds no text node, ever.** The round after that one shipped a
 * visually hidden `<span>` inside the title, and it turned up on screen as a
 * prefix — the heading read "(DEV-PC ERREICHBAR)Feedback" instead of a tinted
 * "Feedback", which is exactly the line the admin had just asked us to remove
 * ("Sollte aber NUR 'Feedback' heißen, und das dann Rot oder Grün entsprechend
 * einfärben"). A clip-rect span is only invisible while every stylesheet that
 * could reach it behaves; the safe version is not to put the wording in the
 * document at all. The state now rides on `aria-label` plus the `title`
 * tooltip: both are genuine non-colour carriers for assistive tech, and neither
 * can ever leak into the layout, whatever CSS does or fails to load.
 *
 * The host's own title stays the single source of the visible text — the
 * directive only ever touches classes and attributes on it, never its content.
 * `scRoutineStatus` takes the translation key of that title as a plain static
 * attribute value (`scRoutineStatus="feedbackFab.title"`) so the accessible
 * name can stay "Feedback — Dev-PC erreichbar" instead of collapsing to the
 * state alone. Static, not a binding, on purpose: the attribute has to survive
 * into the DOM because the global tint rules select on it.
 */
@Directive({
  selector: '[scRoutineStatus]',
  standalone: true,
})
export class RoutineStatusDirective {
  /** i18n key of the title we decorate, so the accessible name keeps it. */
  readonly titleKey = input('', { alias: 'scRoutineStatus' });

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
      const wording = this.translate.instant(`adminFeedback.heartbeat.${state}`);

      for (const cls of Object.values(STATE_CLASS)) {
        if (cls) this.renderer.removeClass(host, cls);
      }
      const active = STATE_CLASS[state];
      if (active) this.renderer.addClass(host, active);

      this.renderer.setAttribute(host, 'title', detail);
      // Without a key we would rather name only the state than silently rename
      // the heading to nothing — but both call sites pass one.
      const key = this.titleKey();
      const label = key
        ? this.translate.instant('adminFeedback.heartbeat.ariaLabel', {
            title: this.translate.instant(key),
            state: wording,
          })
        : wording;
      this.renderer.setAttribute(host, 'aria-label', label);
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
