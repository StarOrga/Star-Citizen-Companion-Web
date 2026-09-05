import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ColumnFacet, ColumnKind, SortDir } from '../codex/table-column-menu';

/**
 * Generic column-head sort/filter popover (MASTER §9, docs/concepts/
 * codex-schiffsseite-ui-spec.md §10, iteration 3 `#t4`). Pairs with the pure
 * model in `codex/table-column-menu.ts`: this component owns only the popover
 * chrome (open/close, keyboard) and re-emits the model's actions — it holds no
 * table state of its own, so ANY table in the app can adopt the pattern by
 * building a `ColumnDef[]`/`ColumnMenuState` pair and wiring these six outputs.
 *
 * Usage (inside a `<th>`):
 * ```html
 * <sc-column-menu
 *   [label]="'codex.picker.col.mass' | translate"
 *   kind="numeric"
 *   [sortDir]="sortDirOf('codex.picker.col.mass')"
 *   [range]="rangeOf('codex.picker.col.mass')"
 *   [hasFilter]="hasFilter('codex.picker.col.mass')"
 *   (headClick)="onHeadClick('codex.picker.col.mass')"
 *   (sortPick)="onSortPick('codex.picker.col.mass', $event)"
 *   (rangeChange)="onRangeChange('codex.picker.col.mass', $event)"
 *   (clearFilter)="onClearFilter('codex.picker.col.mass')" />
 * ```
 * A categorical column additionally binds `[facets]` and listens on
 * `(facetToggle)` instead of `(rangeChange)`.
 */
