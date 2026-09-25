import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ResolvedEntity } from '../codex.service';
import { ARMOR_SLOT_SPECS } from '../codex-landing-kpi';
import { cleanLocaleValue, humanizeClassName } from '../codex-format';
import { HangarService } from '../../hangar/hangar.service';
import {
  ROLE_SLOT_SUGGESTIONS,
  RoleLoadoutItem,
  RoleLoadoutRole,
  slotHasArchiveSource,
} from '../../hangar/hangar.types';

/** The six anatomical positions — the board panel above already renders them. */
const ARMOR_ROLE_SLOTS: ReadonlySet<string> = new Set(ARMOR_SLOT_SPECS.map((s) => s.roleSlot));

/** Every slot token some role suggests — each has a `hangar.slots.*` label. */
const KNOWN_SLOTS: ReadonlySet<string> = new Set(Object.values(ROLE_SLOT_SUGGESTIONS).flat());

export interface GearSlotRow {
  slot: string;
  /** i18n key of the position's label (`hangar.slots.<slot>`); null for a free-form slot. */
  labelKey: string | null;
  /** A free-form slot's own name, as the user typed it; null when `labelKey` names it. */
  label: string | null;
  className: string | null;
  /** Resolved display name of the equipped piece; '' when the slot is open. */
  name: string;
  /** False where the FPS archive has nothing to offer (medpen, custom slots) — no link then. */
  linkable: boolean;
  /** A filled position outside the role's own list (see `rows`). */
  custom: boolean;
}

/**
 * The set's weapon/tool positions on /codex/set/:id (audit 2026-09-25): the
 * board panel covers the six armour positions, this section the REST of the
 * role's positions (`ROLE_SLOT_SUGGESTIONS`, array order) — primary /
 * secondary / sidearm, multi-tool, tractor, medgun …
 *
 * Every archive-backed position is a real anchor into the FPS archive,
 * narrowed to that slot (`equipInto` + `equipSlot`), so middle-click and
 * "open in new tab" work. A filled position gets its own "clear" button NEXT
 * to the anchor — an action, never nested inside the navigation.
 *
 * Colour vocabulary is the board panel's: `--tint` (amber, inherited from
 * `.board-wrap`) = equipped / yours, `--idle` (blue-grey) = open.
 */
