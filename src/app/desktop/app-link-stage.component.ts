import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AppLogoComponent } from '../shared/app-logo/app-logo.component';
import { QuantumStreaksComponent } from '../shared/quantum-streaks/quantum-streaks.component';

export type AppLinkApp = 'uploader' | 'starscape' | 'scc';
/**
 * `checking`: looking at the session; `ready`: waiting for the reader; `linking`: the hand-over runs;
 * `done`: the app has the session; `halt`: stopped on purpose or by role; `error`: it failed.
 */
export type AppLinkPhase = 'checking' | 'ready' | 'linking' | 'done' | 'halt' | 'error';

/**
 * One stage for both connect flows (Data Uploader, Starscape): the 404 / boot-splash language - a
 * dark star field, the round app logo, calm quantum streaks - with a "VC Web - link - app" visual
 * that tells the state: a travelling light while it connects, a solid line once the app has the
 * session, a broken line when it stopped. Purely presentational: the flows keep all their
 * behaviour; the page's own heading, text and buttons are projected. Motion stops under
 * prefers-reduced-motion (the line then just changes colour).
 */
@Component({
  selector: 'sc-app-link-stage',
  standalone: true,
  imports: [TranslatePipe, AppLogoComponent, QuantumStreaksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-phase]': 'phase()' },
  template: `
    <section class="stage">
      <div class="sky" aria-hidden="true"></div>
      <div class="hero" aria-hidden="true">
        <span class="streaks"><sc-quantum-streaks speed="slow" /></span>
        <span class="node web">
          <sc-app-logo size="clamp(64px, 14vw, 96px)" />
          <small>{{ 'appLink.web' | translate }}</small>
        </span>
        <span class="link">
          <i class="line"></i>
          <i class="packet"></i>
          <i class="packet p2"></i>
          <b class="badge">
            @if (phase() === 'done') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            } @else if (phase() === 'halt' || phase() === 'error') {
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
            }
          </b>
        </span>
        <span class="node app">
          <span class="mark"><img [src]="'icons/brand/' + app() + '-mark.svg'" alt="" width="64" height="64" draggable="false" /></span>
          <small>{{ 'appLink.app.' + app() | translate }}</small>
        </span>
      </div>
      <div class="body" role="status" aria-live="polite"><ng-content /></div>
    </section>
  `,
  styleUrl: './app-link-stage.component.scss',
})
export class AppLinkStageComponent {
  readonly app = input<AppLinkApp>('scc');
  readonly phase = input<AppLinkPhase>('checking');
}
