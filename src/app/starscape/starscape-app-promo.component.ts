import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/** Permanent opt-out — only the ✕ writes this (admin feedback eb9c6ec3). */
const DISMISS_KEY = 'sc.starscapePromo.dismissed';
/** One pitch per browser session, so tab-hopping back to Starscape never nags. */
const SESSION_KEY = 'sc.starscapePromo.shown';
/** The app is a Windows tray tool — pointless to pitch on a phone or tablet. */
const MIN_WIDTH = 900;
/** Delay before the pitch appears, so the gallery gets the first impression. */
const DELAY_MS = 3000;
/** Dwell time per wallpaper in the mock monitor. */
const ROTATE_MS = 2600;

/**
 * The Starscape download pitch (admin feedback eb9c6ec3). The download button in
 * the header is easy to miss and does not explain what the app is *for* — so
 * three seconds after landing on the Starscape view, a small poster slides in
 * that simply shows the product: a mock desktop whose wallpaper crossfades
 * through real gallery images, which is exactly what the tray app does.
 *
 * Frequency rules, per the admin's spec: once per browser session (sessionStorage),
 * three seconds after arriving; the ✕ opts out permanently (localStorage); any
 * other close only ends it for this session, so it returns on the next visit.
 * Never shown on the Data-Uploader side — that tool needs no advertising.
 */
