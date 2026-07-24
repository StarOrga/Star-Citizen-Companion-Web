import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CodexKind } from './codex.service';
import { HARDPOINT_CATEGORY_ORDER, HardpointCategory } from './codex-format';

// One labelled slot in the read-only layout (Rung 1): the port, what the
// stock loadout installs there, and where to jump on click.
export interface LayoutSlot {
  port: string; // humanized port label
  className: string | null; // null = stock-empty port
  kind: CodexKind | null; // null = installed item not resolvable → no link
  name: string | null;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  /** Optional highlighted stat chip, e.g. the jump range on the quantum drive (#137). */
  statChip?: string | null;
}

export interface LayoutGroup {
  category: HardpointCategory;
  slots: LayoutSlot[];
}

// Which column a category cluster docks to (desktop).
const LEFT_CATEGORIES: HardpointCategory[] = ['weapons', 'missiles', 'avionics'];
const RIGHT_CATEGORIES: HardpointCategory[] = ['defense', 'power', 'propulsion'];

/**
 * Read-only hardpoint layout (loadout ladder Rung 1): the stock loadout as
 * labelled slot clusters in two columns. No positional port data exists in
 * the extract, so clusters are grouped by functional category — an honest
 * schematic, not an invented blueprint. Opening a slot navigates to the
 * installed item's detail page. The ship render deliberately stays out of
 * this block; the detail hero above already shows it.
 */
@Component({
  selector: 'sc-codex-hardpoint-layout',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layout">
      <div class="col left">
        @for (g of leftGroups(); track g.category) {
          <ng-container *ngTemplateOutlet="cluster; context: { $implicit: g, side: 'left' }" />
        }
      </div>

      <div class="col right">
        @for (g of rightGroups(); track g.category) {
          <ng-container *ngTemplateOutlet="cluster; context: { $implicit: g, side: 'right' }" />
        }
      </div>

      @if (bottomGroups().length > 0) {
        <div class="bottom">
          @for (g of bottomGroups(); track g.category) {
            <ng-container *ngTemplateOutlet="cluster; context: { $implicit: g, side: 'bottom' }" />
          }
        </div>
      }
    </div>

    <ng-template #cluster let-g let-side="side">
      <section class="cluster" [attr.data-side]="side" [attr.data-cat]="g.category">
        <h3 class="cl-head">
          {{ ('codex.portCategory.' + g.category) | translate }}
          <span class="cl-ct">{{ g.slots.length }}</span>
        </h3>
        <ul class="cl-slots">
          @for (s of g.slots; track s.port + $index) {
            <li class="slot" [class.empty]="!s.className">
              @if (s.className && s.kind) {
                <span class="slot-duo">
                  <a class="slot-btn linked" [routerLink]="['/codex', s.kind, s.className]">
                    <span class="slot-port">{{ s.port }}</span>
                    <span class="slot-item">{{ s.name }}</span>
                    <span class="slot-chips">
                      @if (s.size != null) { <span class="chip">S{{ s.size }}</span> }
                      @if (s.grade) { <span class="chip">{{ s.grade }}</span> }
                      @if (s.manufacturerCode) { <span class="chip">{{ s.manufacturerCode }}</span> }
                      @if (s.statChip) { <span class="chip accent">{{ s.statChip }}</span> }
                    </span>
                  </a>
                  <button type="button" class="slot-swap" (click)="swapRequested.emit(s)"
                          [attr.aria-label]="'codex.swap.title' | translate"
                          [attr.title]="'codex.swap.title' | translate">⇄</button>
                </span>
              } @else if (s.className) {
                <span class="slot-btn static">
                  <span class="slot-port">{{ s.port }}</span>
                  <span class="slot-item">{{ s.name }}</span>
                  <span class="slot-chips">
                    @if (s.size != null) { <span class="chip">S{{ s.size }}</span> }
                  </span>
                </span>
              } @else {
                <span class="slot-btn static">
                  <span class="slot-port">{{ s.port }}</span>
                  <span class="slot-empty">{{ 'codex.detail.loadoutEmpty' | translate }}</span>
                </span>
              }
            </li>
          }
        </ul>
      </section>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .layout {
      display: grid; gap: 14px; align-items: start;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .bottom { grid-column: 1 / -1; display: grid; gap: 14px;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

    .cluster { border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      padding: 10px 12px; position: relative; }
    .cluster[data-side="left"] { border-right: 2px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    .cluster[data-side="right"] { border-left: 2px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    .cluster[data-cat="weapons"] { border-top: 2px solid color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 45%, transparent); }
    .cluster[data-cat="missiles"] { border-top: 2px solid color-mix(in srgb, #ff5252 40%, transparent); }
    .cluster[data-cat="defense"] { border-top: 2px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); }

    .cl-head { margin: 0 0 8px; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--sc-fg-1); display: flex; align-items: center; gap: 6px; }
    .cl-ct { font-size: 0.62rem; padding: 0 6px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .cl-slots { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }

    .slot-duo { display: flex; align-items: stretch; gap: 4px; }
    .slot-duo .slot-btn { flex: 1 1 auto; min-width: 0; }
    .slot-swap { flex: 0 0 auto; padding: 0 9px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-size: 0.9rem; cursor: pointer; }
    .slot-swap:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .slot-btn { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 6px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); text-decoration: none; }
    a.slot-btn:hover { border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-0)); }
    .slot.empty .slot-btn { background: transparent; border-style: dashed; }
    .slot-port { font-size: 0.66rem; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .slot-item { font-size: 0.8rem; color: var(--sc-accent); overflow-wrap: anywhere; }
    .slot-btn.static .slot-item { color: var(--sc-fg-1); }
    .slot-empty { font-size: 0.74rem; color: var(--sc-fg-2); font-style: italic; }
    .slot-chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .chip { font-size: 0.6rem; padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-2);
      color: var(--sc-fg-2); border: 1px solid var(--sc-border); white-space: nowrap; }
    .chip.accent { color: var(--sc-accent);
      border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }

    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .cluster[data-side="left"], .cluster[data-side="right"] { border-left: none; border-right: none; }
    }
  `],
})
export class CodexHardpointLayoutComponent {
  /** Loadout slots grouped by functional category (display order applied here). */
  readonly groups = input.required<LayoutGroup[]>();
  /** A filled slot's ⇄ was clicked — the parent opens the swap-preview dock. */
  readonly swapRequested = output<LayoutSlot>();

  private ordered = computed(() =>
    HARDPOINT_CATEGORY_ORDER
      .map((c) => this.groups().find((g) => g.category === c))
      .filter((g): g is LayoutGroup => !!g && g.slots.length > 0),
  );

  readonly leftGroups = computed(() =>
    this.ordered().filter((g) => LEFT_CATEGORIES.includes(g.category)),
  );
  readonly rightGroups = computed(() =>
    this.ordered().filter((g) => RIGHT_CATEGORIES.includes(g.category)),
  );
  readonly bottomGroups = computed(() =>
    this.ordered().filter(
      (g) => !LEFT_CATEGORIES.includes(g.category) && !RIGHT_CATEGORIES.includes(g.category),
    ),
  );
}
