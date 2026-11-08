import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HQ_DIALOG_STYLES } from '../plan/hq-dialog.styles';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { gatherToSteps } from '../data/hq-gather';
import { newNachschubBlock, parseSellGoal, type NachschubLineInput } from './nachschub.model';
import { NachschubService, type NachschubResult } from './nachschub.service';
import { moveLineStop, routeOrdered, targetsFor } from './nachschub-target.util';
import type { NachschubTargetIntent, NachschubTargetResult } from './nachschub-target-picker';
import { NACHSCHUB_ICON_PATHS } from './step-icons';

/**
 * "Aus dem Bestand planen" (round 3, a3-s8): where does the Bestand selection go? Into a new Nachschub or into an
 * existing one (repeatedly - the same item just grows). A sale asks the aUEC goal; a pick-up shows the gather route
 * (largest place first, reorderable, one stop per place). The dialog performs the write and closes with the result,
 * or with null when the player cancelled. It closes only through its X, Abbrechen or Escape.
 */
@Component({
  selector: 'sc-nachschub-target-dialog',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ScActionDirective, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" scDialog (scDialogEscape)="closed.emit(null)" aria-labelledby="ntd-title">
        <header class="dlg-head">
          <span class="dlg-ic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of tray; track p) { <path [attr.d]="p" /> }</svg></span>
          <h2 id="ntd-title" class="dlg-title">{{ 'hq.nachschub.target.title' | translate }}<small>{{ 'hq.nachschub.target.intent.' + intent() | translate }}</small></h2>
          <button type="button" scAction tier="tertiary" [attr.aria-label]="'hq.flow.close' | translate" [scTooltip]="'hq.flow.close' | translate" scTooltipTier="label" (click)="closed.emit(null)">
            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div class="dlg-body">
          @if (error(); as e) { <p class="dlg-err" role="alert">{{ e | translate }}</p> }

          <p class="dlg-msg lead">{{ 'hq.nachschub.target.lead' | translate: { n: work().length } }}</p>

          <section class="mix" aria-labelledby="ntd-where">
            <small id="ntd-where">{{ 'hq.nachschub.target.where' | translate }}</small>
            <div class="seg" role="radiogroup" aria-labelledby="ntd-where">
              <button type="button" role="radio" [attr.aria-checked]="target() === 'new'" [class.on]="target() === 'new'" [disabled]="newBlock() !== null" (click)="picked.set('new')">
                {{ (intent() === 'sell' ? 'hq.nachschub.target.newSell' : 'hq.nachschub.target.new') | translate }}
              </button>
              @for (n of existing(); track n.id) {
                <button type="button" role="radio" [attr.aria-checked]="target() === n.id" [class.on]="target() === n.id" (click)="picked.set(n.id)">
                  {{ 'hq.nachschub.target.append' | translate: { name: n.name } }}
                </button>
              }
            </div>
            @if (newBlock(); as b) { <p class="hint">{{ b | translate }}</p> }
          </section>

          @if (intent() === 'sell' && target() === 'new') {
            <label class="goal">
              <span>{{ 'hq.nachschub.target.goal' | translate }}</span>
              <input type="text" class="input" inputmode="numeric" autocomplete="off" [ngModel]="goalText()" (ngModelChange)="onGoal($event)"
                     [attr.aria-invalid]="goalBad() ? 'true' : null" [attr.aria-describedby]="goalBad() ? 'ntd-goal-err' : null" [placeholder]="'hq.nachschub.target.goalPlaceholder' | translate" />
            </label>
            @if (goalBad()) { <p class="dlg-err" id="ntd-goal-err" role="alert">{{ 'hq.nachschub.sellGoalInvalid' | translate }}</p> }
          }

          <ol class="lines">
            @for (l of work(); track $index; let li = $index) {
              <li>
                <p class="ln"><b>{{ l.name }}</b> <span class="amt">{{ l.amount }} {{ (l.unit === 'scu' ? 'hq.nachschub.target.scu' : 'hq.nachschub.target.pcs') | translate }}</span>
                  @if (intent() === 'pickup' && l.stops && l.stops.length > 1) { <span class="route">{{ 'hq.nachschub.target.route' | translate: { n: l.stops.length } }}</span> }</p>
                @if (l.stops?.length) {
                  <ol class="stops">
                    @for (s of l.stops; track s.location; let si = $index; let last = $last) {
                      <li>
                        <b>{{ s.location }}</b><span>{{ s.amount }}@if (s.quality) { · Q {{ s.quality }} }</span>
                        @if (intent() === 'pickup' && l.stops!.length > 1) {
                          <span class="mv">
                            <button type="button" scAction tier="tertiary" [disabled]="si === 0" [attr.aria-label]="'hq.nachschub.target.up' | translate: { place: s.location }" [scTooltip]="'hq.nachschub.target.up' | translate: { place: s.location }" scTooltipTier="label" (click)="move(li, si, si - 1)">
                              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" /></svg>
                            </button>
                            <button type="button" scAction tier="tertiary" [disabled]="last" [attr.aria-label]="'hq.nachschub.target.down' | translate: { place: s.location }" [scTooltip]="'hq.nachschub.target.down' | translate: { place: s.location }" scTooltipTier="label" (click)="move(li, si, si + 1)">
                              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6" /></svg>
                            </button>
                          </span>
                        }
                      </li>
                    }
                  </ol>
                }
              </li>
            }
          </ol>
        </div>

        <footer class="dlg-foot">
          <span class="sp"></span>
          <button type="button" scAction tier="secondary" (click)="closed.emit(null)">{{ 'common.dialog.cancel' | translate }}</button>
          <button type="button" scAction tier="primary" [busy]="busy()" [disabled]="busy() || !canSave()" (click)="save()">
            {{ (target() === 'new' ? 'hq.nachschub.target.create' : 'hq.nachschub.target.add') | translate }}
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [
    HQ_DIALOG_STYLES,
    `
      .mix { padding: var(--sc-space-3, 12px); border: 1px dashed var(--sc-border); border-radius: 10px; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .mix small { color: var(--sc-fg-2); }
      .seg { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .seg button { min-height: 36px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); color: var(--sc-fg-1); font: inherit; cursor: pointer; }
      .seg button.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); }
      .seg button:disabled { opacity: 0.5; cursor: not-allowed; }
      .seg button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .hint { margin: 0; color: var(--sc-fg-2); font-size: 0.82rem; }
      .goal { display: flex; flex-direction: column; gap: 4px; }
      .goal span { color: var(--sc-fg-2); font-size: 0.82rem; }
      .input { min-height: 40px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg-0); font: inherit; }
      .input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .input[aria-invalid='true'] { border-color: var(--sc-warning); }
      .lines, .stops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .lines > li { padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
      .ln { margin: 0 0 4px; }
      .amt, .route { color: var(--sc-fg-2); font-size: 0.82rem; margin-left: 6px; }
      .stops { counter-reset: stop; gap: 2px; }
      .stops li { counter-increment: stop; display: flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: 32px; }
      .stops li::before { content: counter(stop); display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: color-mix(in srgb, var(--sc-accent) 18%, transparent); color: var(--sc-accent); font-size: 0.75rem; flex: none; }
      .stops li > span:not(.mv) { color: var(--sc-fg-2); font-size: 0.82rem; flex: 1; }
      .mv { display: inline-flex; margin-left: auto; }
      button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      @media (pointer: coarse) { .seg button { min-height: 44px; } }
    `,
  ],
})
export class NachschubTargetDialogComponent {
  readonly intent = input.required<NachschubTargetIntent>();
  readonly lines = input.required<readonly NachschubLineInput[]>();
  readonly closed = output<NachschubTargetResult | null>();

