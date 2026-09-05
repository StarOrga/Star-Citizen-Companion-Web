import {
  ChangeDetectionStrategy,
  Component,
  WritableSignal,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CodexKind } from './codex.service';
import { buildFoldPreview, FoldPeekChip, FoldPreview } from './codex-fold-preview';
import type { SummaryOccupant } from './ship-summary-panels';
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
import { formatNumber } from './codex-format';

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
  /** Every RAW sub-port name this row stands for (Falle 3 / R5) — draft/query key. */
  rawPorts: string[];
  /** Raw (un-humanized) engine type strings the sub-port declares. */
  rawTypes: string[];
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
  /**
   * Overrides the default className/size/grade/variantKey grouping key with
   * a caller-computed one — the draft write path sets this to the STOCK
   * identity so display can diverge from grouping (R5/Falle 4).
   */
  groupKey?: string | null;
  /** Keep this hardpoint on its own row — it is an individual choice. */
  noCollapse?: boolean;
  /**
   * i18n key for what "nothing installed" MEANS here. The default reads "empty
   * (stock)", which on a gun mount would claim the ship is unarmed — a weapon
   * mount says instead that the extract carries no stock weapon (1add86a4).
   */
  emptyLabelKey?: string | null;
  /**
   * i18n key naming the role this hardpoint plays inside its block, when the
   * block mixes roles — a shield GENERATOR bay versus the shield CONTROL
   * module. Rendered as a tag; null for blocks where every row is the same job.
   */
  roleKey?: string | null;
  /** An unfitted hardpoint we know the accepted item type for — still swappable. */
  emptySwappable?: boolean;
  /**
   * Draft write-path (PR B, R6/R8): this row's occupant is not the stock one —
   * `'changed'` once resolved, `'pending'` while the swapped class's stats are
   * still hydrating (no numbers rendered meanwhile), `'unresolved'` when a
   * restored draft names a class the current build no longer has (R9).
   */
  draftState?: 'changed' | 'pending' | 'unresolved' | null;
  /** The raw dotted path(s) this row's draft entry lives at — for the revert action. */
  draftPaths?: string[];
  /**
   * Percent change of the row's headline stat (`stats[0]`) versus the STOCK
   * occupant, only set while `draftState === 'changed'` and both sides carry
   * a comparable numeric value (MASTER §6: "right figure … with delta chip
   * when changed"). `null` when there is nothing to compare against.
   */
  deltaPct?: number | null;
}

/**
 * A short, translated note under a section head: the data gap in the weapons
 * block, what "generator vs control module" means in the shield block. Params
 * feed ngx-translate interpolation.
 */
export interface SectionNote {
  key: string;
  params?: Record<string, unknown>;
}

/**
 * What a click on a module row refers to: the row itself, how many identical
 * hardpoints it stands for, and — when a sub-slot was clicked — which child.
 */
export interface LayoutTarget {
  slot: LayoutSlot;
  count: number;
  child: LayoutChild | null;
  /**
   * Every RAW slot path this target covers (Falle 3/5, R5): the top-level raw
   * ports of a (possibly grouped) row, or — for a sub-slot click — the dotted
   * `parentRawPort.childRawPort` paths of every parent×child combination the
   * grouped row stands for. Approximation: identical mounts are assumed to
   * expose their sub-slots at the same raw names, which is what let them
   * collapse into one row in the first place.
   */
  rawPorts: string[];
}

/** One block of the ship-modules view — see `ship-module-sections.ts`. */
export interface LayoutSection {
  section: ShipModuleSection;
  slots: LayoutSlot[];
  /** Optional explanatory note rendered under this block's heading. */
  notes?: SectionNote[];
}

