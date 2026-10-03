import { logWarn } from '../core/log';
import { deadlineSignal } from '../core/deadline';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ShipSkin, ShipSkinsService, skinSourceKey } from './ship-skins.service';
import type { HardpointPortRef } from './hardpoint-port-ref';
import {
  Vec3,
  hotspotPosition,
  parseGlbNodePositions,
  resolveAnchors,
} from './glb-hardpoints';
import { HOLO_FALLBACK_ACCENT, HoloMaterial, applyHologram, parseRgbToken } from './ship-hologram';
// three is already in this chunk through model-viewer (peer dependency, one copy).
import * as THREE from 'three';
import { HoloLook, countTriangles } from './holo-look';
import { manufacturerAccent } from './holo-manufacturer';

/** The slice of model-viewer's internal scene (`Symbol('scene')`) the concept look needs. */
interface ModelViewerScene {
  readonly target: THREE.Object3D;
  queueRender(): void;
}

/** model-viewer's three scene, or null when this model-viewer build hides it differently. */
export function modelViewerScene(el: object | null | undefined): ModelViewerScene | null {
  if (!el) return null;
  const sym = Object.getOwnPropertySymbols(el).find((s) => s.description === 'scene');
  const scene = sym ? ((el as Record<symbol, unknown>)[sym] as Partial<ModelViewerScene> | undefined) : undefined;
  return scene && (scene.target as THREE.Object3D | undefined)?.isObject3D && typeof scene.queueRender === 'function'
    ? (scene as ModelViewerScene)
    : null;
}

/** Scan band frame interval: 30 fps is plenty for a slow sweep. */
const LOOK_TICK_MS = 33;

// Side-effect import registers the <model-viewer> custom element. This component
// (and with it model-viewer + three, ~470 kB) is its own chunk: every page that
// shows it wraps it in a `@defer` block inside its ship-only branch, so weapon,
// armour, component and item pages never load it (AUD-048). Keep it that way —
// import HardpointPortRef from ./hardpoint-port-ref, never from this file.
import '@google/model-viewer';

/**
 * Register the SELF-HOSTED meshopt decoder (#305).
 *
 * model-viewer already bundles three's `MeshoptDecoder`, but it only wires it
 * into the loader once `meshoptDecoderLocation` is set — unset, a
 * meshopt-compressed glb fails with "setMeshoptDecoder must be called before
 * loading compressed files". Unlike `dracoDecoderLocation` there is no CDN
 * default here, so pointing it at our own copy means the decoder is genuinely
 * same-origin: no request to Google, and the 3D view keeps working on networks
 * that block third-party CDNs.
 *
 * Setting this is harmless for the Draco hulls currently in the bucket — it only
 * adds meshopt capability. That ordering is deliberate: the viewer must be able
 * to read meshopt BEFORE the uploader starts producing it, and `www.gstatic.com`
 * may only leave the CSP once no Draco hull is left to decode.
 *
 * Verified in a real browser: a meshopt hull renders with the same dimensions as
 * the Draco one (18.88 x 9.82 x 23.78 m, delta < 1 mm), decoder fetched from our
 * own origin, and unlike the Draco setter this location is NOT reset on load.
 */
function useSelfHostedMeshoptDecoder(ctor: unknown): void {
  if (ctor) {
    (ctor as { meshoptDecoderLocation?: string }).meshoptDecoderLocation =
      '/meshopt/meshopt_decoder.loader.js';
  }
}
useSelfHostedMeshoptDecoder(customElements.get('model-viewer'));
void customElements
  .whenDefined('model-viewer')
  .then((ctor) => useSelfHostedMeshoptDecoder(ctor ?? customElements.get('model-viewer')))
  .catch(() => {
    /* a model-viewer that never defines already surfaces as a model load error */
  });

type ViewMode = '3d' | 'paint';


/** One resolved hotspot, ready to hand to `<model-viewer>`. */
interface HotspotView {
  port: string;
  label: string;
  itemName: string | null;
  /** `slot` attribute; must be unique per model-viewer and start with `hotspot-`. */
  slot: string;
  /** `data-position` — model-space coordinates as a "x y z" string. */
  position: string;
}

// Only the head of a glb is needed: node transforms live in the JSON chunk,
// which precedes the (draco-compressed) binary payload. One ranged request
// keeps this off the ~3 MB the viewer itself streams.
const GLB_HEAD_BYTES = 1_048_576;
// A hanging head read ends here — markers are a bonus, not worth a stuck socket.
const GLB_HEAD_TIMEOUT_MS = 10_000;

/**
 * Per-ship livery selector with a lazy-loaded 3D <model-viewer>.
 *
 * The 3D model is the ship's hull as a hologram: geometry only (the uploader
 * ships no textures, see ship-hologram.ts), one glb per ship, hung off the
 * factory paint. Every livery shows its official store icon (the faithful CIG
 * render) — the view falls back to that paint render. Hidden entirely when a
 * ship has no skins.
 */
