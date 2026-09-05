import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CodexBoardFigureComponent } from './codex-board-figure.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';

/** Which half of the Codex-landing surface this rail re-opens. */
export type ZoneRailKind = 'board' | 'hangar';

/**
 * The collapsed half of the AN BORD ⇄ IM HANGAR switcher (feedback e80cc831).
 *
 * The two zones used to be columns that each grew with their content, so the
 * page jumped every time something was selected. They are ONE toggle now: the
 * expanded zone keeps its panel, the other one shrinks to this rail — a
 * vertical strip on tablet/desktop, a horizontal bar below 760px, where a
 * vertical strip would eat a third of a phone's width.
 *
 * ROUND TWO (feedback 77668f11): "schöner wäre es wenn man das hero darin schon
 * sieht … keine Beschreibungen, keine auswahlmöglichkeiten, nur die visuelle
 * darstellung des männchen bzw. des schiffs (flagship only) ohne texte /
 * angaben wenn collapsed." So a collapsed zone is no longer two words on a
 * 52px spine: it carries its zone's HERO — the hard-suit figure for AN BORD,
 * the flagship's art for IM HANGAR — and the rail widens to make it legible.
 * The hero is the ONLY thing that comes along. Not the set/ship name, not a
 * slot, not a KPI, not a control: the rail keeps exactly its own two
 * affordances, the rotated zone label and the chevron, because a strip that
 * does not say what it opens is a picture, not a control.
 *
 * ROUND THREE (same feedback): AN BORD's figure is now unconditional. It used
 * to be withheld while nothing was equipped — "immer noch nicht die person als
 * spalte sondern nur die textleiste" was the answer to that, and it is right:
 * the figure is the character, not the set, so an unequipped suit is an honest
 * empty one rather than "a picture of nothing". Only IM HANGAR can still be
 * heroless: an empty hangar has no ship, and there it degrades to the plain
 * rail it has always been, summary line included.
 *
 * Both heroes are the components the expanded zones already use
 * (sc-codex-board-figure, sc-fallback-image + the category glyph), the figure
 * in its `decorative` mode — no second copy of either rendering.
 *
 * A real `<button>`, not an anchor: it switches a view, it does not take you
 * anywhere. The zone's own entrances (set name, six positions, /hangar link)
 * come back with the expanded panel.
 *
 * Split out of `codex-landing.component.ts` for the same reason
 * `codex-board-panel.component.ts` was: that file's inline styles sit against
 * an 18 kB budget and these rules push it over.
 */