@Component({
  selector: 'sc-codex-set-gear',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="gear" aria-labelledby="set-gear-title">
      <h2 class="zone-eyebrow" id="set-gear-title">{{ 'codex.set.gear.eyebrow' | translate }}</h2>
      <ul class="gear-grid">
        @for (r of rows(); track r.slot) {
          <li class="gear-slot" [class.empty]="!r.className" [class.nosource]="!r.linkable" [attr.data-slot]="r.slot">
            <div class="gear-row">
              @let label = r.label ?? (r.labelKey | translate);
              @if (r.linkable) {
                <a
                  class="gear-tile"
                  routerLink="/codex/fps"
                  [queryParams]="{ cat: 'weapon', equipInto: setId(), equipSlot: r.slot }"
                >
                  <span class="t-label">{{ label }}</span>
                  <span class="t-value">{{ r.className ? r.name : ('codex.set.gear.open' | translate) }}</span>
                </a>
              } @else {
                <div class="gear-tile static">
                  <span class="t-label">{{ label }}</span>
                  <span class="t-value">{{ r.className ? r.name : ('codex.set.gear.open' | translate) }}</span>
                  <span class="gear-note">{{ (r.custom ? 'codex.set.gear.customSlot' : 'codex.set.gear.noSource') | translate }}</span>
                </div>
              }
              @if (r.className) {
                <!-- One write at a time: every clear waits while one is in flight. -->
                <button
                  type="button"
                  class="gear-clear"
                  [disabled]="busySlot() !== null"
                  [attr.aria-busy]="busySlot() === r.slot"
                  [attr.aria-label]="'codex.set.gear.clearAria' | translate: { slot: label }"
                  (click)="clear(r.slot, r.className)"
                >
                  {{ (busySlot() === r.slot ? 'codex.set.gear.clearing' : 'codex.set.gear.clear') | translate }}
                </button>
              }
            </div>
            @if (failedSlot() === r.slot) {
              <p class="gear-err" role="alert">
                {{ 'codex.set.gear.clearFailed' | translate: { slot: label } }}
              </p>
            }
          </li>
        }
      </ul>
    </section>
  `,
  styles: [
    `
      :host {
        --idle: #3d5a6c;
        --idle-bg: #0a1c26;
        display: block;
      }
      .gear { display: flex; flex-direction: column; gap: 8px; }
      /* Same eyebrow as the board panel's zone header. */
      .zone-eyebrow {
        margin: 0;
        font-family: var(--sc-font-display);
        font-size: max(0.68rem, var(--sc-fs-floor));
        font-weight: normal;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--tint);
      }
      .t-label {
        display: block;
        font-family: var(--sc-font-display, inherit);
        font-size: max(0.6rem, var(--sc-fs-floor, 0.6rem));
        letter-spacing: 0.18em;
        text-transform: uppercase;
        line-height: 1.3;
        color: var(--tint);
      }
      .t-value {
        display: block;
        font-size: max(0.78rem, var(--sc-fs-floor, 0.7rem));
        line-height: 1.35;
        color: var(--sc-fg-0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .gear-grid {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
        gap: 6px;
      }
      .gear-slot { min-width: 0; }
      .gear-row { display: flex; align-items: stretch; gap: 4px; min-width: 0; }

      .gear-tile {
        flex: 1 1 auto;
        min-width: 0;
        min-height: max(40px, var(--sc-tap-min, 0px));
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 4px 8px;
        border: 1px solid color-mix(in srgb, var(--tint) 28%, var(--sc-border));
        border-radius: 3px;
        text-decoration: none;
        color: inherit;
      }
      a.gear-tile:hover { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 9%, transparent); }
      a.gear-tile:focus-visible {
        outline: 2px solid var(--tint);
        outline-offset: 1px;
        background: color-mix(in srgb, var(--tint) 9%, transparent);
      }
      .empty .gear-tile { border-style: dashed; border-color: var(--idle); background: var(--idle-bg); }
      .empty .t-label, .empty .t-value { color: var(--idle); }
      .empty .t-value { font-style: italic; }
      .empty a.gear-tile:hover, .empty a.gear-tile:focus-visible { border-color: var(--tint); }
      .empty a.gear-tile:hover .t-value, .empty a.gear-tile:focus-visible .t-value { color: var(--sc-fg-1); }

      /* No archive source (medpen): muted, never a link. */
      .gear-tile.static { opacity: 0.75; }
      .gear-note { font-size: max(0.68rem, var(--sc-fs-floor, 0.6rem)); color: var(--sc-fg-2); line-height: 1.3; }

      .gear-clear {
        flex: 0 0 auto;
        min-height: max(40px, var(--sc-tap-min, 0px));
        padding: 0 10px;
        border-radius: 3px;
        border: 1px solid var(--sc-border);
        background: transparent;
        color: var(--sc-fg-2);
        font-family: var(--sc-font-display, inherit);
        font-size: max(0.6rem, var(--sc-fs-floor, 0.6rem));
        letter-spacing: 0.12em;
        text-transform: uppercase;
        cursor: pointer;
      }
      .gear-clear:hover { color: var(--sc-fg-0); border-color: var(--tint); }
      .gear-clear:focus-visible { outline: 2px solid var(--tint); outline-offset: 1px; }
      .gear-clear:disabled { cursor: progress; opacity: 0.6; }

      .gear-err { margin: 4px 0 0; font-size: max(0.72rem, var(--sc-fs-floor, 0.7rem)); color: var(--sc-danger); }

      @media (max-width: 600px) {
        .gear-tile, .gear-clear { min-height: 48px; }
      }
    `,
  ],
})
export class CodexSetGearComponent {
  private readonly hangar = inject(HangarService);

  readonly setId = input.required<string>();
  readonly role = input.required<RoleLoadoutRole>();
  readonly items = input.required<readonly RoleLoadoutItem[]>();
  /** Names of the set's pieces — the set page resolves every item, not only armour. */
  readonly resolved = input<ReadonlyMap<string, ResolvedEntity>>(new Map());

  /** The slot whose clear is in flight — one write at a time for the whole list. */
  readonly busySlot = signal<string | null>(null);
  /** The slot whose last clear failed; its inline alert shows until the next attempt. */
  readonly failedSlot = signal<string | null>(null);

  readonly rows = computed<GearSlotRow[]>(() => {
    const items = this.items();
    const bySlot = new Map(items.map((i) => [i.slot, i.className] as const));
    const resolved = this.resolved();
    const nameOf = (className: string | null): string =>
      className ? cleanLocaleValue(resolved.get(className)?.nameLocalized) || humanizeClassName(className) : '';
    const suggested = (ROLE_SLOT_SUGGESTIONS[this.role()] ?? []).filter((slot) => !ARMOR_ROLE_SLOTS.has(slot));
    const rows: GearSlotRow[] = suggested.map((slot) => {
      const className = bySlot.get(slot) ?? null;
      return {
        slot,
        labelKey: 'hangar.slots.' + slot,
        label: null,
        className,
        name: nameOf(className),
        linkable: slotHasArchiveSource(slot),
        custom: false,
      };
    });
    // Filled slots outside the role's positions: the retired set editor
    // (until #496) stored whatever slot name the user typed. Readiness still
    // counts their pieces, so they are listed — clearable, not linked — rather
    // than lighting a glyph from something the page never shows.
    const listed = new Set(suggested);
    for (const item of items) {
      if (!item.className || listed.has(item.slot) || ARMOR_ROLE_SLOTS.has(item.slot)) continue;
      listed.add(item.slot);
      const known = KNOWN_SLOTS.has(item.slot);
      rows.push({
        slot: item.slot,
        labelKey: known ? 'hangar.slots.' + item.slot : null,
        label: known ? null : item.slot,
        className: item.className,
        name: nameOf(item.className),
        linkable: false,
        custom: true,
      });
    }
    return rows;
  });

  /**
   * Empty `slot` — but only while it still holds `shown`, the piece this tile
   * displays; a newer piece another tab put there stays (see setRoleLoadoutSlot).
   */
  async clear(slot: string, shown: string | null): Promise<void> {
    if (this.busySlot()) return;
    this.busySlot.set(slot);
    this.failedSlot.set(null);
    try {
      const saved = await this.hangar.setRoleLoadoutSlot(this.setId(), slot, null, shown ?? undefined);
      if (!saved) this.failedSlot.set(slot);
    } catch {
      this.failedSlot.set(slot);
    } finally {
      this.busySlot.set(null);
    }
  }
}
