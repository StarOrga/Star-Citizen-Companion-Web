import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** The step kinds (verbs) of an Einsatz, concept D18. */
export const STEP_KINDS = ['buy', 'mission', 'mine', 'refine', 'craft', 'transport', 'pickup', 'event'] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export type StepState = 'todo' | 'done';

/**
 * The map/legend shape per kind (concept D29): buy ◆ · mission ★ · mine ▲ · refine ⬢ ·
 * craft ■ · transport ⬤ · pickup ▼. SVG polygon points in a 24×24 box; `circle` is drawn as one.
 */
export const STEP_SHAPES: Readonly<Record<StepKind, string>> = {
  buy: '12,2.5 21.5,12 12,21.5 2.5,12',
  mission: '12,2.2 14.8,8.9 22,9.5 16.5,14.2 18.2,21.3 12,17.5 5.8,21.3 7.5,14.2 2,9.5 9.2,8.9',
  mine: '12,3 22,20.5 2,20.5',
  refine: '12,2.5 20.6,7.25 20.6,16.75 12,21.5 3.4,16.75 3.4,7.25',
  craft: '4,4 20,4 20,20 4,20',
  transport: 'circle',
  pickup: '12,21 2,3.5 22,3.5',
  event: '12,2.5 14.2,9.8 21.5,12 14.2,14.2 12,21.5 9.8,14.2 2.5,12 9.8,9.8',
};

/**
 * The ONE step component of HQ (concept D36), used by the Planen route list, the Jetzt path,
 * the log and Nachschub: "Kauf" (done) and "Kaufen" (to do) share the style. A step is a
 * kind icon (the shape of the map), the verb, a label with optional quantity and place, and a
 * state; a done step can offer "Rückgängig" (`undo`).
 */
@Component({
  selector: 'sc-step',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-kind]': 'kind()', '[attr.data-state]': 'state()', role: 'listitem' },
  template: `
    <svg class="shape" viewBox="0 0 24 24" aria-hidden="true">
      @if (shape() === 'circle') {
        <circle cx="12" cy="12" r="9.5" />
      } @else {
        <polygon [attr.points]="shape()" />
      }
    </svg>
    <span class="body">
      <span class="verb">{{ 'hq.step.kind.' + kind() | translate }}</span>
      <span class="label">
        {{ label() }}@if (qty() !== null) { <b class="qty mono"> ×{{ qty() }}</b> }
      </span>
      @if (location()) { <span class="where">{{ location() }}</span> }
    </span>
    <span class="state" [class.done]="state() === 'done'">
      @if (state() === 'done') {
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      }
      {{ 'hq.step.state.' + state() | translate }}
    </span>
    @if (undoable() && state() === 'done') {
      <button type="button" class="undo" (click)="undo.emit()">{{ 'hq.log.undo' | translate }}</button>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        gap: var(--sc-space-3, 12px);
        padding: var(--sc-space-2, 8px) 0;
        color: var(--sc-fg);
      }
      .shape { flex: none; width: 22px; height: 22px; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linejoin: round; }
      :host([data-state='done']) .shape { fill: var(--sc-accent); }
      :host([data-state='done']) .label { color: var(--sc-fg-2); }
      .body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
      .verb { font-size: max(0.75rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
      .label { overflow-wrap: anywhere; }
      .qty { color: var(--sc-fg-2); font-weight: 600; }
      .where { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .state { display: inline-flex; align-items: center; gap: 4px; flex: none; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .state.done { color: var(--sc-accent); }
      .state svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .undo {
        flex: none; padding: 2px 10px; border: 1px solid var(--sc-border); border-radius: 999px;
        background: transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer;
      }
      .undo:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
      .undo:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      @media (pointer: coarse) { .undo { min-height: 48px; padding-inline: 14px; } }
    `,
  ],
})
export class ScStepComponent {
  readonly kind = input.required<StepKind>();
  readonly state = input<StepState>('todo');
  readonly label = input<string>('');
  readonly qty = input<number | null>(null);
  readonly location = input<string | null>(null);
  /** Offer "Rückgängig" on a done step (auto-applied events). */
  readonly undoable = input<boolean>(false);
  readonly undo = output<void>();

  readonly shape = computed(() => STEP_SHAPES[this.kind()]);
}
