import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ResolvedEntity, fpsArmorSlot } from './codex.service';
import { cleanLocaleValue, formatNumber, humanizeClassName } from './codex-format';
import {
  ARMOR_CLASS_OFF_SCALE,
  ARMOR_CLASS_WEIGHT,
  ArmorClass,
  EntityPayloadEntry,
  ReadinessKey,
  ReadinessSlot,
  armorClassFromPayload,
  armorSlotsFromLoadout,
  computeReadiness,
} from './codex-landing-kpi';
import { HangarRoleLoadout } from '../hangar/hangar.types';

/**
 * One anatomical position as the AN BORD zone renders it. `weight` is the
 * armour class as a 0..1 bar height — null means the archive carries no class
 * for this piece (every backpack), and the square then shows the hatch instead
 * of a guessed bar.
 */
export interface BoardSlotView {
  roleSlot: string;
  labelKey: string;
  attachType: string;
  filled: boolean;
  name: string;
  cls: ArmorClass | null;
  weight: number | null;
  offScale: boolean;
  archiveCount: number | null;
}

/** One entry of the set switcher: favourites first, topped up with recents. */
interface BoardSetView {
  id: string;
  name: string;
  role: string;
  filled: number;
}

/**
 * One glyph per readiness class. Inline paths rather than an icon font: the
 * zone must render identically offline and the set is closed at six — the six
 * classes the archive actually carries (see computeReadiness).
 */
const READY_ICON_PATHS: Readonly<Record<ReadinessKey, string>> = {
  primary: 'M3 9h14l4 3-4 1v3h-5l-2-3H6zM8 16v4',
  secondary: 'M4 8h11l3 3h3M7 11v5h4l2-5',
  melee: 'M4 20l7-7M13 11l7-7-2 8-5 5z',
  throwable: 'M12 20a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 8V5h3',
  gadget: 'M7 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM7 10V6h10v4',
  medical: 'M12 6v12M6 12h12',
};

/**
 * The AN BORD panel — the on-foot plane of the Codex landing's scale ladder,
 * rebuilt in the /tune-rethink round of 2026-09-01 (concept:
 * docs/concepts/2026-09-01-codex-an-bord-neu.html, chosen variant Ⓣ "Gewicht"
 * on the Ⓜ light panel with the Ⓟ plinth).
 *
 * Split out of `codex-landing.component.ts` for exactly the reason
 * `codex-loadout-save-bar.component.ts` was: that file's inline styles sit
 * against an 18 kB budget and this panel would push it over. Keeping the zone
 * here also makes it testable without the rest of the landing.
 *
 * The parent still owns the `<article class="zone board">` frame — its `.zone`
 * rules and the `--tint` custom property live there and inherit into here.
 */
