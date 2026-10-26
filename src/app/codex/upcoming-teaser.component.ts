import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BetaService } from '../core/beta.service';
import { FallbackImageComponent } from './fallback-image.component';
import { UpcomingShip, UpcomingShipsService, heroArtOrder, thumbnailCandidates, upcomingRoleLabel } from './upcoming-ships.service';

/** Ships shown in the teaser (concept ships with a render, new ones first). */
const MAX_SLIDES = 5;
/** Time one ship stays up before the next fades in. */
const SLIDE_MS = 7000;

/**
 * Cinematic teaser for the announced ships on the Codex landing (shell beta,
 * implement.md §12): one big render at a time with the ship's name and a way into
 * its page, the whole list one anchor away. The Upcoming list itself stays a tool
 * page (`/codex/upcoming`). Renders nothing with the beta off or without a feed.
 *
 * Rotation pauses on hover and focus and does not run at all under
 * `prefers-reduced-motion`; the dots are real buttons, so it is fully operable
 * without waiting for the timer.
 */
@Component({
  selector: 'sc-upcoming-teaser',
  standalone: true,
  imports: [RouterLink, TranslatePipe, FallbackImageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shell() && current(); as s) {
      <section class="teaser" aria-labelledby="upcoming-teaser-title"
               (mouseenter)="hold.set(true)" (mouseleave)="hold.set(false)"
               (focusin)="hold.set(true)" (focusout)="hold.set(false)">
        <div class="art" aria-hidden="true">
          @for (slide of slides(); track slide.ship.id; let i = $index) {
            <div class="shot" [class.on]="i === index()">
              <sc-fallback-image [candidates]="slide.art" [alt]="''" [eager]="i === 0" />
            </div>
          }
        </div>
        <div class="copy">
          <span class="eyebrow">{{ 'codex.landing.teaser.eyebrow' | translate }}</span>
          <h2 id="upcoming-teaser-title" class="title">{{ 'codex.landing.teaser.title' | translate }}</h2>
          <p class="ship" aria-live="polite">
            <strong>{{ s.name }}</strong>
            @if (role(s); as r) { <span class="role">{{ r }}</span> }
          </p>
          <div class="acts">
            <a class="act primary" [routerLink]="['/codex/upcoming', s.id]">{{ 'codex.landing.teaser.open' | translate }}</a>
            <a class="act" routerLink="/codex/upcoming">{{ 'codex.landing.teaser.all' | translate: { count: total() } }}</a>
          </div>
          @if (slides().length > 1) {
            <div class="dots" role="group" [attr.aria-label]="'codex.landing.teaser.dots' | translate">
              @for (slide of slides(); track slide.ship.id; let i = $index) {
                <button type="button" class="dot" [attr.aria-pressed]="i === index()" [attr.aria-label]="slide.ship.name"
                        (click)="index.set(i)"></button>
              }
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .teaser { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); min-height: 240px;
        border: 1px solid var(--sc-border); border-radius: 4px; overflow: hidden;
        background:
          radial-gradient(ellipse 60% 90% at 85% 40%, color-mix(in srgb, var(--sc-accent) 14%, transparent), transparent 70%),
          var(--sc-bg-1); }
      .copy { grid-column: 1; grid-row: 1; z-index: 1; display: flex; flex-direction: column; justify-content: center; gap: var(--sc-space-2, 8px);
        padding: var(--sc-space-5, 24px) var(--sc-space-5, 24px) var(--sc-space-5, 24px) var(--sc-space-6, 32px); min-width: 0; }
      .art { grid-column: 1 / -1; grid-row: 1; position: relative; z-index: 0; min-height: 0;
        mask-image: linear-gradient(to right, transparent 28%, #000 62%); -webkit-mask-image: linear-gradient(to right, transparent 28%, #000 62%); }
      .shot { position: absolute; inset: 0 0 0 38%; display: grid; place-items: center; opacity: 0; transition: opacity 0.9s ease;
        --sc-img-w: 100%; --sc-img-h: 100%; --sc-img-fit: cover; --sc-img-max-h: none; --sc-img-shadow: none; }
      .shot.on { opacity: 1; }
      .eyebrow { font: 600 max(0.7rem, var(--sc-fs-floor)) var(--sc-font-display); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
      .title { margin: 0; font: 400 1.5rem/1.15 var(--sc-font-display); letter-spacing: 0.06em; color: var(--sc-fg-0); }
      .ship { margin: 0; display: flex; flex-direction: column; gap: 2px; color: var(--sc-fg-1); }
      .ship strong { font-size: 1.1rem; color: var(--sc-fg-0); }
      .role { font-size: 0.85rem; color: var(--sc-fg-2); }
      .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: var(--sc-space-2, 8px); }
      .act { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); padding: 0 var(--sc-space-3, 12px); border-radius: 8px;
        border: 1px solid var(--sc-border); color: var(--sc-fg-1); background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
        font: 0.85rem inherit; text-decoration: none; }
      .act.primary { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0); }
      .act:hover, .act:focus-visible { border-color: var(--sc-accent); color: var(--sc-fg-0); outline: none; text-decoration: none; }
      .act:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
      .dots { display: flex; gap: 2px; margin-top: var(--sc-space-1, 4px); }
      .dot { position: relative; width: 28px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer; }
      .dot::before { content: ''; position: absolute; inset: 10px 4px; border-radius: 4px; background: var(--sc-border); transition: background 0.2s; }
      .dot[aria-pressed='true']::before { background: var(--sc-accent); }
      .dot:hover::before, .dot:focus-visible::before { background: var(--sc-fg-1); }
      .dot:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 0; border-radius: 6px; }
      @media (pointer: coarse) { .dot { width: 44px; height: 44px; } .dot::before { inset: 18px 8px; } }
      @media (max-width: 760px) {
        .teaser { grid-template-columns: minmax(0, 1fr); grid-template-rows: 180px auto; }
        .art { grid-row: 1; mask-image: linear-gradient(to bottom, #000 55%, transparent); -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent); }
        .shot { inset: 0; }
        .copy { grid-row: 2; padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px) var(--sc-space-4, 16px); }
      }
      @media (prefers-reduced-motion: reduce) { .shot { transition: none; } }
    `,
  ],
})
export class UpcomingTeaserComponent {
  private readonly svc = inject(UpcomingShipsService);
  private readonly translate = inject(TranslateService);
  protected readonly shell = inject(BetaService).isEnabled('shell');

  protected readonly index = signal(0);
  protected readonly hold = signal(false);

  /** Concept ships that have a render: the ones new since the last visit first. */
  protected readonly slides = computed(() => {
    if (!this.shell()) return [];
    const fresh = this.svc.newIds();
    const withArt = this.svc
      .concept()
      .map((ship) => ({ ship, art: heroArtOrder(thumbnailCandidates(ship)) }))
      .filter((s) => s.art.length > 0);
    withArt.sort((a, b) => Number(fresh.has(b.ship.id)) - Number(fresh.has(a.ship.id)));
    return withArt.slice(0, MAX_SLIDES);
  });
  protected readonly current = computed<UpcomingShip | null>(() => this.slides()[this.index()]?.ship ?? null);
  protected readonly total = computed(() => this.svc.feed()?.counts?.total ?? this.svc.feed()?.ships.length ?? 0);

  constructor() {
    effect(() => {
      if (this.shell()) void this.svc.ensureLoaded();
    });
    effect((onCleanup) => {
      const n = this.slides().length;
      if (n < 2 || this.hold() || reducedMotion()) return;
      const t = setInterval(() => this.index.update((i) => (i + 1) % n), SLIDE_MS);
      onCleanup(() => clearInterval(t));
    });
  }

  protected role(ship: UpcomingShip): string {
    const value = ship.focus ?? ship.type;
    return value ? upcomingRoleLabel(value, (k) => this.translate.instant(k)) : '';
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
