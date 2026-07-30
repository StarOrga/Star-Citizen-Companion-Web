import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CodexKind } from './codex.service';
import {
  EquippedStat,
  GroupedSlot,
  commonPortLabel,
  formatEquippedStat,
  groupIdenticalSlots,
  sizeBadge,
} from './codex-equipped-stats';
import {
  SHIP_MODULE_SECTION_ORDER,
  ShipModuleSection,
  isConfigurableSection,
} from './ship-module-sections';

/**
 * A sub-slot the installed mount itself exposes: the gun port inside a VariPuck
 * gimbal, the two missile ports of a rack, the twin gun ports of a remote
 * turret. Read from the MOUNT's own `itemPorts` — that is where the "3× S3
 * VariPuck … → 3× S3 CF-337 Panther Repeater" pairing comes from.
 */
export interface LayoutChild {
  /** Humanized sub-port label on the mount (e.g. "Hardpoint Class 2"). */
  port: string;
  /** What fits in here ("Weapon Gun", "Missile"), humanized engine type. */
  typeLabel: string | null;
  /** Fixed size of the sub-slot, or null when the port accepts a range. */
  size: number | null;
  /** The item installed in the sub-slot; null = nothing resolvable → "—". */
  className: string | null;
  kind: CodexKind | null;
  name: string | null;
  /** How many identical sub-slots this row stands for on ONE mount (≥1). */
  count: number;
}

// One labelled slot in the read-only layout (Rung 1): the port, what the
// stock loadout installs there, and what that thing itself carries.
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
  /** Sub-slots the occupant exposes (mount → weapon, rack → missiles). */
  children?: LayoutChild[];
  /** Size the hardpoint itself accepts, when the extract knows it. */
  portSize?: number | null;
  /**
   * Identity beyond the installed class, so two identical mounts holding
   * different things never collapse into one row (see `groupIdenticalSlots`).
   */
  variantKey?: string | null;
}

/**
 * What a click on a module row refers to: the row itself, how many identical
 * hardpoints it stands for, and — when a sub-slot was clicked — which child.
 */
export interface LayoutTarget {
  slot: LayoutSlot;
  count: number;
  child: LayoutChild | null;
}

/** One block of the ship-modules view — see `ship-module-sections.ts`. */
export interface LayoutSection {
  section: ShipModuleSection;
  slots: LayoutSlot[];
}

/** A section after identical hardpoints have been collapsed. */
interface RenderSection {
  section: ShipModuleSection;
  /** Total hardpoints in the block (the header count — not the row count). */
  count: number;
  rows: GroupedSlot<LayoutSlot>[];
  configurable: boolean;
}

/**
 * Ship modules, ordered the way a pilot configures them (admin request
 * 461288f9): the blocks they can actually change first — Weapons, Remote
 * Turrets, Missiles, POD, Shields, Power Plant, Quantum Drive, Radar, Coolers,
 * Life Support — then the fixed rest (thrusters, seats, controllers …) below,
 * visually de-emphasised.
 *
 * A weapon row reads mount-first, exactly like the loadout tools do: the thing
 * bolted to the hull ("3× S3 VariPuck S3 Gimbal Mount") on the left, and what
 * sits INSIDE it ("3× S3 CF-337 Panther Repeater", or a "—" placeholder when
 * the extract has no stock weapon) chained to its right.
 *
 * Clicking a card in a CONFIGURABLE block opens the swap picker — that block is
 * exactly the set of things a pilot can change, so "click the weapon" answering
 * "what else fits here" is what the request asked for (461288f9). Blocks that
 * cannot be configured (thrusters, seats, doors) have nothing to swap, so their
 * cards open the read-only stat sheet instead; configurable rows reach the same
 * sheet through their ⓘ button. Since #137 part 3 a row can also be LOCATED:
 * hovering it emits its raw port name(s) for the hull map above.
 */