@Component({
  selector: 'sc-codex-zone-rail',
  standalone: true,
  imports: [
    TranslateModule,
    CodexBoardFigureComponent,
    CodexCategoryIconComponent,
    FallbackImageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="zone-rail"
      [class.board]="kind() === 'board'"
      [class.hangar]="kind() === 'hangar'"
      [class.has-hero]="hasHero()"
      aria-expanded="false"
      [attr.aria-controls]="'zone-' + kind()"
      [attr.aria-label]="labelKey() | translate"
      (click)="expand.emit()"
    >
      <span class="rail-chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
      </span>

      <!-- The hero. aria-hidden throughout: the button already carries the one
           name this control has, and a picture of the thing behind it must not
           add a second one. -->
      @if (heroSuit(); as filled) {
        <span class="rail-hero" aria-hidden="true">
          <sc-codex-board-figure [filled]="filled" [decorative]="true" />
        </span>
      } @else if (heroArt(); as art) {
        <span class="rail-hero" aria-hidden="true">
          <span class="rail-ship">
            <sc-fallback-image [candidates]="art" alt="">
              <sc-codex-icon kind="ship" />
            </sc-fallback-image>
          </span>
        </span>
      }

      <span class="rail-text">
        <span class="rail-eyebrow">{{ eyebrowKey() | translate }}</span>
        <!-- The summary is a DETAIL — the set's name, the flagship's name. It
             is exactly what the hero replaces, so the two are never shown
             together. -->
        @if (!hasHero()) {
          <span class="rail-sub">
            @if (summary(); as s) {
              {{ s }}
            } @else {
              {{ fallbackKey() | translate }}
            }
          </span>
        }
      </span>
    </button>
  `,
  styles: [
    `
      /* The button itself is the grid item of .surface, so the host must not
         sit between them — same trick the board panel uses. */
      :host { display: contents; }
      .zone-rail {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        padding: 14px 0;
        border: 0;
        border-left: 2px solid var(--tint);
        background: color-mix(in srgb, var(--tint) 5%, transparent);
        color: inherit;
        font: inherit;
        cursor: pointer;
        overflow: hidden;
        transition: background 0.16s ease;
      }
      .zone-rail.board { --tint: var(--sc-warning, #ffc14d); }
      .zone-rail.hangar { --tint: var(--sc-accent); }
      /* The drawn suit paints its plates from --idle and --tint. --tint is
         right above; --idle lives on the EXPANDED board panel, so the rail has
         to carry the same value or the SVG fallback loses its colour the
         moment WebGL is unavailable. Same hex as codex-board-panel's .board. */
      .zone-rail.board.has-hero { --idle: #3d5a6c; }
      .zone-rail:hover { background: color-mix(in srgb, var(--tint) 12%, transparent); }
      .zone-rail:focus-visible {
        outline: none;
        background: color-mix(in srgb, var(--tint) 12%, transparent);
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--tint) 60%, transparent);
      }
      .zone-rail.has-hero { padding: 12px 8px; gap: 8px; }
      .rail-chevron { width: 16px; height: 16px; flex: 0 0 16px; color: var(--tint); }
      .rail-chevron svg { width: 100%; height: 100%; display: block; }
      .rail-text { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 0; }
      .rail-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--tint);
        white-space: nowrap;
      }
      .rail-sub {
        min-width: 0;
        font-size: max(0.72rem, var(--sc-fs-floor));
        color: var(--sc-fg-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* ── the hero ──────────────────────────────────────────────────────
         Clipped, never scrolled: the rail is a fixed slot inside a fixed
         surface, and a hero that overflowed it would push the label out. */
      .rail-hero {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }
      /* The flagship's art in the same treatment the expanded zone's
         .ship-hero uses — 16:9, cover, no drop shadow — so the collapsed
         picture and the expanded one are recognisably the same render. */
      .rail-ship {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        aspect-ratio: 16 / 9;
        border-radius: 3px;
        overflow: hidden;
        background: radial-gradient(circle at 52% 42%, var(--sc-bg-2), var(--sc-bg-0));
        --sc-img-w: 100%;
        --sc-img-h: 100%;
        --sc-img-max-h: 100%;
        --sc-img-fit: cover;
        --sc-img-shadow: none;
      }
      /* No art for this hull: the category glyph, which is still a picture of
         a ship and still carries no text. */
      .rail-ship sc-codex-icon { opacity: 0.6; color: var(--sc-accent); }

      /* Vertical rail: the label reads bottom-to-top, the way a spine does. */
      @media (min-width: 761px) {
        .zone-rail { flex-direction: column; justify-content: flex-start; }
        .rail-text { writing-mode: vertical-rl; transform: rotate(180deg); max-height: 100%; }
        .zone-rail.hangar .rail-chevron { transform: rotate(180deg); }
        /* Chevron on top, hero in the middle, zone label on the spine below:
           the hero takes every pixel the other two do not need. */
        .zone-rail.has-hero .rail-hero { flex: 1 1 auto; width: 100%; }
        .zone-rail.has-hero .rail-text { flex: 0 0 auto; }
        /* The figure's own 108px cap is sized for the expanded panel, where it
           shares the row with six positions. Here it IS the content, and the
           rail is 500px tall against a ~150px hero — so it takes the width. */
        .zone-rail.has-hero sc-codex-board-figure { width: 100%; }
      }
      /* Phone/small tablet: a horizontal bar. The chevron points at the space
         the zone will take — down for the top half, up for the bottom one. */
      @media (max-width: 760px) {
        .zone-rail { height: 100%; padding: 0 14px; border-left: 0; border-top: 2px solid var(--tint); }
        .rail-text { flex: 1; }
        .zone-rail.board .rail-chevron { transform: rotate(90deg); }
        .zone-rail.hangar .rail-chevron { transform: rotate(-90deg); }
        /* The bar is 92px tall (--rail-h on .surface.hero-rail), 76px of it
           inside the padding, so each hero gets the width its own ratio needs
           at that height: 50px for the 120:184 figure, 136px for 16:9 art.
           Stated rather than transferred from aspect-ratio, because a flex
           item's base size is the one thing that must not depend on how a
           browser resolves a ratio against a percentage height. */
        .zone-rail.has-hero { padding: 8px 14px; }
        .zone-rail.has-hero .rail-hero { flex: 0 0 auto; height: 100%; }
        .zone-rail.has-hero.board .rail-hero { width: 50px; }
        .zone-rail.has-hero.hangar .rail-hero { width: 136px; }
        .zone-rail.has-hero .rail-ship { width: 100%; height: 100%; aspect-ratio: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .zone-rail { transition: none; }
      }
    `,
  ],
})
export class CodexZoneRailComponent {
  readonly kind = input.required<ZoneRailKind>();
  /** i18n key of the zone name ("An Bord" / "Im Hangar"). */
  readonly eyebrowKey = input.required<string>();
  /** i18n key of the button's accessible name ("… aufklappen"). */
  readonly labelKey = input.required<string>();
  /** What is inside, in plain data (set name, flagship name) — may be absent. */
  readonly summary = input<string | null>(null);
  /** i18n key shown instead when there is nothing to name yet. */
  readonly fallbackKey = input.required<string>();

  /**
   * AN BORD's hero: the equipped positions of the active set — possibly none of
   * them. The landing always passes a set (see `boardHero`); `null` is left
   * accepted so the rail stays one generic component for both zones.
   */
  readonly heroSuit = input<ReadonlySet<string> | null>(null);
  /**
   * IM HANGAR's hero: the flagship's art candidates, best first (flagship only
   * — the fleet is not a hero). Null when the hangar is empty.
   */
  readonly heroArt = input<readonly string[] | null>(null);

  /** A hero replaces the summary line and earns the rail its extra width. */
  readonly hasHero = computed(() => this.heroSuit() !== null || this.heroArt() !== null);

  readonly expand = output<void>();
}