@Component({
  selector: 'sc-starscape-app-promo',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <aside class="promo" role="note" [attr.aria-label]="'starscape.promo.title' | translate">
        <!-- The "image": a desktop mock whose wallpaper crossfades — a live demo
             of the app rather than a screenshot of it. -->
        <div class="screen" aria-hidden="true">
          @for (p of posters(); track p; let i = $index) {
            <img class="shot" [class.on]="i === frame()" [src]="p" alt="" decoding="async" />
          }
          <span class="glare"></span>
          <span class="taskbar"></span>
        </div>
        <div class="stand" aria-hidden="true"></div>

        <div class="body">
          <span class="eyebrow">{{ 'starscape.promo.eyebrow' | translate }}</span>
          <strong class="title">{{ 'starscape.promo.title' | translate }}</strong>
          <span class="desc">{{ 'starscape.promo.desc' | translate }}</span>
          <a class="cta" [href]="downloadUrl()" target="_blank" rel="noopener noreferrer" download
             (click)="closeForSession()">
            ↓ {{ 'starscape.promo.cta' | translate }}
            @if (version(); as v) { <span class="cta-ver">v{{ v }}</span> }
          </a>
          <span class="note">{{ 'starscape.promo.note' | translate }}</span>
        </div>

        <button type="button" class="x" (click)="dismissForever()"
                [attr.aria-label]="'starscape.promo.dismiss' | translate"
                [title]="'starscape.promo.dismiss' | translate">✕</button>
      </aside>
    }
  `,
  styles: [`
    .promo {
      position: fixed; right: 22px; bottom: 22px; z-index: 900;
      width: 320px; display: flex; flex-direction: column; gap: 0;
      padding: 14px 16px 16px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent);
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55),
                  0 0 22px color-mix(in srgb, var(--sc-accent) 22%, transparent);
      animation: promo-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    @keyframes promo-in {
      from { opacity: 0; transform: translateY(18px) scale(0.96); }
      to { opacity: 1; transform: none; }
    }

    /* Desktop mock — the crossfading "wallpaper" is the whole pitch. */
    .screen {
      position: relative; width: 100%; aspect-ratio: 16 / 10;
      border: 2px solid color-mix(in srgb, var(--sc-fg-2) 45%, var(--sc-bg-0));
      border-radius: 6px; overflow: hidden; background: var(--sc-bg-0);
    }
    .shot {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover; opacity: 0;
      transition: opacity 1.1s ease;
    }
    .shot.on { opacity: 1; }
    .glare {
      position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(115deg, rgba(255,255,255,0.16) 0%, transparent 42%);
    }
    .taskbar {
      position: absolute; left: 0; right: 0; bottom: 0; height: 8%;
      background: rgba(0, 0, 0, 0.55);
      border-top: 1px solid rgba(255, 255, 255, 0.12);
    }
    .stand {
      width: 54px; height: 8px; margin: 0 auto 10px;
      border-radius: 0 0 5px 5px;
      background: color-mix(in srgb, var(--sc-fg-2) 40%, var(--sc-bg-0));
    }

    .body { display: flex; flex-direction: column; gap: 3px; }
    .eyebrow {
      font-family: var(--sc-font-display); font-size: 0.6rem;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-accent);
    }
    .title { font-family: var(--sc-font-display); font-size: 0.94rem; color: var(--sc-fg-0); }
    .desc { font-size: 0.74rem; color: var(--sc-fg-2); line-height: 1.4; }
    .cta {
      align-self: flex-start; margin-top: 8px;
      display: inline-flex; align-items: baseline; gap: 6px;
      padding: 5px 14px; border-radius: 999px;
      font-size: 0.78rem; text-decoration: none; white-space: nowrap;
      color: var(--sc-bg-0); background: var(--sc-accent); border: 1px solid var(--sc-accent);
      transition: filter 0.16s ease;
    }
    .cta:hover { filter: brightness(1.12); }
    .cta-ver { font-size: 0.68rem; opacity: 0.75; font-variant-numeric: tabular-nums; }
    .note { margin-top: 6px; font-size: 0.62rem; color: var(--sc-fg-2); opacity: 0.8; line-height: 1.4; }

    .x {
      position: absolute; top: 6px; right: 8px;
      background: rgba(0, 0, 0, 0.45); border: 0; border-radius: 50%;
      width: 22px; height: 22px; line-height: 1;
      color: var(--sc-fg-1); font-size: 0.74rem; cursor: pointer;
    }
    .x:hover { color: var(--sc-fg-0); background: rgba(0, 0, 0, 0.7); }

    @media (prefers-reduced-motion: reduce) {
      .promo { animation: none; }
      .shot { transition: none; }
    }
    /* Belt-and-braces with the width check in TS: a tray app for Windows has no
       business pitching itself on a small screen. */
    @media (max-width: 900px) {
      .promo { display: none; }
    }
  `],
})
export class StarscapeAppPromoComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  /** Preview urls used as the mock desktop's rotating wallpaper. */
  readonly wallpapers = input<readonly string[]>([]);
  readonly downloadUrl = input.required<string>();
  readonly version = input<string | null>(null);

  readonly visible = signal(false);
  readonly frame = signal(0);

  /** At most three stills — enough to read as a rotation, cheap to decode. */
  readonly posters = computed(() => this.wallpapers().slice(0, 3));

  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private rotateTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.clearTimers());
    if (!this.eligible()) return;
    this.showTimer = setTimeout(() => this.reveal(), DELAY_MS);
  }

  private eligible(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.innerWidth < MIN_WIDTH) return false;
    return !this.flag(localStorage, DISMISS_KEY) && !this.flag(sessionStorage, SESSION_KEY);
  }

  private reveal(): void {
    this.visible.set(true);
    this.mark(sessionStorage, SESSION_KEY);
    if (this.posters().length > 1) {
      this.rotateTimer = setInterval(
        () => this.frame.update((i) => (i + 1) % this.posters().length),
        ROTATE_MS,
      );
    }
  }

  /** ✕ — the admin's explicit "never show this again". */
  dismissForever(): void {
    this.mark(localStorage, DISMISS_KEY);
    this.closeForSession();
  }

  /** Any other close (Esc, following the CTA) — it returns on the next visit. */
  closeForSession(): void {
    this.visible.set(false);
    this.clearTimers();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) this.closeForSession();
  }

  private clearTimers(): void {
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.rotateTimer) clearInterval(this.rotateTimer);
    this.showTimer = null;
    this.rotateTimer = null;
  }

  private flag(store: Storage, key: string): boolean {
    try {
      return store.getItem(key) === '1';
    } catch {
      // Private mode / storage disabled — treat as "not set" so the pitch still
      // works; the worst case is that it reappears next visit.
      return false;
    }
  }

  private mark(store: Storage, key: string): void {
    try {
      store.setItem(key, '1');
    } catch {
      /* private mode — the flag simply does not persist */
    }
  }
}
