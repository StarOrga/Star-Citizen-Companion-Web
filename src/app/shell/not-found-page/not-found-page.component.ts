import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Route, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AppLogoComponent } from '../../shared/app-logo/app-logo.component';
import { QuantumStreaksComponent } from '../../shared/quantum-streaks/quantum-streaks.component';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { knownTopLevel, suggestRoutes } from './suggest-routes';

/** The router config's top-level paths, looking through the layout parents (`path: ''`). */
function configPaths(routes: readonly Route[]): string[] {
  const out: string[] = [];
  for (const r of routes) {
    if (r.path === '' && r.children) out.push(...configPaths(r.children));
    else if (r.path !== undefined) out.push(r.path);
  }
  return out;
}

/**
 * The real 404 (concept 2026-11-09, round 3, screen 5): replaces the old
 * `** -> verse` redirect. A big "4 · round logo · 4" with the entry transition
 * (fast loading streaks fade out, the logo settles in as the 0, the 4s land
 * beside it, slower streaks keep running), the typed address with the unknown
 * segment marked, up to two "Meintest du" suggestions from the known top-level
 * routes and the one primary way home. No search field (the header has one) and
 * no destination list (the page footer has Verse, Codex and HQ). Lives inside
 * the shell, so a signed-out visitor is sent to the login by the shell guards
 * like for every other route.
 */
@Component({
  selector: 'sc-not-found-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective, AppLogoComponent, QuantumStreaksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="nf" aria-labelledby="nf-title">
      <h1 class="sc-sr-only">{{ 'notFoundPage.srTitle' | translate }}</h1>
      <div class="hero" aria-hidden="true">
        <sc-quantum-streaks class="fast" speed="fast" [fadeOut]="true" />
        <span class="slow"><sc-quantum-streaks speed="slow" /></span>
        <span class="dig dig-a">4</span>
        <span class="zero"><sc-app-logo size="0.82em" /></span>
        <span class="dig dig-b">4</span>
      </div>
      <h2 id="nf-title" class="title">{{ 'notFoundPage.title' | translate }}</h2>
      <p class="lead">
        {{ 'notFoundPage.lead' | translate }}
        <code class="addr" dir="ltr">/@for (p of parts(); track $index) {@if ($index > 0) {/}@if (p.bad) {<mark>{{ p.text }}</mark>} @else {{{ p.text }}}}</code>
      </p>
      @if (suggestions().length) {
        <p class="mean">
          <span class="mean-l">{{ 'notFoundPage.didYouMean' | translate }}</span>
          @for (s of suggestions(); track s) {
            <a class="mean-a" [routerLink]="['/', s]">/{{ s }}</a>
          }
        </p>
      }
      <a scAction tier="primary" class="home" routerLink="/">{{ 'notFoundPage.home' | translate }}</a>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .nf {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--sc-space-4);
      min-height: min(70dvh, 640px);
      text-align: center;
      overflow-x: clip;
    }
    .hero {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: .04em;
      font-family: var(--sc-font-display);
      font-weight: 700;
      font-size: clamp(96px, 26vw, 200px);
      line-height: 1;
    }
    .slow { position: absolute; inset: 0; opacity: .85; animation: nf-in 1s ease-out .5s both; }
    .dig {
      position: relative;
      z-index: 2;
      display: block;
      color: transparent;
      background: linear-gradient(180deg, #f2fbff 0%, #a6e8fb 38%, #52c1e6 70%, rgba(47, 143, 181, .55) 100%);
      -webkit-background-clip: text;
      background-clip: text;
      filter: drop-shadow(0 0 22px rgba(82, 193, 230, .35));
      animation: nf-land .8s cubic-bezier(.16, .9, .24, 1) .7s both;
    }
    .dig-b { animation-delay: .8s; }
    .zero {
      position: relative;
      z-index: 2;
      flex: none;
      display: block;
      margin: 0 .02em;
      transform: translateY(-.03em);
      animation: nf-settle 1.1s cubic-bezier(.2, .8, .2, 1) both;
    }
    .title {
      margin: 0;
      font-family: var(--sc-font-display);
      font-size: 24px;
      line-height: 1.2;
      font-weight: 600;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--sc-fg-0);
    }
    .lead, .mean { margin: 0; color: var(--sc-fg-1); font-size: 14px; max-width: var(--sc-measure, 52ch); overflow-wrap: anywhere; }
    .addr {
      font-family: var(--sc-font-mono, ui-monospace, monospace);
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(0, 0, 0, .3);
      box-shadow: inset 0 0 0 1px var(--sc-border);
    }
    mark { background: none; color: var(--sc-accent); border-bottom: 1px dashed var(--sc-accent); }
    .mean { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--sc-space-2); }
    .mean-a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 0 var(--sc-space-4);
      border-radius: 999px;
      border: 1px solid var(--sc-border);
      color: var(--sc-accent);
      text-decoration: none;
      font-family: var(--sc-font-mono, ui-monospace, monospace);
    }
    .mean-a:hover, .mean-a:focus-visible { border-color: var(--sc-accent); }
    .home { margin-top: var(--sc-space-1); }
    @media (max-width: 600px) {
      .home { align-self: stretch; justify-content: center; }
    }
    @keyframes nf-in { 0% { opacity: 0; } 100% { opacity: .85; } }
    @keyframes nf-land {
      0% { opacity: 0; transform: scale(2.4, .3); filter: blur(8px) drop-shadow(0 0 22px rgba(82, 193, 230, .35)); }
      45% { opacity: 1; transform: scale(.96, 1.04); filter: blur(0) drop-shadow(0 0 30px rgba(143, 227, 255, .6)); }
      100% { opacity: 1; transform: none; filter: drop-shadow(0 0 22px rgba(82, 193, 230, .35)); }
    }
    @keyframes nf-settle {
      0% { opacity: 0; transform: translateY(-.03em) scale(.06); filter: brightness(2.4); }
      14% { opacity: 1; transform: translateY(-.03em) scale(.08); filter: brightness(2.4); }
      62% { transform: translateY(-.03em) scale(1.06); filter: brightness(1.2); }
      100% { opacity: 1; transform: translateY(-.03em) scale(1); filter: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .slow, .dig, .zero { animation: none; opacity: 1; }
      .slow { opacity: .85; }
      .fast { display: none; }
    }
  `],
})
export class NotFoundPageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** The segments the wildcard swallowed, decoded by the router. */
  private readonly segments = computed(() =>
    this.route.snapshot.url.map((s) => s.path).filter((s) => s.length > 0),
  );

  private readonly known = computed(() => knownTopLevel(configPaths(this.router.config)));

  /** The typed address in pieces; the unknown segment is `bad`. */
  protected readonly parts = computed(() => {
    const segs = this.segments();
    const known = this.known();
    const badIndex = segs.length === 0 ? -1 : known.includes(segs[0].toLowerCase()) && segs.length > 1 ? 1 : 0;
    return segs.slice(0, 8).map((text, i) => ({ text: text.length > 60 ? `${text.slice(0, 60)}…` : text, bad: i === badIndex }));
  });

  protected readonly suggestions = computed(() => suggestRoutes(this.segments().join('/'), this.known()));
}
