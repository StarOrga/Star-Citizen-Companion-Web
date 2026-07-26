import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CodexKind } from './codex.service';
import { HARDPOINT_CATEGORY_ORDER, HardpointCategory } from './codex-format';
import {
  EquippedStat,
  GroupedSlot,
  commonPortLabel,
  formatEquippedStat,
  groupIdenticalSlots,
  sizeBadge,
} from './codex-equipped-stats';

// One labelled slot in the read-only layout (Rung 1): the port, what the
// stock loadout installs there, and where to jump on click.
export interface LayoutSlot {
  port: string; // humanized port label
  /**
   * The RAW port name (e.g. `hardpoint_weapon_left`) — the key the hull map
   * highlights by, because a humanized label is not unique or matchable.
   */
  rawPort?: string;
  className: string | null; // null = stock-empty port
  kind: CodexKind | null; // null = installed item not resolvable → no link
  name: string | null;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  /** Optional highlighted stat chip, e.g. the jump range on the quantum drive (#137). */
  statChip?: string | null;
  /** What the occupant IS ("Gun", "Quantum Drive", "Mid Range Radar"). */
  typeLabel?: string | null;
  /** Damage channels a mounted weapon deals, strongest first (usually one). */
  damageChannels?: string[];
  /**
   * Curated headline stats of the item installed here, picked for ITS type
   * (a gun gets damage/velocity/range, a shield gets HP/regen). Empty when the
   * extract carries no usable numbers — the row then simply shows no stats
   * rather than zeros.
   */
  stats?: EquippedStat[];
  /** The occupant is a real gun but this extract has no stats for it. */
  statsMissing?: boolean;
}

export interface LayoutGroup {
  category: HardpointCategory;
  slots: LayoutSlot[];
}

/** A category cluster after identical hardpoints have been collapsed. */
interface RenderGroup {
  category: HardpointCategory;
  /** Total hardpoints in the cluster (the header count — not the row count). */
  count: number;
  rows: GroupedSlot<LayoutSlot>[];
}

// Which column a category cluster docks to (desktop).
const LEFT_CATEGORIES: HardpointCategory[] = ['weapons', 'missiles', 'avionics'];
const RIGHT_CATEGORIES: HardpointCategory[] = ['defense', 'power', 'propulsion'];