@Component({
  selector: 'sc-ship-skin-viewer',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  host: { '[class.holo]': 'holo()', '[class.still]': 'still()' },
  template: `
    @if (skins().length) {
      <section class="skins" [class.embedded]="embedded()">
        @if (!embedded()) {
        <header class="skins-head">
          <button
            type="button"
            class="head-toggle"
            [attr.aria-expanded]="expanded()"
            [attr.aria-label]="(expanded() ? 'codex.skins.collapse' : 'codex.skins.expand') | translate"
            (click)="toggleExpanded()"
          >
            <span class="caret" [class.open]="expanded()" aria-hidden="true">▸</span>
            <span class="ttl">{{ 'codex.skins.title' | translate }}</span>
          </button>
          <span class="src">{{ 'codex.skins.source' | translate }}</span>
        </header>
        }
        @if (expanded() || embedded()) {
        <div class="skins-body">
          <div class="stage">
            @if (!embedded()) {
            <div class="modes">
              <button
                type="button"
                [class.on]="mode() === '3d'"
                [disabled]="!current()?.modelPath"
                (click)="setMode('3d')"
              >
                {{ 'codex.skins.mode3d' | translate }}
              </button>
              <button type="button" [class.on]="mode() === 'paint'" (click)="setMode('paint')">
                {{ 'codex.skins.modePaint' | translate }}
              </button>
            </div>
            }

            @if (mode() === '3d' && modelUrl() && !modelError()) {
              <!-- keyed by skinId: Angular destroys + recreates the element on
                   skin change, so a previous skin's late (load)/(error) event
                   can never mutate the new skin's loading/error state. -->
              @for (sid of [current()?.skinId]; track sid) {
                <model-viewer
                  [class.materialised]="!modelLoading()"
                  [attr.src]="modelUrl()"
                  camera-controls
                  [attr.auto-rotate]="still() || (hotspots().length && activePorts().length) ? null : ''"
                  [attr.auto-rotate-delay]="holo() ? 2200 : null"
                  [attr.rotation-per-second]="holo() ? '14deg' : null"
                  [attr.interpolation-decay]="holo() ? 140 : null"
                  [attr.shadow-intensity]="holo() ? 0 : 1"
                  [attr.exposure]="holo() ? 1.15 : 1.0"
                  environment-image="neutral"
                  [attr.tone-mapping]="holo() ? 'neutral' : null"
                  [attr.min-camera-orbit]="holo() ? 'auto 15deg 70%' : null"
                  [attr.max-camera-orbit]="holo() ? 'auto 115deg 180%' : null"
                  [attr.disable-pan]="holo() ? '' : null"
                  camera-orbit="35deg 75deg 105%"
                  interaction-prompt="none"
                  (load)="onModelLoad($event)"
                  (error)="onModelError()"
                >
                  <!-- Component hover -> position on the hull (#256). The
                       markers come out of the model's OWN locator nodes, so a
                       ship whose glb carries none simply shows no markers. -->
                  @for (h of hotspots(); track h.port) {
                    <button
                      type="button"
                      class="hp-dot"
                      [class.on]="isActive(h.port)"
                      [attr.slot]="h.slot"
                      [attr.data-position]="h.position"
                      data-normal="0 1 0"
                      data-visibility-attribute="visible"
                      [attr.aria-label]="h.itemName ? h.label + ' — ' + h.itemName : h.label"
                      (mouseenter)="hovered.emit([h.port])"
                      (mouseleave)="hovered.emit(null)"
                      (focus)="hovered.emit([h.port])"
                      (blur)="hovered.emit(null)"
                    >
                      <span class="hp-tip">
                        {{ h.label }}
                        @if (h.itemName) {
                          <em>{{ h.itemName }}</em>
                        }
                      </span>
                    </button>
                  }
                </model-viewer>
              }
              @if (holo() && !shaderLook()) {
                <!-- Projection layer: scanlines and a slow interference band
                     over the hull — the model reads as light, not as a plastic toy.
                     Only the fallback: the concept look draws its own scan. -->
                <div class="holo-scan" aria-hidden="true"><i class="band"></i></div>
              }
              @if (modelLoading()) {
                @if (holo()) {
                  <div class="overlay holo-loading" role="status" animate.leave="holo-loading-leave">
                    <span class="holo-reticle" aria-hidden="true"><i></i><i></i><b></b></span>
                    <span class="holo-loading-label">{{ 'codex.skins.loading' | translate }}</span>
                  </div>
                } @else {
                  <div class="overlay" role="status">
                    <span class="spinner" aria-hidden="true"></span>
                    {{ 'codex.skins.loading' | translate }}
                  </div>
                }
              }
              @if (hotspots().length > 0) {
                <p class="hp-hint">
                  {{ 'codex.skins.hardpointHint' | translate: { count: hotspots().length } }}
                </p>
              }
            } @else if (mode() === '3d' && modelError()) {
              <div class="empty error" role="alert">{{ 'codex.skins.loadError' | translate }}</div>
            } @else if (iconUrl()) {
              <img class="paint-render" [src]="iconUrl()" [alt]="current()?.name || ''" />
            } @else {
              <div class="empty">{{ 'codex.skins.no3d' | translate }}</div>
            }

            @if (!embedded() && current(); as c) {
              <div class="badge">
                <strong>{{ c.name }}</strong>
                @if (c.description) {
                  <p>{{ c.description }}</p>
                }
                <span class="meta">
                  {{ sourceKey(c.source) | translate }}
                  @if (c.nameVerified) {
                    · ✓ {{ 'codex.skins.verified' | translate }}
                  }
                </span>
              </div>
            }
          </div>

          @if (!embedded()) {
          <ul class="list" role="listbox" [attr.aria-label]="'codex.skins.title' | translate">
            @for (s of skins(); track s.skinId) {
              <li
                role="option"
                tabindex="0"
                [attr.aria-selected]="s.skinId === current()?.skinId"
                [class.on]="s.skinId === current()?.skinId"
                [class.no3d]="!s.modelPath"
                (click)="select(s)"
                (keydown)="onKey($event, s)"
              >
                @if (iconFor(s); as ic) {
                  <img [src]="ic" [alt]="s.name" loading="lazy" />
                } @else {
                  <span class="noicon"></span>
                }
                <div class="meta">
                  <span class="nm">{{ s.name }}</span>
                  <span class="tags">
                    @if (s.nameVerified) {
                      <span class="tag v">{{ 'codex.skins.verified' | translate }}</span>
                    }
                    <span class="tag s">{{ sourceKey(s.source) | translate }}</span>
                  </span>
                </div>
              </li>
            }
          </ul>
          }
        </div>
        }
      </section>
    } @else if (catalogError()) {
      <section class="skins">
        <header class="skins-head">
          <h3>{{ 'codex.skins.title' | translate }}</h3>
        </header>
        <div class="catalog-error">
          <span>{{ 'codex.skins.loadCatalogError' | translate }}</span>
          <button type="button" (click)="retry()">{{ 'codex.skins.retry' | translate }}</button>
        </div>
      </section>
    }
  `,
  styles: [
    `
      .skins {
        border: 1px solid var(--border, #23262d);
        border-radius: 12px;
        overflow: hidden;
        background: var(--surface, #15171c);
      }
      /* Bare stage inside the hero card: no chrome, no border, no rounding —
         the card already provides all three. */
      .skins.embedded {
        border: 0;
        border-radius: 0;
        background: transparent;
        block-size: 100%;
      }
      .skins.embedded .skins-body,
      .skins.embedded .stage {
        block-size: 100%;
        margin: 0;
        padding: 0;
      }
      /* Embedded hides the second (thumbnail-rail) column's content, but the
         host still kept its 1.4fr/1fr grid, so the model-viewer only got
         1.4/2.4 of the card's width (measured ~340px inside a 582px frame —
         wave5 red-team). One column when embedded. */
      .skins.embedded .skins-body {
        grid-template-columns: 1fr;
      }
      /* The classic hero card (.stage-art in codex-detail.component.ts)
         already paints a background behind this viewer (.hero.stage has
         background: var(--sc-bg-1)) — the stage's own radial gradient here
         would otherwise double-paint and clip the card's art. */
      .skins.embedded .stage {
        background: transparent;
      }
      .skins-head {
        display: flex;
        align-items: baseline;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--border, #23262d);
      }
      .head-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
        padding: 0;
        background: none;
        border: 0;
        cursor: pointer;
        font: inherit;
        color: var(--sc-accent);
      }
      .head-toggle .ttl {
        font-size: 1rem;
        font-weight: 600;
      }
      .head-toggle .caret {
        display: inline-block;
        color: var(--muted, #8a92a0);
        transition: transform 0.15s ease;
      }
      .head-toggle .caret.open {
        transform: rotate(90deg);
      }
      .head-toggle:focus-visible {
        outline: 2px solid var(--sc-accent);
        outline-offset: 2px;
        border-radius: 4px;
      }
      @media (prefers-reduced-motion: reduce) {
        .head-toggle .caret {
          transition: none;
        }
      }
      .skins-head .src {
        font-size: max(0.72rem, var(--sc-fs-floor));
        color: var(--muted, #8a92a0);
      }
      .skins-body {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
      }
      @media (max-width: 720px) {
        .skins-body {
          grid-template-columns: 1fr;
        }
      }
      .stage {
        position: relative;
        min-height: 320px;
        background: radial-gradient(circle at 50% 38%, #1c2029, #0c0d10);
      }
      model-viewer,
      .paint-render {
        width: 100%;
        height: 100%;
        min-height: 320px;
        display: block;
      }
      .paint-render {
        object-fit: contain;
        padding: 1rem;
      }
      .empty {
        display: grid;
        place-items: center;
        min-height: 320px;
        color: var(--muted, #8a92a0);
        text-align: center;
        padding: 1rem;
      }
      .empty.error {
        color: var(--sc-danger);
      }
      .catalog-error {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding: 0.9rem 1rem;
        color: var(--muted, #8a92a0);
        font-size: 0.85rem;
      }
      .catalog-error button {
        background: var(--panel, #1c2330);
        color: #cdd;
        border: 1px solid var(--border, #23262d);
        border-radius: 7px;
        padding: 0.3rem 0.8rem;
        cursor: pointer;
        font: inherit;
      }
      .catalog-error button:hover {
        border-color: var(--sc-accent);
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        gap: 0.6rem;
        grid-auto-flow: row;
        color: var(--muted, #8a92a0);
        background: #0c0d10aa;
        pointer-events: none;
      }
      .spinner {
        width: 26px;
        height: 26px;
        border: 3px solid #ffffff22;
        border-top-color: var(--sc-accent);
        border-radius: 50%;
        animation: sc-spin 0.8s linear infinite;
      }
      @keyframes sc-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: none;
        }
      }
      .modes {
        position: absolute;
        right: 0.75rem;
        top: 0.6rem;
        z-index: 3;
        display: inline-flex;
        border: 1px solid var(--border, #23262d);
        border-radius: 8px;
        overflow: hidden;
      }
      .modes button {
        background: #15171cdd;
        color: #cdd;
        border: 0;
        padding: 0.35rem 0.7rem;
        cursor: pointer;
        font: inherit;
      }
      .modes button.on {
        background: var(--sc-accent);
        color: #111;
        font-weight: 600;
      }
      .modes button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .badge {
        position: absolute;
        left: 0.9rem;
        top: 0.8rem;
        max-width: 70%;
        background: #000a;
        border: 1px solid var(--border, #23262d);
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
      }
      .badge strong {
        color: var(--sc-accent);
      }
      .badge p {
        margin: 0.2rem 0 0;
        font-size: max(0.78rem, var(--sc-fs-floor));
        color: #cdd3db;
      }
      .badge .meta {
        font-size: max(0.7rem, var(--sc-fs-floor));
        color: var(--muted, #8a92a0);
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0.6rem;
        overflow: auto;
        max-height: 420px;
        border-left: 1px solid var(--border, #23262d);
      }
      .list li {
        display: flex;
        gap: 0.7rem;
        align-items: center;
        padding: 0.45rem;
        border: 1px solid var(--border, #23262d);
        border-radius: 9px;
        margin-bottom: 0.45rem;
        cursor: pointer;
      }
      .list li.on {
        border-color: var(--sc-accent);
        box-shadow: inset 0 0 0 1px var(--sc-accent);
      }
      .list li:hover {
        border-color: #3a4150;
      }
      .list li:focus-visible {
        outline: 2px solid var(--sc-accent);
        outline-offset: 1px;
      }
      .list li.no3d {
        opacity: 0.7;
      }
      .list img,
      .list .noicon {
        width: 54px;
        height: 54px;
        flex: 0 0 auto;
        border-radius: 7px;
        border: 1px solid var(--border, #23262d);
        object-fit: cover;
        background: #000;
      }
      .list .nm {
        font-size: 0.82rem;
        font-weight: 600;
      }
      .list .tags {
        display: block;
        margin-top: 0.15rem;
      }
      .tag {
        font-size: max(0.62rem, var(--sc-fs-floor));
        padding: 0.05rem 0.4rem;
        border-radius: 5px;
        margin-right: 0.3rem;
      }
      .tag.v {
        background: #173a25;
        color: #6ad28a;
      }
      .tag.s {
        background: #1c2330;
        color: #8fb0e0;
      }

      .hp-hint {
        position: absolute;
        left: 0.6rem;
        bottom: 0.5rem;
        margin: 0;
        max-width: 60%;
        font-size: max(0.64rem, var(--sc-fs-floor));
        line-height: 1.3;
        color: #7f92ab;
        pointer-events: none;
      }

      /* ── Hardpoint markers on the hull (#256) ───────────────────────
         model-viewer positions these itself via the slot/data-position
         pair; everything here is only what the dot looks like. The
         occluded state comes from the PER-HOTSPOT
         data-visibility-attribute (on the button, not on <model-viewer>),
         which makes model-viewer add data-visible while the marker is
         unoccluded — so a marker on the far side of the hull fades
         instead of floating in front of it. */
      .hp-dot {
        position: relative; /* anchors .hp-tip */
        width: 14px;
        height: 14px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid var(--sc-accent, #4da3ff);
        background: rgba(10, 14, 20, 0.75);
        cursor: pointer;
        transition: transform 0.12s ease, opacity 0.12s ease, background 0.12s ease;
      }
      /* Occluded markers recede but stay usable. model-viewer ADDS data-visible
         to an unoccluded hotspot and removes it again — so "no attribute" means
         either "behind the hull" or "the per-hotspot data-visibility-attribute
         is not wired". Dimming is therefore the most this rule may do: a version
         that also killed pointer-events turned a wiring slip into a dead
         feature (every marker faint and unclickable) instead of a cosmetic one. */
      .hp-dot:not([data-visible]) {
        opacity: 0.4;
      }
      .hp-dot:hover,
      .hp-dot:focus-visible,
      .hp-dot.on {
        background: var(--sc-accent, #4da3ff);
        transform: scale(1.45);
        outline: none;
      }
      /* A highlighted hotspot (list hover / pinned component) pulses. */
      .hp-dot.on { animation: hp-pulse 1.4s ease-in-out infinite; }
      @keyframes hp-pulse {
        0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-accent, #4da3ff) 70%, transparent); }
        50% { box-shadow: 0 0 0 9px color-mix(in srgb, var(--sc-accent, #4da3ff) 0%, transparent); }
      }
      @media (prefers-reduced-motion: reduce) { .hp-dot.on { animation: none; } }
      .hp-tip {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        transform: translateX(-50%);
        display: none;
        white-space: nowrap;
        padding: 0.2rem 0.45rem;
        border-radius: 6px;
        background: rgba(8, 11, 16, 0.94);
        border: 1px solid #2a3444;
        color: #dce6f5;
        font-size: max(0.66rem, var(--sc-fs-floor));
        pointer-events: none;
      }
      .hp-tip em {
        display: block;
        font-style: normal;
        color: #8fb0e0;
      }
      .hp-dot:hover .hp-tip,
      .hp-dot:focus-visible .hp-tip,
      .hp-dot.on .hp-tip {
        display: block;
      }

      /* ── Holotable treatment (input holo) ─────────────────────────────
         The hull is projected light: it materialises with a scan front once
         the glb is in and recoloured (never a flash of the untreated model),
         a scanline layer and a slow interference band ride over it, and the
         loader is a reticle on the table rather than a dark box with a spinner. */
      :host(.holo) .stage {
        overflow: hidden;
      }
      :host(.holo) model-viewer {
        --poster-color: transparent;
        --progress-bar-height: 0px;
        /* Hidden by opacity only, never by clip-path: model-viewer's
           visibility observer reads a fully clipped element as off screen
           and would never start downloading the glb. */
        opacity: 0;
      }
      :host(.holo) model-viewer.materialised {
        opacity: 1;
        transition: opacity var(--holo-t-base) var(--holo-e-out);
        /* The scan front runs once the model is in; then one gentle settle —
           no luminance swings (photosensitivity), and no filter at rest: a
           filter on a turning WebGL canvas would be re-rasterised every frame. */
        animation:
          holo-materialise var(--holo-t-slow) var(--holo-e-io),
          holo-settle 600ms var(--holo-e-out) 700ms backwards;
      }
      @keyframes holo-materialise {
        from { clip-path: inset(0 0 100% 0); }
        to { clip-path: inset(0 0 0 0); }
      }
      @keyframes holo-settle {
        from { filter: brightness(1.2); }
        to { filter: none; }
      }
      :host(.holo) .holo-scan {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        overflow: hidden;
        background: repeating-linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 6%, transparent) 0, transparent 1.5px 4px);
        -webkit-mask-image: radial-gradient(ellipse 62% 58% at 50% 50%, #000 40%, transparent 100%);
        mask-image: radial-gradient(ellipse 62% 58% at 50% 50%, #000 40%, transparent 100%);
      }
      /* The interference band moves by transform only; the scanlines stay put. */
      :host(.holo) .holo-scan .band {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 22%;
        will-change: transform;
        background: linear-gradient(180deg, transparent 0, color-mix(in srgb, var(--sc-accent) 9%, transparent) 50%, transparent 100%);
        animation: holo-band 7s linear infinite;
      }
      @keyframes holo-band {
        from { transform: translateY(-100%); }
        to { transform: translateY(460%); }
      }
      :host(.holo) .holo-loading {
        background: none;
        gap: 14px;
        align-content: center;
        color: var(--sc-fg-2);
        font-family: var(--sc-font-display);
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: max(10px, var(--sc-fs-floor));
        animation: holo-fade-in var(--holo-t-base) var(--holo-e-out) 120ms backwards;
      }
      .holo-loading-leave {
        animation: holo-fade-out var(--holo-t-fast) var(--holo-e-io) forwards;
      }
      @keyframes holo-fade-in { from { opacity: 0; } }
      @keyframes holo-fade-out { to { opacity: 0; } }
      .holo-reticle {
        position: relative;
        width: 64px;
        height: 64px;
        display: grid;
        place-items: center;
      }
      .holo-reticle i {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent);
        border-top-color: var(--sc-accent);
        box-shadow: 0 0 12px color-mix(in srgb, var(--sc-accent) 30%, transparent);
        animation: sc-spin 1.4s var(--holo-e-io) infinite;
      }
      .holo-reticle i + i {
        inset: 12px;
        border-top-color: color-mix(in srgb, var(--sc-accent) 30%, transparent);
        border-bottom-color: var(--sc-accent);
        animation-duration: 2.1s;
        animation-direction: reverse;
      }
      .holo-reticle b {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--sc-accent);
        box-shadow: 0 0 10px var(--sc-accent);
        animation: holo-pulse 1.4s ease-in-out infinite;
      }
      @keyframes holo-pulse { 50% { opacity: 0.35; scale: 0.7; } }
      :host(.holo) .empty.error {
        color: var(--sc-danger);
        font-family: var(--sc-font-display);
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: max(10px, var(--sc-fs-floor));
      }
      :host(.holo) .hp-dot {
        border-color: var(--sc-accent);
        background: color-mix(in srgb, var(--sc-bg-0) 80%, transparent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 14%, transparent), 0 0 10px color-mix(in srgb, var(--sc-accent) 45%, transparent);
        transition: transform var(--holo-t-fast) var(--holo-e-out), opacity var(--holo-t-fast) ease, background var(--holo-t-fast) ease, box-shadow var(--holo-t-fast) ease;
      }
      :host(.holo) .hp-tip {
        border-radius: 2px;
        background: color-mix(in srgb, var(--sc-bg-0) 92%, transparent);
        border-color: var(--sc-accent);
        color: var(--sc-fg-0);
        font-family: var(--sc-font-display);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      :host(.holo) .hp-tip em {
        color: var(--sc-fg-1);
        font-family: var(--font-monospace, monospace);
        text-transform: none;
        letter-spacing: 0;
      }
      :host(.holo) .hp-hint {
        color: var(--sc-fg-2);
      }
      /* Reduced motion: the model is simply there, nothing loops. */
      :host(.holo.still) model-viewer.materialised { transition: none; animation: none; }
      :host(.holo.still) .holo-scan .band,
      :host(.holo.still) .holo-reticle i,
      :host(.holo.still) .holo-reticle b,
      :host(.holo.still) .holo-loading { animation: none; }
      @media (prefers-reduced-motion: reduce) {
        :host(.holo) model-viewer.materialised { transition: none; animation: none; }
        :host(.holo) .holo-scan .band,
        :host(.holo) .holo-reticle i,
        :host(.holo) .holo-reticle b,
        :host(.holo) .holo-loading,
        .holo-loading-leave { animation: none; }
      }
    `,
  ],
})
export class ShipSkinViewerComponent {
  readonly shipId = input.required<string>();

