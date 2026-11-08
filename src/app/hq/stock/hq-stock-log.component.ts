import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { PATH_ICONS } from '../../shared/item-path/path-icons';

/** One line of the Ladeprotokoll: a removal (−) or a reservation (⧉), newest first. */
export interface LogLine {
  readonly key: string;
  readonly at: string;
  readonly kind: 'out' | 'reserve';
  readonly name: string;
  readonly className: string | null;
  readonly qty: number;
  readonly unit: 'pcs' | 'scu';
  readonly place: string;
  /** Removals only: the removal kind for the icon (take / delete / reduce / handout / snapshot). */
  readonly why?: string;
}

/** Visible lines before "Alle Änderungen" (R2 anno-c-3: the last three, extendable). */
export const LOG_VISIBLE = 3;

/**
 * Ladeprotokoll (I11–I13, I17): at the top beside the bays, one connected log of the last changes and what was used
 * up — no explanatory sentences: icon + delta + item + place per line. Follows every filter (the caller filters).
 * "Nachbestellen" puts ALL listed removals with their amounts onto the wishlist (I13); each removal line can go back
 * onto the wishlist on its own (I17).
 */
@Component({
  selector: 'sc-hq-stock-log',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="h">{{ 'hq.bestand.deck.log' | translate }}</h3>
    <p class="flt">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>
      <span>{{ summary() }}</span>
      <b class="mono">{{ hits() }}</b>
    </p>
    @if (lines().length) {
      <ul class="lines" [attr.aria-label]="'hq.bestand.deck.changes' | translate">
        @for (l of visible(); track l.key) {
          <li [class.res]="l.kind === 'reserve'">
            <span class="ico" aria-hidden="true">{{ l.kind === 'reserve' ? '⧉' : '−' }}</span>
            <b class="d mono">{{ qtyText(l) }}</b>
            <span class="nm">{{ l.name }}</span>
            <small class="pl">{{ l.place }}</small>
            <small class="at">{{ l.at | scDate: 'datetime' }}</small>
            @if (l.kind === 'out') {
              <button type="button" scAction tier="tertiary" class="again" [attr.aria-label]="'hq.bestand.catchUpOne' | translate: { name: l.name }"
                      [scTooltip]="'hq.bestand.catchUpOne' | translate: { name: l.name }" scTooltipTier="label" (click)="wishOne.emit(l)">
                <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of wishIcon; track $index) { <path [attr.d]="d" /> }</svg>
              </button>
            }
          </li>
        }
      </ul>
      <div class="foot">
        @if (lines().length > visibleCount) {
          <button type="button" class="more" [attr.aria-expanded]="expanded()" (click)="expanded.set(!expanded())">
            {{ (expanded() ? 'hq.bestand.deck.less' : 'hq.bestand.deck.more') | translate: { n: lines().length } }}
          </button>
        }
        @if (outs().length) {
          <button type="button" scAction tier="secondary" (click)="reorder.emit(outs())">{{ 'hq.bestand.deck.reorder' | translate: { n: outs().length } }}</button>
        }
      </div>
    } @else {
      <p class="none">{{ 'hq.bestand.deck.logEmpty' | translate }}</p>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 12px 14px; border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-1); }
      .h { margin: 0; color: var(--sc-fg-2); font: 600 0.62rem / 1 var(--sc-font-display, inherit); letter-spacing: .2em; text-transform: uppercase; }
      .flt { display: flex; align-items: center; gap: 6px; margin: 0; padding: 5px 8px; border-radius: 6px; background: color-mix(in srgb, var(--sc-accent) 10%, transparent); font-size: 0.75rem; }
      .flt span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .flt b { color: var(--sc-accent); }
      .flt svg { width: 13px; height: 13px; flex: none; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linejoin: round; }
      .lines { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
      .lines li { display: grid; grid-template-columns: 1.1rem auto 1fr auto; grid-template-areas: 'i d n b' 'i p p at'; column-gap: 6px; align-items: center; padding: 4px 0; border-bottom: 1px dashed var(--sc-border); font-size: 0.75rem; }
      .ico { grid-area: i; color: var(--sc-warning); font-weight: 700; text-align: center; }
      .res .ico, .res .d { color: var(--sc-accent); }
      .d { grid-area: d; color: var(--sc-warning); }
      .nm { grid-area: n; min-width: 0; overflow-wrap: anywhere; }
      .pl { grid-area: p; color: var(--sc-fg-2); font-size: 0.68rem; }
      .at { grid-area: at; color: var(--sc-fg-2); font-size: 0.68rem; white-space: nowrap; }
      .again { grid-area: b; }
      .again svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
      .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
      .more { min-height: 30px; padding: 0; border: 0; background: none; color: var(--sc-accent); font: inherit; font-size: 0.75rem; cursor: pointer; }
      .more:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .none { margin: 0; color: var(--sc-fg-2); font-size: 0.75rem; }
      @media (pointer: coarse) { .more { min-height: 48px; } }
    `,
  ],
})
export class HqStockLogComponent {
  private readonly tr = inject(TranslateService);
  protected readonly wishIcon = PATH_ICONS.wish;
  protected readonly visibleCount = LOG_VISIBLE;
  /** "Lorville · Rohstoffe · „eisen“" — what the deck shows right now. */
  readonly summary = input('');
  readonly hits = input(0);
  readonly lines = input<readonly LogLine[]>([]);
  readonly wishOne = output<LogLine>();
  readonly reorder = output<readonly LogLine[]>();

  protected readonly expanded = signal(false);
  protected readonly visible = computed(() => (this.expanded() ? this.lines() : this.lines().slice(0, LOG_VISIBLE)));
  protected readonly outs = computed(() => this.lines().filter((l) => l.kind === 'out'));

  protected qtyText(l: LogLine): string {
    const n = l.qty.toLocaleString(this.tr.getCurrentLang() || undefined, { maximumFractionDigits: 3 });
    const sign = l.kind === 'out' ? '−' : '';
    return l.unit === 'scu' ? `${sign}${n} SCU` : `${sign}${n}×`;
  }
}
