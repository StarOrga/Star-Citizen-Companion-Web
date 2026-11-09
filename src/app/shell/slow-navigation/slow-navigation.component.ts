import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { QuantumStreaksComponent } from '../../shared/quantum-streaks/quantum-streaks.component';
import { SlowNavigationService } from './slow-navigation.service';

/**
 * "Das dauert länger als sonst" (concept 2026-11-09, round 3, screen 4): a calm
 * glass card over the content area once a navigation has been pending for
 * about 8 s, with the slowed streaks behind it, a retry and the way home. No
 * status pill, no extra line. Mounted once per layout; shows nothing otherwise.
 */
@Component({
  selector: 'sc-slow-navigation',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective, QuantumStreaksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (nav.slow()) {
      <div class="stage">
        <sc-quantum-streaks speed="slow" [far]="520" />
        <div class="hold" role="status">
          <h2 class="h2">{{ 'slowLoad.title' | translate }}</h2>
          <div class="acts">
            <button scAction tier="primary" type="button" (click)="nav.retry()">{{ 'slowLoad.retry' | translate }}</button>
            <a scAction tier="secondary" routerLink="/">{{ 'slowLoad.home' | translate }}</a>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .stage {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: grid;
      place-items: center;
      padding: var(--sc-space-4) var(--sc-space-4) var(--sc-fab-clear-block, var(--sc-space-4));
      pointer-events: none;
      overflow: clip;
    }
    .hold {
      position: relative;
      pointer-events: auto;
      width: fit-content;
      max-width: calc(100% - 32px);
      display: flex;
      flex-direction: column;
      gap: var(--sc-space-4);
      padding: 20px 22px;
      border: 1px solid transparent;
      border-radius: 14px;
      background:
        linear-gradient(180deg, rgba(10, 29, 43, .9), rgba(6, 23, 36, .94)) padding-box,
        linear-gradient(160deg, rgba(200, 236, 250, .7) 0%, rgba(80, 125, 148, .45) 30%, rgba(30, 58, 74, .5) 60%, rgba(140, 200, 225, .55) 100%) border-box;
      box-shadow: 0 36px 90px rgba(0, 0, 0, .6), 0 10px 24px rgba(0, 0, 0, .4), 0 0 34px rgba(82, 193, 230, .12);
      backdrop-filter: blur(6px);
      animation: sn-arrive .7s cubic-bezier(.16, .9, .24, 1) both;
    }
    .h2 { margin: 0; font-size: 17px; font-weight: 600; color: var(--sc-fg-0); }
    .acts { display: flex; flex-wrap: wrap; gap: var(--sc-space-2); }
    @keyframes sn-arrive {
      0% { opacity: 0; transform: perspective(900px) translateZ(-180px); filter: blur(5px); }
      60% { filter: blur(0); }
      100% { opacity: 1; transform: none; }
    }
    @media (max-width: 600px) { .hold { padding: 16px; } .acts > * { flex: 1 1 auto; justify-content: center; } }
    @media (prefers-reduced-motion: reduce) { .hold { animation: none; } }
  `],
})
export class SlowNavigationComponent {
  protected readonly nav = inject(SlowNavigationService);
}
