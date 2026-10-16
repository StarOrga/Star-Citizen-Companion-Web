import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CodexKind } from '../codex.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import type { HardpointPortRef } from '../hardpoint-port-ref';
import { FallbackImageComponent } from '../fallback-image.component';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import type { StageCountChip } from './codex-detail.types';

/** One hero chip on the ship stage — a career/role/crew/cargo/mass fact or a
 * disclosed gap. Mirrors the shape `codex-detail.component.ts` computes. */
export interface StageHeroChip {
  key: string;
  text: string;
  accent?: boolean;
  ghost?: boolean;
  gap?: boolean;
}

/**
 * The ship branch of the detail hero — "die BUEHNE" (concept section 2): the
 * art fills the card edge to edge, the maker/role eyebrow and the name sit on
 * it top-left, the stat chips and the module census bottom-right (#239). Split out of `codex-detail.component.ts` (AUD-062)
 * purely to keep that file's component-style budget under the Angular build
 * budget; every binding, class and DOM node here is byte-identical to what
 * used to render inline in the `kind() === 'ship'` branch of the hero.
 *
 * Everything the stage needs but does not own (loadout counts, active ports,
 * whether a 3D model exists…) flows in as inputs; the few things the stage
 * can change (which port is hovered, whether the 3D model turned out to be
 * locatable, the 2D/3D toggle) flow back out as outputs — the parent still
 * owns every signal. The hangar control left the picture (#239): the
 * page header above it carries the same link and recent-ship chain.
 */