  private readonly ns = inject(NachschubService);
  private readonly einsatz = inject(HqEinsatzService);
  private readonly i18n = inject(TranslateService);

  protected readonly tray = NACHSCHUB_ICON_PATHS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly goalText = signal('');
  protected readonly goalBad = signal(false);
  /** The route as the player arranged it; null = the Bestand's lines, largest place first. */
  private readonly edited = signal<readonly NachschubLineInput[] | null>(null);
  protected readonly work = computed(() => this.edited() ?? routeOrdered(this.lines()));
  protected readonly existing = computed(() => targetsFor(this.intent(), this.ns.packages()));
  protected readonly newBlock = computed(() => newNachschubBlock(this.ns.packages()));
  protected readonly picked = signal<string | null>(null);
  /** The chosen target: the player's pick, else a new one while a slot is free, else the first existing one. */
  protected readonly target = computed<string>(() => this.picked() ?? (this.newBlock() === null ? 'new' : (this.existing()[0]?.id ?? 'new')));
  protected readonly canSave = computed(() => {
    if (this.work().length === 0) return false;
    if (this.target() === 'new') return this.newBlock() === null && (this.intent() !== 'sell' || this.goalText().trim() !== '');
    return this.existing().some((n) => n.id === this.target());
  });

  constructor() {
    void this.ns.ensureLoaded();
  }

  protected onGoal(v: string): void {
    this.goalText.set(v);
    this.goalBad.set(false);
  }

  protected move(line: number, from: number, to: number): void {
    this.edited.set(moveLineStop(this.work(), line, from, to));
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canSave()) return;
    this.error.set(null);
    const target = this.target();
    const lines = this.work();
    let goal: number | null = null;
    if (this.intent() === 'sell' && target === 'new') {
      goal = parseSellGoal(this.goalText());
      if (goal === null) {
        this.goalBad.set(true);
        return;
      }
    }
    this.busy.set(true);
    try {
      const result: NachschubResult =
        goal !== null
          ? await this.ns.createSellNachschub(goal, lines, { name: this.i18n.instant('hq.nachschub.target.sellName') })
          : await this.ns.addToNachschub(target, lines);
      if (!result.ok || !result.id) {
        this.error.set(result.key);
        return;
      }
      if (this.intent() === 'pickup') this.writeRoute(result.id, lines);
      this.closed.emit({ nachschubId: result.id, created: target === 'new' });
    } catch (err) {
      this.error.set(toErrorKey('nachschub', 'target', err));
    } finally {
      this.busy.set(false);
    }
  }

  /** The gather lines become one Einsatz of pickup steps (one per stop, in the player's order): Jetzt ticks them. */
  private writeRoute(packageId: string, lines: readonly NachschubLineInput[]): void {
    const supplies = this.ns.linesOf(packageId);
    const steps = lines.flatMap((l) => {
      if (!l.stops?.length) return [];
      const key = (l.className ?? l.name).toLowerCase();
      const line = supplies.find((s) => (s.className ?? s.name).toLowerCase() === key);
      if (!line) return [];
      return gatherToSteps({ id: line.id, name: line.name, className: line.className }, l.stops).map((s) => ({
        kind: 'pickup' as const,
        label: s.label,
        location: s.location ?? null,
        system: s.system ?? null,
        className: s.class_name ?? null,
        qty: s.qty ?? null,
        supplyId: s.supply_id ?? null,
        missionRef: null,
      }));
    });
    if (!steps.length) return;
    const title = lines.length === 1 ? this.i18n.instant('hq.nachschub.target.einsatzOne', { name: lines[0].name }) : this.i18n.instant('hq.nachschub.target.einsatzMany');
    this.einsatz.create({ title: String(title).slice(0, 40), packageId, startLocation: null, steps });
  }
}