/**
 * Read-only hardpoint layout (loadout ladder Rung 1): the stock loadout as
 * labelled slot clusters in two columns, grouped by functional category.
 * Opening a slot navigates to the installed item's detail page. The ship render
 * deliberately stays out of this block; the detail hero above already shows it.
 *
 * Since #137 part 3 a row can also be LOCATED: hovering (or focusing) it emits
 * its raw port name(s), which the hull map above turns into a highlighted
 * marker, and `activePorts` marks the row when the highlight came from the map.
 * Ships whose extract carries no coordinates simply never get an
 * `activePorts` match — the layout then behaves exactly as before.
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
          <span class="cl-ct">{{ g.count }}</span>
        </h3>
        <ul class="cl-slots">
          @for (row of g.rows; track row.slot.port + $index) {
            <li class="slot" [class.empty]="!row.slot.className"
                [class.located]="isLocated(row)" [class.on]="isActive(row)"
                (mouseenter)="emitHover(row)" (mouseleave)="hovered.emit(null)"
                (focusin)="emitHover(row)" (focusout)="hovered.emit(null)">
              @if (row.slot.className && row.slot.kind) {
                <span class="slot-duo">
                  <a class="slot-btn linked"
                     [routerLink]="['/codex', row.slot.kind, row.slot.className]"
                     [attr.title]="portTitle(row)">
                    <ng-container *ngTemplateOutlet="ident; context: { $implicit: row }" />
                    @if (row.slot.stats?.length) {
                      <dl class="slot-stats">
                        @for (st of row.slot.stats; track st.labelKey) {
                          <div class="stat">
                            <dt>
                              {{ st.labelKey | translate }}
                              @if (st.derived) {
                                <span class="derived"
                                      [attr.title]="'codex.equipped.derivedHint' | translate">*</span>
                              }
                            </dt>
                            <dd>{{ fmtStat(st) }}</dd>
                          </div>
                        }
                      </dl>
                    } @else if (row.slot.statsMissing) {
                      <span class="slot-note">{{ 'codex.equipped.noStats' | translate }}</span>
                    }
                  </a>
                  <button type="button" class="slot-swap" (click)="swapRequested.emit(row.slot)"
                          [attr.aria-label]="'codex.swap.title' | translate"
                          [attr.title]="'codex.swap.title' | translate">⇄</button>
                </span>
              } @else if (row.slot.className) {
                <span class="slot-btn static" [attr.title]="portTitle(row)">
                  <ng-container *ngTemplateOutlet="ident; context: { $implicit: row }" />
                </span>
              } @else {
                <span class="slot-btn static" [attr.title]="portTitle(row)">
                  <span class="slot-head">
                    @if (badge(row); as b) { <span class="size-tag muted">{{ b }}</span> }
                    <span class="slot-empty">{{ 'codex.detail.loadoutEmpty' | translate }}</span>
                  </span>
                  <span class="slot-port">{{ portLabel(row) }}</span>
                </span>
              }
            </li>
          }
        </ul>
      </section>
    </ng-template>

    <!--
      Identity block of one occupied hardpoint, in the order a pilot reads it:
      size class first (the number that decides what even fits), then WHAT is
      mounted, then who made it / what type it is, and only then which port it
      sits on. The port name used to be the headline, which is why
      "Hardpoint Controller Weapon" read as if it were the weapon.
    -->
    <ng-template #ident let-row>
      <span class="slot-head">
        @if (badge(row); as b) { <span class="size-tag">{{ b }}</span> }
        <span class="slot-ident">
          <span class="slot-item">{{ row.slot.name }}</span>
          <span class="slot-meta">
            @if (metaLine(row); as m) { <span class="meta-txt">{{ m }}</span> }
            @for (ch of row.slot.damageChannels; track ch) {
              <span class="tag dmg">{{ ('codex.damage.' + ch) | translate }}</span>
            }
            @if (row.slot.grade) { <span class="tag">{{ row.slot.grade }}</span> }
            @if (row.slot.statChip) { <span class="tag accent">{{ row.slot.statChip }}</span> }
          </span>
        </span>
      </span>
      <span class="slot-port">{{ portLabel(row) }}</span>
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
    .slot-btn { display: flex; flex-direction: column; gap: 3px; padding: 7px 8px; border-radius: 6px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); text-decoration: none; }
    a.slot-btn:hover { border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-0)); }
    .slot.empty .slot-btn { background: transparent; border-style: dashed; }
    /* A row whose position on the hull is known gets a locator rail; when the
       hull map highlights it, the rail lights up. Rows without coordinates keep
       their previous appearance entirely. */
    .slot.located .slot-btn { border-left: 2px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .slot.located.on .slot-btn { border-left-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)); }

    /* Size badge | name + meta — the two things that identify the occupant. */
    .slot-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .slot-ident { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    /* The size class is what decides whether an item fits at all, so it gets a
       block of its own rather than trailing the row as one chip among many. */
    .size-tag { flex: 0 0 auto; font-size: 0.66rem; font-weight: 600; line-height: 1.4;
      padding: 1px 6px; border-radius: 4px; white-space: nowrap;
      font-variant-numeric: tabular-nums; color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .size-tag.muted { color: var(--sc-fg-2); background: transparent; border-color: var(--sc-border); }

    .slot-item { font-size: 0.84rem; line-height: 1.25; color: var(--sc-accent);
      overflow-wrap: anywhere; }
    .slot-btn.static .slot-item { color: var(--sc-fg-1); }
    /* "KLA · Gun" + type tags — who made it and what it is, one line under the name. */
    .slot-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
    .slot-meta:empty { display: none; }
    .meta-txt { font-size: 0.64rem; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .tag { font-size: 0.58rem; letter-spacing: 0.04em; text-transform: uppercase;
      padding: 0 5px; border-radius: 3px; background: var(--sc-bg-2); color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); white-space: nowrap; }
    .tag.accent { text-transform: none; letter-spacing: 0; color: var(--sc-accent);
      border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    /* Damage type is the gun's identity (shield-eater vs hull-shredder). */
    .tag.dmg { color: var(--sc-accent-hot, #ff7a45);
      border-color: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 45%, transparent);
      background: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 10%, transparent); }

    /* Port name is context, not headline — it sits last and quiet. */
    .slot-port { font-size: 0.63rem; color: var(--sc-fg-2); opacity: 0.85; overflow-wrap: anywhere; }
    .slot-empty { font-size: 0.74rem; color: var(--sc-fg-2); font-style: italic; }

    /* Per-hardpoint stat readout: label/value pairs that pack left-to-right and
       wrap, so they stay tight in a narrow cluster and never stretch into
       "Alpha damage ................ 19" in a wide one. */
    .slot-stats { margin: 5px 0 0; padding: 5px 0 0; display: flex; flex-wrap: wrap;
      gap: 2px 14px;
      border-top: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent); }
    .slot-stats .stat { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
    .slot-stats dt { font-size: 0.63rem; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .slot-stats dd { margin: 0; font-size: 0.7rem; color: var(--sc-fg-1); white-space: nowrap;
      font-variant-numeric: tabular-nums; }
    .slot-stats .derived { color: var(--sc-fg-2); cursor: help; }
    .slot-note { margin-top: 4px; font-size: 0.63rem; color: var(--sc-fg-2); font-style: italic; }

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
  /**
   * Raw port names whose hull position is known. A row is only marked as
   * locatable when its port is in here, so the affordance never promises a
   * marker the map cannot show.
   */
  readonly locatablePorts = input<readonly string[]>([]);
  /** Raw port names currently highlighted (came from the hull map). */
  readonly activePorts = input<readonly string[]>([]);
  /** A row was hovered/focused: its raw port names, or `null` on leave. */
  readonly hovered = output<string[] | null>();

  /** Raw port names a (possibly collapsed) row stands for. */
  private rawPorts(row: GroupedSlot<LayoutSlot>): string[] {
    return row.ports.map((p) => p.rawPort).filter((p): p is string => !!p);
  }

  emitHover(row: GroupedSlot<LayoutSlot>): void {
    const ports = this.rawPorts(row);
    this.hovered.emit(ports.length > 0 ? ports : null);
  }

  /** At least one of the row's ports has a known position on the hull. */
  isLocated(row: GroupedSlot<LayoutSlot>): boolean {
    const locatable = this.locatablePorts();
    return locatable.length > 0 && this.rawPorts(row).some((p) => locatable.includes(p));
  }

  isActive(row: GroupedSlot<LayoutSlot>): boolean {
    const active = this.activePorts();
    return active.length > 0 && this.rawPorts(row).some((p) => active.includes(p));
  }

  private ordered = computed<RenderGroup[]>(() =>
    HARDPOINT_CATEGORY_ORDER
      .map((c) => this.groups().find((g) => g.category === c))
      .filter((g): g is LayoutGroup => !!g && g.slots.length > 0)
      .map((g) => ({
        category: g.category,
        count: g.slots.length,
        rows: groupIdenticalSlots(g.slots),
      })),
  );

  /** "3× S3" / "S3" / "3×" — never a guessed size (see sizeBadge). */
  badge(row: GroupedSlot<LayoutSlot>): string | null {
    return sizeBadge(row.count, row.slot.size);
  }

  /**
   * Port label for the row. A collapsed run is prefixed with its count and
   * labelled with the part of the name all its ports share, so it never claims
   * N copies of one specific mount (see commonPortLabel).
   */
  portLabel(row: GroupedSlot<LayoutSlot>): string {
    if (row.count === 1) return row.slot.port;
    return `${row.count}× ${commonPortLabel(row.ports.map((p) => p.port))}`;
  }

  /** Hover text listing every port a collapsed row stands for. */
  portTitle(row: GroupedSlot<LayoutSlot>): string {
    return row.ports.map((p) => p.port).join(' · ');
  }

  /**
   * "KLA · Gun" — the maker and the kind of thing, under the name. Both are
   * catalog data (a manufacturer code and a humanized engine type), not UI
   * copy, so neither is translated; either half may be absent.
   */
  metaLine(row: GroupedSlot<LayoutSlot>): string {
    return [row.slot.manufacturerCode, row.slot.typeLabel].filter(Boolean).join(' · ');
  }

  fmtStat(stat: EquippedStat): string {
    return formatEquippedStat(stat);
  }

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
