import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HoloSilhouette } from '../holo-silhouette';
import { ShipHardpointMapComponent } from '../ship-hardpoint-map.component';
import { HardpointFrame, HardpointMarker } from '../hardpoint-map';
import { ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import type { HardpointPortRef } from '../hardpoint-port-ref';
import { FallbackImageComponent } from '../fallback-image.component';
import type { PortPinBadge } from './codex-holo-patch.component';
import { HoloPhase, PinRing, StagePin } from './codex-holo-model';

/** Last-resort hull glyph (top-down, nose up, 100×100 viewBox) shown only
 * when a ship has neither a traced silhouette nor any artwork. */
const GENERIC_HULL_PATH =
  'M50 4 L56 18 L58 34 L74 46 L90 52 L90 58 L72 58 L64 66 L66 82 L60 88 L54 78 L50 90 L46 78 L40 88 L34 82 L36 66 L28 58 L10 58 L10 52 L26 46 L42 34 L44 18 Z';

let hullFillSeq = 0;

/**
 * The Holotable's projection surface: rings, the hull (traced outline, the
 * game's own icon, the artwork, or a generic glyph — never two empty rings),
 * the numbered pins with their orbit, the dense-table key and the legend; the
 * 3D model and the schema map swap in on the same surface.
 *
 * Purely presentational — the stage computes the pins and owns the arrival
 * phase; this component only renders them and times the entrance. Every
 * element that exists across the arrival is created WHEN the canvas opens
 * (`showCanvas`), so one set of entrance animations serves both the slow,
 * staggered arrival and the quick re-materialisation on a view or hull switch
 * — only their timing variables differ, and a changed timing variable never
 * restarts an animation that already ran.
 */
@Component({
  selector: 'sc-codex-holo-table',
  standalone: true,
  imports: [TranslatePipe, ShipHardpointMapComponent, ShipSkinViewerComponent, FallbackImageComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ph-wait]': "phase() === 'wait'",
    '[class.ph-hero]': "phase() === 'hero'",
    '[class.ph-reveal]': "phase() === 'reveal'",
    '[class.still]': 'still()',
    '[class.offscreen]': 'offscreen()',
  },
  template: `
    <div class="silhouette-frame" [class.mode-3d]="viewMode() === '3d'" [class.mode-schema]="viewMode() === 'schema'">
      <div class="rings" aria-hidden="true"><i class="sweep"></i></div>
      <!-- Projection layer over everything on the surface: scanlines and a
           slow interference band, masked to the table's light cone. -->
      <div class="projection" aria-hidden="true"><i class="band"></i></div>
      @if (phase() === 'reveal') {
        <!-- The arrival's scan front: one bright line crossing the table. -->
        <i class="reveal-scan" aria-hidden="true"></i>
      }
      @if (heroSrc(); as src) {
        <img class="hero-art" [src]="src" alt="" aria-hidden="true" />
      }
      @if (viewMode() === '3d') {
        <!-- @defer: the viewer chunk loads only in 3D mode (AUD-048). -->
        @defer (on immediate) {
          <sc-ship-skin-viewer class="mode-viewer" animate.leave="surface-leave" [shipId]="shipClassName()" [embedded]="true" [holo]="true" [still]="still()"
            [hardpointPorts]="hardpointPortRefs()" [activePorts]="activePorts()"
            (hovered)="hovered.emit($event)" (available)="artAvailable.emit($event)" />
        } @placeholder {
          <div class="mode-viewer is-placeholder" aria-hidden="true"></div>
        }
      } @else if (viewMode() === 'schema' && hardpointFrame(); as frame) {
        <sc-ship-hardpoint-map class="mode-viewer" animate.leave="surface-leave" [markers]="hardpointMarkers()" [frame]="frame"
          [activePorts]="activePorts()" (hovered)="hovered.emit($event)" />
      } @else if (showCanvas()) {
        <div class="shipwrap" animate.leave="surface-leave" [class.no-geometry]="!silhouette()" [class.dense]="dense()"
             [class.empty]="pins().length === 0" [class.has-orbit]="!!orbit()">
          @if (orbit(); as o) {
            <svg class="orbit" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <ellipse [attr.cx]="o.cx" [attr.cy]="o.cy" [attr.rx]="o.rx" [attr.ry]="o.ry" />
            </svg>
          }
          @if (silhouette(); as s) {
            <!-- The breathing light behind the hull: its own layer, so the
                 loop only ever changes one composited opacity. -->
            <i class="hull-halo" aria-hidden="true"></i>
            <svg class="silhouette" [attr.viewBox]="s.viewBox" preserveAspectRatio="xMidYMid meet" role="img"
                 [attr.aria-label]="'codex.holo.stage.silhouetteAria' | translate: { name: displayName() }">
              <defs>
                <!-- Projected light falls off toward the stern; the gradient is
                     per instance (ids are document-global). -->
                <linearGradient [attr.id]="hullFillId" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" class="hf-a" />
                  <stop offset="0.55" class="hf-b" />
                  <stop offset="1" class="hf-c" />
                </linearGradient>
              </defs>
              <path class="hull" [attr.d]="s.path" fill-rule="evenodd" [attr.fill]="'url(#' + hullFillId + ')'" />
            </svg>
          } @else {
            <!-- No traced silhouette for this hull (wave 5 A3.2): the default
                 is the game's own flat top-down icon, else the hull's artwork
                 in a holo treatment — and only when even that is missing, a
                 generic hull glyph. Never a client-side guess of the outline. -->
            <div class="silhouette-placeholder" role="img" [attr.aria-label]="'codex.holo.stage.placeholderAria' | translate: { name: displayName() }">
              <span class="ring"></span>
              <span class="ring inner"></span>
              @if (previewSilhouette() && !previewFailed()) {
                <img class="ghost-icon" [src]="previewSilhouette()" alt="" aria-hidden="true" (error)="previewError.emit()" />
              } @else if (heroArt().length > 0) {
                <div class="ghost-art" aria-hidden="true">
                  <sc-fallback-image [candidates]="heroArt()" [alt]="''" [eager]="true">
                    <svg class="generic-hull" viewBox="0 0 100 100" aria-hidden="true"><path [attr.d]="GENERIC_HULL" /></svg>
                  </sc-fallback-image>
                </div>
              } @else {
                <svg class="generic-hull" viewBox="0 0 100 100" aria-hidden="true"><path [attr.d]="GENERIC_HULL" /></svg>
              }
            </div>
          }
          @if (pins().length === 0) {
            <p class="table-empty">{{ 'codex.holo.stage.noPorts' | translate }}</p>
          }
          @for (pin of pins(); track pin.portName) {
            <button
              type="button"
              class="pin"
              [class.unresolved]="!pin.resolved"
              [class.gold]="pin.tone === 'gold'"
              [class.active]="activePorts().includes(pin.portName)"
              [class.sel]="inspectedPort() === pin.portName"
              [class.patched]="!!patchPortPins()?.[pin.portName]"
              [class.rev]="pin.side === 'left'"
              [class.pos-b]="pin.side === 'below'"
              [class.pos-t]="pin.side === 'above'"
              [style.left.%]="pin.x"
              [style.top.%]="pin.y"
              [style.--i]="pin.index"
              [attr.aria-pressed]="inspectedPort() === pin.portName"
              [scTooltip]="pin.resolved ? null : (pin.label + ' · ' + ('codex.holo.pinUnresolved' | translate))"
              scTooltipTier="label"
              (mouseenter)="hovered.emit([pin.portName])"
              (mouseleave)="hovered.emit(null)"
              (focus)="hovered.emit([pin.portName])"
              (blur)="hovered.emit(null)"
              (click)="pinInspect.emit(pin.portName)">
              <i aria-hidden="true">{{ pin.index }}</i>
              <span class="pin-label">
                {{ pin.label }}
                @if (pin.short) {
                  <!-- Always in the DOM, revealed by width: the label grows
                       smoothly instead of jumping when the stat appears. -->
                  <em>· {{ pin.short }}</em>
                }
              </span>
            </button>
          }
        </div>
      }
    </div>

    <!-- Dense tables (wave 5 A2.4): labels leave the pins and become a
         numbered key under the table — hover/click work like the pins. On a
         desktop with the inspector open, its hardpoint list takes this job. -->
    @if (dense() && viewMode() === 'holo') {
      <ol class="pin-key" [attr.aria-label]="'codex.holo.stage.pinKey' | translate">
        @for (pin of pins(); track pin.portName) {
          <li>
            <button type="button" class="pk"
                    [class.gold]="pin.tone === 'gold'"
                    [class.active]="activePorts().includes(pin.portName)"
                    [class.sel]="inspectedPort() === pin.portName"
                    (mouseenter)="hovered.emit([pin.portName])"
                    (mouseleave)="hovered.emit(null)"
                    (focus)="hovered.emit([pin.portName])"
                    (blur)="hovered.emit(null)"
                    (click)="pinInspect.emit(pin.portName)">
              <i aria-hidden="true">{{ pin.index }}</i><span>{{ pin.label }}</span>
            </button>
          </li>
        }
      </ol>
    }

    @if (viewMode() === 'holo' && pins().length > 0) {
      <div class="legend">
        <span><i aria-hidden="true"></i>{{ 'codex.holo.stage.legendConfigurable' | translate }}</span>
        @if (hasGold()) {
          <span><i class="g" aria-hidden="true"></i>{{ 'codex.holo.stage.legendMissiles' | translate }}</span>
        }
        @if (hasUnresolved()) {
          <span><i class="u" aria-hidden="true"></i>{{ 'codex.holo.stage.legendUnresolved' | translate }}</span>
        }
        <span class="legend-hint">{{ 'codex.holo.stage.legendHint' | translate }}</span>
      </div>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; position: relative;
      --f: var(--sc-fs-floor); --d: var(--sc-font-display); --m: var(--font-monospace, "Share Tech Mono", monospace);
      --e-out: var(--holo-e-out); --e-io: var(--holo-e-io);
      --sil-dur: 420ms; --sil-delay: 0ms; --glow-delay: 220ms; --orbit-dur: 520ms; --orbit-delay: 0ms;
      --pin-dur: 260ms; --pin-delay: 60ms; --pin-step: 12ms; }
    /* The arrival's slow timing — the SAME animations, only later and longer. */
    :host(.ph-reveal) { --sil-dur: 900ms; --sil-delay: 80ms; --glow-delay: 620ms; --orbit-dur: 820ms; --orbit-delay: 160ms;
      --pin-dur: 340ms; --pin-delay: 380ms; --pin-step: 16ms; }
    .silhouette-frame { position: relative; flex: 1; width: 100%; min-height: 480px; z-index: 1; display: flex; align-items: center;
      justify-content: center; overflow: hidden; container-type: size; --pin-inset: 56px; }
    .silhouette-frame:has(.shipwrap.dense) { --pin-inset: 40px; }
    /* Rings + grid + a slow sweep: the table is a live instrument even at rest. */
    .rings { position: absolute; inset: 0; pointer-events: none; z-index: 0; transition: opacity 420ms ease;
      background:
        repeating-radial-gradient(circle at 50% 50%, transparent 0 58px, var(--a7) 59px, transparent 60.5px),
        linear-gradient(var(--a5) 1px, transparent 1px) 0 0 / 100% 40px,
        linear-gradient(90deg, var(--a5) 1px, transparent 1px) 0 0 / 40px 100%; }
    .sweep { position: absolute; left: 50%; top: 50%; width: 150cqmax; aspect-ratio: 1; border-radius: 50%; translate: -50% -50%;
      background: conic-gradient(from 0deg, transparent 0 310deg, var(--a5) 350deg, var(--a7) 358deg, transparent 360deg);
      animation: holo-sweep 12s linear infinite; will-change: rotate; }
    @keyframes holo-sweep { to { rotate: 1turn; } }
    .silhouette-frame:is(.mode-3d, .mode-schema) .sweep { display: none; }
    :host(.ph-wait) .rings, :host(.ph-hero) .rings { opacity: 0.4; }
    /* Surfaces stack on one spot, so a view swap crossfades (the outgoing
       one leaves while the next enters) instead of cutting to bare rings. */
    .mode-viewer { position: absolute; inset: 0; z-index: 1; animation: fade-in var(--holo-t-base) var(--holo-e-out) backwards; }
    .mode-viewer.is-placeholder { animation: none; }
    .surface-leave { animation: surface-out var(--holo-t-fast) var(--holo-e-io) forwards; pointer-events: none; }
    @keyframes surface-out { to { opacity: 0; } }
    .shipwrap { position: absolute; left: 50%; top: 50%; aspect-ratio: 1 / 1; transform: translate(-50%, -50%);
      width: min(560px, 100cqw - 2 * var(--pin-inset), 100cqh - 2 * var(--pin-inset)); }
    .shipwrap.no-geometry { width: min(440px, 100cqw - 2 * var(--pin-inset), 100cqh - 2 * var(--pin-inset)); }

    /* ── The hull ── a scan front materialises it top to bottom. */
    .silhouette { width: 100%; height: 100%; display: block; overflow: visible;
      animation: sil-scan var(--sil-dur) var(--e-io) var(--sil-delay) backwards; }
    /* One filter for the whole hull, on the svg (the scan clips a composited
       layer, never re-rasterises two filters per frame). */
    .silhouette { filter: drop-shadow(0 0 4px var(--a55)) drop-shadow(0 0 14px var(--a28)); will-change: transform; }
    .silhouette .hull { stroke: var(--sc-accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
    /* The light behind the hull breathes slowly once it stands — an instrument
       at rest, never a blink. Its own layer: the loop changes one opacity. */
    .hull-halo { position: absolute; inset: 6%; border-radius: 50%; pointer-events: none; will-change: opacity;
      background: radial-gradient(closest-side, var(--a14), transparent 70%); opacity: 0.7;
      animation: fade-in 460ms ease-out var(--glow-delay) backwards, halo-breathe 5.6s ease-in-out calc(var(--glow-delay) + 460ms) infinite; }
    @keyframes halo-breathe { 50% { opacity: 1; } }
    .silhouette .hf-a { stop-color: var(--sc-accent); stop-opacity: 0.2; }
    .silhouette .hf-b { stop-color: var(--sc-accent); stop-opacity: 0.1; }
    .silhouette .hf-c { stop-color: var(--sc-accent); stop-opacity: 0.04; }
    /* Scanlines + a slow interference band over the whole surface, masked to
       the light cone so the frame's edges stay clean. Screen blend: it only
       ever adds light. */
    .projection { position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; transition: opacity 420ms ease;
      background: repeating-linear-gradient(180deg, var(--a5) 0, transparent 1.5px 4px);
      -webkit-mask-image: radial-gradient(ellipse 58% 62% at 50% 50%, #000 35%, transparent 100%);
      mask-image: radial-gradient(ellipse 58% 62% at 50% 50%, #000 35%, transparent 100%); }
    /* The interference band moves by transform only — the scanlines stay put. */
    .projection .band { position: absolute; left: 0; right: 0; top: 0; height: 18%; will-change: transform;
      background: linear-gradient(180deg, transparent 0, var(--a7) 50%, transparent 100%);
      animation: projection-band 8s linear infinite; }
    @keyframes projection-band { from { transform: translateY(-100%); } to { transform: translateY(560%); } }
    /* The 3D view brings its own projection layer; the schema map is a plan, not light. */
    .silhouette-frame:is(.mode-3d, .mode-schema) .projection { display: none; }
    :host(.ph-wait) .projection, :host(.ph-hero) .projection { opacity: 0; }
    @keyframes sil-scan { from { clip-path: inset(0 0 100% 0); } }
    .silhouette-placeholder { position: absolute; inset: 0; display: grid; place-items: center; }
    .silhouette-placeholder > * { animation: ghost-in var(--sil-dur) var(--e-out) var(--sil-delay) backwards; }
    @keyframes ghost-in { from { opacity: 0; transform: scale(0.9); } }
    .silhouette-placeholder .ring { grid-area: 1 / 1; width: 78%; height: 78%; border: 1px dashed var(--l2); border-radius: 50%; }
    .silhouette-placeholder .ring.inner { width: 40%; height: 40%; border-style: dotted; }
    /* The orbit already draws the outer ring — never two concentric dashes. */
    .shipwrap.has-orbit .silhouette-placeholder .ring:not(.inner) { display: none; }
    /* sc-fallback-image is display:contents — its img (or the projected glyph)
       is the grid item, so the sizing goes on those, not on the host. */
    .silhouette-placeholder > .generic-hull, .silhouette-placeholder .ghost-art, .silhouette-placeholder .ghost-icon {
      grid-area: 1 / 1; width: 74%; height: 74%; display: block; pointer-events: none; }
    /* The icon file pads its hull generously and points nose-right: rotate to
       the table's nose-up and scale it up to read like the traced outlines. */
    .silhouette-placeholder .ghost-icon { object-fit: contain; rotate: -90deg; scale: 1.4; opacity: 0.5;
      filter: sepia(1) saturate(4) hue-rotate(160deg) brightness(1.05) drop-shadow(0 0 3px var(--sc-accent)) drop-shadow(0 0 10px var(--a55)); }
    .silhouette-placeholder .ghost-art { display: grid; place-items: center; mix-blend-mode: screen; opacity: 0.6;
      filter: grayscale(1) sepia(1) hue-rotate(158deg) saturate(2.6) brightness(0.9) contrast(1.1);
      -webkit-mask-image: radial-gradient(ellipse closest-side at center, #000 55%, transparent 100%);
      mask-image: radial-gradient(ellipse closest-side at center, #000 55%, transparent 100%); }
    /* cover, not contain: a wide render letterboxed in the square showed hard
       picture edges inside the round mask — covered, it reads as a disc of light. */
    .silhouette-placeholder .ghost-art ::ng-deep img { width: 100%; height: 100%; max-height: none; object-fit: cover; display: block; filter: none; }
    .silhouette-placeholder .ghost-art .generic-hull { width: 100%; height: 100%; }
    .generic-hull path { fill: var(--a10); stroke: var(--sc-accent); stroke-width: 0.8; stroke-dasharray: 2 1.5; opacity: 0.7; filter: drop-shadow(0 0 4px var(--a40)); }
    .table-empty { position: absolute; inset: 0; margin: 0; display: grid; place-items: center; text-align: center; font-family: var(--d);
      text-transform: uppercase; letter-spacing: 0.14em; font-size: max(10px, var(--f)); color: var(--sc-fg-2); padding: 24px;
      animation: fade-in 400ms ease-out var(--glow-delay) backwards; }

    /* ── The orbit the estimated pins ride on: it says "these positions are a
       ring, not a guess at the hull" before a single label is read. */
    .orbit { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .orbit ellipse { fill: none; stroke: var(--a28); stroke-width: 1; vector-effect: non-scaling-stroke; stroke-dasharray: 3 7;
      transform-origin: 50% 50%; transform-box: view-box;
      animation: orbit-in var(--orbit-dur) var(--e-out) var(--orbit-delay) backwards; }
    @keyframes orbit-in { from { opacity: 0; transform: scale(0.94); } }

    /* ── Arrival (concept hv3-s1): the hero art is the loading image and
       dissolves into the table while a scan front materialises the hull. */
    .hero-art { position: absolute; inset: 0; z-index: 3; width: 100%; height: 100%; object-fit: cover; pointer-events: none;
      -webkit-mask-image: radial-gradient(ellipse 70% 70% at center, #000 55%, transparent 100%);
      mask-image: radial-gradient(ellipse 70% 70% at center, #000 55%, transparent 100%); }
    :host(.ph-hero) .hero-art { animation: hero-in 380ms var(--e-out) backwards; }
    :host(.ph-reveal) .hero-art { animation: hero-out 640ms var(--e-io) forwards; }
    @keyframes hero-in { from { opacity: 0; transform: scale(1.05); } }
    @keyframes hero-out { to { opacity: 0; transform: scale(0.92); } }
    /* The "bleach" of the dissolving art: an accent wash that only fades. */
    :host(.ph-reveal) .silhouette-frame::before { content: ''; position: absolute; inset: 0; z-index: 4; pointer-events: none;
      background: radial-gradient(ellipse 60% 60% at center, var(--a22), transparent 75%);
      animation: wash 640ms var(--e-io) both; }
    @keyframes wash { 0% { opacity: 0; } 35% { opacity: 1; } 100% { opacity: 0; } }
    .reveal-scan { position: absolute; left: 0; right: 0; top: 0; height: 14%; z-index: 4; pointer-events: none; will-change: transform, opacity;
      background: linear-gradient(180deg, transparent 0, var(--a28) 45%, var(--a55) 50%, transparent 100%);
      animation: holo-scan 980ms var(--e-io) 60ms both; }
    @keyframes holo-scan { from { transform: translateY(-100%); } 85% { opacity: 1; } to { transform: translateY(720%); opacity: 0; } }
    @keyframes fade-in { from { opacity: 0; } }

    /* ── Pins. The pin keeps its 20px box so the dot stays ON its anchor even
       under the global 48px touch minimum; the hit area is the dot's halo.
       Tone (accent / gold missiles) lives in --pc, so "estimated position"
       (dashed) never swallows the tone or the hover / selected states. */
    .pin { position: absolute; display: flex; align-items: center; gap: 6px; padding: 0; margin: -10px 0 0 -10px; background: none;
      border: none; cursor: pointer; z-index: 2; color: var(--sc-fg-1); min-width: 0; min-height: 0; --pc: var(--sc-accent); }
    .pin.gold, .pk.gold { --pc: var(--holo-gold); }
    .pin.rev { flex-direction: row-reverse; transform: translateX(calc(-100% + 20px)); }
    /* Top / bottom ring pins stack their label vertically so neighbours on the
       ring never run into each other horizontally (wave 5 A2.4). */
    .pin.pos-b { flex-direction: column; transform: translateX(calc(-50% + 10px)); }
    .pin.pos-t { flex-direction: column-reverse; transform: translate(calc(-50% + 10px), calc(-100% + 20px)); }
    .pin:is(.sel, :hover, :focus-visible) { z-index: 4; }
    .pin i { position: relative; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--pc); background: var(--ink);
      color: var(--pc); font-family: var(--m); font-style: normal; font-size: 10px; display: grid; place-items: center; flex: none;
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--pc) 12%, transparent), 0 0 12px color-mix(in srgb, var(--pc) 45%, transparent);
      transition: background var(--holo-t-fast) ease, color var(--holo-t-fast) ease, box-shadow var(--holo-t-fast) ease, scale var(--holo-t-fast) var(--e-out);
      animation: pin-dot var(--pin-dur) var(--e-out) backwards;
      animation-delay: calc(var(--pin-delay) + min(var(--i, 1), 16) * var(--pin-step)); }
    .pin i::after { content: ''; position: absolute; inset: -14px; border-radius: 50%; }
    @keyframes pin-dot { from { opacity: 0; transform: scale(0.6); } }
    .pin.unresolved i { border-style: dashed; background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      color: color-mix(in srgb, var(--pc) 78%, var(--sc-fg-1)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pc) 8%, transparent); }
    .pin:is(.active, :hover, :focus-visible) i { scale: 1.14; border-style: solid;
      box-shadow: 0 0 0 6px color-mix(in srgb, var(--pc) 22%, transparent), 0 0 18px color-mix(in srgb, var(--pc) 75%, transparent); }
    .pin.sel i { background: var(--pc); color: var(--sc-bg-0); border-style: solid; }
    /* The selected pin pings like a contact on a scope. */
    .pin.sel i::before { content: ''; position: absolute; inset: -1px; border-radius: 50%; border: 1px solid var(--pc); pointer-events: none;
      animation: pin-ping 1.6s var(--e-out) 3; }
    @keyframes pin-ping { from { opacity: 0.9; transform: scale(1); } to { opacity: 0; transform: scale(2.6); } }
    /* Patched draws a second ring with box-shadow — outline is the focus ring's. */
    .pin.patched i { box-shadow: 0 0 0 2px var(--sc-bg-0), 0 0 0 3px var(--sc-accent), 0 0 12px color-mix(in srgb, var(--pc) 45%, transparent); }
    .pin:focus-visible { outline: none; }
    .pin:focus-visible i { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pin-label { font-family: var(--d); text-transform: uppercase; font-size: max(8.5px, var(--f)); letter-spacing: 0.1em; color: var(--sc-fg-1);
      background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent); padding: 2px 6px; border: 1px solid var(--l1); border-radius: 2px;
      white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
      transition: border-color 160ms ease, color 160ms ease, opacity 160ms ease, visibility 160ms;
      animation: pin-label calc(var(--pin-dur) + 80ms) var(--e-out) backwards;
      animation-delay: calc(var(--pin-delay) + 90ms + min(var(--i, 1), 16) * var(--pin-step)); }
    @keyframes pin-label { from { opacity: 0; translate: 0 4px; } }
    .pin-label em { font-style: normal; color: var(--sc-fg-0); font-family: var(--m); letter-spacing: 0; text-transform: none;
      display: inline-block; vertical-align: bottom; max-width: 0; opacity: 0; overflow: hidden; white-space: nowrap;
      transition: max-width var(--holo-t-base) var(--e-out), opacity var(--holo-t-fast) ease; }
    .pin:is(.active, .sel) .pin-label em { max-width: 12em; opacity: 1; }
    .pin:is(.active, .sel) .pin-label { max-width: 260px; }
    .pin:is(.active, :hover) .pin-label { border-color: var(--pc); color: var(--sc-fg-0); }
    .pin.sel .pin-label { color: var(--pc); border-color: var(--pc); }
    /* Dense tables keep the labels off the canvas — the key (or the
       inspector's list) carries them; hover / selection shows the pin's own. */
    .shipwrap.dense .pin-label { opacity: 0; visibility: hidden; }
    .shipwrap.dense .pin:is(.sel, .active, :hover, :focus-visible) .pin-label { opacity: 1; visibility: visible; }

    /* ── Key + legend under the canvas ── */
    .pin-key { position: relative; z-index: 2; list-style: none; margin: 0; padding: 8px 12px 0; display: flex; flex-wrap: wrap; gap: 4px 6px; }
    .pk { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 2px; border: 1px solid var(--l1); border-radius: 999px;
      background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); color: var(--sc-fg-1); cursor: pointer; font: inherit;
      font-size: max(9.5px, var(--f)); min-height: var(--sc-tap-min, 24px); max-width: 100%; transition: border-color 160ms ease, color 160ms ease;
      --pc: var(--sc-accent); }
    .pk:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pk i { width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--pc); color: var(--pc); font-family: var(--m); font-style: normal;
      font-size: 9px; display: grid; place-items: center; flex: none; transition: background 160ms ease, color 160ms ease; }
    .pk span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pk:hover, .pk.active { border-color: var(--pc); color: var(--sc-fg-0); }
    .pk.sel { border-color: var(--pc); color: var(--pc); }
    .pk.sel i { background: var(--pc); color: var(--sc-bg-0); }
    .legend { position: relative; z-index: 2; padding: 8px 12px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
      font-family: var(--d); text-transform: uppercase; font-size: max(8.5px, var(--f)); letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--sc-accent); vertical-align: middle; margin-right: 4px; }
    .legend i.g { border-color: var(--holo-gold); }
    .legend i.u { border-style: dashed; border-color: var(--sc-fg-2); }
    .legend-hint { margin-inline-start: auto; }

    @media (orientation: landscape) and (max-width: 1000px) and (max-height: 600px) {
      .silhouette-frame { min-height: 320px; }
    }
    @media (max-width: 640px) {
      .silhouette-frame, .mode-viewer { min-height: 360px; }
      .silhouette-frame { --pin-inset: 36px; }
      .pin-label { display: none; }
      .pin:is(.sel, .active) .pin-label { display: inline; }
      .legend-hint { display: none; }
    }
    /* Off screen (scrolled to the ports list, the drawer): the loops rest. */
    :host(.offscreen) *, :host(.offscreen) *::before, :host(.offscreen) *::after { animation-play-state: paused !important; }
    /* Reduced motion = a hard cut: nothing moves, nothing loops. */
    :host(.still) *, :host(.still) *::before, :host(.still) *::after { animation: none !important; transition: none !important; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  `],
})
export class CodexHoloTableComponent {
  readonly GENERIC_HULL = GENERIC_HULL_PATH;
  /** Document-unique id of this table's hull gradient. */
  readonly hullFillId = `holo-hull-fill-${++hullFillSeq}`;

