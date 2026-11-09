import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LocationStrategy } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CodexHoloCalloutComponent } from '../holo/codex-holo-callout.component';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { CodexService, type CodexKind } from '../codex.service';
import { HOLO_FALLBACK_ACCENT, parseRgbToken } from '../ship-hologram';
import { type Rgb, manufacturerAccent, rgbToken } from '../holo-manufacturer';
import { AssetPackageService } from './asset-package.service';
import type { PackageScene, ScreenPoint, StartFacing } from './asset-package-scene';
import {
  type CalloutPlacement,
  type LabelPlacement,
  MARKER_RADIUS,
  type Rect,
  type SafeArea,
  type Size,
  calloutSize,
  cycleId,
  fanOut,
  placeCallout,
  placeLabel,
} from './holo-overlay';
import {
  type AssetPackageManifest,
  type AssetPackageRow,
  DEFAULT_GROUPS,
  HOTSPOT_GROUPS,
  type HotspotScope,
  type PackagePlacement,
  type PlacementGroup,
  availableGroups,
  focusedPlacementIds,
  hotspotPlacements,
  isFreeSlot,
  isPlaced,
  isSwappable,
  listPlacements,
  placementVisible,
  placementsForPorts,
  plausibleBounds,
  scopedHotspots,
  selectablePlacements,
} from './asset-package.model';

interface ItemRef {
  readonly kind: CodexKind;
  readonly name: string;
}

export interface PlacementRow {
  readonly p: PackagePlacement;
  readonly name: string;
  readonly link: readonly string[] | null;
  /** The link as a URL, for the anchors that decide about a plain click themselves. */
  readonly href: string | null;
  readonly visible: boolean;
  readonly free: boolean;
}

/** The component label beside the hull: the selected slot, where it sits, and the leader line to it. */
export interface ComponentLabel extends LabelPlacement {
  readonly row: PlacementRow;
  /** Empty slot (no component docked): the label names the port and what it accepts. */
  readonly empty: boolean;
}

/** What the holotable learns about a selected part. */
export interface PlacementSelection {
  readonly id: string;
  readonly portName: string;
  readonly itemClass: string | null;
  readonly swappable: boolean;
}

/** One of the callout's values, already translated by the host. */
export interface CalloutValue {
  readonly label: string;
  readonly value: string;
}

/** The fixed callout beside the model, in a reserved gutter. */
export interface PartCallout extends CalloutPlacement {
  readonly row: PlacementRow;
  readonly empty: boolean;
  readonly swappable: boolean;
}

/**
 * `classic`: the codex detail pages: hover x-rays, a click navigates, the wheel zooms.
 * `table`: the holotable: hover lights, a click selects, Ctrl + wheel zooms, safe-area camera.
 */
export type ViewerInteraction = 'classic' | 'table';

/** Hover grace: the pointer may travel from a hotspot to the label without losing the selection. */
export const HOVER_GRACE_MS = 280;

/** Label size before the first measurement. */
const LABEL_SIZE_GUESS: Size = { w: 240, h: 56 };
/** How long the wheel hint stays. */
const WHEEL_HINT_MS = 2000;
/** Pixels per line for a wheel that reports lines (Firefox). */
const WHEEL_LINE_PX = 33;

/**
 * Displays one pre-built 3D asset package (ship, FPS weapon, item): root GLB +
 * shared part GLBs (+ the interior layer, lazily) composed with three.js in
 * the concept-hologram look, group and per-placement show/hide, hotspots that
 * x-ray the hull and light the hovered component in the manufacturer accent.
 * The selected slot gets a label outside the hull silhouette with a leader
 * line to it: it links to the component's codex page and steps to the other
 * slots. Lazy by construction: three is only reached through a dynamic import
 * of `asset-package-scene`.
 */
