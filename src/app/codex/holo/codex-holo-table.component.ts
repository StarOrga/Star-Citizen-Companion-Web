import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CodexHoloCalloutComponent } from './codex-holo-callout.component';
import { HoloDiffMarkerComponent } from './holo-diff-marker';
import { calloutValuesOf, partTypeKey, shortStatKey } from './holo-callout-values';
import { partFocusOf } from './codex-holo-inspector.component';
import { displayItemName } from '../codex-format';
import { isConfigurableSection } from '../ship-module-sections';
import type { PlacementGroup } from '../asset-package/asset-package.model';
import { HoloSilhouette } from '../holo-silhouette';
import { ShipHardpointMapComponent } from '../ship-hardpoint-map.component';
import { ShipBlueprintSchemaComponent, type SchemaCallout } from '../ship-blueprint/ship-blueprint-schema.component';
import { ShipDeckPlanComponent } from '../ship-deck-plan.component';
import type { Lang, ShipDeck } from '../codex.types';
import { ShipBlueprintService } from '../ship-blueprint/ship-blueprint.service';
import {
  type BlueprintViewName,
  type SchemaMarker,
  type ShipBlueprint,
  blueprintView,
  placeSchemaMarkers,
  schemaHardpointsFromManifest,
  schemaHardpointsFromPayload,
} from '../ship-blueprint/ship-blueprint.model';
import type { AssetPackageManifest } from '../asset-package/asset-package.model';
import { HardpointFrame, HardpointMarker } from '../hardpoint-map';
import { ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import { AssetPackageViewerComponent, type CalloutValue, type PlacementSelection } from '../asset-package/asset-package-viewer.component';
import type { HotspotScope } from '../asset-package/asset-package.model';
import { calloutGutter, calloutSize } from '../asset-package/holo-overlay';
import { AssetPackageService } from '../asset-package/asset-package.service';
import type { AssetPackageRow } from '../asset-package/asset-package.model';
import { logWarn } from '../../core/log';
import type { HardpointPortRef } from '../hardpoint-port-ref';
import { FallbackImageComponent } from '../fallback-image.component';
import type { PortPinBadge } from './codex-holo-patch.component';
import { HoloPhase, PinRing, StagePin, spreadStackedPins } from './codex-holo-model';
import { LeaderLayout, layoutLeaderLabels } from './codex-holo-leader';

/** One deck of the ship on the table surface (Schema "Einfach", concept r1-decks). */
export interface HoloDeckView {
  decks: readonly ShipDeck[];
  lang: Lang;
  key: string;
  /** D5: the room picked in the bottom row (its key); null/absent = none. */
  room?: string | null;
}

/**
 * The perspective views show only the points of the parts the table shows
 * (concept r1-callout), plus the part picked elsewhere so its callout has a
 * point to stand on. A hull whose ports match none keeps every point.
 */
export function filterSchemaMarkers<T extends Pick<SchemaMarker, 'port'>>(
  markers: readonly T[],
  shown: readonly string[],
  picked: string | null,
): T[] {
  const keep = new Set(shown);
  if (picked) keep.add(picked);
  const out = markers.filter((m) => keep.has(m.port));
  return out.length > 0 ? out : [...markers];
}

/** A pin's size: the held gun's for a mount, else the slot's own (the same rule the inspector's list follows). */
function sizeOfPin(pin: StagePin): number | null {
  const slot = pin.slot;
  if (!slot) return null;
  const held = pin.section === 'weapons' ? slot.children?.find((c) => !!c.name) : undefined;
  return held?.size ?? slot.size ?? slot.portSize ?? null;
}

/** Closest two schema markers may sit, in % of the drawing's long side. */
const SCHEMA_MARKER_GAP = 3.2;

/** Last-resort hull glyph (top-down, nose up, 100×100 viewBox) shown only
 * when a ship has neither a traced silhouette nor any artwork. */
const GENERIC_HULL_PATH =
  'M50 4 L56 18 L58 34 L74 46 L90 52 L90 58 L72 58 L64 66 L66 82 L60 88 L54 78 L50 90 L46 78 L40 88 L34 82 L36 66 L28 58 L10 58 L10 52 L26 46 L42 34 L44 18 Z';

let hullFillSeq = 0;

/** Clamp to [-1, 1]. */
const unit = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Parallax offset of the table (cx-parallax), both axes in [-1, 1]: the
 * pointer's position over the frame, plus a third of how far the frame's
 * centre sits from the viewport's centre (scrolling the page tilts it).
 */
export function parallaxOffset(
  rect: { left: number; top: number; width: number; height: number },
  viewportH: number,
  pointer: { x: number; y: number } | null,
): { x: number; y: number } {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
  const px = pointer ? unit(((pointer.x - rect.left) / rect.width) * 2 - 1) : 0;
  const py = pointer ? unit(((pointer.y - rect.top) / rect.height) * 2 - 1) : 0;
  const scroll = viewportH > 0 ? unit((rect.top + rect.height / 2 - viewportH / 2) / (viewportH / 2)) : 0;
  return { x: Math.round(px * 1000) / 1000, y: Math.round(unit(py + scroll / 3) * 1000) / 1000 };
}

/**
 * Drives `--px`/`--py` on the frame from pointer + scroll, at most once per
 * frame and without change detection. Off under reduced motion (`still`).
 * Returns the teardown.
 */
function bindParallax(frame: HTMLElement, still: () => boolean): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let pointer: { x: number; y: number } | null = null;
  let raf = 0;
  const apply = () => {
    raf = 0;
    if (still()) {
      frame.style.removeProperty('--px');
      frame.style.removeProperty('--py');
      return;
    }
    const o = parallaxOffset(frame.getBoundingClientRect(), window.innerHeight, pointer);
    frame.style.setProperty('--px', String(o.x));
    frame.style.setProperty('--py', String(o.y));
  };
  const queue = () => {
    if (!raf) raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(apply) : (apply(), 0);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    pointer = { x: e.clientX, y: e.clientY };
    queue();
  };
  const onLeave = () => {
    pointer = null;
    queue();
  };
  frame.addEventListener('pointermove', onMove, { passive: true });
  frame.addEventListener('pointerleave', onLeave, { passive: true });
  window.addEventListener('scroll', queue, { passive: true, capture: true });
  queue();
  return () => {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    frame.removeEventListener('pointermove', onMove);
    frame.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('scroll', queue, { capture: true });
  };
}

