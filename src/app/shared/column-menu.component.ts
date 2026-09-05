import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { TranslateModule } from '@ngx-translate/core';
import { ColumnFacet, ColumnKind, SortDir } from '../codex/table-column-menu';

/**
 * MEDIUM-5 (E-main-gap popover clipping): the panel used to render as a plain
 * `position: absolute` child of the `<details>`, so any scrolling ancestor
 * with `overflow` other than `visible` clipped it — including `.pick-scroll`,
 * which the picker could only "fix" by dropping its OWN clipping (and with it
 * `scrollLeft`/the sticky header) while a menu was open. Portaling the panel
 * through CDK's `Overlay` into the top-level overlay container sidesteps the
 * whole ancestor-clipping chain: `.pick-scroll` never has to change its
 * `overflow` behaviour, so the horizontal scroll offset — and the sticky
 * header/first column that depends on it — survives opening a column menu.
 */
const PANEL_POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];

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
      <button type="button" class="cm-label" (click)="onLabelClick($event)">
        {{ label() }}
        @if (unit(); as u) {
          <small class="unit">{{ u }}</small>
        }
        @if (sortDir(); as d) {
          <span class="cm-arrow" aria-hidden="true">{{ d === 'asc' ? '▲' : '▼' }}</span>
        }
      </button>
      <details #det class="cm-pop" (toggle)="onToggle($event)">
        <summary
          #kebab
          class="cm-kebab"
          [class.active]="open() || hasFilter()"
          [attr.aria-label]="menuOpenLabel()"
        >⋮</summary>
      </details>
    </span>
    <ng-template #panelTpl>
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
        @if (secondarySortLabel()) {
          <button type="button" class="cm-secondary" [class.on]="secondaryActive()"
                  [attr.aria-pressed]="secondaryActive()"
                  (click)="secondarySortToggle.emit()">
            {{ secondarySortLabel() }}
          </button>
        }

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
    </ng-template>
  `,
  styles: [`
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .cm-wrap { display: inline-flex; align-items: center; gap: 2px; width: 100%; }
    .cm-label { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 3px;
      background: transparent; border: none; color: inherit; font: inherit; cursor: pointer; text-align: inherit; padding: 0; }
    .cm-arrow { color: var(--sc-accent); }
    /* LOW-3: unit floor per UI-spec §0 — an explicit max() rather than a
       relative 0.85em, which derives from a 12px head and lands near 10px. */
    .unit { color: var(--sc-fg-2); font-size: max(11px, var(--sc-fs-floor)); margin-left: 2px; font-weight: 400; }
    .cm-secondary { padding: 4px 6px; border-radius: 4px; background: var(--sc-bg-1);
      border: 1px dashed var(--sc-border); color: var(--sc-fg-1); font: inherit;
      font-size: max(11px, var(--sc-fs-floor)); cursor: pointer; text-align: left; }
    .cm-secondary.on { color: var(--sc-accent); border-color: var(--sc-accent); border-style: solid; }
    .cm-pop { position: relative; flex: 0 0 auto; }
    .cm-kebab { list-style: none; cursor: pointer; color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
      padding: 2px 4px; border-radius: 4px; user-select: none; }
    .cm-kebab::-webkit-details-marker { display: none; }
    .cm-kebab:hover, .cm-kebab.active { color: var(--sc-accent); }
    /* MEDIUM-5: positioned by the CDK overlay (flexibleConnectedTo the kebab
       button) rather than position: absolute inside .cm-pop — see the module
       doc comment above the imports. */
    .cm-panel { width: 190px;
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
  /** Unit suffix rendered as `<small class="unit">`, next to the label (LOW-3: never concatenated into the label string). */
  readonly unit = input<string | null>(null);
  readonly kind = input.required<ColumnKind>();
  readonly sortDir = input<SortDir | null>(null);
  readonly range = input<{ min: number | null; max: number | null } | null>(null);
  readonly facets = input<readonly ColumnFacet[]>([]);
  readonly hasFilter = input(false);
  /** True while THIS column is the active secondary (tie-breaker) sort. */
  readonly secondaryActive = input(false);
  /** Omit (leave `''`) to hide the "als zweite Sortierung" entry entirely. */
  readonly secondarySortLabel = input<string>('');

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

  /**
   * Click on the label text — sorts (or flips), same as today. Emits whether
   * Ctrl/⌘ was held (main's secondary-sort shortcut, E-main-gap #41); a plain
   * click emits `false` and behaves exactly as before.
   */
  readonly headClick = output<boolean>();
  readonly sortPick = output<SortDir>();
  readonly rangeChange = output<{ min: number | null; max: number | null }>();
  readonly facetToggle = output<string>();
  readonly clearFilter = output<void>();
  /** The "als zweite Sortierung" menu entry was clicked. */
  readonly secondarySortToggle = output<void>();

  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  private readonly detEl = viewChild<ElementRef<HTMLDetailsElement>>('det');
  private readonly kebabEl = viewChild<ElementRef<HTMLElement>>('kebab');
  private readonly panelTpl = viewChild<TemplateRef<unknown>>('panelTpl');
  readonly open = signal(false);

  private overlayRef: OverlayRef | null = null;

  private readonly uid = Math.random().toString(36).slice(2, 8);
  readonly fromId = computed(() => `cm-from-${this.uid}`);
  readonly toId = computed(() => `cm-to-${this.uid}`);

  constructor() {
    this.destroyRef.onDestroy(() => this.disposeOverlay());
  }

  onToggle(ev: Event): void {
    const isOpen = (ev.target as HTMLDetailsElement).open;
    this.open.set(isOpen);
    if (isOpen) this.openOverlay();
    else this.disposeOverlay();
  }

  /** MEDIUM-5: portals `.cm-panel` through CDK's `Overlay` instead of rendering
   * it as an absolutely-positioned child of `.cm-pop` — see the module doc
   * comment. Closes on any scroll (the table's own, or the page's) rather than
   * trying to track a moving anchor. */
  private openOverlay(): void {
    this.disposeOverlay();
    const origin = this.kebabEl()?.nativeElement;
    const tpl = this.panelTpl();
    if (!origin || !tpl) return;
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(origin).withPositions(PANEL_POSITIONS).withPush(true),
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });
    overlayRef.backdropClick().subscribe(() => this.closeDetails());
    overlayRef.detachments().subscribe(() => this.closeDetails());
    overlayRef.attach(new TemplatePortal(tpl, this.viewContainer));
    this.overlayRef = overlayRef;
  }

  private disposeOverlay(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  /** Closes both the native `<details>` (so `.cm-kebab` stops reading as open)
   * and the portaled panel — used wherever a close is triggered from outside
   * the native `toggle` event (Escape, Clear, backdrop click, scroll-close). */
  private closeDetails(): void {
    this.disposeOverlay();
    const det = this.detEl()?.nativeElement;
    if (det) det.open = false;
    this.open.set(false);
  }

  onLabelClick(ev: MouseEvent): void {
    this.headClick.emit(ev.ctrlKey || ev.metaKey);
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
    this.closeDetails();
  }

  /** Escape closes the popover; arrow keys move focus within the facet list. */
  onPanelKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      const kebab = this.kebabEl()?.nativeElement;
      this.closeDetails();
      kebab?.focus();
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