  readonly pins = input<readonly StagePin[]>([]);
  /** The fallback ring the estimated pins ride on; null = every pin anchored. */
  readonly orbit = input<PinRing | null>(null);
  readonly silhouette = input<HoloSilhouette | null>(null);
  readonly previewSilhouette = input<string | null>(null);
  readonly previewFailed = input(false);
  readonly heroArt = input<readonly string[]>([]);
  /** The preloaded arrival image, only while the arrival shows it. */
  readonly heroSrc = input<string | null>(null);
  readonly viewMode = input<'holo' | '3d' | 'schema'>('holo');
  readonly shipClassName = input('');
  readonly hardpointPortRefs = input<readonly HardpointPortRef[]>([]);
  readonly hardpointFrame = input<HardpointFrame | null>(null);
  readonly hardpointMarkers = input<HardpointMarker[]>([]);
  readonly activePorts = input<readonly string[]>([]);
  readonly inspectedPort = input<string | null>(null);
  readonly patchPortPins = input<Readonly<Record<string, PortPinBadge>> | null>(null);
  readonly displayName = input('');
  readonly dense = input(false);
  readonly hasUnresolved = input(false);
  readonly phase = input<HoloPhase>('done');
  /** Reduced motion: a hard cut, no entrance, no loops. */
  readonly still = input(false);

  readonly hovered = output<string[] | null>();
  readonly pinInspect = output<string>();
  readonly artAvailable = output<boolean>();
  readonly previewError = output<void>();

  /** The hull, the orbit and the pins exist from the reveal on — see the class comment. */
  readonly showCanvas = computed(() => this.phase() === 'reveal' || this.phase() === 'done');
  /** The table is scrolled out of view — its loops (sweep, band, halo, ping) pause. */
  readonly offscreen = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver !== 'function') return;
      const io = new IntersectionObserver(([entry]) => this.offscreen.set(!entry.isIntersecting));
      io.observe(host);
      destroyRef.onDestroy(() => io.disconnect());
    });
  }
  readonly hasGold = computed(() => this.pins().some((p) => p.tone === 'gold'));
}