/** The outline's horizontal extent in % of the (square) hull box — what the
 * leader columns hug. Undefined for a viewBox that is not a plain square. */
function hullSpanOf(s: HoloSilhouette): { x0: number; x1: number } | undefined {
  const vb = s.viewBox.trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2] <= 0 || vb[2] !== vb[3]) return undefined;
  return { x0: ((s.bbox.x - vb[0]) / vb[2]) * 100, x1: ((s.bbox.x + s.bbox.w - vb[0]) / vb[2]) * 100 };
}

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
  imports: [TranslatePipe, ShipHardpointMapComponent, ShipBlueprintSchemaComponent, ShipDeckPlanComponent, ShipSkinViewerComponent, AssetPackageViewerComponent, FallbackImageComponent, ScTooltipDirective, CodexHoloCalloutComponent, HoloDiffMarkerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.ph-wait]': "phase() === 'wait'",
    '[class.ph-hero]': "phase() === 'hero'",
    '[class.ph-reveal]': "phase() === 'reveal'",
    '[class.still]': 'still()',
    '[class.offscreen]': 'offscreen()',
  },
  template: `
    <div class="silhouette-frame" #frame [class.mode-3d]="viewMode() === '3d'" [class.mode-schema]="viewMode() === 'schema'" [class.phone-full]="phoneFull()">
      @if (phoneFull()) {
        <button type="button" class="full-close" [attr.aria-label]="'codex.holo.stage.fullscreenExit' | translate" [scTooltip]="'codex.holo.stage.fullscreenExit' | translate" (click)="fullDismissed.set(true)">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      }
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
          @if (packageRow(); as row) {
            <sc-asset-package-viewer class="mode-viewer" animate.leave="surface-leave" [row]="row" [still]="still()"
              interaction="table" [safeArea]="safeArea()" [selectedPort]="selectedPart()" [swappablePorts]="swappablePorts()"
              [relevantPorts]="relevantPorts()" [calloutValues]="calloutModel()?.values ?? calloutValues()" [calloutTitle]="calloutModel()?.title ?? calloutTitle()"
              [calloutType]="calloutModel()?.type ?? null" [calloutDiff]="calloutModel()?.diff ?? false" [groupFilter]="viewerGroups()" [(hotspotScope)]="hotspotScope"
              [activePorts]="activePorts()" (hovered)="hovered.emit($event)" (locatable)="locatable.emit($event)"
              (selectionChange)="partSelected.emit($event)" (swapRequested)="partSwap.emit($event)" />
          } @else if (packageRow() === null) {
            <!-- Legacy path (hulls uploaded before asset packages): model-viewer + browser-side port/node join. -->
            <sc-ship-skin-viewer class="mode-viewer" animate.leave="surface-leave" [shipId]="shipClassName()" [embedded]="true" [holo]="true" [still]="still()"
              [hardpointPorts]="hardpointPortRefs()" [activePorts]="activePorts()"
              (hovered)="hovered.emit($event)" (locatable)="locatable.emit($event)" />
          } @else {
            <div class="mode-viewer is-placeholder" aria-hidden="true"></div>
          }
        } @placeholder {
          <div class="mode-viewer is-placeholder" aria-hidden="true"></div>
        }
      } @else if (viewMode() === 'schema' && schemaBlueprint(); as bp) {
        <!-- The ship's own blueprint with every hardpoint on it; the box map
             below stays the view for hulls without a drawing. -->
        <sc-ship-blueprint-schema class="mode-viewer schema-sheet" animate.leave="surface-leave" [blueprint]="bp" [view]="schemaView()"
          [markers]="schemaMarkers()" [activePorts]="activePorts()" [inspectedPort]="inspectedPort()"
          [callout]="schemaCallout()" [listHidden]="true"
          (hovered)="hovered.emit($event)" (inspect)="pinInspect.emit($event)" (swap)="portSwap.emit($event)" />
      } @else if (viewMode() === 'schema' && schemaBlueprintPending()) {
        <div class="mode-viewer is-placeholder" aria-hidden="true"></div>
      } @else if (viewMode() === 'schema' && hardpointFrame(); as frame) {
        <sc-ship-hardpoint-map class="mode-viewer" animate.leave="surface-leave" [markers]="hardpointMarkers()" [frame]="frame"
          [activePorts]="activePorts()" (hovered)="hovered.emit($event)" />
      } @else if (viewMode() === 'holo' && deckPlan(); as dp) {
        <!-- Schema "Einfach" on a deck chip (concept r1-decks): the deck's
             rooms replace the hull; no part markers or callouts inside a deck. -->
        <sc-ship-deck-plan class="mode-viewer deck-sheet" animate.leave="surface-leave"
          [decks]="dp.decks" [lang]="dp.lang" [deckKey]="dp.key" [bare]="true"
          [room]="dp.room ?? null" (roomChange)="deckRoomChange.emit($event)" />
      } @else if (showCanvas()) {
        <div class="shipwrap" animate.leave="surface-leave" [class.no-geometry]="!silhouette()" [class.dense]="keyMode()"
             [class.leader]="!!leader()" [style.width.px]="leader()?.hull?.w ?? null"
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
              @if (s.edges) { <path class="hull-edges" [attr.d]="s.edges" fill="none" /> }
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
              [class.q]="isQuiet(pin.portName)"
              [class.unresolved]="!pin.resolved"
              [class.gold]="pin.tone === 'gold'"
              [class.active]="lit(pin.portName)"
              [class.sel]="inspectedPort() === pin.portName"
              [class.patched]="!!patchPortPins()?.[pin.portName]"
              [class.rev]="pin.side === 'left'"
              [class.pos-b]="pin.side === 'below'"
              [class.pos-t]="pin.side === 'above'"
              [style.left.%]="pin.x"
              [style.top.%]="pin.y"
              [style.--i]="pin.index"
              [attr.aria-pressed]="inspectedPort() === pin.portName"
              [attr.tabindex]="leader() ? -1 : null"
              [attr.aria-hidden]="leader() ? 'true' : null"
              [attr.data-port]="pin.portName"
              [attr.aria-label]="tagAria(pin)"
              [scTooltip]="pin.label + (pin.resolved ? '' : ' · ' + ('codex.holo.pinUnresolved' | translate))"
              scTooltipTier="label"
              (mouseenter)="hover(pin.portName)"
              (mouseleave)="hover(null)"
              (focus)="hover(pin.portName)"
              (blur)="hover(null)"
              (click)="pinInspect.emit(pin.portName)">
              <!-- No numbers on the table (C10/C11): the dot, then the tag "Typ + Größe". -->
              <i aria-hidden="true"></i>
              <span class="pin-label">
                {{ tagOf(pin).text }}
                @if (diffPorts().has(pin.portName)) { <sc-holo-diff-marker /> }
              </span>
            </button>
          }
          @if (!leader() && selectedPin(); as sp) {
            <!-- The selected part is the full callout, beside its dot (the tag steps aside). -->
            <sc-holo-callout class="pin-card" [class.to-left]="sp.x > 50" [style.left.%]="sp.x" [style.top]="'clamp(48px, ' + sp.y + '%, calc(100% - 48px))'"
              [type]="tagOf(sp).type" [name]="calloutModel()?.title ?? sp.label" [values]="calloutModel()?.values ?? []"
              [swappable]="calloutModel()?.swappable ?? false" [diff]="diffPorts().has(sp.portName)" (swap)="portSwap.emit(sp.portName)" />
          }
        </div>
        @if (leader(); as lay) {
          <!-- Leader lines (#642): each anchored dot's label sits in the
               nearest free slot of a column beside the hull, joined by a thin
               line. Geometry from layoutLeaderLabels() in frame px. -->
          <svg class="leaders" animate.leave="surface-leave" [attr.viewBox]="'0 0 ' + frameW() + ' ' + frameH()"
               preserveAspectRatio="none" aria-hidden="true">
            @for (l of lay.labels; track l.portName) {
              <path [attr.d]="l.path" pathLength="1" [style.--i]="l.index"
                    [class.gold]="pinByPort().get(l.portName)?.tone === 'gold'"
                    [class.est]="!pinByPort().get(l.portName)?.resolved"
                    [class.active]="lit(l.portName)" [class.sel]="inspectedPort() === l.portName" [class.under]="!!leaderCard()?.covered?.has(l.portName)" />
            }
          </svg>
          <ol class="leader-labels" animate.leave="surface-leave" [attr.aria-label]="'codex.holo.stage.pinLabels' | translate">
            @for (l of lay.labels; track l.portName) {
              @if (pinByPort().get(l.portName); as pin) {
                <li>
                  <button type="button" class="ll" [class.r]="l.side === 'right'" [class.q]="isQuiet(l.portName)" [class.under]="!!leaderCard()?.covered?.has(l.portName)"
                          [class.gold]="pin.tone === 'gold'"
                          [class.est]="!pin.resolved"
                          [class.active]="lit(l.portName)"
                          [class.sel]="inspectedPort() === l.portName"
                          [style.left.px]="l.side === 'left' ? l.rect.x : null"
                          [style.right.px]="l.side === 'right' ? frameW() - l.rect.x - l.rect.w : null"
                          [style.top.px]="l.rect.y"
                          [style.height.px]="l.rect.h"
                          [style.--w.px]="l.rect.w"
                          [style.--i]="l.index"
                          [attr.aria-pressed]="inspectedPort() === l.portName"
                          [attr.data-port]="l.portName"
                          (mouseenter)="hover(l.portName)"
                          (mouseleave)="hover(null)"
                          (focus)="hover(l.portName)"
                          (blur)="hover(null)"
                          (click)="pinInspect.emit(l.portName)">
                    <i aria-hidden="true"></i>
                    <span class="ll-t">{{ tagOf(pin).text }}</span>
                    @if (diffPorts().has(l.portName)) { <sc-holo-diff-marker /> }
                  </button>
                </li>
              }
            }
          </ol>
          @if (leaderCard(); as lc) {
            <!-- The selected part's full callout in the slot of its label. -->
            <sc-holo-callout class="leader-card" [style.left.px]="lc.left" [style.top.px]="lc.top"
              [type]="tagOf(lc.pin).type" [name]="calloutModel()?.title ?? lc.pin.label" [values]="calloutModel()?.values ?? []"
              [swappable]="calloutModel()?.swappable ?? false" [diff]="diffPorts().has(lc.pin.portName)" (swap)="portSwap.emit(lc.pin.portName)" />
          }
        }
      }
    </div>

    <!-- Dense tables (wave 5 A2.4): labels leave the pins and become a
         numbered key under the table — hover/click work like the pins. On a
         desktop with the inspector open, its hardpoint list takes this job. -->
    @if (keyMode() && viewMode() === 'holo' && !deckPlan()) {
      <ol class="pin-key" [attr.aria-label]="'codex.holo.stage.pinKey' | translate">
        @for (pin of pins(); track pin.portName) {
          <li>
            <button type="button" class="pk"
                    [class.gold]="pin.tone === 'gold'"
                    [class.active]="lit(pin.portName)"
                    [class.sel]="inspectedPort() === pin.portName"
                    (mouseenter)="hover(pin.portName)"
                    (mouseleave)="hover(null)"
                    (focus)="hover(pin.portName)"
                    (blur)="hover(null)"
                    (click)="pinInspect.emit(pin.portName)">
              <i aria-hidden="true"></i><span>{{ tagOf(pin).text }}</span>
              @if (diffPorts().has(pin.portName)) { <sc-holo-diff-marker /> }
            </button>
          </li>
        }
      </ol>
    }

    @if (viewMode() === 'holo' && pins().length > 0 && !deckPlan()) {
      <div class="legend">
        <span><i aria-hidden="true"></i>{{ 'codex.holo.stage.legendConfigurable' | translate }}</span>
        @if (hasGold()) {
          <span><i class="g" aria-hidden="true"></i>{{ 'codex.holo.stage.legendMissiles' | translate }}</span>
        }
        @if (hasUnresolved()) {
          <span><i class="u" aria-hidden="true"></i>{{ 'codex.holo.stage.legendUnresolved' | translate }}</span>
        }
        @if (diffPorts().size > 0) {
          <span class="legend-diff"><sc-holo-diff-marker />{{ 'codex.holo.table.legendDiff' | translate }}</span>
        }
        <span class="legend-hint" [class.quiet]="hintHidden()">{{ 'codex.holo.table.legendHint' | translate }}</span>
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
    /* The table takes the height the screen has: the model grows with the window. */
    .silhouette-frame { position: relative; flex: 1; width: 100%; min-height: clamp(320px, 56dvh, 640px); z-index: 1; display: flex; align-items: center;
      justify-content: center; overflow: hidden; container-type: size; --pin-inset: 56px; }
    /* Desktop: the stage gives the table exactly the height the first screen has left. */
    @media (min-width: 1001px) { .silhouette-frame { min-height: 0; } }
    /* Not what the picked Einsatz is about: quiet, still reachable. */
    .pin.q, .ll.q { opacity: 0.35; }
    /* Under the open callout: the tag steps aside (C10). */
    .ll.under, .leaders path.under { opacity: 0; visibility: hidden; pointer-events: none; }
    .pin.q:is(:hover, :focus-visible, .active, .sel), .ll.q:is(:hover, :focus-visible, .active, .sel) { opacity: 1; }
    .silhouette-frame:has(.shipwrap.dense) { --pin-inset: 40px; }
    /* Parallax (concept cine-parallax / cx-parallax): the layers sit at three
       depths and shift against each other with the pointer and the scroll —
       rings far, hull + pins mid, the projection band near. --px/--py in
       [-1, 1] come from the component; reduced motion leaves them at 0. */
    .silhouette-frame { --px: 0; --py: 0; }
    .rings, .shipwrap, .projection { transition: translate 520ms cubic-bezier(0.2, 0.7, 0.2, 1); }
    .rings { inset: -14px; translate: calc(var(--px) * -7px) calc(var(--py) * -7px); }
    .shipwrap { translate: calc(var(--px) * 9px) calc(var(--py) * 9px); }
    .projection { translate: calc(var(--px) * 15px) calc(var(--py) * 15px); }
    :host(.still) .rings, :host(.still) .shipwrap, :host(.still) .projection { translate: none; transition: none; }
    /* Rings + grid + a slow sweep: the table is a live instrument even at rest. */
    /* No frame: the rings fade out before they reach an edge. */
    .rings { position: absolute; inset: 0; pointer-events: none; z-index: 0; transition: opacity 420ms ease;
      -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 40%, transparent 100%); mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, #000 40%, transparent 100%);
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
    /* While the viewer chunk / the hull's asset row resolves, the projector already
       runs: a pulsing lock ring and a scan line rising through the air, so the stage
       is never an empty box (cx-polish: it stood empty for seconds on a cold load). */
    .mode-viewer.is-placeholder::before, .mode-viewer.is-placeholder::after { content: ''; position: absolute; pointer-events: none; }
    .mode-viewer.is-placeholder::before {
      left: 50%; top: 50%; width: 76px; height: 76px; margin: -38px 0 0 -38px; border-radius: 50%;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 60%, transparent);
      box-shadow: 0 0 22px color-mix(in srgb, var(--sc-accent) 30%, transparent), inset 0 0 14px color-mix(in srgb, var(--sc-accent) 20%, transparent);
      animation: ph-lock 1.6s var(--holo-e-io) infinite;
    }
    .mode-viewer.is-placeholder::after {
      left: 16%; right: 16%; bottom: 14%; height: 2px; border-radius: 2px;
      background: linear-gradient(90deg, transparent, var(--sc-accent), transparent);
      box-shadow: 0 0 14px var(--sc-accent);
      animation: ph-scan 2.4s var(--holo-e-io) infinite;
    }
    @keyframes ph-lock { 0%, 100% { transform: scale(0.82); opacity: 0.45; } 50% { transform: scale(1); opacity: 1; } }
    @keyframes ph-scan { 0% { bottom: 14%; opacity: 0; } 15%, 85% { opacity: 1; } 100% { bottom: 86%; opacity: 0; } }
    :host(.still) .mode-viewer.is-placeholder::before, :host(.still) .mode-viewer.is-placeholder::after { animation: none; }
    .mode-viewer.schema-sheet { padding: 14px 16px; overflow: auto; }
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
    .silhouette .hull-edges { stroke: var(--sc-accent); stroke-width: 1; opacity: 0.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
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
    /* Touch screens: a 48px hit box (the --sc-tap-min floor) around the 20px dot, re-centred so the dot stays on its anchor.
       44px measured 43px mid-reveal in the mobile gate, right on its rounding edge. */
    @media (pointer: coarse) {
      .pin { padding: 14px; margin: -24px 0 0 -24px; }
      .pin.rev { transform: translateX(calc(-100% + 48px)); }
      .pin.pos-b { transform: translateX(calc(-50% + 24px)); }
      .pin.pos-t { transform: translate(calc(-50% + 24px), calc(-100% + 48px)); }
    }
    .pin i { position: relative; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--pc);
      background: radial-gradient(circle, var(--pc) 0 3px, var(--ink) 3.5px);
      color: var(--pc); font-style: normal; display: grid; place-items: center; flex: none;
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
    .pin-label { font-family: var(--d); text-transform: uppercase; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-1);
      background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent); padding: 2px 6px; border: 1px solid var(--l1); border-radius: 2px;
      white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
      transition: border-color 160ms ease, color 160ms ease, opacity 160ms ease, visibility 160ms;
      animation: pin-label calc(var(--pin-dur) + 80ms) var(--e-out) backwards;
      animation-delay: calc(var(--pin-delay) + 90ms + min(var(--i, 1), 16) * var(--pin-step)); }
    @keyframes pin-label { from { opacity: 0; translate: 0 4px; } }
    .pin-label { display: inline-flex; align-items: center; gap: 5px; }
    .pin.sel .pin-label { max-width: 260px; }
    /* The selected part is a full callout (sc-holo-callout), the tag steps aside. */
    .shipwrap:not(.leader) .pin.sel .pin-label, .ll.sel { visibility: hidden; }
    .pin-card, .leader-card { position: absolute; z-index: 5; --co-u: clamp(0.8px, calc(0.5px + 100vw / 3840), 1px); }
    .pin-card { transform: translate(18px, -50%); }
    .pin-card.to-left { transform: translate(calc(-100% - 18px), -50%); }
    .legend-diff { display: inline-flex; align-items: center; gap: 5px; color: var(--sc-accent); }
    .pin:is(.active, :hover) .pin-label { border-color: var(--pc); color: var(--sc-fg-0); }
    .pin.sel .pin-label { color: var(--pc); border-color: var(--pc); }
    /* Dense tables keep the labels off the canvas — the key (or the
       inspector's list) carries them; hover / selection shows the pin's own. */
    .shipwrap.dense .pin-label { opacity: 0; visibility: hidden; }
    .shipwrap.dense .pin:is(.sel, .active, :hover, :focus-visible) .pin-label { opacity: 1; visibility: visible; }

    /* ── Leader lines (#642): the dot stays on its anchor, the label moves into
       a column beside the hull. Thin lines under the pins, drawn in with the
       pins' stagger; reduced motion shows them complete (the rules below). ── */
    .shipwrap.leader .pin-label { display: none; }
    .leaders { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; pointer-events: none; overflow: visible; }
    .leaders path { fill: none; stroke: color-mix(in srgb, var(--pc) 45%, transparent); stroke-width: 1; vector-effect: non-scaling-stroke;
      stroke-dasharray: 1; stroke-dashoffset: 0; --pc: var(--sc-accent);
      transition: stroke var(--holo-t-fast) ease, stroke-width var(--holo-t-fast) ease;
      animation: leader-draw calc(var(--pin-dur) + 120ms) var(--e-out) backwards;
      animation-delay: calc(var(--pin-delay) + 60ms + min(var(--i, 1), 16) * var(--pin-step)); }
    .leaders path.gold { --pc: var(--holo-gold); }
    .leaders path.est { stroke-dasharray: 0.012 0.012; animation-name: fade-in; }
    .leaders path:is(.active, .sel) { stroke: var(--pc); stroke-width: 1.5; }
    @keyframes leader-draw { from { stroke-dashoffset: 1; } }
    .leader-labels { position: absolute; inset: 0; z-index: 3; list-style: none; margin: 0; padding: 0; pointer-events: none; }
    .ll { position: absolute; pointer-events: auto; display: flex; align-items: center; gap: 5px; box-sizing: border-box;
      min-width: var(--w); max-width: var(--w); padding: 0 7px 0 3px; margin: 0; cursor: pointer; --pc: var(--sc-accent);
      font-family: var(--d); text-transform: uppercase; font-size: max(8.5px, var(--f)); letter-spacing: 0.12em; color: var(--sc-fg-1);
      background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent); border: 1px solid var(--l1); border-radius: 2px;
      transition: border-color 160ms ease, color 160ms ease, max-width var(--holo-t-base) var(--e-out);
      animation: pin-label calc(var(--pin-dur) + 80ms) var(--e-out) backwards;
      animation-delay: calc(var(--pin-delay) + 90ms + min(var(--i, 1), 16) * var(--pin-step)); }
    /* A right-column label reads toward the hull: number on the inner edge. */
    .ll.r { flex-direction: row-reverse; padding: 0 3px 0 7px; text-align: right; }
    .ll.gold { --pc: var(--holo-gold); }
    .ll i { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--pc); background: var(--pc); font-style: normal;
      flex: none; transition: background 160ms ease, color 160ms ease; opacity: 0.8; }
    .ll.est i { border-style: dashed; }
    .ll-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Hovered or lit from its pin: the tag opens toward the hull to its full text. */
    .ll:is(.active, .sel, :hover, :focus-visible) { max-width: calc(var(--w) + 180px); z-index: 1; border-color: var(--pc); color: var(--sc-fg-0); }
    .ll.sel { color: var(--pc); }
    .ll.sel i { opacity: 1; }
    .ll:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

    /* ── Key + legend under the canvas ── */
    .pin-key { position: relative; z-index: 2; list-style: none; margin: 0; padding: 8px 12px 0; display: flex; flex-wrap: wrap; gap: 4px 6px; }
    .pk { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 2px; border: 1px solid var(--l1); border-radius: 999px;
      background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); color: var(--sc-fg-1); cursor: pointer; font: inherit;
      font-size: max(9.5px, var(--f)); min-height: var(--sc-tap-min, 24px); max-width: 100%; transition: border-color 160ms ease, color 160ms ease;
      --pc: var(--sc-accent); }
    .pk:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pk i { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--pc); background: var(--pc); font-style: normal;
      flex: none; opacity: 0.8; transition: opacity 160ms ease; }
    .pk span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pk:hover, .pk.active { border-color: var(--pc); color: var(--sc-fg-0); }
    .pk.sel { border-color: var(--pc); color: var(--pc); }
    .pk.sel i { opacity: 1; }
    .legend { position: relative; z-index: 2; padding: 8px 12px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
      font-family: var(--d); text-transform: uppercase; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2); }
    .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--sc-accent); vertical-align: middle; margin-right: 4px; }
    .legend i.g { border-color: var(--holo-gold); }
    .legend i.u { border-style: dashed; border-color: var(--sc-fg-2); }
    .legend-hint { margin-inline-start: auto; transition: opacity 160ms ease; }
    /* A toast stands over the hint's corner: the hint steps back until it is gone. */
    .legend-hint.quiet { opacity: 0; }

    @media (orientation: landscape) and (max-width: 1000px) and (max-height: 600px) {
      .silhouette-frame { min-height: 320px; }
    }
    /* A phone on its side: a fixed overlay, because iPhone Safari has no Fullscreen API.
       Above the feedback launcher (1400), below dialogs and overlays (1500). */
    .silhouette-frame.phone-full { position: fixed; inset: 0; z-index: 1450; min-height: 0; width: auto; background: var(--sc-bg-0); }
    .full-close { position: absolute; z-index: 5; top: calc(8px + env(safe-area-inset-top, 0px)); right: calc(8px + env(safe-area-inset-right, 0px));
      width: 48px; height: 48px; display: grid; place-items: center; padding: 0; cursor: pointer; border-radius: 50%; color: var(--sc-fg);
      background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .full-close:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    @media (max-width: 640px) {
      .silhouette-frame, .mode-viewer { min-height: 320px; }
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
  /** The asset package viewer, once 3D shows one: the panel's part rows read it. */
  readonly assetViewer = viewChild(AssetPackageViewerComponent);
  /** The part selected on the table, as a raw port or placement id. */
  readonly selectedPart = input<string | null>(null);
  readonly swappablePorts = input<ReadonlySet<string> | null>(null);
  readonly relevantPorts = input<ReadonlySet<string> | null>(null);
  readonly calloutValues = input<readonly CalloutValue[]>([]);
  readonly calloutTitle = input<string | null>(null);
  /** Which dots the model shows; the "all parts" chip writes it. */
  readonly hotspotScope = model<HotspotScope>('swappable');
  readonly partSelected = output<PlacementSelection | null>();
  readonly partSwap = output<PlacementSelection>();
  /**
   * The swap icon of a callout that is not the 3D viewer's (Einfach, Oben, Seite, Front):
   * the port whose part to swap. The stage runs the same flow as the inspector's swap.
   */
  readonly portSwap = output<string>();
  /** Ports whose part differs from the stock loadout: their tag and callout carry the diamond (C19). */
  readonly diffPorts = input<ReadonlySet<string>>(new Set());
  /** A toast shows over the legend's corner: the "Klick = Bauteil wählen" hint hides meanwhile. */
  readonly hintHidden = input(false);
  /** The stage's component filters (null = all); the 3D model shows exactly these groups. */
  readonly partFilter = input<ReadonlySet<'weapons' | 'missiles' | 'components' | 'other'> | null>(null);
  readonly viewerGroups = computed<ReadonlySet<PlacementGroup> | null>(() => {
    const f = this.partFilter();
    if (!f) return null;
    const out = new Set<PlacementGroup>();
    if (f.has('weapons')) out.add('weapons');
    if (f.has('missiles')) out.add('missiles');
    if (f.has('components')) out.add('components');
    if (f.has('other')) {
      out.add('other');
      out.add('attachments');
    }
    return out;
  });

  private readonly i18n = inject(TranslateService);

  /** The tag of a part (C10): its TYPE ("Gatling", "Kühler"; the port category when unknown), then its size — no numbers beyond that. */
  readonly tags = computed(() => {
    const map = new Map<string, { type: string; text: string }>();
    for (const p of [...(this.labelPins() ?? []), ...this.pins()]) {
      if (map.has(p.portName)) continue;
      const held = p.section === 'weapons' || p.section === 'remoteTurrets' ? p.slot?.children?.find((c) => !!c.name) : undefined;
      const typeKey = partTypeKey(p.section, held?.className ?? p.slot?.className ?? null);
      const type = this.i18n.instant(typeKey ?? (p.section ? `codex.moduleSection.${p.section}` : 'codex.holo.stage.pinGroupOther'));
      const size = sizeOfPin(p);
      map.set(p.portName, { type, text: size != null ? `${type} S${size}` : type });
    }
    return map;
  });

  /** A callout value's short label ("Alpha", "EM"); the full label where no short one exists. */
  private shortLabel(labelKey: string): string {
    const key = shortStatKey(labelKey);
    const short = this.i18n.instant(key);
    return short && short !== key ? short : this.i18n.instant(labelKey);
  }

  tagOf(pin: StagePin): { type: string; text: string } {
    return this.tags().get(pin.portName) ?? { type: pin.label, text: pin.label };
  }

  tagAria(pin: StagePin): string {
    return `${this.tagOf(pin).text}: ${pin.label}`;
  }

  /** The pin whose part is picked, among the pins the canvas shows. */
  readonly selectedPin = computed(() => {
    const port = this.inspectedPort();
    return port ? (this.pins().find((p) => p.portName === port) ?? null) : null;
  });

  /** The callout of the picked part, one model for every view: type, name, three values, swap, diamond. */
  readonly calloutModel = computed<{ type: string; title: string; values: readonly CalloutValue[]; swappable: boolean; diff: boolean } | null>(() => {
    const port = this.inspectedPort();
    if (!port) return null;
    const pin = (this.labelPins() ?? []).find((p) => p.portName === port) ?? this.pins().find((p) => p.portName === port);
    if (!pin?.slot) return null;
    const part = partFocusOf({ slot: pin.slot, count: 1, child: null, rawPorts: [port] }, pin.section);
    const t = this.i18n;
    return {
      type: this.tagOf(pin).type,
      title: part.name ? displayItemName(part.name) : pin.label,
      values: calloutValuesOf(pin.section, part.stats, part.size, part.grade, (k) => this.shortLabel(k), t.instant('codex.holo.stage.partSize'), t.instant('codex.holo.stage.partGrade')),
      swappable: !!pin.section && isConfigurableSection(pin.section),
      diff: this.diffPorts().has(port),
    };
  });

  /** The callout's reserved gutters left and right of the model; none where the frame cannot spare them (phones). */
  readonly safeArea = computed(() => {
    const w = this.frameW();
    const gutter = typeof window === 'undefined' ? 0 : calloutGutter(window.innerWidth);
    return w >= gutter * 2 + 280 ? { left: gutter, right: gutter, top: 4, bottom: 0 } : { left: 0, right: 0, top: 4, bottom: 0 };
  });

  isQuiet(port: string): boolean {
    const lit = this.relevantPorts();
    return !!lit && lit.size > 0 && !lit.has(port);
  }

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
  /** Which drawing the schema shows. */
  readonly schemaView = input<BlueprintViewName>('top');
  /** Every pin, for the schema's labels and numbers; the canvas's own `pins` may be a subset. */
  readonly labelPins = input<readonly StagePin[] | null>(null);
  /** A deck picked by the Schema chips (null = the hull from outside). */
  readonly deckPlan = input<HoloDeckView | null>(null);
  /** D5: a room picked (or let go) on the deck plan — the bottom row's room chips follow it. */
  readonly deckRoomChange = output<string | null>();
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

  // ── Leader lines (#642) ────────────────────────────────────────────
  private readonly frameRef = viewChild<ElementRef<HTMLElement>>('frame');
  /** The projection surface's size in CSS px (0 until measured). */
  readonly frameW = signal(0);
  readonly frameH = signal(0);
  /** A phone on its side: the 3D view takes the whole screen until it is closed. */
  private readonly phoneLandscape = signal(false);
  /** Closed by the reader; turning the phone again brings it back. */
  readonly fullDismissed = signal(false);
  readonly phoneFull = computed(() => this.viewMode() === '3d' && this.phoneLandscape() && !this.fullDismissed());
  /** Touch pointer: leader labels are full tap targets, fewer fit a column. */
  private readonly coarse = signal(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  /** The port under the pointer / focus HERE — lights its pin and its label
   * together even before the host feeds the hover back as `activePorts`. */
  readonly hoverPort = signal<string | null>(null);
  /**
   * Leader-line layout for the holo surface: only when the hull has an
   * outline and at least one pin sits on its anchor. Null (the dense key /
   * labels beside the dots stay) when the frame is too small — every phone —
   * or the pins outnumber the column slots — see layoutLeaderLabels().
   */
  readonly leader = computed<LeaderLayout | null>(() => {
    const s = this.silhouette();
    if (this.viewMode() !== 'holo' || !s) return null;
    const pins = this.pins();
    if (!pins.some((p) => p.resolved)) return null;
    return layoutLeaderLabels(pins, { width: this.frameW(), height: this.frameH(), coarse: this.coarse(), hullSpan: hullSpanOf(s) });
  });
  /** The numbered key under the table: a dense table the leader layout could not take. */
  readonly keyMode = computed(() => this.dense() && !this.leader());
  readonly pinByPort = computed(() => new Map(this.pins().map((p) => [p.portName, p])));

  lit(port: string): boolean {
    return this.hoverPort() === port || this.activePorts().includes(port);
  }

  hover(port: string | null): void {
    this.hoverPort.set(port);
    this.hovered.emit(port ? [port] : null);
  }
  /** Ports the 3D model resolved to a hotspot (the viewer's `locatable`). */
  readonly locatable = output<string[]>();
  readonly previewError = output<void>();

  /** The hull, the orbit and the pins exist from the reveal on — see the class comment. */
  readonly showCanvas = computed(() => this.phase() === 'reveal' || this.phase() === 'done');
  /** The table is scrolled out of view — its loops (sweep, band, halo, ping) pause. */
  readonly offscreen = signal(false);

  /**
   * The ship's 3D asset package row: undefined while looking it up, null when
   * there is none (or the lookup failed) — the 3D view then keeps the legacy
   * model-viewer path, so hulls uploaded before packages keep working.
   */
  readonly packageRow = signal<AssetPackageRow | null | undefined>(undefined);
  private readonly packages = inject(AssetPackageService);
  private packageLookup = 0;

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    if (typeof matchMedia === 'function') {
      const landscape = matchMedia('(orientation: landscape) and (max-width: 1000px) and (max-height: 500px)');
      const syncLandscape = () => { this.phoneLandscape.set(landscape.matches); this.fullDismissed.set(false); };
      syncLandscape();
      landscape.addEventListener('change', syncLandscape);
      destroyRef.onDestroy(() => landscape.removeEventListener('change', syncLandscape));
    }
    afterNextRender(() => {
      const frame = this.frameRef()?.nativeElement;
      if (!frame) return;
      const measure = () => {
        this.frameW.set(Math.round(frame.clientWidth));
        this.frameH.set(Math.round(frame.clientHeight));
      };
      measure();
      if (typeof ResizeObserver !== 'function') return;
      // In the next frame: the size moves the callout and the tags, a write inside the callback is a
      // "ResizeObserver loop" (seen as an unhandled error after an exemplar was removed).
      let raf = 0;
      const ro = new ResizeObserver(() => { raf ||= requestAnimationFrame(() => { raf = 0; measure(); }); });
      ro.observe(frame);
      destroyRef.onDestroy(() => { ro.disconnect(); cancelAnimationFrame(raf); });
    });
    afterNextRender(() => {
      const frame = this.frameRef()?.nativeElement;
      if (frame) destroyRef.onDestroy(bindParallax(frame, () => this.still()));
    });
    afterNextRender(() => {
      if (typeof IntersectionObserver !== 'function') return;
      const io = new IntersectionObserver(([entry]) => this.offscreen.set(!entry.isIntersecting));
      io.observe(host);
      destroyRef.onDestroy(() => io.disconnect());
    });
    effect(() => {
      // The 3D view and the schema (its hardpoint positions) need the answer; the holo table never queries.
      if (this.viewMode() === 'holo') return;
      const ship = this.shipClassName();
      const token = ++this.packageLookup;
      if (!ship) {
        this.packageRow.set(null);
        return;
      }
      this.packageRow.set(undefined);
      this.packages.findRow(['ship'], ship).then(
        (row) => {
          if (token === this.packageLookup) this.packageRow.set(row);
        },
        (err: unknown) => {
          logWarn('holo-table', 'asset package lookup failed', { ship, err });
          if (token === this.packageLookup) this.packageRow.set(null);
        },
      );
    });
  }
  readonly hasGold = computed(() => this.pins().some((p) => p.tone === 'gold'));

  // ── Schema view: the ship's blueprint with its hardpoints ─────────────
  private readonly blueprints = inject(ShipBlueprintService);
  /** The full drawing, once loaded in schema mode (null = none / not yet). */
  readonly schemaBlueprint = signal<ShipBlueprint | null>(null);
  /** The ship has a drawing that is still on its way — hold the surface instead of flashing the box map. */
  readonly schemaBlueprintPending = signal(false);
  /** The package manifest, for hardpoint positions in the hull's own space. */
  private readonly schemaManifest = signal<AssetPackageManifest | null>(null);
  private schemaRequest = 0;
  private manifestRequest = 0;

  private readonly schemaEffects = [
    effect(() => {
      if (this.viewMode() !== 'schema') return;
      const ship = this.shipClassName();
      const has = !!this.blueprints.urls(ship)?.full;
      const token = ++this.schemaRequest;
      this.schemaBlueprint.set(null);
      this.schemaBlueprintPending.set(has);
      if (!has) return;
      void this.blueprints.drawing(ship, 'full').then((bp) => {
        if (token !== this.schemaRequest) return;
        this.schemaBlueprint.set(bp);
        this.schemaBlueprintPending.set(false);
      });
    }),
    effect(() => {
      const row = this.packageRow();
      const token = ++this.manifestRequest;
      this.schemaManifest.set(null);
      if (this.viewMode() !== 'schema' || !row) return;
      this.packages.manifest(row.manifestSha256).then(
        (m) => {
          if (token === this.manifestRequest) this.schemaManifest.set(m);
        },
        (err: unknown) => logWarn('holo-table', 'manifest for the schema failed', { ship: this.shipClassName(), err }),
      );
    }),
  ];

  /**
   * Hardpoints on the drawing: the package's placements (the hull's own glTF
   * space) when the ship has one, else the extractor's positions converted from
   * CryEngine space. Labels and numbers come from the stage's pins.
   */
  readonly schemaMarkers = computed(() => {
    const bp = this.schemaBlueprint();
    const view = bp ? (blueprintView(bp, this.schemaView()) ?? blueprintView(bp, 'top')) : null;
    if (!view) return [];
    const m = this.schemaManifest();
    const hardpoints = m ? schemaHardpointsFromManifest(m) : schemaHardpointsFromPayload(this.hardpointMarkers());
    const markers = placeSchemaMarkers(
      view,
      hardpoints,
      (this.labelPins() ?? this.pins()).map((p) => ({ portName: p.portName, label: p.label, index: p.index })),
    );
    // Seen from the side or the front many hardpoints share one spot: fan them
    // out so each stays a target of its own (the list keeps the exact order).
    const long = Math.max(view.box.w, view.box.h);
    const toPct = (v: number, origin: number) => ((v - origin) / long) * 100;
    const fanned = spreadStackedPins(
      markers.map((m) => ({ x: toPct(m.x, view.box.x), y: toPct(m.y, view.box.y) })),
      SCHEMA_MARKER_GAP,
    );
    const placed = markers.map((m, i) => ({
      ...m,
      x: view.box.x + (fanned[i].x / 100) * long,
      y: view.box.y + (fanned[i].y / 100) * long,
    }));
    // Oben / Seite / Front show the parts Einfach shows (C12); "Alle Teile" reveals the raw ports too.
    if (this.hotspotScope() === 'all') return placed;
    return filterSchemaMarkers(placed, this.pins().map((p) => p.portName), this.inspectedPort());
  });

  /** The callout of the part picked on the drawing or in the panel: the same card as in 3D. */
  readonly schemaCallout = computed<SchemaCallout | null>(() => {
    const port = this.inspectedPort();
    if (!port) return null;
    const model = this.calloutModel();
    if (model) return { port, title: model.title, type: model.type, values: model.values, swappable: model.swappable, diff: model.diff };
    // A raw port (Alle Teile) has no part behind it: its name is all the card says.
    const marker = this.schemaMarkers().find((m) => m.port === port);
    return marker ? { port, title: marker.label, type: null, values: [], swappable: false, diff: false } : null;
  });

  /** The selected part's label slot on the leader columns: where its full callout stands (frame px). */
  readonly leaderCard = computed(() => {
    const lay = this.leader();
    const port = this.inspectedPort();
    if (!lay || !port) return null;
    const l = lay.labels.find((k) => k.portName === port);
    const pin = this.pinByPort().get(port);
    if (!l || !pin) return null;
    const { w, h } = calloutSize(typeof window === 'undefined' ? 1920 : window.innerWidth);
    const inner = l.side === 'left' ? l.rect.x + l.rect.w : l.rect.x;
    const left = Math.min(Math.max(0, l.side === 'left' ? inner - w : inner), Math.max(0, this.frameW() - w));
    const top = Math.min(Math.max(0, l.rect.y + l.rect.h / 2 - h / 2), Math.max(0, this.frameH() - h));
    // The tags the full callout lies over step aside (C10): they hide while it is open.
    const covered = new Set<string>();
    for (const o of lay.labels) {
      if (o.portName === port) continue;
      const overX = o.rect.x < left + w && o.rect.x + o.rect.w > left;
      // `h` is the callout's reserved box; its drawn card ends a few px earlier — a tag that only grazes it stays.
      const overY = o.rect.y < top + h - 6 && o.rect.y + o.rect.h > top + 6;
      if (overX && overY) covered.add(o.portName);
    }
    return { pin, left, top, covered };
  });
}