@Component({
  selector: 'sc-column-menu',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cm-wrap">
      <button type="button" class="cm-label" (click)="headClick.emit()">
        {{ label() }}
        @if (sortDir(); as d) {
          <span class="cm-arrow" aria-hidden="true">{{ d === 'asc' ? '▲' : '▼' }}</span>
        }
      </button>
      <details #det class="cm-pop" (toggle)="onToggle($event)">
        <summary
          class="cm-kebab"
          [class.active]="open() || hasFilter()"
          [attr.aria-label]="menuOpenLabel()"
        >⋮</summary>
        <div class="cm-panel" (keydown)="onPanelKeydown($event)">
          <p class="cm-title">{{ sortLabel() }}</p>
          <div class="cm-sortrow">
            <button type="button" class="cm-sortbtn" [class.on]="sortDir() === 'asc'" (click)="pickSort('asc')">
              ▲ {{ ascLabel() }}
            </button>
            <button type="button" class="cm-sortbtn" [class.on]="sortDir() === 'desc'" (click)="pickSort('desc')">
              ▼ {{ descLabel() }}
            </button>
          </div>

          @if (kind() === 'numeric') {
            <p class="cm-title">{{ rangeLabel() }}</p>
            <div class="cm-range">
              <label class="sr-only" [attr.for]="fromId()">{{ fromLabel() }}</label>
              <input #fromInput type="number" [id]="fromId()" [value]="range()?.min ?? ''"
                     (change)="applyRange(fromInput.value, toInput.value)" />
              <span class="cm-dash" aria-hidden="true">–</span>
              <label class="sr-only" [attr.for]="toId()">{{ toLabel() }}</label>
              <input #toInput type="number" [id]="toId()" [value]="range()?.max ?? ''"
                     (change)="applyRange(fromInput.value, toInput.value)" />
            </div>
          } @else {
            <p class="cm-title">{{ filterLabel() }}</p>
            <ul class="cm-facets" role="group">
              @for (f of facets(); track f.value) {
                <li>
                  <label class="cm-facet">
                    <input type="checkbox" [checked]="f.selected" (change)="facetToggle.emit(f.value)" />
                    <span class="cm-facet-val">{{ f.value }}</span>
                    <span class="cm-facet-ct">{{ f.count }}</span>
                  </label>
                </li>
              }
            </ul>
          }

          <div class="cm-foot">
            <button type="button" class="cm-clear" (click)="doClear()">{{ clearLabel() }}</button>
          </div>
        </div>
      </details>
    </span>
  `,
  styles: [`
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .cm-wrap { display: inline-flex; align-items: center; gap: 2px; width: 100%; }
    .cm-label { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 3px;
      background: transparent; border: none; color: inherit; font: inherit; cursor: pointer; text-align: inherit; padding: 0; }
    .cm-arrow { color: var(--sc-accent); }
    .cm-pop { position: relative; flex: 0 0 auto; }
    .cm-kebab { list-style: none; cursor: pointer; color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
      padding: 2px 4px; border-radius: 4px; user-select: none; }
    .cm-kebab::-webkit-details-marker { display: none; }
    .cm-kebab:hover, .cm-kebab.active { color: var(--sc-accent); }
    .cm-panel { position: absolute; top: calc(100% + 4px); right: 0; z-index: 5; width: 190px;
      background: var(--sc-bg-2); border: 1px solid var(--sc-border); border-radius: var(--radius-md, 4px);
      box-shadow: 0 10px 28px rgb(0 0 0 / .6); padding: 8px; display: flex; flex-direction: column; gap: 6px;
      text-transform: none; letter-spacing: normal; font-weight: 400; }
    .cm-title { margin: 4px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .cm-sortrow { display: flex; gap: 4px; }
    .cm-sortbtn { flex: 1 1 0; padding: 4px 6px; border-radius: 4px; background: var(--sc-bg-1);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; font-size: 11px; cursor: pointer; }
    .cm-sortbtn.on { color: var(--sc-accent); border-color: var(--sc-accent); }
    .cm-range { display: flex; align-items: center; gap: 4px; }
    .cm-range input { width: 54px; padding: 3px 4px; border-radius: 4px; background: var(--sc-bg-1);
      border: 1px solid var(--sc-border); color: var(--sc-fg-0); font: inherit; font-size: 11px; }
    .cm-dash { color: var(--sc-fg-2); }
    .cm-facets { list-style: none; margin: 0; padding: 0; max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
    .cm-facet { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; padding: 2px 0; }
    .cm-facet-val { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .cm-facet-ct { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }
    .cm-foot { display: flex; justify-content: flex-end; padding-top: 2px; border-top: 1px solid var(--sc-border); }
    .cm-clear { padding: 3px 8px; border-radius: 4px; background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font: inherit; font-size: 11px; cursor: pointer; }
    .cm-clear:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
  `],
})
export class ScColumnMenuComponent {
  readonly label = input.required<string>();
  readonly kind = input.required<ColumnKind>();
  readonly sortDir = input<SortDir | null>(null);
  readonly range = input<{ min: number | null; max: number | null } | null>(null);
  readonly facets = input<readonly ColumnFacet[]>([]);
  readonly hasFilter = input(false);

  // Every consumer must pass a translated string — there is no untranslated
  // English fallback to leak if a future one forgets to (LOW finding, column-menu).
  readonly menuOpenLabel = input.required<string>();
  readonly sortLabel = input.required<string>();
  readonly ascLabel = input.required<string>();
  readonly descLabel = input.required<string>();
  readonly rangeLabel = input<string>('');
  readonly fromLabel = input<string>('');
  readonly toLabel = input<string>('');
  readonly filterLabel = input.required<string>();
  readonly clearLabel = input.required<string>();

  /** Plain click on the label text — sorts (or flips), same as today. */
  readonly headClick = output<void>();
  readonly sortPick = output<SortDir>();
  readonly rangeChange = output<{ min: number | null; max: number | null }>();
  readonly facetToggle = output<string>();
  readonly clearFilter = output<void>();

  private readonly detEl = viewChild<ElementRef<HTMLDetailsElement>>('det');
  readonly open = signal(false);

  private readonly uid = Math.random().toString(36).slice(2, 8);
  readonly fromId = computed(() => `cm-from-${this.uid}`);
  readonly toId = computed(() => `cm-to-${this.uid}`);

  onToggle(ev: Event): void {
    this.open.set((ev.target as HTMLDetailsElement).open);
  }

  pickSort(dir: SortDir): void {
    this.sortPick.emit(dir);
  }

  applyRange(fromRaw: string, toRaw: string): void {
    const min = fromRaw === '' ? null : Number(fromRaw);
    const max = toRaw === '' ? null : Number(toRaw);
    this.rangeChange.emit({
      min: min === null || Number.isNaN(min) ? null : min,
      max: max === null || Number.isNaN(max) ? null : max,
    });
  }

  doClear(): void {
    this.clearFilter.emit();
    const det = this.detEl()?.nativeElement;
    if (det) det.open = false;
  }

  /** Escape closes the popover; arrow keys move focus within the facet list. */
  onPanelKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      const det = this.detEl()?.nativeElement;
      if (det) det.open = false;
      (det?.querySelector('summary') as HTMLElement | null)?.focus();
      return;
    }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const panel = (ev.currentTarget as HTMLElement) ?? null;
    const items = Array.from(panel?.querySelectorAll<HTMLElement>('.cm-facet input') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    ev.preventDefault();
    const next = ev.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  }
}