  /** i18n key for a skin's source tag (AUD-188). */
  sourceKey(source: string): string {
    return skinSourceKey(source);
  }

  /**
   * Ports the detail view would like located on the hull (#256).
   *
   * The viewer resolves them against the loaded model's own locator nodes and
   * emits back the subset it could place, so the list rows only advertise a
   * marker that actually exists.
   */
  readonly hardpointPorts = input<readonly HardpointPortRef[]>([]);
  /** Raw port names currently highlighted anywhere in the detail view. */
  readonly activePorts = input<readonly string[]>([]);
  /** A marker was hovered/focused: its raw port name, or `null` on leave. */
  readonly hovered = output<string[] | null>();
  /** Ports this model can locate — drives the row affordance in the list. */
  readonly locatable = output<string[]>();

  /**
   * Render as bare stage: no header, no mode buttons, no skin list, no badge —
   * only the model. Used by the ship page's hero card, whose own 2D/3D switch
   * already owns the decision this component's chrome would duplicate.
   */
  readonly embedded = input(false);
  /**
   * Holotable treatment (the holo stage's 3D view): no ground shadow under a
   * projection, a slower turntable, softer camera damping, a scanline layer
   * and a materialise-in instead of a spinner. Off everywhere else.
   */
  readonly holo = input(false);
  /** Reduced motion: no turntable, no scan loops, the model simply appears. */
  readonly still = input(false);
  /**
   * Whether this ship has an interactive model at all. The hero switch is only
   * offered when the answer is yes, and only this component can answer it: the
   * skin catalog is what says whether a glb exists.
   */
  readonly available = output<boolean>();

