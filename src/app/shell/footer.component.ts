import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { isVerseHome } from './scene/scene.model';
import { AuthService } from '../auth/auth.service';
import { BetaService } from '../core/beta.service';
import { LayoutService } from '../core/layout/layout.service';
import { ScDialogDirective } from '../shared/dialog/sc-dialog.directive';
import { BetaChipComponent } from './corners/beta-chip.component';
import { HandoffButtonComponent } from './corners/handoff-button.component';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { ReleaseSeenService } from '../release-notes/release-seen.service';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

/**
 * Site-wide footer. Shown on both the public login page and inside the
 * authenticated shell. Carries the "Made by the Community" fan badge and
 * the trademark disclaimer required for a Star Citizen fan site.
 */
@Component({
  selector: 'sc-footer',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScTooltipDirective, ScDialogDirective, NgTemplateOutlet, BetaChipComponent, HandoffButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shellOn()) {
      <footer class="sf" [class.sf-stage]="stage()" [attr.data-footer]="stage() ? 'stage' : 'end'">
        <div class="sf-badge" (mouseenter)="peek()" (mouseleave)="unpeek()" (focusout)="onFocusOut($event)">
          <button type="button" class="sf-badge-btn" aria-haspopup="dialog"
                  [attr.aria-expanded]="bubble() === 'pinned'"
                  [attr.aria-describedby]="bubble() === 'peek' ? 'sf-bubble' : null"
                  (click)="togglePinned()" (focus)="peek()" (keydown.escape)="bubble.set('closed')">
            <img src="icons/made-by-community.png" [alt]="'footer.badgeAlt' | translate" width="32" height="32" />
            <span class="sf-word">{{ 'footer.madeByCommunity' | translate }}</span>
          </button>
          @if (bubble() === 'pinned') {
            <div class="sf-bubble" id="sf-bubble" scDialog role="dialog" [attr.aria-label]="'footer.disclaimerTitle' | translate">
              <ng-container *ngTemplateOutlet="disclaimerBody" />
            </div>
          } @else if (bubble() === 'peek') {
            <div class="sf-bubble" id="sf-bubble" role="tooltip">
              <ng-container *ngTemplateOutlet="disclaimerBody" />
            </div>
          }
        </div>
        <nav class="sf-links" [attr.aria-label]="'footer.legalNav' | translate">
          <a routerLink="/release-notes" class="sf-news">{{ 'footer.links.news' | translate }}@if (seen.unseen()) {<span class="new-dot" aria-hidden="true"></span><span class="sc-sr-only"> ({{ 'footer.links.aboutNew' | translate }})</span>}</a>
          <span aria-hidden="true">·</span>
          <a routerLink="/about">{{ 'footer.links.about' | translate }}</a>
          <span aria-hidden="true">·</span>
          <a routerLink="/legal/privacy">{{ 'footer.links.privacy' | translate }}</a>
          <span aria-hidden="true">·</span>
          <a routerLink="/legal/imprint">{{ 'footer.links.imprint' | translate }}</a>
        </nav>
      </footer>
      <ng-template #disclaimerBody>
        <p>{{ 'footer.disclaimer' | translate }}</p>
        <p class="sf-tm">{{ 'footer.trademarks' | translate }}</p>
      </ng-template>
      <sc-beta-chip />
      @if (auth.user()) {
        <sc-handoff-button />
      }
    } @else {
    <footer class="site-footer" [class.overlay]="overlay()">
      <div class="inner">
        <div class="badge">
          <img src="icons/made-by-community.png"
               [alt]="'footer.badgeAlt' | translate"
               width="36" height="36" />
          <span class="badge-label">{{ 'footer.madeByCommunity' | translate }}</span>
        </div>

        <div class="meta">
          <p class="brand">Star Citizen Companion</p>
          @if (expanded()) {
            <p class="disclaimer">{{ 'footer.disclaimer' | translate }}</p>
            <p class="copyright">
              {{ 'footer.trademarks' | translate }}
              <button type="button" class="disclaimer-toggle"
                      (click)="expanded.set(false)"
                      [attr.aria-label]="'footer.disclaimerCollapse' | translate"
                      [scTooltip]="'footer.disclaimerCollapse' | translate"
                      scTooltipTier="label">▲</button>
            </p>
          } @else {
            <p class="disclaimer" [scTooltip]="overlay() ? ('footer.disclaimer' | translate) : ''">{{ disclaimerShort() }}<button
                      type="button" class="disclaimer-toggle"
                      (click)="expanded.set(true)"
                      [attr.aria-label]="'footer.disclaimerExpand' | translate"
                      [scTooltip]="'footer.disclaimerExpand' | translate"
                      scTooltipTier="label">…</button></p>
          }
        </div>

        <div class="whatsnew">
          <nav class="legal-links" [attr.aria-label]="'footer.legalNav' | translate">
            <a routerLink="/about" class="about-link">{{ 'footer.links.about' | translate }}@if (seen.unseen()) {<span class="new-dot" aria-hidden="true"></span><span class="sc-sr-only"> ({{ 'footer.links.aboutNew' | translate }})</span>}</a>
            <span aria-hidden="true">·</span>
            <a routerLink="/legal/privacy">{{ 'footer.links.privacy' | translate }}</a>
            <span aria-hidden="true">·</span>
            <a routerLink="/legal/imprint">{{ 'footer.links.imprint' | translate }}</a>
          </nav>
        </div>
      </div>
    </footer>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* ---- Shell beta footer: no background, no line ---- */
    .sf {
      position: relative; margin-top: auto; box-sizing: border-box;
      display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-4);
      padding: var(--sc-space-2) var(--sc-page-gutter) calc(var(--sc-space-2) + var(--sc-safe-bottom, 0px));
      min-height: var(--sc-footer-h);
    }
    /* Hub stage: the footer sits on the stage's bottom edge and scrolls along
       (in flow, pulled up over the stage by its own height), infos centred. */
    /* The bottom-right corner is the feedback launcher's, and beside it the share
       button's lane: the footer's last link ends before both. */
    @media (min-width: 721px) {
      .sf { padding-inline-end: max(var(--sc-page-gutter), calc(var(--sc-fab-clear-inline) + var(--sc-space-2) + 44px)); }
      /* The left corner is the hand-off launcher's (same lane as the feedback one):
         "Made by the Community" starts after it. */
      .sf { padding-inline-start: max(var(--sc-page-gutter), var(--sc-fab-clear-inline)); }
      .sf-stage .sf-badge { left: max(var(--sc-page-gutter), var(--sc-fab-clear-inline)); }
    }
    .sf-stage { margin-top: calc(-1 * var(--sc-footer-h)); justify-content: center; pointer-events: none; z-index: 2; }
    .sf-stage > * { pointer-events: auto; }
    .sf-stage .sf-badge { position: absolute; left: var(--sc-page-gutter); bottom: var(--sc-space-2); }
    .sf-badge { position: relative; }
    /* The badge sits over the scene (the HQ floor, the hub planet): its own soft
       backdrop keeps emblem + wordmark legible on any camera pose. */
    .sf-badge-btn {
      display: inline-flex; align-items: center; gap: var(--sc-space-2); cursor: pointer;
      min-height: var(--sc-tap-min); padding: 0 var(--sc-space-3) 0 var(--sc-space-2); border: 0; font: inherit;
      color: var(--sc-fg-1); border-radius: 999px;
      background: color-mix(in srgb, var(--sc-bg-0) 62%, transparent); backdrop-filter: blur(6px);
    }
    .sf-badge-btn img { filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.35)); }
    .sf-word {
      font-family: var(--sc-font-display); font-size: max(0.58rem, var(--sc-fs-floor));
      letter-spacing: 0.1em; text-transform: uppercase; line-height: 1.2; max-width: 11ch;
    }
    .sf-badge-btn:hover, .sf-badge-btn:focus-visible { color: var(--sc-fg-1); }
    .sf-badge-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 6px; }
    /* Speech bubble: grows up out of the badge, tail points at it. */
    .sf-bubble {
      position: absolute; left: 0; bottom: calc(100% + var(--sc-space-2)); z-index: 5;
      width: min(380px, calc(100vw - 2 * var(--sc-space-4)));
      padding: var(--sc-space-3) var(--sc-space-4);
      background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent);
      border: 1px solid var(--sc-border); border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); backdrop-filter: blur(10px);
      color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); line-height: 1.45;
    }
    .sf-bubble::after {
      content: ''; position: absolute; left: 22px; bottom: -6px; width: 10px; height: 10px; rotate: 45deg;
      background: inherit; border: 1px solid var(--sc-border); border-top: 0; border-left: 0;
    }
    .sf-bubble p { margin: 0; }
    .sf-bubble .sf-tm { margin-top: var(--sc-space-2); opacity: 0.8; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .sf-links {
      display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sc-space-2);
      font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .sf-links a { color: var(--sc-fg-2); text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
    .sf-links a:hover { color: var(--sc-accent); }
    .sf-links a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 3px; }
    /* Phone (the bar's breakpoint, <= 720): compact, badge row over the links,
       clear of the bottom bar and the feedback launcher. The wordmark folds away
       (the hub's planet-free strip is ~74px at 375px): the emblem stays, and
       its dialog still carries the disclaimer. */
    @media (max-width: 720px) {
      .sf { flex-direction: column; align-items: flex-start; gap: var(--sc-space-1);
        padding-bottom: max(var(--sc-fab-clear-block), calc(var(--sc-bar-stack-h, 0px) + var(--sc-float-bottom) + var(--sc-space-3))); }
      .sf-word { display: none; }
      .sf-badge-btn { padding: 0 var(--sc-space-2); }
      .sf-stage { align-items: center; }
      .sf-stage .sf-badge { position: relative; left: auto; bottom: auto; align-self: flex-start; }
    }

    
    .site-footer {
      border-top: 1px solid var(--sc-border);
      background: linear-gradient(0deg, var(--sc-bg-2), transparent);
      padding: 12px var(--sc-page-gutter);
      margin-top: auto;
    }
    /* Phone / tablet portrait: the footer's last line (the legal links) is the
       last thing on every page, i.e. exactly where the fixed feedback launcher
       sits once the page is scrolled to its end. The footer ends above it. */
    @media (max-width: 800px) {
      .site-footer { padding-bottom: var(--sc-fab-clear-block); }
    }
    /* The community badge and the disclaimer column need real air between them
       (feedback #79, item 6): at 18px the wrapped "… Community" and the
       "Dies ist eine inoffizielle …" line ran into each other and read as one
       sentence. 34px separates the two blocks without breaking the single row.
       The row shares the page content's edges (styles.scss, "PAGE FRAME"): the
       frame minus its gutters is exactly the content box above it. */
    .inner {
      max-width: calc(var(--sc-page-max) - 2 * var(--sc-page-gutter));
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 34px;
      flex-wrap: nowrap;
    }
    .badge {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .badge img {
      filter: drop-shadow(0 0 8px rgba(0, 212, 255, 0.35));
    }
    .badge-label {
      font-family: var(--sc-font-display);
      font-size: max(0.58rem, var(--sc-fs-floor));
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      max-width: 9ch;
      line-height: 1.2;
    }
    .meta { flex: 1; min-width: 0; }
    .meta .brand {
      font-family: var(--sc-font-display);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-1);
      margin: 0 0 2px;
      font-size: 0.8rem;
    }
    .meta .disclaimer {
      color: var(--sc-fg-2);
      font-size: max(0.74rem, var(--sc-fs-floor));
      line-height: 1.4;
      margin: 0;
    }
    .meta .copyright {
      color: var(--sc-fg-2);
      font-size: max(0.7rem, var(--sc-fs-floor));
      line-height: 1.4;
      margin: 2px 0 0;
      opacity: 0.8;
    }
    .disclaimer-toggle {
      appearance: none;
      background: none;
      border: none;
      padding: 0 0 0 2px;
      margin: 0;
      font: inherit;
      color: var(--sc-accent);
      cursor: pointer;
      vertical-align: baseline;
    }
    .disclaimer-toggle:hover { color: var(--sc-fg-1); }
    .disclaimer-toggle:focus-visible {
      outline: 1px solid var(--sc-accent);
      outline-offset: 2px;
      border-radius: 2px;
    }
    .whatsnew {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      flex-shrink: 0;
    }
    .legal-links {
      display: flex;
      gap: 6px;
      font-size: max(0.68rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .legal-links a {
      color: var(--sc-fg-2);
      text-decoration: none;
      transition: color 0.16s ease;
    }
    .legal-links a:hover { color: var(--sc-accent); }
    .about-link { display: inline-flex; align-items: center; gap: 5px; }
    /* "There is something new on the About page" — accent, never the red of
       elevated access. */
    .new-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--sc-accent);
      box-shadow: 0 0 6px var(--sc-accent);
    }

    /* Verse front page overlay (shell sets [overlay]): a slim frosted strip
       fixed to the bottom, the beta pill sits in its left part, the feedback
       launcher lane stays free on the right. Short or phone-sized viewports
       keep the normal in-flow footer. Height contract: --sc-verse-footer-h on
       the shell host (48px while active). */
    @media (min-width: 641px) and (min-height: 681px) {
      .site-footer.overlay {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
        margin: 0; box-sizing: border-box;
        padding: 0 var(--sc-fab-clear-inline) var(--sc-safe-bottom, 0px) 190px;
        height: calc(48px + var(--sc-safe-bottom, 0px));
        background: color-mix(in srgb, var(--sc-bg-1) 55%, transparent);
        backdrop-filter: blur(10px);
        border-top: 1px solid var(--sc-border);
      }
      .overlay .inner { height: 48px; gap: 18px; max-width: none; margin: 0; }
      .overlay .badge img { width: 24px; height: 24px; }
      .overlay .badge-label, .overlay .copyright, .overlay .disclaimer-toggle { display: none; }
      .overlay .meta { display: flex; align-items: center; gap: 12px; }
      .overlay .meta .brand { margin: 0; white-space: nowrap; }
      .overlay .meta .disclaimer {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
      }
      .overlay .legal-links { white-space: nowrap; }
    }
    /* Tablet portrait / narrow window: three blocks in one nowrap row squeeze
       the disclaimer into a sliver. The links block wraps under the other two
       instead, and the gap tightens with it. */
    @media (min-width: 641px) and (max-width: 800px) {
      .inner { flex-wrap: wrap; gap: 12px 24px; }
      .meta { flex: 1 1 320px; }
      .whatsnew { flex: 1 1 100%; }
    }
    @media (max-width: 640px) {
      .inner { flex-direction: column; align-items: flex-start; gap: 10px; }
      .badge-label { max-width: none; }
      .whatsnew { align-items: flex-start; }
    }
  `],
})
export class FooterComponent {
  /** Verse front page: render as a fixed overlay strip (set by the shell). */
  readonly overlay = input(false);
  protected readonly seen = inject(ReleaseSeenService);
  protected readonly auth = inject(AuthService);
  private readonly layoutSvc = inject(LayoutService);
  protected readonly shellOn = inject(BetaService).isEnabled('shell');
  private readonly router = inject(Router);
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  /**
   * Hub (cinematic) pages: the footer sits on the stage's bottom edge. The
   * Verse front page is the exception — its content runs on below the stage
   * (the hub columns), so the footer is a real row under it, never over it.
   */
  protected readonly stage = computed(() => this.layoutSvc.layout() === 'cinematic' && !isVerseHome(this.url()));

  /** Disclaimer bubble: hover / focus peeks, a click pins it (then it is a real dialog). */
  protected readonly bubble = signal<'closed' | 'peek' | 'pinned'>('closed');
  protected peek(): void { if (this.bubble() === 'closed') this.bubble.set('peek'); }
  protected unpeek(): void { if (this.bubble() === 'peek') this.bubble.set('closed'); }
  protected togglePinned(): void { this.bubble.set(this.bubble() === 'pinned' ? 'closed' : 'pinned'); }
  protected onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (this.bubble() === 'peek' && !(ev.currentTarget as HTMLElement).contains(next)) this.bubble.set('closed');
  }
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** Whether the full legal disclaimer + trademark line is shown. */
  readonly expanded = signal(false);

  /** Full, localized disclaimer text — kept in sync with the active language. */
  private readonly disclaimerFull = signal('');

  /** First clause of the disclaimer plus an ellipsis affordance. */
  readonly disclaimerShort = computed(() => {
    const clause = this.disclaimerFull().split(/[,，]/)[0]?.trim() ?? '';
    return clause ? `${clause} ` : '';
  });

  constructor() {
    this.syncDisclaimer();
    this.translate.onLangChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.syncDisclaimer());
  }

  private syncDisclaimer(): void {
    this.translate
      .get('footer.disclaimer')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((text: string) => this.disclaimerFull.set(text));
  }
}