@Component({
  selector: 'sc-asset-package-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, CodexHoloCalloutComponent],
  host: { '[style.--holo-mfr-rgb]': 'mfrRgb()' },
  template: `
    <div class="pkg" [class.ready]="status() === 'ready'">
      <canvas #canvas class="stage" aria-hidden="true" (dblclick)="resetView()"></canvas>

      @if (status() === 'loading') {
        <p class="state" role="status">{{ 'codex.assetPackage.loading' | translate }}</p>
      } @else if (status() === 'error') {
        <div class="state err" role="alert">
          <p>{{ errorKey() | translate }}</p>
          <button type="button" class="sc-btn" (click)="retry()">{{ 'codex.assetPackage.retry' | translate }}</button>
        </div>
      }

      @if (status() === 'ready') {
        <div class="hotspots">
          @for (h of hotspots(); track h.p.id) {
            @if (h.link) {
              <a class="hs" [class.on]="focusSet().has(h.p.id)" [class.sel]="pinned() === h.p.id" [class.minor]="h.minor" [class.q]="h.quiet"
                 [attr.href]="h.href" [attr.aria-current]="pinned() === h.p.id ? 'true' : null"
                 [style.left.px]="h.x" [style.top.px]="h.y"
                 [attr.aria-label]="'codex.assetPackage.hotspotTip' | translate: tipParams(h)"
                 
                 (mouseenter)="focus(h.p)" (mouseleave)="blur(h.p)" (focus)="focus(h.p)" (blur)="blur(h.p)"
                 (click)="onPick($event, h)"></a>
            } @else {
              <span class="hs" tabindex="0" [attr.role]="table() ? 'button' : 'img'" [class.on]="focusSet().has(h.p.id)"
                    [class.sel]="pinned() === h.p.id" [class.minor]="h.minor" [class.q]="h.quiet"
                    [style.left.px]="h.x" [style.top.px]="h.y"
                    [attr.aria-label]="'codex.assetPackage.hotspotTip' | translate: tipParams(h)"
                    
                    (mouseenter)="focus(h.p)" (mouseleave)="blur(h.p)" (focus)="focus(h.p)" (blur)="blur(h.p)"
                    (click)="onPick($event, h)" (keydown.enter)="onPick($event, h)" (keydown.space)="onPick($event, h)"></span>
            }
          }
        </div>

        @if (hoverTag(); as t) {
          <!-- Not a tooltip bubble: it must never take the pointer from the dots around it. -->
          <span class="dot-name" [class.flip]="t.flip" [style.left.px]="t.x" [style.top.px]="t.y" aria-hidden="true">{{ t.name }}</span>
        }

        @if (callout(); as co) {
          <svg class="leader" aria-hidden="true">
            <line [attr.x1]="co.line.x1" [attr.y1]="co.line.y1" [attr.x2]="co.line.x2" [attr.y2]="co.line.y2" class="solid" />
            <circle class="ring" [attr.cx]="co.anchor.x" [attr.cy]="co.anchor.y" [attr.r]="markerRadius" />
          </svg>
          <sc-holo-callout class="callout" [attr.data-side]="co.side"
               [style.left.px]="co.left" [style.top.px]="co.top"
               [type]="calloutType()"
               [name]="co.empty ? ('codex.assetPackage.label.emptySlot' | translate) : (calloutTitle() ?? co.row.name)"
               [values]="calloutValues()" [swappable]="co.swappable" [diff]="calloutDiff()" (swap)="requestSwap()" />
        }

        @if (wheelHint()) {
          <p class="wheel-hint" role="status">{{ 'codex.assetPackage.zoomHint' | translate }}</p>
        }

        @if (label(); as l) {
          <!-- Leader line from the component (or the empty slot) to its label. -->
          <svg class="leader" aria-hidden="true">
            <line [attr.x1]="l.line.x1" [attr.y1]="l.line.y1" [attr.x2]="l.line.x2" [attr.y2]="l.line.y2" />
            <circle class="tip" [attr.cx]="l.line.x1" [attr.cy]="l.line.y1" r="3" />
          </svg>
          <div #labelBox class="clabel" role="group" [attr.data-side]="l.side" [class.empty]="l.empty"
               [style.left.px]="l.left" [style.top.px]="l.top"
               [attr.aria-label]="'codex.assetPackage.label.aria' | translate: { name: l.row.name }"
               (mouseenter)="holdLabel()" (mouseleave)="releaseLabel()"
               (focusin)="holdLabel()" (focusout)="releaseLabel()" (keydown.escape)="unpin()"
               (keydown.arrowleft)="step(-1)" (keydown.arrowright)="step(1)">
            @if (slotCount() > 1) {
              <button type="button" class="step" (click)="step(-1)"
                      [attr.aria-label]="'codex.assetPackage.label.prev' | translate"
                      [scTooltip]="'codex.assetPackage.label.prev' | translate" scTooltipTier="label">‹</button>
            }
            <div class="txt">
              @if (l.row.link) {
                <a class="nm" [routerLink]="l.row.link" (click)="onActivate($event)"
                   [attr.aria-label]="'codex.assetPackage.label.open' | translate: { name: l.row.name }">{{ l.row.name }}</a>
              } @else {
                <span class="nm">{{ l.empty ? ('codex.assetPackage.label.emptySlot' | translate) : l.row.name }}</span>
              }
              <span class="meta">{{ labelMeta(l) }}</span>
            </div>
            @if (slotCount() > 1) {
              <button type="button" class="step" (click)="step(1)"
                      [attr.aria-label]="'codex.assetPackage.label.next' | translate"
                      [scTooltip]="'codex.assetPackage.label.next' | translate" scTooltipTier="label">›</button>
            }
            @if (pinned()) {
              <button type="button" class="step close" (click)="unpin()"
                      [attr.aria-label]="'codex.assetPackage.label.close' | translate"
                      [scTooltip]="'codex.assetPackage.label.close' | translate" scTooltipTier="label">×</button>
            }
          </div>
        }

        <!-- The holotable has no chip bar of its own: the stage's filter row drives the
             groups (groupFilter) and its "Alle Teile" chip the scope (hotspotScope); a
             double click on the model resets the view. -->
        @if (!table()) {
          <div #bar class="bar" role="toolbar" [attr.aria-label]="'codex.assetPackage.groupsAria' | translate">
            @for (g of groups(); track g) {
              <button type="button" class="chip" [attr.aria-pressed]="groupsOn().has(g)" (click)="toggleGroup(g)">
                {{ 'codex.assetPackage.groups.' + g | translate }}
              </button>
            }
            <button type="button" class="chip reset-view" (click)="resetView()">
              {{ 'codex.assetPackage.resetView' | translate }}
            </button>
            @if (rows().length) {
              <button type="button" class="chip list-toggle" [attr.aria-expanded]="listOpen()" (click)="listOpen.set(!listOpen())">
                {{ 'codex.assetPackage.parts' | translate: { count: rows().length } }}
              </button>
            }
          </div>
        }

        @if (listOpen() && !table()) {
          <ul class="plist">
            @for (r of rows(); track r.p.id) {
              <li [class.off]="!r.visible" [class.on]="focusSet().has(r.p.id)">
                @if (r.free) {
                  @if (placed(r.p)) {
                    <span class="free" tabindex="0" (mouseenter)="focus(r.p)" (mouseleave)="blur(r.p)"
                          (focus)="focus(r.p)" (blur)="blur(r.p)">{{ 'codex.assetPackage.freeSlot' | translate: { types: r.p.port?.types?.join(', ') ?? '' } }}</span>
                  } @else {
                    <span class="free">{{ 'codex.assetPackage.freeSlot' | translate: { types: r.p.port?.types?.join(', ') ?? '' } }}</span>
                  }
                } @else {
                  <button type="button" class="eye" [attr.aria-pressed]="!hidden().has(r.p.id)"
                          [attr.aria-label]="(hidden().has(r.p.id) ? 'codex.assetPackage.show' : 'codex.assetPackage.hide') | translate: { name: r.name }"
                          [scTooltip]="(hidden().has(r.p.id) ? 'codex.assetPackage.show' : 'codex.assetPackage.hide') | translate: { name: r.name }"
                          scTooltipTier="label"
                          (click)="togglePlacement(r.p.id)">{{ hidden().has(r.p.id) ? '○' : '●' }}</button>
                  @if (r.link) {
                    <a class="name" [attr.href]="r.href" (mouseenter)="focus(r.p)" (mouseleave)="blur(r.p)"
                       (focus)="focus(r.p)" (blur)="blur(r.p)" (click)="onPick($event, r)">{{ r.name }}</a>
                  } @else {
                    <span class="name" tabindex="0" (mouseenter)="focus(r.p)" (mouseleave)="blur(r.p)"
                          (focus)="focus(r.p)" (blur)="blur(r.p)">{{ r.name }}</span>
                  }
                  <span class="meta">{{ 'codex.assetPackage.groups.' + r.p.group | translate }}@if (r.p.itemSize !== null) { · S{{ r.p.itemSize }} }</span>
                }
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; position: relative; min-height: 18rem; --holo-mfr: rgb(var(--holo-mfr-rgb, var(--accent-primary-rgb))); }
      .pkg { position: relative; width: 100%; height: 100%; min-height: inherit; overflow: hidden; }
      .stage { display: block; width: 100%; height: 100%; min-height: inherit; touch-action: none; }
      .state {
        position: absolute; inset: 0; display: grid; place-content: center; gap: var(--sc-gap-2);
        text-align: center; color: var(--sc-fg-2); margin: 0;
      }
      .state.err { color: var(--sc-fg-1); }
      .hotspots { position: absolute; inset: 0; pointer-events: none; }
      .hs {
        --hs-c: var(--holo-e, var(--sc-accent));
        position: absolute; width: 0.75rem; height: 0.75rem; margin: -0.375rem 0 0 -0.375rem;
        border-radius: 50%; border: 1px solid var(--hs-c); background: rgb(from var(--hs-c) r g b / 0.25);
        pointer-events: auto; transition: transform 0.15s ease, background 0.15s ease;
      }
      /* Hit area: 18px, as wide as the spacing of a fanned-out stack (holo-overlay FAN_SPACING_PX). */
      .hs::after { content: ''; position: absolute; inset: -0.1875rem; border-radius: 50%; }
      .hs:hover, .hs:focus-visible, .hs.on { background: var(--hs-c); transform: scale(1.35); outline: none; }
      .hs:focus-visible { box-shadow: 0 0 0 2px var(--sc-bg-0), 0 0 0 4px var(--hs-c); }
      /* A part that cannot be swapped: smaller dot, same hit area. The selected one is white. */
      @media (pointer: fine) {
        .hs.minor { width: 0.5rem; height: 0.5rem; margin: -0.25rem 0 0 -0.25rem; }
        .hs.minor::after { inset: -0.3125rem; }
        .hs.sel { background: var(--sc-fg-0); border-color: var(--hs-c); transform: scale(1.35); }
      }
      /* Not relevant to the picked Einsatz: quiet, but it still takes the pointer. */
      .hs.q { opacity: 0.3; }
      .hs.q:hover, .hs.q:focus-visible, .hs.q.on, .hs.q.sel { opacity: 1; }
      /* Touch: the hotspot itself is a 48px hit box (a pseudo-element extends the hit area but not
         the measured target), the 12px dot is drawn inside it. */
      @media (pointer: coarse) {
        .hs, .hs:hover, .hs:focus-visible, .hs.on {
          width: 48px; height: 48px; margin: -24px 0 0 -24px;
          border: 0; background: none; box-shadow: none; transform: none;
        }
        .hs::after { display: none; }
        .hs::before {
          content: ''; position: absolute; left: 50%; top: 50%; width: 0.75rem; height: 0.75rem; margin: -0.375rem 0 0 -0.375rem;
          box-sizing: border-box; border-radius: 50%; border: 1px solid var(--hs-c); background: rgb(from var(--hs-c) r g b / 0.25);
          transition: transform 0.15s ease, background 0.15s ease;
        }
        .hs:focus-visible::before, .hs.on::before { background: var(--sc-accent); transform: scale(1.35); }
        .hs:focus-visible::before { box-shadow: 0 0 0 2px var(--sc-bg-0), 0 0 0 4px var(--sc-accent); }
        .hs.minor::before { transform: scale(0.66); }
        .hs.sel::before { background: var(--sc-fg-0); transform: scale(1.35); }
      }
      .dot-name {
        position: absolute; transform: translate(0.875rem, -50%); pointer-events: none; white-space: nowrap;
        padding: 0.125rem var(--sc-pad-1); border-radius: 0.375rem; font-size: 0.75rem; color: var(--sc-fg-0);
        background: rgb(from var(--sc-bg-1) r g b / 0.9); border: 1px solid var(--sc-border);
      }
      .dot-name.flip { transform: translate(calc(-100% - 0.875rem), -50%); }
      .leader { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
      .leader line { stroke: var(--holo-mfr); stroke-width: 1.25; stroke-dasharray: 4 3; opacity: 0.9; }
      .leader .tip { fill: var(--holo-mfr); }
      .leader line.solid { stroke: var(--sc-accent); stroke-width: 1.4; stroke-dasharray: none; opacity: 1; }
      .leader .ring { fill: none; stroke: var(--sc-accent); stroke-width: 1.4; opacity: 0.8; }
      /* The shared callout card (sc-holo-callout): 188 wide at 1920, 0.8 of it at the narrowest (calloutSize). */
      .callout { --co-u: clamp(0.8px, calc(0.5px + 100vw / 3840), 1px); position: absolute; }
      .wheel-hint {
        position: absolute; left: 50%; top: var(--sc-pad-2); transform: translateX(-50%); margin: 0; pointer-events: none;
        padding: var(--sc-pad-1) var(--sc-pad-2); border-radius: 999px; font-size: 0.8125rem; color: var(--sc-fg-1);
        background: rgb(from var(--sc-bg-1) r g b / 0.9); border: 1px solid var(--sc-border);
      }
      .clabel {
        position: absolute; display: flex; align-items: center; gap: var(--sc-gap-1);
        width: max-content; max-width: min(22rem, calc(100% - 1rem)); padding: var(--sc-pad-1);
        background: rgb(from var(--sc-bg-1) r g b / 0.94); border: 1px solid var(--sc-accent);
        border-radius: 0.375rem; box-shadow: 0 0 0.75rem rgb(from var(--sc-accent) r g b / 0.25);
        /* The box only shows: it must not cover the hotspots beside it. Real controls take the pointer back. */
        pointer-events: none;
      }
      .clabel a.nm, .clabel .step { pointer-events: auto; }
      .clabel .txt { display: grid; flex: 1 1 auto; min-width: 0; padding: 0 var(--sc-pad-1); text-align: start; }
      .clabel .nm {
        color: var(--sc-fg-0); font-weight: 600; font-size: 0.875rem; text-decoration: none;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .clabel a.nm:hover { color: var(--sc-accent); text-decoration: underline; }
      .clabel .meta { color: var(--sc-fg-2); font-size: 0.75rem; overflow-wrap: anywhere; }
      .clabel.empty .nm { color: var(--sc-fg-1); font-style: italic; font-weight: 500; }
      .step {
        flex: none; width: 2rem; height: 2rem; display: grid; place-items: center; padding: 0;
        border: 1px solid var(--sc-border); border-radius: 0.375rem; background: transparent;
        color: var(--sc-accent); font: inherit; font-size: 1rem; line-height: 1; cursor: pointer;
      }
      .step:hover { border-color: var(--sc-accent); }
      .clabel .nm:focus-visible, .step:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      @media (pointer: coarse) { .step { width: 3rem; height: 3rem; } }
      .bar {
        position: absolute; left: var(--sc-pad-2); right: var(--sc-pad-2); bottom: var(--sc-pad-2);
        display: flex; flex-wrap: wrap; gap: var(--sc-gap-1); pointer-events: none;
      }
      .chip {
        pointer-events: auto;
        min-height: var(--sc-tap-min, 2.25rem); padding: 0 var(--sc-pad-2); border-radius: 999px;
        border: 1px solid var(--sc-border); background: rgb(from var(--sc-bg-1) r g b / 0.8);
        color: var(--sc-fg-2); font: inherit; font-size: 0.8125rem; cursor: pointer;
      }
      .chip[aria-pressed='true'], .chip[aria-expanded='true'] { border-color: var(--sc-accent); color: var(--sc-accent); }
      .chip:focus-visible, .eye:focus-visible, .name:focus-visible, .free:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .plist {
        position: absolute; top: var(--sc-pad-2); right: var(--sc-pad-2); bottom: 3.5rem;
        width: min(20rem, calc(100% - 2 * var(--sc-pad-2))); overflow: auto; margin: 0; padding: var(--sc-pad-1);
        list-style: none; background: rgb(from var(--sc-bg-1) r g b / 0.92); border: 1px solid var(--sc-border);
        border-radius: 0.5rem;
      }
      .plist li { display: flex; align-items: center; gap: var(--sc-gap-1); padding: 0.125rem 0; font-size: 0.8125rem; }
      .plist li.off .name { color: var(--sc-fg-2); text-decoration: line-through; }
      .plist li.on .name, .plist li.on .free { color: var(--sc-accent); }
      .eye {
        flex: none; width: 2rem; height: 2rem; border: 1px solid var(--sc-border); border-radius: 0.375rem;
        background: transparent; color: var(--sc-accent); cursor: pointer; font: inherit;
      }
      .name { flex: 1; min-width: 0; color: var(--sc-fg-0); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      a.name:hover { color: var(--sc-accent); }
      .meta { flex: none; color: var(--sc-fg-2); font-size: 0.75rem; }
      .free { color: var(--sc-fg-2); font-style: italic; padding-left: 2.5rem; }
      @media (prefers-reduced-motion: reduce) { .hs, .hs::before { transition: none; } }
    `,
  ],
})
export class AssetPackageViewerComponent {
  readonly row = input.required<AssetPackageRow>();
  /** Raw port names an outside list points at (hover on the holo stage's component list). */
  readonly activePorts = input<readonly string[]>([]);
  /** Reduced motion from the host page; the OS setting is honoured as well. */
  readonly still = input(false);
  /** Start view: 'nose' turns the model so its nose faces the reader (missiles). */
  readonly facing = input<StartFacing>('side');
  /** Hover, click, wheel and camera behaviour; see {@link ViewerInteraction}. */
  readonly interaction = input<ViewerInteraction>('classic');
  /** Insets the model stays out of, CSS px (table only). The chip row is reserved on top of `bottom` by the viewer itself. */
  readonly safeArea = input<Partial<SafeArea> | null>(null);
  /** Which dots show (table only); the "all parts" chip writes it too. */
  readonly hotspotScope = model<HotspotScope>('swappable');
  /** The host's rule for what can be swapped, as raw port names (table only); null: the package's own `editable` flag. */
  readonly swappablePorts = input<ReadonlySet<string> | null>(null);
  /** The selected part as a raw port name or placement id; null clears it (table only). */
  readonly selectedPort = input<string | null>(null);
  /** Ports or placement ids that stay lit, the rest goes quiet; null or empty: nothing is quiet (table only). */
  readonly relevantPorts = input<ReadonlySet<string> | null>(null);
  /** Up to three values for the selected part's callout (table only). */
  readonly calloutValues = input<readonly CalloutValue[]>([]);
  /** The part's name as the host's panel gives it (a mount's dot speaks of its gun); null: the placement's own. */
  readonly calloutTitle = input<string | null>(null);
  /** The component type the callout's header names (the port category's label; table only). */
  readonly calloutType = input<string | null>(null);
  /** The selected part differs from the stock loadout: the callout carries the diamond (table only). */
  readonly calloutDiff = input(false);
  /**
   * The groups the host's filter row shows (table only); null leaves the viewer's own set.
   * The stage's filters map: Waffen → weapons, Raketen → missiles, Komponenten → components,
   * Sonstiges → other + attachments.
   */
  readonly groupFilter = input<ReadonlySet<PlacementGroup> | null>(null);