@Component({
  selector: 'sc-codex-ship-stage',
  standalone: true,
  imports: [
    TranslatePipe,
    ScTooltipDirective,
    ShipSkinViewerComponent,
    FallbackImageComponent,
    CodexCategoryIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The stage art is a picture and therefore inert — unless it is
         the live 3D model, which has to stay interactive. -->
    <div class="stage-art" [class.live]="heroView3d()"
         [attr.aria-hidden]="heroView3d() ? null : 'true'">
      @if (heroView3d() && shipClassName(); as cls) {
        <!-- @defer: the viewer chunk loads only once 3D is switched on (AUD-048);
             until it lands the stage keeps showing the 2D art, never a blank box. -->
        @defer (on immediate) {
          <sc-ship-skin-viewer
            class="stage-viewer"
            [shipId]="cls"
            [embedded]="true"
            [hardpointPorts]="hardpointPortRefs()"
            [activePorts]="activePorts()"
            (hovered)="hovered.emit($event)"
            (locatable)="locatable.emit($event)"
            (available)="artAvailable.emit($event)" />
        } @placeholder {
          <sc-fallback-image [candidates]="heroArt()" [alt]="displayName()" [eager]="true">
            <span class="art-fallback">
              <sc-codex-icon class="hero-icon" [kind]="kind()" [sub]="heroSub()" />
              <span class="art-note">{{ 'codex.detail.noArtwork' | translate }}</span>
            </span>
          </sc-fallback-image>
        }
      } @else {
        <sc-fallback-image [candidates]="heroArt()" [alt]="displayName()" [eager]="true">
          <span class="art-fallback">
            <sc-codex-icon class="hero-icon" [kind]="kind()" [sub]="heroSub()" />
            <span class="art-note">{{ 'codex.detail.noArtwork' | translate }}</span>
          </span>
        </sc-fallback-image>
      }
    </div>

    <!-- Identity, top-left ON the picture (#239): the maker/role eyebrow
         first, the name under it in the accent — the ship IS the subject.
         A translucent panel keeps both legible on any render. The hangar
         control that used to sit here moved above the picture. -->
    <div class="stage-ident">
      @if (heroEyebrow(); as eb) { <p class="mfr">{{ eb }}</p> }
      <h1>{{ displayName() }}</h1>
    </div>

    <!-- 2D ⇄ 3D on the card itself. A toggle, not a navigation, so a
         real button: deliberately quiet and half-transparent, and it
         names the view you would switch TO (pressing "3D" gives you
         3D). The two characters are decorative; the accessible name is
         the whole sentence. -->
    @if (has3dView()) {
      <!-- The label is split into its digit and its letter: Orbitron
           draws a "D" that reads as a "0"/"O" next to the "3", so the
           letter is set in the body face (feedback 140dfb7e). -->
      @let viewLabel = (heroView3d() ? 'codex.detail.heroView2d' : 'codex.detail.heroView3d') | translate;
      <button
        type="button"
        class="view-switch"
        [class.on]="heroView3d()"
        [attr.aria-pressed]="heroView3d()"
        [attr.aria-label]="(heroView3d() ? 'codex.detail.heroSwitchTo2d' : 'codex.detail.heroSwitchTo3d') | translate"
        [scTooltip]="(heroView3d() ? 'codex.detail.heroSwitchTo2d' : 'codex.detail.heroSwitchTo3d') | translate"
        scTooltipTier="label"
        (click)="viewToggle.emit()">
        <span class="vs-label" aria-hidden="true"><span class="vs-num">{{ viewLabel.slice(0, -1) }}</span><span class="vs-letter">{{ viewLabel.slice(-1) }}</span></span>
      </button>
    }

    <!-- The bottom band of the stage: the figures, right-aligned.
         Nothing in here is clickable — the four frequent actions sit in
         their own row directly beneath the picture (feedback 140dfb7e:
         "die anklickbaren Links raus aus dem Bild"). The name moved to
         the top-left corner (#239), so the band carries only the stat
         chips and, under them, the module census. Every figure takes
         one and the same treatment (#239: "Werte gleichmäßig") — no
         category is tinted on its own. -->
    <div class="stage-foot">
      @if (heroChips().length > 0) {
        <ul class="chips stage-side">
          @for (c of heroChips(); track c.key) {
            @if (c.key !== 'role') {
              <li class="hchip" [class.gap]="c.gap">{{ c.text }}</li>
            }
          }
        </ul>
      }
      <!-- Module census, bottom-right ON the art, on its own line so
           it can use the full width of the stage and wraps into two or
           three short rows instead of a tall column. Read from the
           same resolved sections the loadout column renders, so "3
           Bewaffnung" here is the "Bewaffnung · 3 Slots" heading down
           there — never a second classifier with its own opinion. -->
      @if (stageCounts().length > 0) {
        <ul class="loadout-summary stage-counts" [attr.aria-label]="'codex.detail.equipment' | translate">
          @for (s of stageCounts(); track s.group + s.labelKey) {
            <li class="ls-item" [attr.data-cat]="s.group">
              <span class="ls-count">{{ s.count }}</span>
              <span class="ls-cat">{{ s.labelKey | translate }}</span>
              @if (s.detailKey) {
                <span class="ls-detail">· {{ s.detailKey | translate: { n: s.detailCount } }}</span>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    /* Unwraps into the header's own grid/flex layout (.hero.stage in
       codex-detail.component.ts owns the card chrome, the grid rows and the
       gradient wash) — this component only supplies the stage's CONTENT, so
       its host must not become a box of its own. */
    :host { display: contents; }
    /* On the stage every chip sits on the art, the disclosed gap included:
       a transparent dashed box over a white hull is unreadable, so it takes
       the same translucent ground as its neighbours (feedback 140dfb7e). */
    .hchip { font-size: max(10px, var(--sc-fs-floor)); padding: 3px 7px; border-radius: 3px;
      letter-spacing: 0.12em; text-transform: uppercase;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
    .hchip.gap { color: var(--sc-warn); background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      border-style: dashed; border-color: color-mix(in srgb, var(--sc-warn) 50%, transparent); }

    /* ── BUEHNE (concept section 2) ─────────────────────────────────────────
       The art fills the card; name, chips and the four frequent actions sit
       ON it. Nothing else lives here. The 246px stage: art edge to edge, name
       top-left, chips and actions bottom-right. A GRID rather than a stack of
       absolutely placed overlays — the name row, the flexible middle and the
       foot each own a band, so the foot can grow (wrapped buttons, many
       chips) and push the stage taller instead of sliding under the row
       above it or being cut off by the overflow clip. The grid itself is
       .hero.stage in the parent; .stage-art/.stage-foot below are its
       actual grid items once this host disappears via display:contents. */
    /* The render FILLS the stage (#239: no bands above and below it): cover,
       not contain, so a wide store render crops at its edges instead of
       letterboxing. A drop shadow on a full-bleed picture only darkens its
       border, so it goes. The no-art fallback is a centred glyph and keeps
       its own size (--sc-icon-max). */
    .stage-art { position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; pointer-events: none;
      --sc-img-w: 100%; --sc-img-h: 100%; --sc-img-fit: cover;
      --sc-img-max-h: none;
      --sc-img-shadow: none;
      --sc-icon-max: 132px; }
    /* The live model is the one piece of stage art you may grab. */
    .stage-art.live { pointer-events: auto; }
    .stage-art sc-ship-skin-viewer { display: block; width: 100%; height: 100%; }
    /* The bottom-wash gradient (.hero.stage::before) stays with the parent
       header — it is a pseudo-element of the card, not of this content. */
    /* The identity block sits on a translucent panel (feedback 140dfb7e:
       "Texthintergrund einfügen"): whatever the render puts behind it — a
       white hull, a bright engine glow — the eyebrow and the name keep their
       contrast. */
    /* Grid row 1 of .hero.stage, pinned to its top-left corner; it stops
       short of the 2D/3D switch in the opposite corner. */
    .stage-ident { grid-row: 1; align-self: start; justify-self: start; position: relative; z-index: 1;
      max-width: calc(100% - 72px); box-sizing: border-box; pointer-events: none;
      padding: 8px 12px; border-radius: 4px;
      background: color-mix(in srgb, var(--sc-bg-0) 78%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
    /* Typography lifted from the codex fleet tile (.fleet-tile__mfr / __name),
       with the emphasis swapped: the NAME carries the accent now — it is the
       ship this page is about — and the maker/role eyebrow steps back to the
       secondary text colour. */
    .mfr { margin: 0; font-family: var(--sc-font-display);
      font-size: max(0.6rem, var(--sc-fs-floor)); letter-spacing: 0.08em; line-height: 1.2;
      text-transform: uppercase; color: var(--sc-fg-1); }
    h1 { margin: 2px 0 0; font-size: clamp(19px, 1.9vw, 25px); font-weight: 700;
      line-height: 1.15; color: var(--sc-accent); overflow-wrap: normal; }
    .stage-foot { grid-row: 2; position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
    .chips { list-style: none; margin: 0; padding: 0;
      display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .stage-side { align-self: flex-end; max-width: 70%; }
    /* The census takes the full width of the band, right-aligned. */
    .stage-counts { margin: 0; justify-content: flex-end; }
    /* The census chips sit on the art, so they take the stat chips' opaque-ish
       ground rather than the tool row's near-transparent one. */
    .stage-counts .ls-item {
      background: color-mix(in srgb, var(--sc-bg-0) 82%, transparent); }
    .ls-detail { font-size: max(10px, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.12em; color: var(--sc-fg-2); }

    /* No artwork anywhere: say so instead of leaving a lost glyph in a big
       empty frame — the catalog simply has no render for this hull yet. */
    .art-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; width: 100%; padding: 14px; box-sizing: border-box; }
    .art-note { font-size: max(0.72rem, var(--sc-fs-floor)); line-height: 1.35; text-align: center;
      color: var(--sc-fg-2); max-width: 24ch; text-wrap: balance; }

    /* Module census (bottom-right of the stage). The mock has no element of
       its own for it, so it takes the chip vocabulary (part-02:156): count and
       category are one 10px uppercase run at .12em inside a 3px rectangle. */
    .loadout-summary { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .ls-item { display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 7px; border-radius: 3px;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent); border: 1px solid var(--sc-border); }
    /* One treatment for every figure (#239): the number in the primary text
       colour, the word after it in the chips' secondary one, the same border
       on every chip. Weapons used to be tinted in the accent, missiles and
       shields bordered in their own colours — it read as a ranking nobody
       meant. */
    .ls-count { font-family: var(--sc-font-display); font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.12em; color: var(--sc-fg-0); }
    .ls-cat { font-size: max(10px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.12em; color: var(--sc-fg-1); }

    /* 2D <-> 3D. Quiet on purpose: a two-character label that only steps
       fully forward when you reach for it. */
    .view-switch { position: absolute; top: 12px; inset-inline-end: 12px; z-index: 2;
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 48px; min-height: 48px; padding: 0 10px; border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
      border-radius: var(--radius-md, 4px);
      background: color-mix(in srgb, var(--sc-bg-0) 45%, transparent);
      color: var(--sc-fg-1); opacity: 0.8;
      font-family: var(--sc-font-display); font-size: max(12px, var(--sc-fs-floor));
      letter-spacing: 0.12em; cursor: pointer; }
    .view-switch:hover, .view-switch:focus-visible { opacity: 1; }
    .view-switch.on { color: var(--sc-accent); opacity: 0.85;
      border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); }
    .view-switch:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    /* "3D", not "30": the digit keeps the display face, the letter is set in
       the body face (Inter) at a heavier weight so its straight stem and flat
       bowl cannot be mistaken for a zero (feedback 140dfb7e).
       Both glyphs sit in ONE inline run (.vs-label) so they share a baseline
       (#239: the "D" stood higher than the "3"). As two flex items each span
       was centred on its own box, and the larger letter's box pushed it up.
       Same size for both — Inter's caps are no taller than Orbitron's digits. */
    .view-switch .vs-label { display: inline-block; line-height: 1; white-space: nowrap; }
    .view-switch .vs-num { font-family: var(--sc-font-display); }
    .view-switch .vs-letter { font-family: var(--sc-font-body, 'Inter', system-ui, sans-serif);
      font-weight: 700; letter-spacing: 0; margin-inline-start: 0.08em; }

    @media (max-width: 760px) {
      /* A phone has no room for four overlays on one picture: the stage keeps
         the art and the name, and hands chips and actions to normal flow
         underneath it. Nothing is dropped, nothing overlaps. The header's own
         .hero.stage switches to display:flex and its ::before wash
         shrinks to the art's height at this breakpoint (still in the parent
         file) — this content only follows along. */
      .stage-art { position: relative; inset: auto; aspect-ratio: 16 / 9; min-height: 190px;
        align-items: stretch; }
      /* The name stays ON the picture, top-left (#239), on its panel. */
      .stage-ident { position: absolute; top: 8px; inset-inline-start: 8px;
        max-width: calc(100% - 72px); padding: 6px 10px; }
      .stage-foot { padding: 10px 0 12px; }
      .stage-side { max-width: none; }
      .chips, .stage-counts { justify-content: flex-start;
        padding: 0 14px; }
      .view-switch { top: 8px; inset-inline-end: 8px; }
    }
  `],
})
export class CodexShipStageComponent {
  readonly kind = input.required<CodexKind>();
  readonly heroSub = input<string | null>(null);
  readonly heroArt = input<readonly string[]>([]);
  readonly displayName = input.required<string>();
  readonly heroView3d = input(false);
  readonly shipClassName = input('');
  readonly hardpointPortRefs = input<HardpointPortRef[]>([]);
  readonly activePorts = input<readonly string[]>([]);
  readonly has3dView = input(false);
  readonly heroEyebrow = input<string | null>(null);
  readonly heroChips = input<StageHeroChip[]>([]);
  readonly stageCounts = input<StageCountChip[]>([]);

  readonly hovered = output<string[] | null>();
  readonly locatable = output<string[]>();
  readonly artAvailable = output<boolean>();
  readonly viewToggle = output<void>();
}