@Component({
  selector: 'sc-codex-board-panel',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
          <header class="board-head">
            <span class="zone-eyebrow" id="board-title">{{ 'codex.landing.me.eyebrow' | translate }}</span>
            <a class="board-name" [routerLink]="boardEntryLink()">
              {{ hasPersonalSet() ? activeLoadout()!.name : ('codex.landing.me.title' | translate) }}
            </a>
          </header>

          @if (!hasPersonalSet()) {
            <div class="board-empty">
              <span class="empty-chip">{{ 'codex.landing.me.uncommissioned' | translate }}</span>
              <p class="me-lead">{{ 'codex.landing.me.emptyLead' | translate }}</p>
              <a class="btn tint" routerLink="/codex/fps">
                {{ 'codex.landing.me.cta' | translate }}
                <span class="btn-goal">{{ 'codex.landing.me.ctaGoal' | translate }}</span>
              </a>
            </div>
          } @else {
            <!-- The person: three positions left, the figure on its plinth in the
                 middle, three positions right. Each position is a real anchor, so
                 middle-click and "open in new tab" work like anywhere else. -->
            <div class="board-person">
              <div class="board-col">
                @for (s of boardSlotsLeft(); track s.roleSlot) {
                  <a class="board-slot" [class.empty]="!s.filled"
                     [routerLink]="['/codex', 'fps']" [queryParams]="slotQuery(s)">
                    <span class="t-label">{{ s.labelKey | translate }}</span>
                    <span class="t-value">{{ s.filled ? s.name : ('codex.landing.board.open' | translate) }}</span>
                  </a>
                }
              </div>

              <div class="board-fig">
                <svg class="board-doll" viewBox="0 0 120 172" role="img"
                     [attr.aria-label]="'codex.landing.paperdoll.aria' | translate">
                  <circle [class.on]="slotFilled('helmet')" cx="60" cy="20" r="13" />
                  <rect [class.on]="slotFilled('core')" x="43" y="38" width="34" height="54" rx="2" />
                  <rect [class.on]="slotFilled('arms')" x="28" y="42" width="11" height="42" rx="2" />
                  <rect [class.on]="slotFilled('arms')" x="81" y="42" width="11" height="42" rx="2" />
                  <rect [class.on]="slotFilled('legs')" x="47" y="96" width="11" height="52" rx="2" />
                  <rect [class.on]="slotFilled('legs')" x="62" y="96" width="11" height="52" rx="2" />
                </svg>

                <!-- Plinth: the set's role, named once, as a label — not a chip. -->
                <div class="board-plinth">
                  <svg viewBox="0 0 172 52" aria-hidden="true">
                    <ellipse cx="86" cy="22" rx="74" ry="18" />
                    <g class="plinth-glyph" transform="translate(86,22) scale(1,0.28)">
                      <circle cx="0" cy="0" r="30" />
                      <circle cx="0" cy="0" r="9" />
                      <path d="M0 -44v14M0 30v14M-44 0h14M30 0h14" />
                    </g>
                  </svg>
                  <span class="t-label plinth-role">{{ 'hangar.roles.' + activeLoadout()!.role | translate }}</span>
                </div>

                <!-- Readiness: only the six classes the archive really carries.
                     Mining/salvage/tractor are absent on purpose — every such hit
                     in the archive is a SHIP component, so a "mining ready" mark
                     would be fabricated. -->
                <div class="board-rdy">
                  @for (r of readiness(); track r.key) {
                    <span class="rdy-ic" [class.on]="r.ok"
                          [attr.title]="('codex.landing.board.readiness.' + r.key | translate)
                            + ' — ' + ((r.ok ? 'codex.landing.board.readyOn' : 'codex.landing.board.readyOff') | translate)">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="readyIcon(r.key)" /></svg>
                    </span>
                  }
                </div>
              </div>

              <div class="board-col right">
                @for (s of boardSlotsRight(); track s.roleSlot) {
                  <a class="board-slot" [class.empty]="!s.filled"
                     [routerLink]="['/codex', 'fps']" [queryParams]="slotQuery(s)">
                    <span class="t-label">{{ s.labelKey | translate }}</span>
                    <span class="t-value">{{ s.filled ? s.name : ('codex.landing.board.open' | translate) }}</span>
                  </a>
                }
              </div>
            </div>

            <!-- Squares: one per position. Bar height = armour class. No hue
                 carries the class, so a set's silhouette is comparable at a
                 glance and colour keeps its single meaning. A piece the archive
                 has no class for (every backpack) shows the hatch, never a
                 guessed height. -->
            <div class="board-squares">
              @for (s of boardSlots(); track s.roleSlot) {
                <a class="board-sq" [class.empty]="!s.filled" [class.nodata]="s.filled && s.weight === null"
                   [routerLink]="['/codex', 'fps']" [queryParams]="slotQuery(s)"
                   [attr.title]="(s.labelKey | translate) + ' — ' + slotClassTitle(s)">
                  @if (s.weight !== null) {
                    <span class="sq-fill" [class.off-scale]="s.offScale" [style.height.%]="s.weight * 100"></span>
                  }
                  <span class="t-label">{{ s.labelKey | translate }}</span>
                </a>
              }
            </div>

            <!-- Set switcher: favourites first, topped up with most recently
                 edited (decided 2026-09-01 after the question went twice
                 unanswered), then "more". -->
            <div class="board-dial">
              @for (l of boardSets(); track l.id) {
                <a class="dial-node" [class.on]="l.id === activeLoadout()!.id"
                   [routerLink]="['/hangar', 'loadout', l.id]">
                  <span class="t-value">{{ l.name }}</span>
                  <span class="t-label dial-sub">{{ ('hangar.roles.' + l.role) | translate }} · {{ l.filled }}/6</span>
                </a>
              }
              @if (moreSetCount() > 0) {
                <a class="dial-node more" routerLink="/hangar">
                  <span class="t-value">{{ 'codex.landing.board.more' | translate }}</span>
                  <span class="t-label dial-sub">{{ 'codex.landing.board.moreCount' | translate: { count: moreSetCount() } }}</span>
                </a>
              }
            </div>
          }
          `,
  styles: [
    `
      :host { display: contents; }
      /* ── AN BORD ───────────────────────────────────────────────────────
         Design system fixed in concept iteration 6 — the old zone carried FOUR
         meanings on amber (equipped / set name / slot label / armour class
         "medium") and TWO on cyan (role / undersuit class), which is what made
         it read as noise. The rules below are the whole vocabulary; anything
         not listed here must not appear in this zone.

           --tint (amber)  = "equipped / yours"          — and nothing else
           --idle          = "open"                      — and nothing else
           armour class    = BAR HEIGHT on .board-sq     — never a hue
           type            = .t-label / .t-value / name  — three roles, no more
      */
      .board { --idle: #3d5a6c; --idle-bg: #0a1c26; }
      .t-label {
        font-family: var(--sc-font-display, inherit);
        font-size: max(0.6rem, var(--sc-fs-floor, 0.6rem));
        letter-spacing: 0.18em;
        text-transform: uppercase;
        line-height: 1.3;
      }
      .t-value { font-size: max(0.78rem, var(--sc-fs-floor, 0.7rem)); line-height: 1.35; }

      .board-head { position: relative; z-index: 1; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
      .board-name {
        font-size: 1rem;
        font-weight: 600;
        color: var(--sc-fg-0);
        text-decoration: none;
        text-shadow: 0 0 18px color-mix(in srgb, var(--tint) 32%, transparent);
      }
      .board-name:hover, .board-name:focus-visible { color: var(--tint); }

      .board-person {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 8px;
        align-items: center;
        margin-top: 6px;
      }
      .board-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .board-col.right { text-align: right; }

      /* Every position is a REAL anchor — middle-click and "open in new tab"
         are browser features, and this zone exists to be operated. */
      .board-slot {
        display: block;
        padding: 4px 6px;
        border: 1px solid transparent;
        border-radius: 3px;
        text-decoration: none;
        color: inherit;
      }
      .board-slot .t-label { display: block; color: var(--tint); }
      .board-slot .t-value {
        display: block;
        color: var(--sc-fg-0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .board-slot.empty .t-label, .board-slot.empty .t-value { color: var(--idle); }
      .board-slot.empty .t-value { font-style: italic; }
      .board-slot:hover, .board-slot:focus-visible {
        border-color: var(--tint);
        background: color-mix(in srgb, var(--tint) 9%, transparent);
        outline: none;
      }

      .board-fig { display: flex; flex-direction: column; align-items: center; }
      .board-doll { width: 108px; height: auto; overflow: visible; }
      /* Open limbs are filled with the idle ground, not merely outlined — the
         same blue-grey as every other "open" state in the zone. */
      .board-doll circle, .board-doll rect {
        fill: var(--idle-bg);
        stroke: var(--idle);
        stroke-width: 1.3;
      }
      .board-doll .on {
        fill: none;
        stroke: color-mix(in srgb, var(--tint) 88%, #fff);
        stroke-width: 1.8;
        filter: drop-shadow(0 0 6px color-mix(in srgb, var(--tint) 34%, transparent));
      }

      /* Plinth — the focus mark lives UNDER the figure, never behind it
         (rejected in concept iteration 4: two line drawings on top of each
         other read as mud). It doubles as the standing shadow the floating
         figure never had, and it is the ONLY place the role is named. */
      .board-plinth { position: relative; margin-top: -6px; width: 172px; height: 52px; }
      .board-plinth svg { width: 100%; height: 100%; overflow: visible; }
      .board-plinth ellipse {
        fill: none;
        stroke: var(--tint);
        stroke-width: 1;
        opacity: 0.42;
      }
      .board-plinth .plinth-glyph {
        fill: none;
        stroke: var(--tint);
        stroke-width: 2.4;
        opacity: 0.4;
      }
      .board-plinth::before {
        content: '';
        position: absolute;
        left: 50%;
        top: 6px;
        width: 140px;
        height: 32px;
        transform: translateX(-50%);
        border-radius: 50%;
        background: radial-gradient(ellipse, color-mix(in srgb, var(--tint) 24%, transparent), transparent 70%);
        pointer-events: none;
      }
      .plinth-role {
        position: absolute;
        left: 50%;
        bottom: 0;
        transform: translateX(-50%);
        color: var(--tint);
        opacity: 0.85;
      }

      /* Readiness — six classes the archive really carries. Mining, salvage and
         tractor are absent on purpose: every such entry is a SHIP component. */
      .board-rdy { display: flex; gap: 5px; margin-top: 2px; }
      .rdy-ic {
        width: 26px;
        height: 26px;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--idle);
        background: var(--idle-bg);
        color: var(--idle);
      }
      .rdy-ic svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .rdy-ic.on {
        border-color: var(--tint);
        background: color-mix(in srgb, var(--tint) 15%, transparent);
        color: var(--tint);
        box-shadow: 0 0 11px color-mix(in srgb, var(--tint) 32%, transparent);
      }

      /* Squares — bar height IS the armour class. Two sets can be told apart by
         their silhouette alone, and hue stays free to mean only equipped/open. */
      .board-squares { position: relative; z-index: 1; display: flex; gap: 3px; margin-top: 10px; }
      .board-sq {
        position: relative;
        flex: 1;
        height: 46px;
        min-width: 0;
        border-radius: 3px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: 5px 6px;
        overflow: hidden;
        text-decoration: none;
        background: color-mix(in srgb, var(--tint) 10%, transparent);
        border-top: 1px solid color-mix(in srgb, #fff 14%, transparent);
        color: color-mix(in srgb, var(--tint) 70%, #fff);
      }
      .board-sq .t-label { position: relative; z-index: 2; font-size: 0.53rem; letter-spacing: 0.13em; }
      .board-sq:hover, .board-sq:focus-visible {
        box-shadow: inset 0 0 0 1px var(--tint);
        outline: none;
      }
      .sq-fill {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--tint);
        opacity: 0.55;
      }
      /* Undersuit / flightsuit are a different KIND of piece, not a step on the
         light→heavy ramp — marked, never silently ranked. */
      .sq-fill.off-scale { opacity: 0.3; }
      .board-sq.empty {
        background: var(--idle-bg);
        border: 1px dashed var(--idle);
        color: var(--idle);
      }
      /* Equipped, but the archive carries no class for it (every backpack). */
      .board-sq.nodata {
        background-image: repeating-linear-gradient(
          45deg, transparent, transparent 3px,
          color-mix(in srgb, var(--sc-fg-2) 22%, transparent) 3px,
          color-mix(in srgb, var(--sc-fg-2) 22%, transparent) 4px);
      }

      /* Set switcher — favourites first, topped up with most recently edited. */
      .board-dial {
        position: relative;
        z-index: 1;
        display: flex;
        justify-content: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 12px;
      }
      .dial-node {
        padding: 5px 11px;
        border-radius: 15px;
        border: 1px solid var(--sc-border);
        background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
        color: var(--sc-fg-2);
        text-align: center;
        text-decoration: none;
      }
      .dial-node .t-value { display: block; }
      .dial-sub { display: block; opacity: 0.7; font-size: 0.55rem; }
      .dial-node.on { border-color: var(--tint); background: color-mix(in srgb, var(--tint) 18%, transparent); color: var(--tint); }
      .dial-node.more { border-style: dashed; }
      .dial-node:hover, .dial-node:focus-visible { border-color: var(--tint); color: var(--tint); outline: none; }

      @media (max-width: 560px) {
        .board-person { grid-template-columns: 1fr; }
        .board-col.right { text-align: left; }
        .board-fig { order: -1; }
      }



      /* Shared chrome the parent also uses (zone eyebrow, empty-state CTA).
         Duplicated rather than imported: component styles are encapsulated, and
         these are eight short rules, not a design system. */
      .zone-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--tint);
      }
      .board-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
      .empty-chip {
        font-family: var(--sc-font-display);
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 3px 9px;
        border-radius: 3px;
        color: var(--sc-fg-2);
        border: 1px dashed color-mix(in srgb, var(--tint) 45%, var(--sc-border));
      }
      .me-lead { margin: 0; color: var(--sc-fg-1); font-size: 0.9rem; }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 14px;
        border-radius: 3px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.88rem;
        min-height: var(--sc-tap-min, 44px);
        box-sizing: border-box;
      }
      .btn.tint { color: var(--sc-bg-0); background: var(--tint); border: 1px solid var(--tint); }
      .btn.tint:hover { box-shadow: 0 0 18px color-mix(in srgb, var(--tint) 40%, transparent); }
      .btn-goal { font-weight: 400; opacity: 0.8; }
    `,
  ],
})
export class CodexBoardPanelComponent {
  private readonly t = inject(TranslateService);

  /** Personal sets, already sorted most-recently-touched first. */
  readonly loadouts = input.required<HangarRoleLoadout[]>();
  /** Names/manufacturers for everything the active set carries. */
  readonly resolved = input.required<Map<string, ResolvedEntity>>();
  /** Payloads — armour class lives in stats, readiness class in subType. */
  readonly payloads = input.required<Map<string, EntityPayloadEntry>>();
  /** How many candidates the archive holds per still-open position. */
  readonly archiveDepth = input.required<Map<string, number>>();
  /** Where the zone's name link goes (the on-foot subview). */
  readonly boardEntryLink = input.required<(string | number)[]>();

  readonly activeLoadout = computed<HangarRoleLoadout | null>(() => this.loadouts()[0] ?? null);
  readonly hasPersonalSet = computed(() => this.activeLoadout() !== null);

  /**
   * The six positions as the zone renders them. The armour class comes from the
   * ONE honest source this build has — the `damageResistance` macro name — and
   * is turned into a bar height, never a hue (concept iteration 6, variant Ⓣ).
   */
  readonly boardSlots = computed<BoardSlotView[]>(() => {
    const payloads = this.payloads();
    const resolved = this.resolved();
    const depth = this.archiveDepth();
    return armorSlotsFromLoadout(this.activeLoadout()?.items ?? []).map((s) => {
      if (!s.className) {
        return {
          roleSlot: s.roleSlot, labelKey: s.labelKey, attachType: s.attachType,
          filled: false, name: '', cls: null, weight: null, offScale: false,
          archiveCount: depth.get(s.attachType) ?? null,
        };
      }
      const cls = armorClassFromPayload(payloads.get(s.className)?.payload ?? null);
      const name =
        cleanLocaleValue(resolved.get(s.className)?.nameLocalized) ||
        humanizeClassName(s.className);
      return {
        roleSlot: s.roleSlot, labelKey: s.labelKey, attachType: s.attachType,
        filled: true, name, cls,
        weight: cls ? ARMOR_CLASS_WEIGHT[cls] : null,
        offScale: cls ? ARMOR_CLASS_OFF_SCALE.has(cls) : false,
        archiveCount: null,
      };
    });
  });
  readonly boardSlotsLeft = computed(() => this.boardSlots().filter((_, i) => i % 2 === 0));
  readonly boardSlotsRight = computed(() => this.boardSlots().filter((_, i) => i % 2 === 1));

  /** Six readiness classes the archive really carries — see computeReadiness(). */
  readonly readiness = computed<ReadinessSlot[]>(() =>
    computeReadiness(this.activeLoadout()?.items ?? [], this.payloads()),
  );

  /**
   * Set switcher: up to three, favourites first, topped up with the most
   * recently edited (decided 2026-09-01 — the question went twice unanswered on
   * the concept page, so the default was set rather than asked a third time).
   */
  readonly boardSets = computed<BoardSetView[]>(() =>
    this.loadouts().slice(0, 3).map((l) => ({
      id: l.id,
      name: l.name,
      role: l.role,
      filled: armorSlotsFromLoadout(l.items).filter((s) => s.className).length,
    })),
  );
  readonly moreSetCount = computed(() => Math.max(0, this.loadouts().length - 3));

  slotFilled(roleSlot: string): boolean {
    return this.boardSlots().some((s) => s.roleSlot === roleSlot && s.filled);
  }

  /**
   * The equip intent, in the URL. Keeping it there rather than in component
   * state is what makes "no equip buttons during ordinary browsing" structural:
   * a plain visit to /codex/fps has no `equipInto`, so nothing can render one.
   */
  slotQuery(s: BoardSlotView): Record<string, string> {
    const q: Record<string, string> = { cat: 'armor', slot: fpsArmorSlot(s.attachType) ?? '' };
    const active = this.activeLoadout();
    if (active) q['equipInto'] = active.id;
    return q;
  }

  /** Tooltip for a square: the honest class, or a named gap — never a guess. */
  slotClassTitle(s: BoardSlotView): string {
    if (!s.filled) {
      return s.archiveCount != null
        ? this.t.instant('codex.landing.board.archiveCount', { count: formatNumber(s.archiveCount) })
        : this.t.instant('codex.landing.board.open');
    }
    if (!s.cls) return this.t.instant('codex.landing.board.classUnknown');
    return this.t.instant('codex.landing.board.class.' + s.cls);
  }

  readyIcon(key: ReadinessKey): string {
    return READY_ICON_PATHS[key];
  }
}
