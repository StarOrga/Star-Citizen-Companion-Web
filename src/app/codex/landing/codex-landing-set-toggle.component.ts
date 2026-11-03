import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CalloutSet, CodexLandingCalloutSetService } from './codex-landing-callout-set.service';

/**
 * The "Werte · Flug · Loadout" switch (#884, design "Kopf der Werte-Spalte"):
 * plain text above the values it swaps, the active set underlined in the
 * accent. Two real buttons with aria-pressed; 48px tall on touch.
 */
@Component({
  selector: 'sc-codex-landing-set-toggle',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tg" role="group" [attr.aria-label]="'codex.landing.set.label' | translate">
      <span class="lbl" aria-hidden="true">{{ 'codex.landing.set.label' | translate }}</span>
      @for (s of sets; track s; let last = $last) {
        <button type="button" [class.on]="svc.set() === s" [attr.aria-pressed]="svc.set() === s" (click)="svc.choose(s)">
          {{ 'codex.landing.set.' + s | translate }}
        </button>
        @if (!last) { <span class="sep" aria-hidden="true">·</span> }
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .tg { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
      .lbl {
        margin-right: 8px; font: 600 max(10px, 0.62rem) / 1.2 var(--sc-font-display); letter-spacing: 0.2em;
        text-transform: uppercase; color: var(--sc-fg-2);
      }
      button {
        min-height: 32px; padding: 0 4px; border: 0; background: none; cursor: pointer;
        font: 600 max(12px, 0.78rem) / 1.2 var(--sc-font-body); color: var(--sc-fg-2);
        text-decoration: underline 2px transparent; text-underline-offset: 6px;
        transition: color 0.15s ease, text-decoration-color 0.15s ease;
      }
      button:hover { color: var(--sc-fg-0); }
      button.on { color: var(--sc-fg-0); text-decoration-color: var(--sc-accent); }
      button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 2px; }
      .sep { color: var(--sc-fg-3, var(--sc-fg-2)); opacity: 0.6; }
      @media (pointer: coarse) {
        .lbl { font-size: 12px; }
        button { min-height: 48px; padding: 0 8px; font-size: 13px; }
      }
    `,
  ],
})
export class CodexLandingSetToggleComponent {
  protected readonly svc = inject(CodexLandingCalloutSetService);
  protected readonly sets: readonly CalloutSet[] = ['flight', 'loadout'];
}
