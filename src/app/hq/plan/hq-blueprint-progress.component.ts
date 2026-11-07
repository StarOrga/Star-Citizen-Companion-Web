import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { HqSuppliesService } from '../hq-supplies.service';
import { blueprintProgress } from './hq-blueprint-progress';

/** Planen: one progress card per blueprint that has material lines in Nachschub ("3 of 5 materials"). */
@Component({
  selector: 'sc-hq-blueprint-progress',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="bp" aria-labelledby="hq-bp-title">
      <h2 id="hq-bp-title" class="bp-title">{{ 'hq.plan.progress.title' | translate }}</h2>
      @if (error(); as key) {
        <p class="bp-err" role="alert">
          {{ key | translate }}
          <button type="button" scAction="secondary" (click)="retry()">{{ 'hq.plan.retry' | translate }}</button>
        </p>
      } @else if (!supplies.ready()) {
        <p class="bp-empty">{{ 'hq.plan.progress.loading' | translate }}</p>
      } @else if (cards().length === 0) {
        <p class="bp-empty">{{ 'hq.plan.progress.empty' | translate }}</p>
      } @else {
        <ul class="bp-list">
          @for (c of cards(); track c.className) {
            <li>
              <a class="bp-card" [routerLink]="['/codex', 'blueprint', c.className]">
                <span class="bp-name">{{ c.name }}</span>
                <span class="bp-count mono">{{ 'hq.plan.progress.count' | translate: { have: c.have, total: c.total } }}</span>
                <span class="bp-bar" role="progressbar" [attr.aria-valuemin]="0" [attr.aria-valuemax]="c.total" [attr.aria-valuenow]="c.have" [attr.aria-label]="c.name">
                  <span class="bp-fill" [style.width.%]="(c.have / c.total) * 100"></span>
                </span>
              </a>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .bp { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .bp-title { margin: 0; font: 600 1rem / 1.3 var(--sc-font-display); }
      .bp-empty { margin: 0; color: var(--sc-fg-2); }
      .bp-err { margin: 0; display: flex; align-items: center; gap: var(--sc-space-3, 12px); color: var(--sc-warning); }
      .bp-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); gap: var(--sc-space-2, 8px); }
      .bp-card { display: grid; gap: var(--sc-space-1, 4px); height: 100%; box-sizing: border-box; min-height: var(--sc-tap-min, 44px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; color: inherit; text-decoration: none; }
      .bp-card:hover { border-color: var(--sc-accent); }
      .bp-card:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .bp-name { overflow-wrap: anywhere; }
      .bp-count { font-size: max(0.85rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .bp-bar { height: 6px; border-radius: 3px; background: var(--sc-border); overflow: hidden; }
      .bp-fill { display: block; height: 100%; background: var(--sc-accent); }
    `,
  ],
})
export class HqBlueprintProgressComponent {
  protected readonly supplies = inject(HqSuppliesService);
  protected readonly cards = computed(() => blueprintProgress(this.supplies.items()));
  protected readonly error = computed(() => this.supplies.syncError());

  protected retry(): void {
    void this.supplies.sync();
  }
}
