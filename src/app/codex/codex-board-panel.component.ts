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
                <!-- The figure: a hard-suit, not six boxes. Every position is
                     drawn as its own plate stack (plate + seam lines + a rim on
                     the lit edge), so helmet/arms/torso/legs read as body parts
                     and each maps to the position link beside it. Depth is the
                     #pd-plate ramp per plate — no 3D engine, no dependency, one
                     inline SVG. Groups are ordered back-to-front: pack, suit,
                     legs, torso, arms, helmet — the overlaps ARE the volume. -->
                <svg class="board-doll" viewBox="0 0 120 184" role="img"
                     [attr.aria-label]="'codex.landing.paperdoll.aria' | translate">
                  <defs>
                    <!-- One light, upper left. Each plate gets its own bbox ramp,
                         which is what makes a plated suit out of flat shapes.
                         Two copies rather than currentColor: a gradient stop
                         resolves currentColor against the <defs>, not against the
                         part that references it, so the hue has to come from the
                         inherited custom property instead. -->
                    <linearGradient id="pd-plate" class="pd-idle" x1="0" y1="0" x2="0.85" y2="1">
                      <stop offset="0%" stop-opacity="0.62" />
                      <stop offset="55%" stop-opacity="0.26" />
                      <stop offset="100%" stop-opacity="0.08" />
                    </linearGradient>
                    <linearGradient id="pd-plate-on" class="pd-tint" x1="0" y1="0" x2="0.85" y2="1">
                      <stop offset="0%" stop-opacity="0.72" />
                      <stop offset="55%" stop-opacity="0.32" />
                      <stop offset="100%" stop-opacity="0.1" />
                    </linearGradient>
                    <linearGradient id="pd-visor" class="pd-idle" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stop-opacity="0.72" />
                      <stop offset="100%" stop-opacity="0.16" />
                    </linearGradient>
                    <linearGradient id="pd-visor-on" class="pd-tint" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stop-opacity="0.85" />
                      <stop offset="100%" stop-opacity="0.2" />
                    </linearGradient>
                    <linearGradient id="pd-scan" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#fff" stop-opacity="0" />
                      <stop offset="50%" stop-color="#fff" stop-opacity="0.14" />
                      <stop offset="100%" stop-color="#fff" stop-opacity="0" />
                    </linearGradient>
                    <!-- The sweep must not leave the figure's box; the box
                         itself stays overflow:visible for the equipped glow. -->
                    <clipPath id="pd-clip"><rect x="0" y="0" width="120" height="184" /></clipPath>
                  </defs>

                  <!-- RUCKSACK — life-support tanks behind the shoulders plus the
                       antenna; the torso covers their inner half, which is what
                       puts them *behind* the figure. -->
                  <g class="pd-part" [class.on]="slotFilled('backpack')" [attr.fill]="plateFill('backpack')">
                    <rect class="plate" x="44" y="30" width="11" height="26" rx="5" />
                    <rect class="plate" x="65" y="30" width="11" height="26" rx="5" />
                    <path class="seam" d="M48 38h3M48 44h3M69 38h3M69 44h3M44 33h-7v-19" />
                    <circle class="seam-dot" cx="37" cy="12" r="2.2" />
                  </g>

                  <!-- UNTERSUIT — the soft layer the plates ride on: neck seal,
                       waist and hips. It was invisible before; the position is
                       equippable, so it gets a body part like the other five. -->
                  <g class="pd-part" [class.on]="slotFilled('undersuit')" [attr.fill]="plateFill('undersuit')">
                    <path class="plate" d="M53 36h14v10c0 2-3 4-7 4s-7-2-7-4z" />
                    <path class="plate" d="M47 100h26v9c0 3-2 5-5 5H52c-3 0-5-2-5-5z" />
                    <path class="plate" d="M45 112h30v10c0 4-3 7-7 7H52c-4 0-7-3-7-7z" />
                    <path class="seam" d="M60 102v10M50 118h20" />
                  </g>

                  <!-- BEINE — thigh, knee joint, shin, boot. -->
                  <g class="pd-part" [class.on]="slotFilled('legs')" [attr.fill]="plateFill('legs')">
                    <rect class="plate" x="46" y="122" width="12" height="26" rx="4" />
                    <rect class="plate" x="62" y="122" width="12" height="26" rx="4" />
                    <circle class="joint" cx="52" cy="151" r="5" />
                    <circle class="joint" cx="68" cy="151" r="5" />
                    <rect class="plate" x="47" y="154" width="10" height="16" rx="3" />
                    <rect class="plate" x="63" y="154" width="10" height="16" rx="3" />
                    <path class="plate" d="M47 168h10v4l1 6H44z" />
                    <path class="plate" d="M73 168H63v4l-1 6h14z" />
                    <path class="seam" d="M52 126v18M68 126v18M48 151h8M64 151h8" />
                    <path class="rim" d="M47 128v16M47 157v10" />
                  </g>

                  <!-- TORSO — chest plate, collar, ribs and two abdomen bands. -->
                  <g class="pd-part" [class.on]="slotFilled('core')" [attr.fill]="plateFill('core')">
                    <path class="plate" d="M60 48c-8 0-15 2-20 6l-2 20 3 14h38l3-14-2-20c-5-4-12-6-20-6z" />
                    <path class="plate" d="M45 90h30l-2 5H47z" />
                    <path class="plate" d="M47 97h26l-2 5H49z" />
                    <path class="seam" d="M60 58v28M44 70h9M67 70h9" />
                    <path class="seam" d="M48 55c8-3 16-3 24 0" />
                    <path class="rim" d="M41 56l-2 18" />
                  </g>

                  <!-- ARME — pauldron, upper arm, elbow joint, forearm, glove. -->
                  <g class="pd-part" [class.on]="slotFilled('arms')" [attr.fill]="plateFill('arms')">
                    <path class="plate" d="M41 49l-9 3c-4 1-6 5-6 9v7l15 3z" />
                    <path class="plate" d="M79 49l9 3c4 1 6 5 6 9v7l-15 3z" />
                    <rect class="plate" x="28" y="70" width="12" height="24" rx="5" />
                    <rect class="plate" x="80" y="70" width="12" height="24" rx="5" />
                    <circle class="joint" cx="34" cy="96" r="4.5" />
                    <circle class="joint" cx="86" cy="96" r="4.5" />
                    <rect class="plate" x="29" y="99" width="10" height="22" rx="4" />
                    <rect class="plate" x="81" y="99" width="10" height="22" rx="4" />
                    <path class="plate" d="M29 121h10v6c0 3-2 5-5 5s-5-2-5-5z" />
                    <path class="plate" d="M81 121h10v6c0 3-2 5-5 5s-5-2-5-5z" />
                    <path class="seam" d="M34 73v18M34 102v16M86 73v18M86 102v16" />
                    <path class="rim" d="M29 76v14M29 103v14M28 60l-1 8" />
                  </g>

                  <!-- HELM — shell, visor, crest and comms nubs. -->
                  <g class="pd-part" [class.on]="slotFilled('helmet')" [attr.fill]="plateFill('helmet')">
                    <path class="plate" d="M60 6c-11 0-19 7-19 17v9c0 5 3 8 8 8h22c5 0 8-3 8-8v-9c0-10-8-17-19-17z" />
                    <path class="visor" [attr.fill]="visorFill()" d="M45 22h30v8c0 4-3 6-7 6H52c-4 0-7-2-7-6z" />
                    <path class="seam" d="M60 7v11M45 16h-4M75 16h4M52 36h16" />
                    <path class="rim" d="M43 30v-7c0-8 6-14 13-15" />
                    <path class="glint" d="M50 25l5 9" />
                  </g>

                  <!-- Holo sweep: the one motion in the zone, and only where
                       motion is welcome (prefers-reduced-motion). -->
                  <g clip-path="url(#pd-clip)">
                    <rect class="pd-scan" x="24" y="-14" width="72" height="14" fill="url(#pd-scan)" />
                  </g>
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
      .board-doll { width: 108px; max-width: 100%; height: auto; overflow: visible; }

      /* ── The figure ──────────────────────────────────────────────────
         Six flat black boxes before (feedback 2026-09-03: "einfach nur
         schwarz … sieht nicht cool aus"), now a plated hard-suit. The
         colour vocabulary is UNCHANGED — a part group carries the color property,
         every stroke below is currentColor, and the plate ramp picks the
         same two hues: --idle = open, --tint = equipped. Depth comes from
         the per-plate gradient plus a white rim on the lit edge; white is
         a specular highlight here, never a state.
         Deliberately empty-state-first: with nothing equipped the suit is
         still fully drawn in --idle, which is the whole point of the
         seams and rims — an unequipped figure reads as a body, not a
         silhouette. */
      .pd-idle stop { stop-color: var(--idle); }
      .pd-tint stop { stop-color: var(--tint); }
      /* The open figure is LIT, not greyed out — the whole complaint was a
         figure that vanished into the panel when nothing is equipped. Same
         --idle hue, lifted with white so the suit is legible on its own. */
      .pd-part { color: color-mix(in srgb, var(--idle) 62%, #fff); }
      .pd-part.on {
        color: color-mix(in srgb, var(--tint) 88%, #fff);
        filter: drop-shadow(0 0 6px color-mix(in srgb, var(--tint) 32%, transparent));
      }
      .board-doll .plate, .board-doll .joint, .board-doll .visor {
        stroke: currentColor;
        stroke-width: 1.25;
        stroke-opacity: 0.88;
        stroke-linejoin: round;
      }
      .pd-part.on .plate, .pd-part.on .joint, .pd-part.on .visor {
        stroke-width: 1.7;
        stroke-opacity: 1;
      }
      /* Panel lines — the "mit einem strich angezeichnet" pass: sternum,
         ribs, limb ridges, joint bands, tank vents. */
      .board-doll .seam {
        fill: none;
        stroke: currentColor;
        stroke-width: 0.9;
        stroke-opacity: 0.55;
        stroke-linecap: round;
      }
      .board-doll .seam-dot { fill: currentColor; fill-opacity: 0.7; stroke: none; }
      .board-doll .rim, .board-doll .glint {
        fill: none;
        stroke: #fff;
        stroke-opacity: 0.2;
        stroke-width: 1.1;
        stroke-linecap: round;
      }
      .pd-part.on .rim, .pd-part.on .glint { stroke-opacity: 0.38; }
      /* Holo sweep: hidden unless motion is welcome, so the resting state
         of the zone is always a still image. */
      .pd-scan { display: none; pointer-events: none; }
      @media (prefers-reduced-motion: no-preference) {
        .pd-scan { display: block; animation: pd-sweep 9s linear infinite; }
      }
      @keyframes pd-sweep {
        from { transform: translateY(0); }
        to { transform: translateY(198px); }
      }

      /* Plinth — the focus mark lives UNDER the figure, never behind it
         (rejected in concept iteration 4: two line drawings on top of each
         other read as mud). It doubles as the standing shadow the floating
         figure never had, and it is the ONLY place the role is named. */
      /* The role label used to sit flush against the ring (feedback
         2026-09-03: "technik noch ein bisschen mehr abstand zum kreis").
         The ring keeps its 52px drawing box; the extra 16px is pure gap
         below it, so the ellipse geometry is untouched. */
      .board-plinth { position: relative; margin-top: -6px; width: 172px; height: 68px; }
      .board-plinth svg { width: 100%; height: 52px; overflow: visible; }
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
   * Which plate ramp one position's parts are filled with. A gradient stop
   * resolves `currentColor` against the `<defs>` it lives in, not against the
   * element referencing it, so the equipped/open hue cannot ride on the group's
   * `color` the way every stroke does — it has to pick one of two gradients.
   */
  plateFill(roleSlot: string): string {
    return this.slotFilled(roleSlot) ? 'url(#pd-plate-on)' : 'url(#pd-plate)';
  }

  /** Same two-gradient trick for the visor glass. */
  visorFill(): string {
    return this.slotFilled('helmet') ? 'url(#pd-visor-on)' : 'url(#pd-visor)';
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
