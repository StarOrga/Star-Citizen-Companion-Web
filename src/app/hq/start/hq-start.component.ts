import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { StageHeroDirective } from '../../shell/fusion-bar/stage-hero.directive';
import { StageSearchDirective } from '../../shell/fusion-bar/stage-search.directive';
import { HqPatchHit } from './hq-start-feed.service';
import { HqStartTilesComponent } from './hq-start-tiles.component';

/**
 * The Start page of the HQ landing: the main page hero (eyebrow, title, the bar's own search field
 * standing in the scene through `[scStageSearch]`) and below it the tiles to the three pages.
 * The most important patch hit replaces eyebrow and title, as the Codex hero does with its news.
 * The zoomed hub planet behind it is the shell scene, and the page cue is the landing's
 * (`HqPagesComponent`). This page paints no background of its own.
 */
@Component({
  selector: 'sc-hq-start',
  standalone: true,
  imports: [RouterLink, TranslatePipe, StageHeroDirective, StageSearchDirective, HqStartTilesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-stage-hero hero" scStageHero>
      @if (patch(); as p) {
        <p class="kicker">{{ eyebrowKey() | translate: { plan: p.plan, build: p.build } }}</p>
        <h1 class="title">
          @if (p.link) {
            <a class="hit" [routerLink]="p.link">{{ effectKey() | translate: { name: p.name, pct: pct() } }}</a>
          } @else {
            {{ effectKey() | translate: { name: p.name, pct: pct() } }}
          }
        </h1>
      } @else {
        <p class="kicker">{{ 'hq.start.kicker' | translate }}</p>
        <h1 class="title">{{ 'hq.start.title' | translate }}</h1>
      }
      <div scStageSearch></div>
    </div>
    <sc-hq-start-tiles class="area" />
  `,
  styles: [
    `
      :host {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
        /* The page stage starts under the shell header: fill the rest of the viewport (D5). */
        min-height: calc(100svh - var(--hq-start-top, 0px));
        padding-bottom: calc(var(--sc-space-8, 64px) + var(--sc-space-3, 12px));
      }
      .hero { padding-top: var(--sc-space-8, 64px); }
      .kicker { margin: 0; font: var(--sc-hero-eyebrow); letter-spacing: 0.24em; text-transform: uppercase; color: var(--sc-accent); }
      .title { margin: max(6px, 0.6vw) 0 0; font: 500 var(--sc-hero-title-size) / 1.1 var(--sc-font-display); letter-spacing: 0.02em; overflow-wrap: anywhere; }
      .hit { color: inherit; text-decoration: none; }
      .hit:hover { color: var(--sc-accent); }
      .hit:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .area { width: min(100%, 1120px); margin-top: var(--sc-space-7, 48px); }
      /* Phones: the bottom bar is the way on, there is no cue to clear. */
      @media (max-width: 1023px) {
        :host { padding-bottom: var(--sc-space-6, 32px); }
        .area { margin-top: var(--sc-space-5, 24px); }
      }
    `,
  ],
})
export class HqStartComponent {
  private readonly i18n = inject(TranslateService);

  /** The patch hit that takes the hero; null shows the plain title. */
  readonly patch = input<HqPatchHit | null>(null);

  protected readonly eyebrowKey = computed(() => {
    const p = this.patch();
    if (p?.plan && p.build) return 'hq.start.patch.eyebrow';
    if (p?.plan) return 'hq.start.patch.eyebrowPlan';
    return p?.build ? 'hq.start.patch.eyebrowBuild' : 'hq.start.patch.eyebrowPlain';
  });
  protected readonly effectKey = computed(() => (this.patch()?.weaker ? 'hq.start.patch.weaker' : 'hq.start.patch.stronger'));
  protected readonly pct = computed(() =>
    new Intl.NumberFormat(this.i18n.getCurrentLang() || undefined, { maximumFractionDigits: 1 }).format(this.patch()?.pct ?? 0),
  );
}
