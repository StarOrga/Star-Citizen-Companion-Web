import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ToastSlotDirective } from '../toast-stack/toast-stack';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { BetaService } from '../../core/beta.service';
import { VerseApiService } from '../../verse/data/verse-api.service';
import { StarEarnedEvent } from '../../verse/data/verse.models';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

/** How long a toast stays before it dismisses itself (paused while hovered or focused). */
export const STAR_TOAST_MS = 8000;

/** Unlock keys in the order the toast prefers to name them (most valuable first). */
const UNLOCK_PRIORITY = [
  'wallpaper', 'supernova', 'meteor', 'reserve', 'live', 'nebula', 'road', 'community', 'logEntry', 'kartograph', 'sunCollection',
] as const;

/**
 * App-wide "star lit" toast: one non-blocking card bottom-right (above the
 * feedback launcher), fed by `VerseApiService.starEarned$`. Shown only while the
 * Verse β is on and the user is signed in. Several events queue and show one
 * after another. The whole card is a real anchor to the star map.
 */
@Component({
  selector: 'sc-star-toast',
  standalone: true,
  imports: [ToastSlotDirective, RouterLink, TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (ev of shown(); track ev) {
      <div class="toast" scToastSlot role="status" aria-live="polite" [class.paused]="held()"
           (mouseenter)="hold(true)" (mouseleave)="hold(false)" (focusin)="hold(true)" (focusout)="hold(false)">
        <i class="star" aria-hidden="true">★</i>
        <a class="body" routerLink="/verse/explorer">
          <small>{{ ev.patchLine }}</small>
          <b>{{ 'verse.toast.lit' | translate: { task: taskName(ev) } }}</b>
          <span class="count">{{ 'verse.toast.count' | translate: { lit: ev.lit, total: ev.total } }}</span>
          <span class="note">{{ note(ev) }}</span>
        </a>
        <button type="button" class="x" (click)="dismiss()" [attr.aria-label]="'verse.toast.close' | translate"
                [scTooltip]="'verse.toast.close' | translate">×</button>
        <i class="drain" aria-hidden="true" [style.animation-duration.ms]="duration"></i>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .toast {
      position: fixed; z-index: 1450;
      inset-inline-end: var(--sc-fab-gutter, 16px);
      bottom: calc(var(--sc-toast-bottom, var(--sc-fab-clear-block, 80px)) + var(--sc-toast-offset, 0px));
      width: min(var(--sc-toast-w, 24rem), calc(100vw - 2 * var(--sc-fab-gutter, 16px)));
      display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: start;
      padding: 14px 14px 16px; border-radius: 14px; overflow: hidden;
      background: color-mix(in srgb, var(--sc-bg-1) 94%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55), 0 0 30px color-mix(in srgb, var(--sc-accent) 14%, transparent);
      backdrop-filter: blur(10px);
      animation: toast-in 0.28s ease-out both;
    }
    .star { font-style: normal; font-size: 22px; line-height: 1; color: var(--sc-accent); text-shadow: 0 0 10px var(--sc-accent); }
    .body { display: grid; gap: 3px; color: inherit; text-decoration: none; min-width: 0; border-radius: 6px; }
    .body small { font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.18em; text-transform: uppercase; color: var(--sc-accent); }
    .body b { font-size: 0.95rem; font-weight: 600; color: var(--sc-fg-0); }
    .count { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .note { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .body:hover b, .body:focus-visible b { text-decoration: underline; }
    .body:focus-visible, .x:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .x {
      width: 32px; height: 32px; border-radius: 50%; padding: 0; cursor: pointer; font-size: 16px; line-height: 1;
      background: none; border: 1px solid var(--sc-border); color: var(--sc-fg-2);
    }
    .x:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .drain {
      position: absolute; inset: auto 0 0 0; height: 2px; background: var(--sc-accent); transform-origin: left center;
      animation: toast-drain linear forwards;
    }
    .toast.paused .drain { animation-play-state: paused; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes toast-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: toast-fade 0.2s linear both; }
      @keyframes toast-fade { from { opacity: 0; } to { opacity: 1; } }
    }
  `],
})
export class StarToastComponent {
  private readonly api = inject(VerseApiService);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly betaOn = inject(BetaService).isEnabled('verse');

  protected readonly duration = STAR_TOAST_MS;
  private readonly queue: StarEarnedEvent[] = [];
  readonly current = signal<StarEarnedEvent | null>(null);
  /** One-element list so each new event gets a fresh DOM node (restarts the animations). */
  protected readonly shown = computed(() => {
    const c = this.current();
    return c ? [c] : [];
  });
  protected readonly held = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = STAR_TOAST_MS;
  private startedAt = 0;

  private readonly enabled = computed(() => this.betaOn() && this.auth.isAuthenticated());

  constructor() {
    const sub = this.api.starEarned$.subscribe((ev) => {
      if (!this.enabled()) return;
      if (this.current()) this.queue.push(ev);
      else this.show(ev);
    });
    inject(DestroyRef).onDestroy(() => { sub.unsubscribe(); this.stop(); });
    // Signing out or switching the β off drops whatever is pending.
    effect(() => {
      if (!this.enabled()) {
        this.queue.length = 0;
        this.stop();
        this.held.set(false);
        this.current.set(null);
      }
    });
  }

  protected taskName(ev: StarEarnedEvent): string {
    const camel = ev.key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const key = `starmap.task.${camel}.title`;
    const t = this.translate.instant(key);
    return t === key ? this.translate.instant('verse.toast.genericTask') : t;
  }

  protected note(ev: StarEarnedEvent): string {
    const hit = UNLOCK_PRIORITY.find((k) => ev.unlocked.includes(k));
    if (hit) return this.translate.instant(`verse.toast.unlock.${hit}`);
    const left = Math.max(0, ev.total - ev.lit);
    return left > 0 ? this.translate.instant('verse.toast.remaining', { n: left }) : '';
  }

  protected hold(on: boolean): void {
    if (!this.current() || on === this.held()) return;
    this.held.set(on);
    if (on) {
      this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
      this.stop();
    } else {
      this.arm();
    }
  }

  protected dismiss(): void {
    this.stop();
    this.held.set(false);
    const next = this.queue.shift();
    if (next) this.show(next);
    else this.current.set(null);
  }

  private show(ev: StarEarnedEvent): void {
    this.remaining = STAR_TOAST_MS;
    this.current.set(ev);
    this.arm();
  }

  private arm(): void {
    this.stop();
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.dismiss(), this.remaining);
  }

  private stop(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }
}
