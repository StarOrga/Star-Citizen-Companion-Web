import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HQ_ROOT, hqHangar, hqPage } from '../hq-routes';

interface LaunchStep {
  id: 1 | 2 | 3;
  key: string;
  link: string[];
  fragment?: string;
  done: boolean;
}

/**
 * The first-visit block of the Start page (concept D9): the promise as the quiet heading of the
 * launch steps, three steps (RSI-Hangar holen · SCC-App starten · Ersten Einsatz planen), the
 * primary "Los geht's" with "Überspringen" under it and a quiet "≈ 4 Minuten". No progress bar.
 * A step that turns done plays a short tick animation (not under reduced motion).
 * Every step leads somewhere, so each is a real anchor.
 */
@Component({
  selector: 'sc-hq-first-visit',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="first" [attr.aria-labelledby]="'hq-first-promise'">
      <h2 id="hq-first-promise" class="promise">{{ 'hq.first.promise' | translate }}</h2>
      <ol class="steps">
        @for (s of steps(); track s.id) {
          <li class="step" [class.done]="s.done">
            <a class="step-link" [routerLink]="s.link" [fragment]="s.fragment">
              <span class="badge" aria-hidden="true">
                @if (s.done) {
                  <svg viewBox="0 0 24 24"><path class="tick" d="M5.5 12.5l4.5 4.5 8.5-9.5" /></svg>
                } @else {
                  {{ s.id }}
                }
              </span>
              <span class="step-label">{{ 'hq.first.step' + s.id | translate }}</span>
            </a>
          </li>
        }
      </ol>
      <div class="actions">
        <a class="sc-btn primary go" [routerLink]="goLink">{{ 'hq.first.go' | translate }}</a>
        <button type="button" class="skip" (click)="skipped.emit()">{{ 'hq.first.skip' | translate }}</button>
        <span class="duration">{{ 'hq.first.duration' | translate }}</span>
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; width: 100%; }
      .first { display: flex; flex-direction: column; align-items: center; gap: var(--sc-space-3, 12px); text-align: center; }
      .promise { margin: 0; max-width: var(--sc-measure, 70ch); font: 400 max(0.95rem, var(--sc-fs-floor)) / 1.45 var(--sc-font-body); color: var(--sc-fg-1); }
      .steps { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sc-space-3, 12px); margin: 0; padding: 0; list-style: none; }
      .step-link {
        display: flex; align-items: center; gap: var(--sc-space-2, 8px);
        min-height: 44px; padding: 6px 14px 6px 8px;
        border: 1px solid var(--sc-border); border-radius: 999px;
        background: color-mix(in srgb, var(--sc-bg-1) 70%, transparent);
        color: var(--sc-fg); text-decoration: none;
      }
      .step-link:hover { border-color: var(--sc-accent); }
      .step-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .badge {
        display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%;
        border: 1px solid var(--sc-border); font-weight: 600; color: var(--sc-fg-2);
      }
      .done .badge { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 18%, transparent); color: var(--sc-accent); }
      .badge svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .done .step-label { color: var(--sc-fg-2); }
      .actions { display: flex; flex-direction: column; align-items: center; gap: var(--sc-space-2, 8px); }
      .go { min-width: 180px; justify-content: center; }
      .skip { border: 0; background: none; color: var(--sc-fg-2); font: inherit; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; padding: 4px 8px; }
      .skip:hover { color: var(--sc-fg); }
      .skip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .duration { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      @media (prefers-reduced-motion: no-preference) {
        .done .badge { animation: hq-step-pop 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.4); }
        .tick { stroke-dasharray: 24; stroke-dashoffset: 24; animation: hq-step-tick 0.45s 0.15s ease-out forwards; }
      }
      @keyframes hq-step-pop { 0% { transform: scale(0.6); } 100% { transform: scale(1); } }
      @keyframes hq-step-tick { to { stroke-dashoffset: 0; } }
      @media (pointer: coarse) { .skip { min-height: 48px; } }
    `,
  ],
})
export class HqFirstVisitComponent {
  readonly hangarDone = input<boolean>(false);
  readonly appDone = input<boolean>(false);
  readonly einsatzDone = input<boolean>(false);
  /** The reader chose "Überspringen". */
  readonly skipped = output<void>();

  /** The tour ends with the RSI import (hangar). */
  readonly goLink = [hqHangar];
  readonly steps = computed<LaunchStep[]>(() => [
    { id: 1, key: 'hangar', link: [hqHangar], done: this.hangarDone() },
    { id: 2, key: 'app', link: [HQ_ROOT], fragment: hqPage('jetzt').fragment, done: this.appDone() },
    { id: 3, key: 'einsatz', link: [HQ_ROOT], fragment: hqPage('planen').fragment, done: this.einsatzDone() },
  ]);
}
