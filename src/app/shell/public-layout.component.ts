import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { BetaService } from '../core/beta.service';
import { LayoutService } from '../core/layout/layout.service';
import { FooterComponent } from './footer.component';
import { skipToMain } from './skip-link';
import { FusionBarComponent } from './fusion-bar/fusion-bar.component';

/**
 * Bare chrome for the app's small public surface (`/about`, `/legal/privacy`,
 * `/legal/imprint` — see app.routes.ts C3). No topbar, no nav, no
 * authenticated-only affordances: this layout must never itself require a
 * session, because it is exactly the escape hatch a signed-out visitor (or a
 * URL-reputation scanner) needs to reach while every other route is gated.
 *
 * It does carry ONE navigation control: a link back to the home route. These
 * pages are reached from the footer, so before it existed the only way out of
 * `/legal/imprint` was the browser's back button — on a phone that is a
 * hidden gesture or a system bar, and users reported being stranded (feedback
 * fbfd1ed5). The bar is sticky because the privacy page is several screens
 * long: the way out has to be where the user is, not only where they started.
 * A plain `<a routerLink>` on purpose — middle-click and Ctrl/Cmd-click must
 * open the home page in a new tab like any other link.
 *
 * `/login` deliberately does NOT render inside this layout — it already owns
 * a full-page layout (card + footer) with its own styling and stays a
 * top-level sibling route.
 *
 * Reuses the shell's `.content` sizing so `/about` etc. look identical to
 * before this route reshuffle.
 */
@Component({
  selector: 'sc-public-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, TranslatePipe, FooterComponent, FusionBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Same layout contract as the shell (beta "shell"): one shared frame, styles.scss.
  host: { '[attr.data-layout]': 'shellOn() ? layout.layout() : null' },
  template: `
    <div class="public-shell">
      <a class="sc-skip-link" href="#sc-main" (click)="skipToMain($event)">{{ 'nav.skipToContent' | translate }}</a>
      @if (shellOn()) {
        <!-- Beta "shell": the same capsule as the app, public variant (brand + way home). -->
        <sc-fusion-bar variant="public" />
      } @else {
      <header class="public-topbar">
        <a class="home" routerLink="/">
          <span class="arrow" aria-hidden="true">←</span>
          <img class="logo" src="icons/brand/scc-mark.svg" alt="" width="32" height="32" />
          <span class="label">{{ 'nav.backToHome' | translate }}</span>
        </a>
      </header>
      }
      <main id="sc-main" tabindex="-1" [class.content]="!shellOn()" [class.sc-frame]="shellOn()">
        <router-outlet />
      </main>
      <sc-footer />
    </div>
  `,
  styles: [`
    :host { display: block; }
    .public-shell { display: flex; flex-direction: column; min-height: 100dvh; }
    .public-topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      padding: 6px 20px;
      background: linear-gradient(180deg, var(--sc-bg-2), transparent);
      border-bottom: 1px solid var(--sc-border);
      backdrop-filter: blur(12px);
    }
    /* 48px min height, not 44: two overlapping scale animations shave a
       fraction off measured targets in the mobile gate. */
    .home {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 48px;
      padding: 0 10px;
      margin-left: -10px;
      border-radius: 6px;
      color: var(--sc-accent);
      text-decoration: none;
      transition: color 0.16s ease, background 0.16s ease;
    }
    .home:hover { color: var(--sc-fg-1); background: rgba(255, 255, 255, 0.04); }
    .home:focus-visible {
      outline: 1px solid var(--sc-accent);
      outline-offset: 2px;
    }
    .home .arrow { font-size: 1.05rem; line-height: 1; }
    .home .logo {
      width: 32px;
      height: 32px;
      filter: drop-shadow(0 0 7px rgba(82, 193, 230, 0.45));
    }
    .home .label {
      font-family: var(--sc-font-display);
      font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 600;
    }
    /* The same page frame as the shell's .content (styles.scss, "PAGE FRAME"). */
    .content {
      flex: 1;
      width: 100%;
      padding: 26px var(--sc-page-gutter) 32px;
      max-width: var(--sc-page-max);
      margin: 0 auto;
    }
    /* Beta "shell" on a phone: the capsule sits at the bottom — keep it free. */
    @media (max-width: 720px) {
      :host([data-layout]) .public-shell { padding-bottom: calc(var(--sc-bar-stack-h, var(--sc-bar-h)) + var(--sc-float-bottom) + var(--sc-space-3)); }
    }
    @media (max-width: 720px) {
      .public-topbar { padding: 4px 12px; }
      .content { padding: 20px var(--sc-page-gutter); }
    }
  `],
})
export class PublicLayoutComponent {
  protected readonly layout = inject(LayoutService);
  readonly shellOn = inject(BetaService).isEnabled('shell');
  readonly skipToMain = skipToMain;
}
