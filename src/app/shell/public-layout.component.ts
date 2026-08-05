import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FooterComponent } from './footer.component';

/**
 * Bare chrome for the app's small public surface (`/about`, `/legal/privacy`,
 * `/legal/imprint` — see app.routes.ts C3). No topbar, no nav, no
 * authenticated-only affordances: this layout must never itself require a
 * session, because it is exactly the escape hatch a signed-out visitor (or a
 * URL-reputation scanner) needs to reach while every other route is gated.
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
  imports: [RouterOutlet, FooterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="public-shell">
      <main class="content">
        <router-outlet />
      </main>
      <sc-footer />
    </div>
  `,
  styles: [`
    :host { display: block; }
    .public-shell { display: flex; flex-direction: column; min-height: 100vh; }
    .content {
      flex: 1;
      width: 100%;
      padding: 26px 28px 32px;
      max-width: 1280px;
      margin: 0 auto;
    }
    @media (max-width: 720px) {
      .content { padding: 20px 16px; }
    }
  `],
})
export class PublicLayoutComponent {}