  /** Everything the swappable ports hold: a gun on a swappable mount can be swapped too. */
  private readonly swappableIds = computed<ReadonlySet<string> | null>(() => {
    const m = this.manifest();
    const ports = this.swappablePorts();
    return m && ports?.size ? new Set(placementsForPorts(m, ports)) : null;
  });
  private swappableOf(p: PackagePlacement): boolean {
    return this.swappableIds()?.has(p.id) ?? isSwappable(p);
  }

  /** A hotspot / list entry was hovered or focused: its raw port name, or null on leave. */
  readonly hovered = output<string[] | null>();
  /** Port names this package can show — drives the "locate" affordance in the host's list. */
  readonly locatable = output<string[]>();
  /** Table: a click, keyboard or Escape changed the selected part. Not fired for a `selectedPort` change. */
  readonly selectionChange = output<PlacementSelection | null>();
  /** Table: the callout's swap icon. */
  readonly swapRequested = output<PlacementSelection>();

  private readonly service = inject(AssetPackageService);
  private readonly codex = inject(CodexService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelBox = viewChild<ElementRef<HTMLElement>>('labelBox');
  private readonly router = inject(Router);
  private readonly locationStrategy = inject(LocationStrategy);

  readonly table = computed(() => this.interaction() === 'table');
  readonly markerRadius = MARKER_RADIUS;
  readonly wheelHint = signal(false);
  private wheelHintShown = false;
  private wheelHintTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set when the anchors must be projected although the camera rests (new target, resize, load). */
  private projectDirty = true;

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly errorKey = signal('errors.generic');
  readonly manifest = signal<AssetPackageManifest | null>(null);
  readonly groupsOn = signal<ReadonlySet<PlacementGroup>>(new Set(DEFAULT_GROUPS));
  readonly hidden = signal<ReadonlySet<string>>(new Set());
  /** Hovered/focused placement (hotspot, list row, label). */
  readonly localFocus = signal<string | null>(null);
  /** Placement the label's step buttons selected; stays until closed or replaced. */
  readonly pinned = signal<string | null>(null);
  readonly listOpen = signal(false);
  /** `r, g, b` of the manufacturer accent (leader line), null = app accent. */
  readonly mfrRgb = signal<string | null>(null);
  private readonly items = signal<ReadonlyMap<string, ItemRef>>(new Map());
  private readonly points = signal<ReadonlyMap<string, ScreenPoint>>(new Map());
  private readonly silhouette = signal<Rect | null>(null);
  private readonly viewport = signal<Size>({ w: 0, h: 0 });
  private readonly labelSize = signal<Size>(LABEL_SIZE_GUESS);
  private readonly attempt = signal(0);

  private readonly zone = inject(NgZone);
  private scene: PackageScene | null = null;
  private offScreen = false;
  private tabHidden = false;
  private visObs: IntersectionObserver | null = null;
  private escapeArmed = false;
  private loadToken = 0;
  private interiorLoading = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly byId = computed(() => new Map((this.manifest()?.placements ?? []).map((p) => [p.id, p] as const)));
  readonly groups = computed(() => {
    const m = this.manifest();
    return m ? availableGroups(m) : [];
  });
  readonly visibleIds = computed(() => {
    const m = this.manifest();
    if (!m) return new Set<string>();
    const g = this.groupsOn();
    const h = this.hidden();
    const byId = this.byId();
    return new Set(m.placements.filter((p) => placementVisible(p, g, h, byId)).map((p) => p.id));
  });
  /** The slot the viewer itself points at: hover/focus first, else the pinned one. */
  readonly selectedId = computed(() => this.localFocus() ?? this.pinned());
  readonly focusIds = computed(() => {
    const m = this.manifest();
    if (!m) return [];
    if (!this.table()) return focusedPlacementIds(m, this.selectedId(), this.activePorts());
    // The selection stays lit while the pointer lights another part.
    const held = this.pinned() ? focusedPlacementIds(m, this.pinned(), []) : [];
    return [...new Set([...held, ...focusedPlacementIds(m, this.localFocus(), this.activePorts())])];
  });
  readonly focusSet = computed(() => new Set(this.focusIds()));
  /** Classic: every focus x-rays. Table: only a selection does, a hover never dims anything. */
  private readonly seeThrough = computed(() => (this.table() ? this.pinned() !== null : this.focusIds().length > 0));

  /** Parts the picked Einsatz leaves quiet. */
  readonly quietIds = computed<ReadonlySet<string>>(() => {
    const m = this.manifest();
    const keys = this.relevantPorts();
    if (!m || !this.table() || !keys?.size) return new Set();
    const lit = new Set(placementsForPorts(m, keys));
    return new Set(m.placements.filter((p) => !lit.has(p.id)).map((p) => p.id));
  });

  private readonly fullSafeArea = computed<SafeArea | null>(() => {
    if (!this.table()) return null;
    const s = this.safeArea();
    return {
      left: s?.left ?? 0,
      right: s?.right ?? 0,
      top: s?.top ?? 0,
      bottom: s?.bottom ?? 0,
    };
  });

  private readonly hrefs = computed(() => {
    const out = new Map<string, string>();
    for (const [cls, ref] of this.items()) {
      out.set(cls, this.locationStrategy.prepareExternalUrl(this.router.serializeUrl(this.router.createUrlTree(['/codex', ref.kind, cls]))));
    }
    return out;
  });

  /** Slots the label steps through (visible, positioned, filled hotspot or empty port). */
  readonly slots = computed(() => {
    const m = this.manifest();
    if (!m) return [];
    const visible = this.visibleIds();
    return selectablePlacements(m).filter((p) => visible.has(p.id));
  });
  readonly slotCount = computed(() => this.slots().length);

  readonly rows = computed<PlacementRow[]>(() => {
    const m = this.manifest();
    if (!m) return [];
    const visible = this.visibleIds();
    return listPlacements(m).map((p) => this.toRow(p, visible.has(p.id)));
  });

  readonly hotspots = computed(() => {
    const m = this.manifest();
    if (!m) return [];
    const pts = this.points();
    const visible = this.visibleIds();
    const table = this.table();
    const quiet = this.quietIds();
    const shown: { p: PackagePlacement; id: string; x: number; y: number }[] = [];
    for (const p of table ? scopedHotspots(m, this.hotspotScope(), this.swappablePorts()) : hotspotPlacements(m)) {
      const pt = pts.get(p.id);
      if (!pt?.onScreen || !visible.has(p.id)) continue;
      shown.push({ p, id: p.id, x: pt.x, y: pt.y });
    }
    // Stacked dots fan out around their centroid (screen position only, never hover state).
    const fanned = fanOut(shown);
    const out = shown.map((h) => {
      const at = fanned.get(h.id) ?? h;
      return { ...this.toRow(h.p, true), x: at.x, y: at.y };
    });
    if (table) {
      // A part out of scope the panel points at gets its dot where it is: the others keep their places.
      const has = new Set(shown.map((h) => h.id));
      for (const id of this.focusIds()) {
        const p = this.byId().get(id);
        const pt = pts.get(id);
        if (!p || has.has(id) || !pt?.onScreen || !visible.has(id) || !p.itemClass || !HOTSPOT_GROUPS.has(p.group)) continue;
        out.push({ ...this.toRow(p, true), x: pt.x, y: pt.y });
      }
    }
    return out.map((h) => ({ ...h, minor: table && !this.swappableOf(h.p), quiet: quiet.has(h.p.id) }));
  });

  /**
   * Where the selected part sits on screen, CSS px inside the viewer (its dot
   * when it has one, fanned out or not). Updates with the camera only; reading
   * it costs nothing while the camera rests.
   */
  readonly selectionAnchor = computed<ScreenPoint | null>(() => {
    const id = this.pinned();
    if (!id) return null;
    const dot = this.hotspots().find((h) => h.p.id === id);
    if (dot) return { x: dot.x, y: dot.y, onScreen: true };
    return this.points().get(id) ?? null;
  });

  /** The name beside the dot under the pointer (table: the selected part has its callout instead). */
  readonly hoverTag = computed(() => {
    const id = this.localFocus();
    if (!this.table() || !id || id === this.pinned()) return null;
    const dot = this.hotspots().find((h) => h.p.id === id);
    return dot ? { x: dot.x, y: dot.y, name: dot.name, flip: dot.x > this.viewport().w / 2 } : null;
  });

  /** The callout in its gutter; null without a selection or when no gutter holds it. */
  readonly callout = computed<PartCallout | null>(() => {
    if (!this.table()) return null;
    const id = this.pinned();
    const p = id ? this.byId().get(id) : undefined;
    const anchor = this.selectionAnchor();
    const vp = this.viewport();
    const safe = this.fullSafeArea();
    if (!p || !anchor || !safe || vp.w <= 0 || vp.h <= 0) return null;
    const placed = placeCallout(anchor, calloutSize(window.innerWidth), vp, safe);
    return placed && { ...placed, row: this.toRow(p, true), empty: !p.itemClass, swappable: this.swappableOf(p) };
  });

  /** The placement the label describes: the viewer's own selection, else the first one the host points at. */
  readonly labelTarget = computed<PackagePlacement | null>(() => {
    const id = this.table() ? this.pinned() : (this.selectedId() ?? this.focusIds()[0] ?? null);
    const p = id ? this.byId().get(id) : undefined;
    return p && isPlaced(p) ? p : null;
  });

  /** Label + leader line, laid out beside the projected hull and clamped to the viewer. The table has its callout instead. */
  readonly label = computed<ComponentLabel | null>(() => {
    if (this.table()) return null;
    const p = this.labelTarget();
    const vp = this.viewport();
    if (!p || vp.w <= 0 || vp.h <= 0) return null;
    const pt = this.points().get(p.id);
    if (!pt) return null;
    const placement = placeLabel(pt, this.silhouette(), this.labelSize(), vp);
    return { ...placement, row: this.toRow(p, true), empty: !p.itemClass };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.loadToken++;
      this.clearGrace();
      if (this.wheelHintTimer) clearTimeout(this.wheelHintTimer);
      this.host.nativeElement.removeEventListener('wheel', this.onWheel, { capture: true });
      this.resizeObs?.disconnect();
      this.visObs?.disconnect();
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.armEscape(false);
      this.scene?.dispose();
      this.scene = null;
    });
    this.tabHidden = document.visibilityState === 'hidden';
    document.addEventListener('visibilitychange', this.onVisibility);
    // Capture on the host: it covers the dots and chips over the canvas too, and
    // it runs before OrbitControls' own listener, which cancels every wheel it sees.
    this.zone.runOutsideAngular(() =>
      this.host.nativeElement.addEventListener('wheel', this.onWheel, { capture: true, passive: false }),
    );
    if (typeof IntersectionObserver === 'function') {
      this.visObs = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last) this.setOffScreen(!last.isIntersecting);
      });
      this.visObs.observe(this.host.nativeElement);
    }
    // Escape clears a pin / hover label only while there is one to clear.
    effect(() => {
      const active = this.selectedId() !== null;
      untracked(() => this.armEscape(active));
    });

    effect(() => {
      const row = this.row();
      this.attempt();
      untracked(() => void this.load(row));
    });
    effect(() => {
      const visible = this.visibleIds();
      const interiorOn = this.groupsOn().has('interior');
      untracked(() => {
        this.scene?.setVisibility(visible, interiorOn);
        if (interiorOn) void this.ensureInterior();
      });
    });
    effect(() => {
      const ids = this.focusIds();
      const seeThrough = this.seeThrough();
      this.labelTarget();
      untracked(() => {
        this.scene?.setFocus(ids, seeThrough);
        this.projectDirty = true;
        this.reproject();
      });
    });
    effect(() => {
      const quiet = this.quietIds();
      untracked(() => this.scene?.setQuiet(quiet));
    });
    effect(() => {
      // The stage's filter row drives the groups; the viewer has no chips of its own in the table.
      const filter = this.groupFilter();
      if (!filter || !this.table()) return;
      const next = new Set<PlacementGroup>(filter);
      untracked(() => this.groupsOn.set(next));
    });
    effect(() => {
      const safe = this.fullSafeArea();
      untracked(() => this.scene?.setSafeArea(safe));
    });
    // The host's selection: already meant when the current pin answers to the name.
    effect(() => {
      const want = this.selectedPort();
      const m = this.manifest();
      if (!this.table()) return;
      untracked(() => {
        if (!want) {
          this.pinned.set(null);
          return;
        }
        const cur = this.pinned();
        if (!m || (cur && [cur.toLowerCase(), this.byId().get(cur)?.portName.toLowerCase()].includes(want.toLowerCase()))) return;
        const key = want.toLowerCase();
        const hit = m.placements.find((p) => p.id.toLowerCase() === key) ?? m.placements.find((p) => p.portName.toLowerCase() === key);
        this.pinned.set(hit?.id ?? null);
      });
    });
  }

  private resizeObs: ResizeObserver | null = null;

  private toRow(p: PackagePlacement, visible: boolean): PlacementRow {
    const ref = p.itemClass ? this.items().get(p.itemClass) : undefined;
    return {
      p,
      name: ref?.name || p.itemClass || p.portName,
      link: ref && p.itemClass ? ['/codex', ref.kind, p.itemClass] : null,
      href: p.itemClass ? (this.hrefs().get(p.itemClass) ?? null) : null,
      visible,
      free: !p.itemClass && isFreeSlot(p),
    };
  }

  /** The list row of a placement. */
  toRowFor(p: PackagePlacement): PlacementRow {
    return this.toRow(p, this.visibleIds().has(p.id));
  }

  tipParams(r: PlacementRow): Record<string, string> {
    return {
      name: r.name,
      type: typeOf(r.p) || '–',
      size: r.p.itemSize === null ? '–' : String(r.p.itemSize),
    };
  }

  /** Second label line: size + type of a component; port name + accepted types of an empty slot. */
  labelMeta(l: ComponentLabel): string {
    const p = l.row.p;
    if (l.empty) {
      const types = p.port?.types?.join(', ') ?? '';
      const size = p.port?.maxSize !== null && p.port?.maxSize !== undefined ? `S${p.port.maxSize}` : '';
      return [p.portName, size, types].filter(Boolean).join(' · ');
    }
    return [p.itemSize !== null ? `S${p.itemSize}` : '', typeOf(p)].filter(Boolean).join(' · ');
  }

  placed(p: PackagePlacement): boolean {
    return isPlaced(p);
  }

  toggleGroup(g: PlacementGroup): void {
    const next = new Set(this.groupsOn());
    if (next.has(g)) next.delete(g);
    else next.add(g);
    this.groupsOn.set(next);
  }

  togglePlacement(id: string): void {
    const next = new Set(this.hidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.hidden.set(next);
  }

  focus(p: PackagePlacement): void {
    this.clearGrace();
    this.localFocus.set(p.id);
    this.hovered.emit([p.portName]);
  }

  /** Leaving a hotspot/row: the selection lingers briefly so the pointer can reach the label. */
  blur(p: PackagePlacement): void {
    if (this.localFocus() !== p.id) return;
    if (this.table()) {
      // No label to travel to on the table: the light goes with the pointer.
      this.localFocus.set(null);
      this.hovered.emit(null);
      return;
    }
    this.scheduleClear();
  }

  /** Pointer/focus entered the label: keep its slot selected. */
  holdLabel(): void {
    this.clearGrace();
  }

  /** Pointer/focus left the label. */
  releaseLabel(): void {
    if (this.localFocus()) this.scheduleClear();
  }

  /** Step to the previous/next slot (pins it, so it stays without hover). */
  step(dir: 1 | -1): void {
    const slots = this.slots();
    const current = this.labelTarget()?.id ?? null;
    const id = cycleId(
      slots.map((p) => p.id),
      current,
      dir,
    );
    const p = id ? this.byId().get(id) : undefined;
    if (!p) return;
    this.clearGrace();
    this.localFocus.set(null);
    this.pinned.set(p.id);
    this.hovered.emit([p.portName]);
  }

  /** Drop the pinned slot (close button / Escape). */
  unpin(): void {
    if (!this.pinned()) return;
    this.pinned.set(null);
    if (!this.localFocus()) this.hovered.emit(null);
  }

  /** The anchor navigates on its own; a plain left click also drops the x-ray before the route changes. */
  onActivate(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    this.clearGrace();
    this.localFocus.set(null);
    this.pinned.set(null);
  }

  /**
   * A dot or list row was activated. A modified click (new tab, new window) stays
   * the browser's. A plain one selects on the table and navigates elsewhere.
   */
  onPick(ev: Event, r: PlacementRow): void {
    if (ev instanceof MouseEvent && !isPlainLeftClick(ev)) return;
    if (this.table()) {
      ev.preventDefault();
      this.select(r.p);
      return;
    }
    ev.preventDefault();
    if (!r.link) return;
    this.onActivate(ev as MouseEvent);
    void this.router.navigate(r.link);
  }

  /** Select a part and hold it until replaced, or until Escape or the host clears it. */
  select(p: PackagePlacement): void {
    this.clearGrace();
    this.setPinned(p.id);
  }

  private setPinned(id: string | null): void {
    if (this.pinned() === id) return;
    this.pinned.set(id);
    if (!this.table()) return;
    const p = id ? this.byId().get(id) : undefined;
    this.selectionChange.emit(p ? { ...selectionOf(p), swappable: this.swappableOf(p) } : null);
  }

  /** The callout's swap icon. */
  requestSwap(): void {
    const id = this.pinned();
    const p = id ? this.byId().get(id) : undefined;
    if (p) this.swapRequested.emit({ ...selectionOf(p), swappable: this.swappableOf(p) });
  }

  toggleAllParts(): void {
    this.hotspotScope.set(this.hotspotScope() === 'all' ? 'swappable' : 'all');
  }

  /**
   * Current screen position of any placed part, CSS px inside the viewer, for a
   * host that draws its own line. Null before the model is ready.
   */
  anchorOf(id: string): ScreenPoint | null {
    return this.scene?.project([id]).get(id) ?? null;
  }

  /**
   * Table: the wheel belongs to the page. It is never cancelled, so every notch
   * scrolls, whichever element lies under the pointer; only Ctrl/Cmd + wheel
   * (a trackpad pinch reports the same) zooms the model.
   */
  private readonly onWheel = (ev: WheelEvent): void => {
    if (!this.table() || !this.scene) return;
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      this.scene.zoomBy(ev.deltaMode === WheelEvent.DOM_DELTA_LINE ? ev.deltaY * WHEEL_LINE_PX : ev.deltaY);
      return;
    }
    this.flashWheelHint();
  };

  /** Once per viewer: the first wheel without Ctrl says how to zoom. */
  private flashWheelHint(): void {
    if (this.wheelHintShown) return;
    this.wheelHintShown = true;
    this.wheelHint.set(true);
    this.wheelHintTimer = setTimeout(() => this.wheelHint.set(false), WHEEL_HINT_MS);
  }

  /** Back to the initial camera framing (chip / double click on the model). */
  resetView(): void {
    const m = this.manifest();
    if (m) this.scene?.frame(this.frameBounds(m), this.facing());
  }

  private frameBounds(m: AssetPackageManifest) {
    return plausibleBounds(m.root?.bounds);
  }

  /**
   * Escape drops the pin / hover label. The listener sits on the document in the
   * capture phase and only exists while a slot is selected; it swallows the key
   * only when it really cleared something, so otherwise the stage's own Escape
   * (close the inspector) is untouched. A dialog above the viewer owns Escape.
   */
  private armEscape(on: boolean): void {
    if (on === this.escapeArmed) return;
    this.escapeArmed = on;
    if (on) document.addEventListener('keydown', this.onEscape, true);
    else document.removeEventListener('keydown', this.onEscape, true);
  }

  private readonly onEscape = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]');
    const top = dialogs.item(dialogs.length - 1);
    if (top && !top.contains(this.host.nativeElement)) return;
    if (this.clearSelection()) ev.stopImmediatePropagation();
  };

  /** Drop pin and hover selection; true when there was one. */
  clearSelection(): boolean {
    if (!this.pinned() && !this.localFocus()) return false;
    this.clearGrace();
    this.localFocus.set(null);
    this.setPinned(null);
    this.hovered.emit(null);
    return true;
  }

  private readonly onVisibility = (): void => {
    this.tabHidden = document.visibilityState === 'hidden';
    this.scene?.setPaused(this.offScreen || this.tabHidden);
  };

  private setOffScreen(off: boolean): void {
    this.offScreen = off;
    this.scene?.setPaused(this.offScreen || this.tabHidden);
  }

  retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private scheduleClear(): void {
    this.clearGrace();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (!this.localFocus()) return;
      this.localFocus.set(null);
      this.hovered.emit(this.pinned() ? [this.byId().get(this.pinned()!)?.portName ?? this.pinned()!] : null);
    }, HOVER_GRACE_MS);
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  private reducedMotion(): boolean {
    return this.still() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  private async load(row: AssetPackageRow): Promise<void> {
    const token = ++this.loadToken;
    this.status.set('loading');
    this.scene?.dispose();
    this.scene = null;
    this.interiorLoading = false;
    this.setPinned(null);
    this.projectDirty = true;
    try {
      const m = await this.service.manifest(row.manifestSha256);
      if (token !== this.loadToken) return;
      const { PackageScene } = await import('./asset-package-scene');
      if (token !== this.loadToken) return;
      const base: Rgb =
        parseRgbToken(getComputedStyle(this.host.nativeElement).getPropertyValue('--accent-primary-rgb')) ??
        HOLO_FALLBACK_ACCENT;
      // Body in the app accent for every ship, accents in the manufacturer's colour.
      const accent = manufacturerAccent(row.shipId ?? row.entityClass, base);
      this.mfrRgb.set(rgbToken(accent));
      // The frame loop (rAF, damping) runs outside Angular: only signal writes reach the UI.
      const scene = this.zone.runOutsideAngular(
        () =>
          new PackageScene(
            this.canvas().nativeElement,
            base,
            accent,
            this.reducedMotion(),
            () => this.reproject(),
            (fn) => this.zone.runOutsideAngular(fn),
          ),
      );
      this.scene = scene;
      scene.setPaused(this.offScreen || this.tabHidden);
      this.observeSize(scene);
      scene.setSafeArea(this.fullSafeArea());

      const urls = this.service.urls;
      if (m.root) await scene.setRoot(await this.service.glb(urls.root(m.kind, m.root.sha256)));
      const shas = [...new Set(m.placements.filter((p) => p.partSha256 && p.position).map((p) => p.partSha256!))];
      // A single broken part must not take the whole package down.
      await Promise.all(
        shas.map(async (sha) => {
          try {
            await scene.addPart(sha, await this.service.glb(urls.part(sha)));
          } catch (err) {
            logWarn('asset-package', 'part failed', { sha, err });
          }
        }),
      );
      if (token !== this.loadToken) return;
      scene.place(m.placements);
      this.manifest.set(m);
      scene.setVisibility(this.visibleIds(), this.groupsOn().has('interior'));
      scene.frame(this.frameBounds(m), this.facing());
      scene.setFocus(this.focusIds(), this.seeThrough());
      scene.setQuiet(this.quietIds());
      this.status.set('ready');
      this.locatable.emit(hotspotPlacements(m).map((p) => p.portName));
      void this.resolveItems(m);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.errorKey.set(toErrorKey('asset-package', 'load', err, { manifest: row.manifestSha256 }));
      this.status.set('error');
    }
  }

  private async ensureInterior(): Promise<void> {
    const m = this.manifest();
    const scene = this.scene;
    if (!m?.interior || !scene || scene.hasInterior() || this.interiorLoading) return;
    this.interiorLoading = true;
    try {
      await scene.setInterior(await this.service.glb(this.service.urls.interior(m.interior.sha256)));
      scene.setVisibility(this.visibleIds(), this.groupsOn().has('interior'));
    } catch (err) {
      logWarn('asset-package', 'interior failed', { err });
    } finally {
      this.interiorLoading = false;
    }
  }

  private async resolveItems(m: AssetPackageManifest): Promise<void> {
    const classes = m.placements.map((p) => p.itemClass).filter((c): c is string => !!c);
    try {
      const res = await this.codex.resolveEntities(classes);
      const map = new Map<string, ItemRef>();
      for (const [cls, e] of res) map.set(cls, { kind: e.kind, name: e.nameLocalized ?? cls });
      this.items.set(map);
    } catch (err) {
      // Names and links are an enrichment; the model stays usable without them.
      logWarn('asset-package', 'resolve items failed', { err });
    }
  }

  private observeSize(scene: PackageScene): void {
    this.resizeObs?.disconnect();
    const el = this.canvas().nativeElement;
    const apply = () => {
      this.projectDirty = true;
      scene.resize(el.clientWidth, el.clientHeight);
    };
    apply();
    if (typeof ResizeObserver === 'function') {
      this.resizeObs = new ResizeObserver(apply);
      this.resizeObs.observe(el);
    }
  }

  /**
   * Per frame: hotspot and label anchors, the hull's screen rectangle, the
   * viewer and label sizes. The look animates every frame, the camera mostly
   * does not: the anchors are only projected after it moved or a target
   * changed, and signals only change when a value did.
   */
  private reproject(): void {
    const m = this.manifest();
    const scene = this.scene;
    if (!m || !scene) return;
    if (scene.viewChanged() || this.projectDirty) {
      this.projectDirty = false;
      const ids = hotspotPlacements(m).map((p) => p.id);
      const target = this.labelTarget();
      if (target && !ids.includes(target.id)) ids.push(target.id);
      const next = scene.project(ids);
      if (!samePoints(this.points(), next)) this.points.set(next);
      const sil = scene.silhouette();
      if (!sameRect(this.silhouette(), sil)) this.silhouette.set(sil);
      const el = this.canvas().nativeElement;
      const vp = { w: el.clientWidth, h: el.clientHeight };
      if (!sameSize(this.viewport(), vp)) this.viewport.set(vp);
    }
    const box = this.labelBox()?.nativeElement;
    if (box) {
      const size = { w: box.offsetWidth, h: box.offsetHeight };
      if (size.w > 0 && !sameSize(this.labelSize(), size)) this.labelSize.set(size);
    }
  }
}

function selectionOf(p: PackagePlacement): PlacementSelection {
  return { id: p.id, portName: p.portName, itemClass: p.itemClass, swappable: isSwappable(p) };
}

function typeOf(p: PackagePlacement): string {
  return [p.itemType, p.itemSubType].filter((t) => t && t !== 'UNDEFINED').join(' / ');
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

function samePoints(a: ReadonlyMap<string, ScreenPoint>, b: ReadonlyMap<string, ScreenPoint>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, p] of b) {
    const q = a.get(id);
    if (!q || q.onScreen !== p.onScreen || !near(q.x, p.x) || !near(q.y, p.y)) return false;
  }
  return true;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return near(a.left, b.left) && near(a.top, b.top) && near(a.right, b.right) && near(a.bottom, b.bottom);
}

function sameSize(a: Size, b: Size): boolean {
  return a.w === b.w && a.h === b.h;
}
