import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CodexKind } from '../codex.service';
import { HangarPickerComponent, HangarPickerItem } from '../stage/hangar-picker.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HardpointPortRef, ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import { FallbackImageComponent } from '../fallback-image.component';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import { StageCountChip } from '../codex-detail.component';

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
 * art fills the card, name and chips sit on it top-left/bottom, the module
 * census sits bottom-right. Split out of `codex-detail.component.ts` (AUD-062)
 * purely to keep that file's component-style budget under the Angular build
 * budget; every binding, class and DOM node here is byte-identical to what
 * used to render inline in the `kind() === 'ship'` branch of the hero.
 *
 * Everything the stage needs but does not own (loadout counts, active ports,
 * the picked hangar ship, whether a 3D model exists…) flows in as inputs; the
 * few things the stage can change (which port is hovered, whether the 3D
 * model turned out to be locatable, the 2D/3D toggle, a hangar pick) flow
 * back out as outputs — the parent still owns every signal.
 */
@Component({
  selector: 'sc-codex-ship-stage',
  standalone: true,
  imports: [
    TranslatePipe,
    HangarPickerComponent,
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
        <sc-ship-skin-viewer
          class="stage-viewer"
          [shipId]="cls"
          [embedded]="true"
          [hardpointPorts]="hardpointPortRefs()"
          [activePorts]="activePorts()"
          (hovered)="hovered.emit($event)"
          (locatable)="locatable.emit($event)"
          (available)="artAvailable.emit($event)" />
      } @else {
        <sc-fallback-image [candidates]="heroArt()" [alt]="displayName()" [eager]="true">
          <span class="art-fallback">
            <sc-codex-icon class="hero-icon" [kind]="kind()" [sub]="heroSub()" />
            <span class="art-note">{{ 'codex.detail.noArtwork' | translate }}</span>
          </span>
        </sc-fallback-image>
      }
    </div>

    <!-- HangarPicker (round 16-17, N4): the same "⌂ Hangar" control
         and fly-out chain as the Codex landing's ship stage, top-left
         in the hero picture. Only the hangar mechanic changes here —
         everything else on the classic hero stays as it was. -->
    <sc-hangar-picker
      class="stage-hangar-picker"
      kind="ship"
      [items]="shipPickerItems()"
      (pick)="hangarPick.emit($event)"
      (open)="hangarOpen.emit()" />

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
        <span class="vs-num" aria-hidden="true">{{ viewLabel.slice(0, -1) }}</span><span class="vs-letter" aria-hidden="true">{{ viewLabel.slice(-1) }}</span>
      </button>
    }

    <!-- The bottom band of the stage: identity left, figures right.
         Nothing in here is clickable any more — the four frequent
         actions moved out of the picture into their own row directly
         beneath it (feedback 140dfb7e: "die anklickbaren Links raus
         aus dem Bild"), so the band carries the name, the stat chips
         and, bottom-right, the module census that used to sit in the
         tool row. A column that grows from the bottom cannot collide
         with itself. -->
    <div class="stage-foot">
      <!-- Upper line of the band: identity left, stat chips right. -->
      <div class="stage-row">
        <!-- Maker and role as one small eyebrow, the name bold and in
             the accent under it — the ship IS the subject — on a
             translucent panel so both stay legible on any render.
             The role lives here rather than in the chip row so it is
             not printed twice. -->
        <div class="stage-ident">
          @if (heroEyebrow(); as eb) { <p class="mfr">{{ eb }}</p> }
          <h1>{{ displayName() }}</h1>
        </div>

        @if (heroChips().length > 0) {
          <ul class="chips stage-side">
            @for (c of heroChips(); track c.key) {
              @if (c.key !== 'role') {
                <li class="hchip" [class.accent]="c.accent" [class.ghost]="c.ghost" [class.gap]="c.gap">{{ c.text }}</li>
              }
            }
          </ul>
        }
      </div>
      <!-- Module census, bottom-right ON the art, on its own line so
           it can use the full width of the stage and wraps into two or
           three short rows instead of a tall column. Read from the
           same resolved sections the loadout column renders, so "3
           Bewaffnung" here is the "Bewaffnung · 3 Slots" heading down
           there — never a second classifier with its own opinion. -->
      @if (stageCounts().length > 0) {
        <ul class="loadout-summary stage-counts" [attr.aria-label]="'codex.detail.equipment' | translate">
          @for (s of stageCounts(); track s.group) {
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
    .hchip.accent { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .hchip.ghost { color: var(--sc-fg-2); }
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
    .stage-art { position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; pointer-events: none;
      --sc-img-max-h: none;
      --sc-img-shadow: drop-shadow(0 12px 34px rgba(0,0,0,0.72));
      --sc-icon-max: 132px; }
    /* The live model is the one piece of stage art you may grab. */
    .stage-art.live { pointer-events: auto; }
    /* The HangarPicker's own host is a plain block box; its child positions
       itself absolutely (top:12/left:16 — see hangar-picker.component.ts).
       Anchoring the host itself out of the grid flow keeps it from claiming
       a third grid row (round 16-17, N4). */
    .stage-hangar-picker { position: absolute; top: 0; left: 0; z-index: 5; }
    .stage-art sc-ship-skin-viewer { display: block; width: 100%; height: 100%; }
    /* The bottom-wash gradient (.hero.stage::before) stays with the parent
       header — it is a pseudo-element of the card, not of this content. */
    /* The identity block sits on a translucent panel (feedback 140dfb7e:
       "Texthintergrund einfügen"): whatever the render puts behind it — a
       white hull, a bright engine glow — the eyebrow and the name keep their
       contrast. */
    .stage-ident { min-width: min-content; flex: 0 1 auto; pointer-events: none;
      align-self: flex-end; padding: 8px 12px; border-radius: 4px;
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
    /* Identity and stat chips share one line and never wrap onto two: the
       chips own 45-50% of the band, the panel takes the rest. */
    .stage-row { display: flex; align-items: flex-end;
      justify-content: space-between; gap: 8px 12px; }
    .chips { list-style: none; margin: 0; padding: 0;
      display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .stage-side { flex: 1 1 0; min-width: 45%; max-width: 50%; }
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
    .ls-count { font-family: var(--sc-font-display); font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.12em; color: var(--sc-fg-0); }
    .ls-cat { font-size: max(10px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.12em; color: var(--sc-fg-2); }
    /* No hot accent and no mock literals here (concept section 0): nothing in
       the port overview is admin-gated and none of it is an error. */
    .ls-item[data-cat="weapons"] { border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .ls-item[data-cat="weapons"] .ls-count { color: var(--sc-accent); }
    .ls-item[data-cat="missiles"] { border-color: color-mix(in srgb, var(--sc-warn) 45%, transparent); }
    .ls-item[data-cat="shields"] { border-color: color-mix(in srgb, var(--sc-accent) 35%, transparent); }

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
       bowl cannot be mistaken for a zero (feedback 140dfb7e). */
    .view-switch .vs-num { font-family: var(--sc-font-display); }
    .view-switch .vs-letter { font-family: var(--sc-font-body, 'Inter', system-ui, sans-serif);
      font-weight: 700; font-size: 1.15em; letter-spacing: 0; margin-inline-start: 0.08em; line-height: 1; }

    @media (max-width: 760px) {
      /* A phone has no room for four overlays on one picture: the stage keeps
         the art and the name, and hands chips and actions to normal flow
         underneath it. Nothing is dropped, nothing overlaps. The header's own
         .hero.stage switches to display:flex and its ::before wash
         shrinks to the art's height at this breakpoint (still in the parent
         file) — this content only follows along. */
      .stage-art { position: relative; inset: auto; min-height: 190px; }
      /* Below the art the name needs no panel — it sits on the card. */
      .stage-ident { padding: 10px 14px 0; background: none; border: 0;
        backdrop-filter: none; -webkit-backdrop-filter: none; border-radius: 0; }
      .stage-foot { padding-bottom: 12px; }
      .stage-row { flex-direction: column; align-items: stretch; gap: 8px; }
      .stage-ident { min-width: 0; flex: 0 0 auto; }
      .stage-side { min-width: 0; max-width: none; }
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
  readonly shipPickerItems = input<HangarPickerItem[]>([]);

  readonly hovered = output<string[] | null>();
  readonly locatable = output<string[]>();
  readonly artAvailable = output<boolean>();
  readonly viewToggle = output<void>();
  readonly hangarPick = output<string>();
  readonly hangarOpen = output<void>();
}