/** A section after identical hardpoints have been collapsed. */
interface RenderSection {
  section: ShipModuleSection;
  /** Total hardpoints in the block (the header count — not the row count). */
  count: number;
  rows: GroupedSlot<LayoutSlot>[];
  configurable: boolean;
  notes: SectionNote[];
  /** Collapsing this block actually hides hardpoints → offer the split toggle. */
  splittable: boolean;
  /** Currently listing every hardpoint on its own row. */
  split: boolean;
  /** This block folds away entirely (the airframe). */
  foldable: boolean;
  /** A foldable block is currently open. */
  open: boolean;
}

/**
 * Blocks that start folded away. The airframe block is a hull inventory — a
 * capital ship puts hundreds of thrusters, seats and doors in it and none of
 * them is a decision, so it opens only when asked for (32659942: *"Die Ganzen
 * Infos 'Zellen und Feste Systeme' könnte man eingeklappt nach ganz unten
 * machen"*). Everything else stays open; folding a block you can act on would
 * hide the action.
 */
const FOLDABLE_SECTIONS: ReadonlySet<ShipModuleSection> = new Set<ShipModuleSection>(['structure']);

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
        <details class="mod-sec" [attr.data-sec]="sec.section" [class.fixed]="!sec.configurable"
                 [open]="sec.open" (toggle)="onToggle(sec.section, $event)">
          <summary class="sec-head">
            <span class="sec-glyph" aria-hidden="true">◈</span>
            {{ ('codex.moduleSection.' + sec.section) | translate }}
            <span class="sec-ct">{{ censusKey(sec) | translate: censusParams(sec) }}</span>
            @if (!sec.configurable) {
              <span class="sec-tag">{{ 'codex.moduleSection.fixedTag' | translate }}</span>
            }
            <!-- "Alle oder einzeln" (32659942): a block that folds identical
                 mounts into one row says so, and hands over the choice. Only
                 shown when collapsing actually hides a hardpoint. -->
            @if (sec.splittable) {
              <button type="button" class="sec-btn" (click)="$event.stopPropagation(); toggleSplit(sec.section)"
                      [attr.aria-expanded]="sec.split"
                      [attr.title]="(sec.split ? 'codex.moduleSection.groupRowsHint' : 'codex.moduleSection.splitRowsHint') | translate">
                <span class="chev" [class.open]="sec.split" aria-hidden="true">›</span>
                {{ (sec.split ? 'codex.moduleSection.groupRows' : 'codex.moduleSection.splitRows') | translate }}
              </button>
            }
            <span class="caret" [class.open]="sec.open">
              <span aria-hidden="true">{{ (sec.open ? '▴' : '▾') }}</span>
              {{ (sec.open ? 'codex.module.caretCollapse' : 'codex.module.caretExpand') | translate }}
            </span>

            @if (!sec.open) {
              <!-- Folded preview (MASTER §6): what's installed, at a glance,
                   INSIDE the summary — no tools, no grip while folded. -->
              <span class="fold-preview">
                @for (chip of preview(sec).chips; track chip.id) {
                  <span class="fp-chip">
                    {{ chip.count > 1 ? chip.count + '× ' : '' }}{{ chip.size ? 'S' + chip.size + ' ' : '' }}{{ chip.name }}
                    @if (chip.roleKey) { <span class="fp-role">{{ chip.roleKey | translate }}</span> }
                    @if (chip.figure != null) { · {{ fmtPeek(chip) }} {{ chip.unitKey ? (chip.unitKey | translate) : '' }} }
                  </span>
                }
                @if (preview(sec).aggregate; as agg) {
                  <span class="fp-chip fp-agg">{{ agg.labelKey! | translate }} {{ fmtPeek(agg) }}</span>
                }
                <span class="fp-lock">{{ preview(sec).lockKey | translate }}</span>
              </span>
            }
          </summary>
          @if (sec.open) {
          <!-- What this block can and cannot tell you — named where it is read,
               not once at the top of the page (1add86a4). -->
          @for (n of sec.notes; track n.key) {
            <p class="sec-note">{{ n.key | translate: n.params }}</p>
          }
          <ul class="sec-rows" [class.dense]="!sec.configurable">
            @for (row of sec.rows; track rowKey(row)) {
              <li class="slot" [class.empty]="!row.slot.className"
                  [class.inactive]="row.slot.roleKey === 'codex.module.badge.passive'"
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
                            @if (row.slot.roleKey) {
                              <span class="tag role">{{ row.slot.roleKey | translate }}</span>
                            }
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
                      @if (secondaryStats(row); as rest) {
                        @if (rest.length) {
                          <dl class="slot-stats">
                            @for (st of rest; track st.labelKey) {
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
                        } @else if (!row.slot.stats?.length && row.slot.statsMissing) {
                          <span class="slot-note">{{ 'codex.equipped.noStats' | translate }}</span>
                        }
                      }
                    </button>
                    <!-- ONE right-hand headline figure per row (MASTER §6:
                         "right figure … with delta chip when changed") — the
                         same quantity the fold-peek aggregates, with the
                         absolute delta (not a percentage) riding inside it. -->
                    @if (headlineFig(sec, row); as fig) {
                      <div class="fig">
                        <span class="n">{{ fig.value }}</span>
                        <span class="u">{{ fig.unitKey | translate }}</span>
                        @if (fig.deltaText) {
                          <span class="dl" [class.up]="fig.delta! > 0" [class.down]="fig.delta! < 0">{{ fig.deltaText }}</span>
                        }
                      </div>
                    }
                  } @else if (row.slot.emptySwappable && sec.configurable) {
                    <!-- An unfitted bay we DO know the accepted item type for
                         (from the hardpoint itself or from an identical fitted
                         bay on the same hull) stays a real choice: the Nomad's
                         third shield slot is pickable even though it ships
                         empty (1add86a4). -->
                    <button type="button" class="slot-btn linked open-bay"
                            (click)="openSlot(row, sec.configurable)"
                            [attr.title]="portTitle(row)">
                      <span class="slot-head">
                        @if (emptyBadge(row); as b) { <span class="size-tag muted">{{ b }}</span> }
                        <span class="slot-ident">
                          <span class="slot-empty">{{ emptyLabel(row) | translate }}</span>
                          <span class="slot-meta">
                            @if (row.slot.roleKey) {
                              <span class="tag role">{{ row.slot.roleKey | translate }}</span>
                            }
                            <span class="tag pick">{{ 'codex.swap.pickHere' | translate }}</span>
                          </span>
                        </span>
                      </span>
                      <span class="slot-port">{{ portLabel(row) }}</span>
                    </button>
                  } @else {
                    <span class="slot-btn static" [attr.title]="portTitle(row)">
                      <span class="slot-head">
                        @if (emptyBadge(row); as b) { <span class="size-tag muted">{{ b }}</span> }
                        <span class="slot-ident">
                          <span class="slot-empty">{{ emptyLabel(row) | translate }}</span>
                          <span class="slot-meta">
                            @if (row.slot.roleKey) {
                              <span class="tag role">{{ row.slot.roleKey | translate }}</span>
                            }
                          </span>
                        </span>
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
                          } @else if (kid.rawTypes.length > 0 && sec.configurable) {
                            <!-- An unfitted sub-slot we know the accepted engine
                                 type(s) for is still a real choice (Falle 3). -->
                            <button type="button" class="kid-btn linked open-bay"
                                    (click)="openChild(row, kid, sec.configurable)">
                              <span class="slot-head">
                                @if (kidBadge(row, kid); as b) { <span class="size-tag muted">{{ b }}</span> }
                                <span class="slot-ident">
                                  <span class="kid-empty">—</span>
                                  <span class="slot-meta">
                                    @if (kid.typeLabel) { <span class="meta-txt">{{ kid.typeLabel }}</span> }
                                    <span class="tag pick">{{ 'codex.swap.pickHere' | translate }}</span>
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

                  <!-- Draft write-path (PR B): a row edited away from stock
                       carries a chip naming its state, plus a revert action. -->
                  @if (row.slot.draftState; as ds) {
                    <span class="tag draft" [class.pending]="ds === 'pending'" [class.unresolved]="ds === 'unresolved'">
                      {{ ('codex.loadout.draftState.' + ds) | translate }}
                    </span>
                    @if (row.slot.draftPaths?.length) {
                      <button type="button" class="slot-revert" (click)="revertRow(row)"
                              [attr.aria-label]="'codex.loadout.revert' | translate"
                              [attr.title]="'codex.loadout.revert' | translate">↺</button>
                    }
                  }
                  <!-- On a configurable row the card itself is the swap action,
                       so the side button is the way BACK to the full stat sheet
                       shipped in the first pass. -->
                  @if (row.slot.className && sec.configurable) {
                    <button type="button" class="slot-swap" (click)="inspectRow(row)"
                            [attr.aria-label]="'codex.inspect.openStats' | translate"
                            [attr.title]="'codex.inspect.openStats' | translate">ⓘ</button>
                    <button type="button" class="slot-swap-action" (click)="openSlot(row, true)"
                            [attr.aria-label]="'codex.swap.open' | translate"
                            [attr.title]="'codex.swap.open' | translate">⇄</button>
                  }
                </div>
              </li>
            }
          </ul>
          }
        </details>
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
    .mod-sec[data-sec="countermeasures"] { border-top: 2px solid color-mix(in srgb, #f0c419 45%, transparent); }
    .mod-sec[data-sec="shields"] { border-top: 2px solid color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .mod-sec[data-sec="powerPlants"] { border-top: 2px solid color-mix(in srgb, #ffc14d 45%, transparent); }
    /* Nothing here can be configured, so the block steps back visually. */
    .mod-sec.fixed { background: transparent; opacity: 0.78; }
    .mod-sec.fixed:hover { opacity: 1; }

    /* The label plus its two toggles are wider than a phone: without wrapping,
       this row's min-content became the floor for the whole detail page and
       pushed it into horizontal scroll (feedback 2c7ed0d0). Wrapping keeps the
       heading a heading on desktop and lets the toggles drop to their own line
       on a narrow screen. */
    .sec-head { margin: 0 0 8px; font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--sc-fg-1); display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0;
      cursor: pointer; list-style: none; }
    .sec-head::-webkit-details-marker { display: none; }
    .sec-glyph { color: var(--sc-accent); font-size: 0.8rem; }
    .caret { margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
      color: var(--sc-accent); font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: none; letter-spacing: 0; }
    .caret.open { color: var(--sc-fg-2); }
    .sec-head:hover .caret { text-decoration: underline; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    /* Folded preview — chips + aggregate + lock hint, INSIDE the summary
       (MASTER §6): what's installed, at a glance, no controls while folded. */
    .fold-preview { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      margin-top: 4px; text-transform: none; letter-spacing: 0; }
    .fp-chip { font-size: max(0.68rem, var(--sc-fs-floor)); padding: 2px 8px; border-radius: 999px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
    .fp-chip.fp-agg { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .fp-role { color: var(--sc-fg-2); margin-left: 3px; }
    .fp-lock { font-size: max(0.62rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; margin-left: auto; }
    /* Passive shield generator (MASTER §6/B-C19): desaturated + darker until
       hovered; still swappable — this is not a disabled row. */
    .slot.inactive .slot-btn { filter: grayscale(0.65) brightness(0.82); }
    .slot.inactive:hover .slot-btn, .slot.inactive .slot-btn:focus-within { filter: none; }
    .sec-ct { font-size: max(0.62rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .sec-tag { font-size: max(0.56rem, var(--sc-fs-floor)); letter-spacing: 0.06em; color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); border-radius: 3px; padding: 0 5px; }
    /* "Einzeln / zusammen" and the airframe fold. Quiet by default — the block
       heading must stay a heading — but a real 32px-tall target. */
    .sec-btn { margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
      min-height: 32px; padding: 2px 8px; border-radius: 6px; cursor: pointer;
      background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font: inherit; font-size: max(0.6rem, var(--sc-fs-floor)); letter-spacing: 0.05em;
      text-transform: uppercase; }
    .sec-btn + .sec-btn { margin-left: 0; }
    .sec-btn:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .sec-btn .chev { display: inline-block; font-size: 0.85rem; line-height: 1;
      transition: transform 140ms ease; }
    .sec-btn .chev.open { transform: rotate(90deg); }
    @media (prefers-reduced-motion: reduce) { .sec-btn .chev { transition: none; } }
    /* Data-gap / mechanic note: readable, but never loud enough to read as an
       app error — nothing is broken, the extract just stops here. */
    .sec-note { margin: 0 0 8px; font-size: max(0.68rem, var(--sc-fs-floor)); line-height: 1.45;
      color: var(--sc-fg-2);
      border-left: 2px solid color-mix(in srgb, var(--sc-warn, #e8a33d) 55%, transparent);
      padding-left: 8px; }

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

    .slot-swap, .slot-swap-action { flex: 0 0 auto; padding: 0 9px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-size: 0.9rem; cursor: pointer; }
    .slot-swap:hover, .slot-swap-action:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    /* The row's ONE headline figure (MASTER §6) — number, unit, absolute
       delta chip. Sits between the identity block and the ⓘ/⇄ tools, same
       spot the concept's .fig occupies next to .tools. */
    .fig { flex: 0 0 auto; align-self: center; display: flex; align-items: baseline; gap: 4px;
      padding: 0 4px; min-width: 64px; text-align: right; }
    .fig .n { font-size: 0.92rem; font-weight: 600; color: var(--sc-fg-1); font-variant-numeric: tabular-nums; }
    .fig .u { font-size: max(0.6rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .fig .dl { font-size: max(0.62rem, var(--sc-fs-floor)); font-weight: 600; }
    .fig .dl.up { color: var(--sc-success, #4caf50); }
    .fig .dl.down { color: var(--sc-danger, #ff5252); }

    /* Draft write-path: a row edited away from stock. */
    .tag.draft { align-self: center; text-transform: none; letter-spacing: 0; color: var(--sc-accent-gold, #c8a84b);
      border-color: color-mix(in srgb, var(--sc-accent-gold, #c8a84b) 45%, transparent);
      background: color-mix(in srgb, var(--sc-accent-gold, #c8a84b) 10%, transparent); }
    .tag.draft.pending { color: var(--sc-fg-2); border-color: var(--sc-border); background: transparent; }
    .tag.draft.unresolved { color: var(--sc-danger, #ff5252);
      border-color: color-mix(in srgb, var(--sc-danger, #ff5252) 45%, transparent);
      background: color-mix(in srgb, var(--sc-danger, #ff5252) 10%, transparent); }
    .slot-revert { flex: 0 0 auto; align-self: center; width: 26px; height: 26px; border-radius: 50%;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-size: 0.85rem; cursor: pointer; }
    .slot-revert:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .slot-btn, .kid-btn { display: flex; flex-direction: column; gap: 3px; padding: 7px 8px;
      border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      text-decoration: none; text-align: left; width: 100%; font: inherit; color: inherit; }
    button.slot-btn, button.kid-btn { cursor: pointer; }
    button.slot-btn:hover, button.kid-btn:hover { border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-0)); }
    .slot.empty > .duo > .slot-btn { background: transparent; border-style: dashed; }
    .slot.empty > .duo > button.slot-btn.open-bay:hover { border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
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
    /* "Generator" vs "Control module" — the one word that keeps a shield bank
       from reading as four interchangeable shields. */
    .tag.role { text-transform: none; letter-spacing: 0; color: var(--sc-fg-1); }
    .tag.pick { text-transform: none; letter-spacing: 0; color: var(--sc-accent);
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
  /** The row's "↺" revert button was clicked — emits its draft paths. */
  readonly reverted = output<string[]>();
  /**
   * Overrides `SHIP_MODULE_SECTION_ORDER` with a mission-driven order (PR C,
   * 04-rules-v2 §7.7) — null keeps the default configurable-first order.
   */
  readonly sectionOrder = input<readonly ShipModuleSection[] | null>(null);
  /**
   * Sections the active mission folds away by default (in addition to
   * `structure`, which is always foldable). Changing this set resets any
   * per-visit "unfold" the pilot made under the previous mission — a mission
   * switch is a fresh read, not an accumulation of manual toggles.
   */
  readonly foldedSections = input<ReadonlySet<ShipModuleSection>>(new Set());
  /** Occupants grouped by section, for the folded-preview chips (MASTER §6). */
  readonly occupantsBySection = input<ReadonlyMap<ShipModuleSection, readonly SummaryOccupant[]>>(new Map());

  constructor() {
    // A mission switch is a fresh read, not an accumulation of manual folds:
    // every block reopens except the ones the new lens folds (plus the
    // airframe, which always starts folded — see FOLDABLE_SECTIONS above).
    effect(() => {
      const folded = this.foldedSections();
      untracked(() => {
        const closedDefault = new Set<ShipModuleSection>([...FOLDABLE_SECTIONS, ...folded]);
        const open = new Set<ShipModuleSection>(
          this.sections()
            .map((s) => s.section)
            .filter((s) => !closedDefault.has(s)),
        );
        this.openSections.set(open);
      });
    });
  }

  /** Folded-preview chips + aggregate + census for this block's `<summary>`. */
  preview(sec: RenderSection): FoldPreview {
    return buildFoldPreview(sec.section, this.occupantsBySection().get(sec.section) ?? []);
  }

  /** The active/passive split only means something for shields (or any block
   * whose preview actually reports a passive count) — everywhere else every
   * occupant counts as "active" by construction, so the split is noise. */
  censusKey(sec: RenderSection): string {
    const census = this.preview(sec).census;
    return sec.section === 'shields' || census.passive > 0 ? 'codex.module.census' : 'codex.module.censusSlots';
  }

  /**
   * The occupant census counts hardpoints that carry something (and, for a
   * mount-chain section, the CHILD it carries) — never the hull's own
   * hardpoint count (D11: a Nomad with 3 gun mounts and 3 gimballed guns must
   * read "3 Slots", not "6"). The section's own slot count is always the
   * source of truth for `slots`; the preview census is only consulted for
   * the active/passive split (shields).
   */
  censusParams(sec: RenderSection): { slots: number; active: number; passive: number } {
    const census = this.preview(sec).census;
    return { slots: sec.count, active: census.active, passive: census.passive };
  }

  fmtPeek(chip: FoldPeekChip): string {
    if (chip.figure == null) return '';
    return formatEquippedStat({ labelKey: '', value: chip.figure, format: chip.format });
  }

  /** Native `<details>` toggled by the user — sync the section's open state. */
  onToggle(section: ShipModuleSection, ev: Event): void {
    const isOpen = (ev.target as HTMLDetailsElement).open;
    const next = new Set(this.openSections());
    if (isOpen) next.add(section);
    else next.delete(section);
    this.openSections.set(next);
  }

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
    const target: LayoutTarget = { slot: row.slot, count: row.count, child: null, rawPorts: this.rawPorts(row) };
    (configurable ? this.swapRequested : this.inspected).emit(target);
  }

  openChild(row: GroupedSlot<LayoutSlot>, child: LayoutChild, configurable: boolean): void {
    const target: LayoutTarget = {
      slot: row.slot,
      count: row.count * child.count,
      child,
      rawPorts: this.childRawPorts(row, child),
    };
    // A known accepted type opens the picker for an unfitted seat too (Falle 3).
    (configurable && (child.className || child.rawTypes.length > 0) ? this.swapRequested : this.inspected).emit(
      target,
    );
  }

  revertRow(row: GroupedSlot<LayoutSlot>): void {
    if (row.slot.draftPaths?.length) this.reverted.emit(row.slot.draftPaths);
  }

  /** The ⓘ side button: always the full stat sheet for the mount itself. */
  inspectRow(row: GroupedSlot<LayoutSlot>): void {
    this.inspected.emit({ slot: row.slot, count: row.count, child: null, rawPorts: this.rawPorts(row) });
  }

  /**
   * Dotted `parentRawPort.childRawPort` paths for every parent × child raw
   * port combination the grouped row stands for (R5 approximation — see
   * `LayoutTarget.rawPorts`).
   */
  private childRawPorts(row: GroupedSlot<LayoutSlot>, child: LayoutChild): string[] {
    const parents = this.rawPorts(row);
    const kids = child.rawPorts.length > 0 ? child.rawPorts : [child.port];
    const out: string[] = [];
    for (const parent of parents) for (const kid of kids) out.push(`${parent}.${kid}`);
    return out;
  }

  /** A stable identity for the row, invariant across draft edits (R5/Falle 4). */
  rowKey(row: GroupedSlot<LayoutSlot>): string {
    const ports = this.rawPorts(row);
    return ports.length > 0 ? [...ports].sort().join('|') : row.slot.port;
  }

  /**
   * Blocks the pilot asked to see hardpoint-by-hardpoint. Identical mounts are
   * folded into one "3× S3 VariPuck" row by default — right when all three
   * carry the same gun, wrong the moment one of them should not (32659942:
   * *"da die Waffen aufhängungen einzeln sind müsste es möglich sein, dass man
   * alle Gimbal Mounts manuell entscheiden kann"*). The toggle is per block and
   * per visit; nothing about the ship changes, only how many rows it takes.
   */
  private readonly splitSections = signal<ReadonlySet<ShipModuleSection>>(new Set());
  /** Foldable blocks currently open (the airframe starts folded). */
  private readonly openSections = signal<ReadonlySet<ShipModuleSection>>(new Set());

  private toggle(
    store: WritableSignal<ReadonlySet<ShipModuleSection>>,
    section: ShipModuleSection,
  ): void {
    const next = new Set(store());
    if (!next.delete(section)) next.add(section);
    store.set(next);
  }

  /** List this block hardpoint by hardpoint, or fold identical ones back together. */
  toggleSplit(section: ShipModuleSection): void {
    this.toggle(this.splitSections, section);
  }

  /** Open or fold away a foldable block (the airframe). */
  toggleFold(section: ShipModuleSection): void {
    this.toggle(this.openSections, section);
  }

  private ordered = computed<RenderSection[]>(() => {
    const split = this.splitSections();
    const open = this.openSections();
    const baseOrder = this.sectionOrder() ?? SHIP_MODULE_SECTION_ORDER;
    // A lens may only reorder and fold — never remove a module the ship
    // actually has (MASTER §5: "Lens = {order, fold}; it never removes a
    // module"). Any section missing from a mission's own `order` array (e.g.
    // countermeasures/structure, which no mission group names) is appended in
    // the default display order, so it still renders — folded if it likes,
    // but never dropped (D17).
    const order = [
      ...baseOrder,
      ...SHIP_MODULE_SECTION_ORDER.filter((s) => !baseOrder.includes(s)),
    ];
    const foldable = new Set<ShipModuleSection>([...FOLDABLE_SECTIONS, ...this.foldedSections()]);
    return order
      .map((s) => this.sections().find((g) => g.section === s))
      .filter((g): g is LayoutSection => !!g && g.slots.length > 0)
      .map((g) => {
        const grouped = groupIdenticalSlots(g.slots);
        const isSplit = split.has(g.section);
        return {
          section: g.section,
          count: g.slots.length,
          // Splitting is just "don't group": every hardpoint gets its own row,
          // each standing for exactly itself.
          rows: isSplit ? g.slots.map((slot) => ({ slot, count: 1, ports: [slot] })) : grouped,
          configurable: isConfigurableSection(g.section),
          notes: g.notes ?? [],
          splittable: grouped.length < g.slots.length,
          split: isSplit,
          foldable: foldable.has(g.section),
          open: open.has(g.section),
        };
      });
  });

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

  /**
   * What "nothing installed" means on THIS hardpoint. "Empty (stock)" is right
   * for a bay the ship really does leave unfitted, but on a gun mount it reads
   * as "this ship has no guns" — which is a claim about the ship when the truth
   * is a claim about our extract (1add86a4).
   */
  emptyLabel(row: GroupedSlot<LayoutSlot>): string {
    return row.slot.emptyLabelKey ?? 'codex.detail.loadoutEmpty';
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

  /**
   * The `l3` run under the identity line: EVERY curated stat, per item. The
   * `.fig` beside it quotes the group TOTAL of a different quantity, so
   * nothing is duplicated by keeping the per-item value here — the concept
   * does exactly that ("279 Dauer-DPS" in l3 next to "837 Dauer-DPS" in the
   * figure, "3.528 HP je Stück" next to "7.056 Schild HP";
   * concept/part-06.html:322-324 + :461).
   */
  secondaryStats(row: GroupedSlot<LayoutSlot>): EquippedStat[] {
    return row.slot.stats ?? [];
  }

  /**
   * The GROUP total this row stands for — the fold-peek's own chip for this
   * occupant, whose `figure` is already ×count and already the quantity the
   * peek aggregates (sustained DPS for guns, salvo damage for missiles, the
   * HP pool for shields). Reading it from there is what keeps the row and the
   * peek from ever quoting two different numbers for the same group; the chip
   * is only trusted when it stands for the same run of hardpoints this row
   * does (`count`), because the two sides group independently.
   *
   * Fallback for the sections whose peek carries no figure: the first curated
   * stat, multiplied out to the group the row represents.
   */
  private groupFigure(sec: RenderSection, row: GroupedSlot<LayoutSlot>): EquippedStat | null {
    const chip = this.preview(sec).chips.find(
      (c) => c.count === row.count && c.id.startsWith(`${row.slot.className}:`),
    );
    if (chip?.figure != null && chip.unitKey) {
      return { labelKey: chip.unitKey, value: chip.figure, format: chip.format };
    }
    const stat = row.slot.stats?.[0];
    return stat ? { ...stat, value: stat.value * row.count } : null;
  }

  /**
   * The row's one right-hand headline figure (MASTER §6): the group total from
   * {@link groupFigure}, never the per-item value — the concept's weapon row
   * quotes "279 Dauer-DPS" per gun and "837 Dauer-DPS" for the three of them
   * (concept/part-06.html:322 + :324).
   *
   * The delta is the ABSOLUTE change (concept: `+81`, never a percentage),
   * reconstructed from the exact percentage already computed for a changed
   * row: given the figure `v` and its percent change `p` against stock, the
   * stock value is `v / (1 + p/100)`, so the absolute delta is
   * `v·p / (100 + p)` — an exact identity, not an estimate.
   */
  headlineFig(
    sec: RenderSection,
    row: GroupedSlot<LayoutSlot>,
  ): { value: string; unitKey: string; delta: number | null; deltaText: string } | null {
    const fig = this.groupFigure(sec, row);
    if (!fig) return null;
    const pct = row.slot.deltaPct;
    let delta: number | null = null;
    if (pct != null && Number.isFinite(pct) && 100 + pct !== 0) {
      delta = Math.round((fig.value * pct) / (100 + pct));
    }
    return {
      value: this.fmtStat(fig),
      unitKey: fig.labelKey,
      delta,
      deltaText: delta == null || delta === 0 ? '' : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`,
    };
  }
}
