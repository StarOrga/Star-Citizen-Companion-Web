import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import type { HqGatherStop } from '../data/hq-db.types';
import { gatherProgress, moveStop } from '../data/hq-gather';
import { HqSuppliesService } from '../hq-supplies.service';
import { type Nachschub, parseSellGoal, sellProgress } from '../nachschub/nachschub.model';
import { NachschubService } from '../nachschub/nachschub.service';

/**
 * What a Bestand selection added to the selected Nachschub (D4, D6): the Verkauf's aUEC progress with a way to enter
 * what was earned by hand, and every gather line ("Agricium: 10 SCU from 3 places") with its route - largest place
 * first, reorderable - and one tick per stop. Jetzt ticks the same stops when the player finishes the matching step.
 */
@Component({
  selector: 'sc-hq-nachschub-gather',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ScActionDirective, ScTooltipDirective, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sell(); as p) {
      <section class="box" [attr.aria-label]="'hq.nachschub.sell.title' | translate">
        <h4>{{ 'hq.nachschub.sell.title' | translate }}</h4>
        <div class="bar" role="progressbar" [attr.aria-valuemin]="0" [attr.aria-valuemax]="p.goal" [attr.aria-valuenow]="p.earned"><i [style.width.%]="p.share * 100"></i></div>
        <p class="line">
          {{ 'hq.nachschub.sell.progress' | translate: { earned: fmt(p.earned), goal: fmt(p.goal) } }}
          @if (p.reached) { <b class="ok">{{ 'hq.nachschub.sell.reached' | translate }}</b> }
        </p>
        <form class="earn" (submit)="$event.preventDefault(); saveEarned()">
          <label>
            <span>{{ 'hq.nachschub.sell.earned' | translate }}</span>
            <input type="text" class="input" inputmode="numeric" autocomplete="off" [ngModel]="earned()" (ngModelChange)="earned.set($event)" name="earned" />
          </label>
          <button type="submit" scAction tier="secondary">{{ 'hq.nachschub.sell.save' | translate }}</button>
        </form>
        @if (error(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }
      </section>
    }
    @if (gathers().length) {
      <section class="box" [attr.aria-label]="'hq.nachschub.gather.title' | translate">
        <h4>{{ 'hq.nachschub.gather.title' | translate }}</h4>
        @for (g of gathers(); track g.id) {
          <div class="gl">
            <p class="line"><b>{{ g.name }}</b> <span>{{ 'hq.nachschub.gather.route' | translate: { done: prog(g.stops).done, n: g.stops.length } }}</span></p>
            <ol class="stops">
              @for (s of g.stops; track s.location; let i = $index; let last = $last) {
                <li [class.done]="s.done">
                  <sc-tristate variant="checkbox" [label]="'hq.nachschub.gather.tick' | translate: { place: s.location }" [value]="s.done ? 1 : 0" (toggled)="tick(g.id, i, !s.done)" />
                  <b>{{ s.location }}</b><span>{{ s.amount }}@if (s.quality) { · Q {{ s.quality }} }</span>
                  @if (g.stops.length > 1) {
                    <span class="mv">
                      <button type="button" scAction tier="tertiary" [disabled]="i === 0 || s.done" [attr.aria-label]="'hq.nachschub.target.up' | translate: { place: s.location }" [scTooltip]="'hq.nachschub.target.up' | translate: { place: s.location }" scTooltipTier="label" (click)="move(g.id, g.stops, i, i - 1)">
                        <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" /></svg>
                      </button>
                      <button type="button" scAction tier="tertiary" [disabled]="last || s.done" [attr.aria-label]="'hq.nachschub.target.down' | translate: { place: s.location }" [scTooltip]="'hq.nachschub.target.down' | translate: { place: s.location }" scTooltipTier="label" (click)="move(g.id, g.stops, i, i + 1)">
                        <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6" /></svg>
                      </button>
                    </span>
                  }
                </li>
              }
            </ol>
          </div>
        }
      </section>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      :host:empty { display: none; }
      .box { padding: var(--sc-space-3, 12px); border: 1px dashed var(--sc-border); border-radius: 10px; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      h4 { margin: 0; font-size: 0.9rem; color: var(--sc-fg-1); }
      .line { margin: 0; color: var(--sc-fg-1); }
      .line span { margin-left: 6px; color: var(--sc-fg-2); font-size: 0.82rem; }
      .ok { color: var(--sc-success); margin-left: 6px; }
      .bar { height: 8px; border-radius: 999px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); overflow: hidden; }
      .bar i { display: block; height: 100%; background: var(--sc-accent); }
      .earn { display: flex; align-items: end; gap: var(--sc-space-2, 8px); flex-wrap: wrap; }
      .earn label { display: flex; flex-direction: column; gap: 4px; }
      .earn label span { color: var(--sc-fg-2); font-size: 0.82rem; }
      .input { min-height: 40px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg-0); font: inherit; }
      .input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .err { margin: 0; color: var(--sc-warning); }
      .stops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
      .stops li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: 36px; }
      .stops li.done b { text-decoration: line-through; color: var(--sc-fg-2); }
      .stops li > span:not(.mv) { color: var(--sc-fg-2); font-size: 0.82rem; flex: 1; }
      .mv { display: inline-flex; margin-left: auto; }
      button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    `,
  ],
})
export class HqNachschubGatherComponent {
  readonly nachschub = input.required<Nachschub>();

  private readonly ns = inject(NachschubService);
  private readonly supplies = inject(HqSuppliesService);

  protected readonly earned = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly sell = computed(() => sellProgress(this.nachschub()));
  protected readonly gathers = computed(() =>
    this.ns
      .linesOf(this.nachschub().id)
      .filter((l) => (l.gather?.length ?? 0) > 0)
      .map((l) => ({ id: l.id, name: l.name, stops: l.gather ?? [] })),
  );
  protected readonly prog = gatherProgress;

  protected fmt(n: number): string {
    return n.toLocaleString();
  }

  protected tick(id: string, index: number, done: boolean): void {
    this.supplies.tickGatherStop(id, index, done);
  }

  protected move(id: string, stops: readonly HqGatherStop[], from: number, to: number): void {
    this.supplies.setGather(id, moveStop(stops, from, to));
  }

  protected async saveEarned(): Promise<void> {
    const raw = this.earned().trim();
    const n = raw === '0' ? 0 : parseSellGoal(raw);
    if (n === null) {
      this.error.set('hq.nachschub.sellGoalInvalid');
      return;
    }
    this.error.set(null);
    try {
      if (!(await this.ns.setSellProgress(this.nachschub().id, n))) this.error.set('errors.generic');
      else this.earned.set('');
    } catch (err) {
      this.error.set(toErrorKey('nachschub', 'sellProgress', err));
    }
  }
}