@Component({
  selector: 'sc-codex-hardpoint-layout',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layout">
      @for (sec of renderSections(); track sec.section) {
        <section class="mod-sec" [attr.data-sec]="sec.section" [class.fixed]="!sec.configurable">
          <h3 class="sec-head">
            {{ ('codex.moduleSection.' + sec.section) | translate }}
            <span class="sec-ct">{{ sec.count }}</span>
            @if (!sec.configurable) {
              <span class="sec-tag">{{ 'codex.moduleSection.fixedTag' | translate }}</span>
            }
          </h3>
          <ul class="sec-rows" [class.dense]="!sec.configurable">
            @for (row of sec.rows; track row.slot.port + $index) {
              <li class="slot" [class.empty]="!row.slot.className"
                  [class.located]="isLocated(row)" [class.on]="isActive(row)"
                  (mouseenter)="emitHover(row)" (mouseleave)="hovered.emit(null)"
                  (focusin)="emitHover(row)" (focusout)="hovered.emit(null)">
                <div class="duo">
                  @if (row.slot.className) {
                    <button type="button" class="slot-btn linked" (click)="openSlot(row, sec.configurable)"
                            [attr.title]="portTitle(row)">
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
                    </button>
                  } @else {
                    <span class="slot-btn static" [attr.title]="portTitle(row)">
                      <span class="slot-head">
                        @if (emptyBadge(row); as b) { <span class="size-tag muted">{{ b }}</span> }
                        <span class="slot-empty">{{ 'codex.detail.loadoutEmpty' | translate }}</span>
                      </span>
                      <span class="slot-port">{{ portLabel(row) }}</span>
                    </span>
                  }

                  <!-- What sits INSIDE the mount: the gun in the gimbal, the
                       missiles in the rack. Rendered even when the extract
                       resolves nothing, so the pilot sees the empty seat
                       instead of a mount that pretends to be the weapon. -->
                  @if (row.slot.children?.length) {
                    <span class="chain" aria-hidden="true"></span>
                    <ul class="kids">
                      @for (kid of row.slot.children; track kid.port) {
                        <li class="kid" [class.empty]="!kid.className">
                          @if (kid.className) {
                            <button type="button" class="kid-btn linked"
                                    (click)="openChild(row, kid, sec.configurable)">
                              <span class="slot-head">
                                @if (kidBadge(row, kid); as b) { <span class="size-tag">{{ b }}</span> }
                                <span class="slot-ident">
                                  <span class="slot-item">{{ kid.name }}</span>
                                  <span class="slot-meta">
                                    @if (kid.typeLabel) { <span class="meta-txt">{{ kid.typeLabel }}</span> }
                                  </span>
                                </span>
                              </span>
                              <span class="slot-port">{{ kid.port }}</span>
                            </button>
                          } @else {
                            <span class="kid-btn static">
                              <span class="slot-head">
                                @if (kidBadge(row, kid); as b) { <span class="size-tag muted">{{ b }}</span> }
                                <span class="slot-ident">
                                  <span class="kid-empty">—</span>
                                  <span class="slot-meta">
                                    @if (kid.typeLabel) { <span class="meta-txt">{{ kid.typeLabel }}</span> }
                                  </span>
                                </span>
                              </span>
                              <span class="slot-port">{{ kid.port }}</span>
                            </span>
                          }
                        </li>
                      }
                    </ul>
                  }

                  <!-- On a configurable row the card itself is the swap action,
                       so the side button is the way BACK to the full stat sheet
                       shipped in the first pass. -->
                  @if (row.slot.className && sec.configurable) {
                    <button type="button" class="slot-swap" (click)="inspectRow(row)"
                            [attr.aria-label]="'codex.inspect.openStats' | translate"
                            [attr.title]="'codex.inspect.openStats' | translate">ⓘ</button>
                  }
                </div>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .layout { display: flex; flex-direction: column; gap: 14px; }

    .mod-sec { border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      padding: 10px 12px; }
    .mod-sec[data-sec="weapons"] { border-top: 2px solid color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 55%, transparent); }
    .mod-sec[data-sec="remoteTurrets"] { border-top: 2px solid color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 35%, transparent); }
    .mod-sec[data-sec="missiles"] { border-top: 2px solid color-mix(in srgb, #ff5252 45%, transparent); }
    .mod-sec[data-sec="shields"] { border-top: 2px solid color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .mod-sec[data-sec="powerPlants"] { border-top: 2px solid color-mix(in srgb, #ffc14d 45%, transparent); }
    /* Nothing here can be configured, so the block steps back visually. */
    .mod-sec.fixed { background: transparent; opacity: 0.78; }
    .mod-sec.fixed:hover { opacity: 1; }

    .sec-head { margin: 0 0 8px; font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--sc-fg-1); display: flex; align-items: center; gap: 6px; }
    .sec-ct { font-size: max(0.62rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .sec-tag { font-size: max(0.56rem, var(--sc-fs-floor)); letter-spacing: 0.06em; color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); border-radius: 3px; padding: 0 5px; }

    .sec-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .sec-rows.dense { display: grid; gap: 6px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }

    /* mount | chain | what is inside it | swap */
    .duo { display: flex; align-items: stretch; gap: 6px; flex-wrap: wrap; }
    .duo > .slot-btn { flex: 1 1 240px; min-width: 0; }
    .chain { flex: 0 0 auto; align-self: center; width: 14px; height: 2px;
      background: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .kids { list-style: none; margin: 0; padding: 0; flex: 2 1 300px; min-width: 0;
      display: flex; flex-direction: column; gap: 4px; }
    .kid { min-width: 0; }

    .slot-swap { flex: 0 0 auto; padding: 0 9px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-size: 0.9rem; cursor: pointer; }
    .slot-swap:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .slot-btn, .kid-btn { display: flex; flex-direction: column; gap: 3px; padding: 7px 8px;
      border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      text-decoration: none; text-align: left; width: 100%; font: inherit; color: inherit; }
    button.slot-btn, button.kid-btn { cursor: pointer; }
    button.slot-btn:hover, button.kid-btn:hover { border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-0)); }
    .slot.empty > .duo > .slot-btn { background: transparent; border-style: dashed; }
    .kid.empty .kid-btn { background: transparent; border-style: dashed; }
    /* A row whose position on the hull is known gets a locator rail; when the
       hull map highlights it, the rail lights up. */
    .slot.located .slot-btn { border-left: 2px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .slot.located.on .slot-btn { border-left-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)); }

    /* Size badge | name + meta — the two things that identify the occupant. */
    .slot-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .slot-ident { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .size-tag { flex: 0 0 auto; font-size: max(0.66rem, var(--sc-fs-floor)); font-weight: 600; line-height: 1.4;
      padding: 1px 6px; border-radius: 4px; white-space: nowrap;
      font-variant-numeric: tabular-nums; color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .size-tag.muted { color: var(--sc-fg-2); background: transparent; border-color: var(--sc-border); }

    .slot-item { font-size: 0.84rem; line-height: 1.25; color: var(--sc-accent);
      overflow-wrap: anywhere; }
    .slot-btn.static .slot-item { color: var(--sc-fg-1); }
    .slot-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
    .slot-meta:empty { display: none; }
    .meta-txt { font-size: max(0.64rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .tag { font-size: max(0.58rem, var(--sc-fs-floor)); letter-spacing: 0.04em; text-transform: uppercase;
      padding: 0 5px; border-radius: 3px; background: var(--sc-bg-2); color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); white-space: nowrap; }
    .tag.accent { text-transform: none; letter-spacing: 0; color: var(--sc-accent);
      border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .tag.dmg { color: var(--sc-accent-hot, #ff7a45);
      border-color: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 45%, transparent);
      background: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 10%, transparent); }

    /* Port name is context, not headline — it sits last and quiet. */
    .slot-port { font-size: max(0.63rem, var(--sc-fs-floor)); color: var(--sc-fg-2); opacity: 0.85; overflow-wrap: anywhere; }
    .slot-empty { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .kid-empty { font-size: 0.84rem; color: var(--sc-fg-2); }

    .slot-stats { margin: 5px 0 0; padding: 5px 0 0; display: flex; flex-wrap: wrap;
      gap: 2px 14px;
      border-top: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent); }
    .slot-stats .stat { display: flex; align-items: baseline; gap: 5px; min-width: 0; }
    .slot-stats dt { font-size: max(0.63rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .slot-stats dd { margin: 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-1); white-space: nowrap;
      font-variant-numeric: tabular-nums; }
    .slot-stats .derived { color: var(--sc-fg-2); cursor: help; }
    .slot-note { margin-top: 4px; font-size: max(0.63rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }

    @media (max-width: 720px) {
      .chain { display: none; }
      .kids { flex-basis: 100%; padding-left: 12px;
        border-left: 2px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    }
  `],
})
export class CodexHardpointLayoutComponent {
  /** Loadout slots grouped into ship-module sections (display order applied here). */
  readonly sections = input.required<LayoutSection[]>();
  /**
   * A configurable module was clicked — the parent opens the swap picker. Emits
   * the row plus, for a sub-slot click, which child was picked (so the gun
   * inside a gimbal mount opens the picker for the GUN, not for the mount).
   */
  readonly swapRequested = output<LayoutTarget>();
  /**
   * A card was clicked — the parent opens the component overlay. Emits the row
   * plus, for a sub-slot click, which child was picked.
   */
  readonly inspected = output<LayoutTarget>();
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

  /**
   * A module card was clicked. In a configurable block that means "show me what
   * else fits here"; in a fixed block there is nothing to swap, so the click
   * falls back to the read-only stat sheet.
   */
  openSlot(row: GroupedSlot<LayoutSlot>, configurable: boolean): void {
    const target = { slot: row.slot, count: row.count, child: null };
    (configurable ? this.swapRequested : this.inspected).emit(target);
  }

  openChild(row: GroupedSlot<LayoutSlot>, child: LayoutChild, configurable: boolean): void {
    const target = { slot: row.slot, count: row.count * child.count, child };
    (configurable && child.className ? this.swapRequested : this.inspected).emit(target);
  }

  /** The ⓘ side button: always the full stat sheet for the mount itself. */
  inspectRow(row: GroupedSlot<LayoutSlot>): void {
    this.inspected.emit({ slot: row.slot, count: row.count, child: null });
  }

  private ordered = computed<RenderSection[]>(() =>
    SHIP_MODULE_SECTION_ORDER
      .map((s) => this.sections().find((g) => g.section === s))
      .filter((g): g is LayoutSection => !!g && g.slots.length > 0)
      .map((g) => ({
        section: g.section,
        count: g.slots.length,
        rows: groupIdenticalSlots(g.slots),
        configurable: isConfigurableSection(g.section),
      })),
  );

  readonly renderSections = this.ordered;

  /** "3× S3" / "S3" / "3×" — never a guessed size (see sizeBadge). */
  badge(row: GroupedSlot<LayoutSlot>): string | null {
    return sizeBadge(row.count, row.slot.size);
  }

  /**
   * Badge for an EMPTY hardpoint. The occupant has no size (there is none), so
   * the hardpoint's own accepted size is used when the extract carries it —
   * "the ship has a size-3 mount here, it is just unfitted".
   */
  emptyBadge(row: GroupedSlot<LayoutSlot>): string | null {
    return sizeBadge(row.count, row.slot.portSize ?? null);
  }

  /** Sub-slot badge: mount count × sub-slots per mount, at the sub-slot's size. */
  kidBadge(row: GroupedSlot<LayoutSlot>, child: LayoutChild): string | null {
    return sizeBadge(row.count * child.count, child.size);
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
}