  // Persist the collapsed/expanded state of the whole viewer (#137 part 2).
  // Default when the user never toggled it: expanded on desktop, collapsed on
  // mobile (the 3D stage eats a lot of vertical space on phones). The stored
  // choice then wins on every ship/page. While collapsed the body is removed
  // from the DOM, so the ~3 MB model-viewer glb is never downloaded until the
  // user opens it.
  private static readonly OPEN_KEY = 'sc.skinViewer.open';
  readonly expanded = signal<boolean>(this.initialExpanded());

  private readonly service = inject(ShipSkinsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly skins = signal<ShipSkin[]>([]);
  readonly current = signal<ShipSkin | null>(null);
  readonly mode = signal<ViewMode>('3d');
  readonly loading = signal(false); // loading the skin catalog for a ship
  readonly catalogError = signal(false); // the skin catalog query failed (vs. empty)
  readonly modelLoading = signal(false); // the current skin's glb is downloading
  readonly modelError = signal(false); // the current skin's glb failed to load

  readonly modelUrl = computed(() => this.service.assetUrl(this.current()?.modelPath));
  readonly iconUrl = computed(() => this.service.assetUrl(this.current()?.iconPath));

  // Locator nodes of the currently loaded glb: node name -> model-space
  // position. Empty until the model's head has been read, and for any model
  // that carries no named locators at all.
  private readonly nodePositions = signal<Map<string, Vec3>>(new Map());

  /** The markers to draw, in the order the detail view listed its ports. */
  readonly hotspots = computed<HotspotView[]>(() => {
    const positions = this.nodePositions();
    if (positions.size === 0) return [];
    return resolveAnchors(positions, this.hardpointPorts()).map((a, i) => ({
      port: a.port,
      label: a.label,
      itemName: a.itemName,
      // Slot names are attribute values and must be unique: the index keeps
      // them so even if two ports sanitize to the same string.
      slot: `hotspot-${i}-${a.port.replace(/[^a-zA-Z0-9_-]/g, '')}`,
      position: hotspotPosition(a.position),
    }));
  });

  isActive(port: string): boolean {
    return this.activePorts().includes(port);
  }

  // Monotonic request token: guards against a slow listSkins() for a previous
  // ship resolving after the user has already navigated to another ship.
  private reqSeq = 0;
  // Same guard for the glb head reads, which race the same way.
  private headSeq = 0;
  // The glb head read in flight — aborted when the model changes or the
  // viewer goes away, so a stale read never keeps a connection open.
  private headAbort: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.headAbort?.abort();
      this.disposeLook();
    });
    // Component highlight in the concept look follows the hovered/selected ports.
    effect(() => this.applyLookFocus());
    // React to shipId changes (router navigation between ships reuses this
    // component, so the input value changes without a new constructor call).
    effect(() => this.load(this.shipId()));
    // Locators come from whichever glb is on screen. Skins of one ship share a
    // hull, but re-reading per skin costs one cached ranged request and keeps
    // this correct if a skin ever ships its own geometry.
    effect(() => this.readLocators(this.modelUrl()));
    // Publish what the model can locate, so the list rows can offer the
    // affordance only for ports that really have a marker.
    effect(() => this.locatable.emit(this.hotspots().map((h) => h.port)));
    // Publish whether a 3D model exists at all, so the hero can offer (or not
    // offer) its 2D/3D switch. Emitted from the catalog, not from a loaded
    // model: the answer must be known before anything is downloaded.
    effect(() => this.available.emit(this.skins().some((s) => !!s.modelPath)));
  }

  /**
   * Read the loaded model's locator nodes.
   *
   * Only the head of the file is requested — node transforms live in the glb's
   * JSON chunk, ahead of the compressed geometry. A server that ignores the
   * Range header simply returns more than asked for, which parses the same.
   * Every failure path (no url, network error, unparsable container, a JSON
   * chunk larger than the window) ends in an empty map, i.e. no markers.
   */
  private readLocators(url: string | null): void {
    const seq = ++this.headSeq;
    this.headAbort?.abort();
    this.headAbort = null;
    this.nodePositions.set(new Map());
    if (!url) return;
    const ctrl = (this.headAbort = new AbortController());
    void fetch(url, {
      headers: { Range: `bytes=0-${GLB_HEAD_BYTES - 1}` },
      signal: deadlineSignal(GLB_HEAD_TIMEOUT_MS, ctrl.signal),
    })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((buf) => {
        if (seq !== this.headSeq || !buf) return; // stale — a newer model won
        this.nodePositions.set(parseGlbNodePositions(buf));
      })
      .catch((e) => {
        // Markers are a bonus: a failed head read just means no markers. An
        // abort is a deliberate cancel (ship switch), not a failure — unless
        // it is the read deadline.
        const err = e as Error | null;
        if (err?.name !== 'AbortError' || /TimeoutError/.test(err.message ?? '')) logWarn('codex', 'glb head read failed', { url, error: e });
      });
  }

  private load(id: string): void {
    const seq = ++this.reqSeq;
    this.skins.set([]);
    this.current.set(null);
    this.modelError.set(false);
    this.catalogError.set(false);
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    void this.service.listSkins(id).then((res) => {
      if (seq !== this.reqSeq) return; // stale response — a newer ship won
      this.loading.set(false);
      this.catalogError.set(res.error);
      this.skins.set(res.skins);
      const first = res.skins.find((s) => s.modelPath) ?? res.skins[0] ?? null;
      this.applySelection(first);
    });
  }

  /** Re-fetch the skin catalog after a transient load failure. */
  retry(): void {
    this.load(this.shipId());
  }

  /** Initial expanded state: stored preference wins, else viewport default. */
  private initialExpanded(): boolean {
    try {
      const saved =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(ShipSkinViewerComponent.OPEN_KEY)
          : null;
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch {
      // localStorage unavailable (private mode / SSR) — fall through to default.
    }
    // No stored choice → expanded on desktop, collapsed on mobile (≤720px,
    // matching the layout breakpoint below).
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return !window.matchMedia('(max-width: 720px)').matches;
    }
    return true;
  }

  /** Toggle the viewer open/closed and remember the choice. */
  toggleExpanded(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ShipSkinViewerComponent.OPEN_KEY, next ? '1' : '0');
      }
    } catch {
      // best-effort persistence — ignore write failures
    }
  }

  iconFor(s: ShipSkin): string | null {
    return this.service.assetUrl(s.iconPath);
  }

  select(s: ShipSkin): void {
    if (s.skinId === this.current()?.skinId) return;
    this.applySelection(s);
  }

  /** Keyboard activation for the skin list items (a11y). */
  onKey(event: KeyboardEvent, s: ShipSkin): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select(s);
    }
  }

  setMode(m: ViewMode): void {
    if (m === '3d' && !this.current()?.modelPath) return;
    this.mode.set(m);
  }

  // model-viewer lifecycle → drives the loading/error overlays.
  onModelLoad(event?: Event): void {
    this.modelLoading.set(false);
    this.modelError.set(false);
    const target = event?.target ?? null;
    // Holo stage: the concept-hologram look on model-viewer's own three scene.
    // Anywhere else, or when the scene is not reachable, the PBR hologram tint.
    if (this.holo() && this.dressModel(target)) return;
    const materials = (target as { model?: { materials?: HoloMaterial[] } } | null)?.model?.materials;
    if (materials?.length) applyHologram(materials, this.accent());
  }

  /** The concept look is on the model; the CSS scan overlay steps aside. */
  readonly shaderLook = signal(false);
  private look: HoloLook | null = null;
  private lookScene: ModelViewerScene | null = null;
  private lookRaf = 0;

  /** Put the concept-hologram look on the loaded model; false if model-viewer's scene is unreachable. */
  private dressModel(el: EventTarget | null): boolean {
    const scene = modelViewerScene(el);
    if (!scene) return false;
    this.disposeLook();
    const reduced =
      this.still() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    // Body in the app accent for every ship, rim + highlight in the manufacturer's colour.
    const base = this.accent();
    const look = new HoloLook(base, manufacturerAccent(this.shipId(), base), reduced);
    // Fit first: the hull's line detail depends on its size and triangle count.
    look.fit(new THREE.Box3().setFromObject(scene.target), countTriangles(scene.target));
    // Only the glb's own meshes (standard materials) — never a shadow plane.
    look.dress(scene.target, 'hull', (m) => !!(m.material as THREE.MeshStandardMaterial | undefined)?.isMeshStandardMaterial);
    this.look = look;
    this.lookScene = scene;
    this.shaderLook.set(true);
    this.applyLookFocus();
    scene.queueRender();
    if (look.animated) this.runLookLoop();
    return true;
  }

  /** Drive the scan band: model-viewer only redraws a dirty scene. */
  private runLookLoop(): void {
    const start = performance.now();
    let last = 0;
    const step = (now: number) => {
      this.lookRaf = 0;
      if (!this.look || !this.lookScene) return;
      if (now - last >= LOOK_TICK_MS) {
        last = now;
        this.look.tick((now - start) / 1000);
        this.lookScene.queueRender();
      }
      this.lookRaf = requestAnimationFrame(step);
    };
    this.lookRaf = requestAnimationFrame(step);
  }

  /**
   * Highlight: an active port dims the hull and lights the hull around its
   * locator. The selection API is unchanged — this only reads activePorts.
   */
  private applyLookFocus(): void {
    // Read the signals first so the effect tracks them even before a look exists.
    const active = new Set(this.activePorts());
    const positions = this.nodePositions();
    const ports = this.hardpointPorts();
    const look = this.look;
    const scene = this.lookScene;
    if (!look || !scene) return;
    const points = active.size
      ? resolveAnchors(positions, ports)
          .filter((a) => active.has(a.port))
          .map((a) => scene.target.localToWorld(new THREE.Vector3(a.position[0], a.position[1], a.position[2])))
      : [];
    look.setFocusPoints(points);
    look.setDim(points.length > 0);
    scene.queueRender();
  }

  private disposeLook(): void {
    if (this.lookRaf) cancelAnimationFrame(this.lookRaf);
    this.lookRaf = 0;
    this.look?.dispose();
    this.look = null;
    this.lookScene = null;
    this.shaderLook.set(false);
  }

  /** The theme's accent, read live so the hologram follows the design tokens. */
  private accent() {
    const token = getComputedStyle(this.host.nativeElement).getPropertyValue('--accent-primary-rgb');
    return parseRgbToken(token) ?? HOLO_FALLBACK_ACCENT;
  }
  onModelError(): void {
    this.modelLoading.set(false);
    this.modelError.set(true);
  }

  private applySelection(s: ShipSkin | null): void {
    // The keyed model-viewer is recreated for the new skin; its look goes with it.
    this.disposeLook();
    this.current.set(s);
    this.modelError.set(false);
    const has3d = !!s?.modelPath;
    this.mode.set(has3d ? '3d' : 'paint');
    this.modelLoading.set(has3d);
  }
}
