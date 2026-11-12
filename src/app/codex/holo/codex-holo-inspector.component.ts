import { LocationStrategy } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LayoutChild, LayoutSlot, LayoutTarget } from '../codex-hardpoint-layout.component';
import { formatEquippedStat } from '../codex-equipped-stats';
import type { EquippedStat } from '../codex-equipped-stats';
import { displayItemName } from '../codex-format';
import { CodexService, manufacturerLabel, toLang } from '../codex.service';
import type { CodexKind } from '../codex.service';
import type { ShipModuleSection } from '../ship-module-sections';
import type { PlacementRow } from '../asset-package/asset-package-viewer.component';
import { resolveIcons } from '../search/search-cta';
import type { SearchRowIcons } from '../search/search-result-model';
import type { PolyHitKind } from '../codex-poly-search';
import { ItemPathComponent } from '../../shared/item-path/item-path.component';
import { isPlainLeftClick } from '../../core/modified-click.util';
import type { PortPinBadge } from './codex-holo-patch.component';
import { PinGroup, StagePin } from './codex-holo-model';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HoloDiffMarkerComponent } from './holo-diff-marker';
import { partTypeKey } from './holo-callout-values';

/** Stat names too long for a third of the card get a short form; the rest keep their own label. */
const SHORT_STAT: Readonly<Record<string, string>> = { projectileSpeed: 'codex.holo.stage.statShort.projectileSpeed' };
function shortStatKey(key: string): string {
  return SHORT_STAT[key.slice(key.lastIndexOf('.') + 1)] ?? key;
}

/** The part the panel talks about: what a pilot asks about, the gun rather than its mount. */
export interface PartFocus {
  readonly name: string | null;
  readonly size: number | null;
  readonly typeLabel: string | null;
  readonly manufacturerCode: string | null;
  readonly grade: string | null;
  readonly stats: readonly EquippedStat[];
  readonly className: string | null;
  readonly kind: CodexKind | null;
  /** What „Bauteil tauschen“ and the details dialog act on. */
  readonly target: LayoutTarget;
  /** The other things of this hardpoint: the mount around the gun, a rack's load. */
  readonly mount: LayoutSlot | null;
  readonly others: readonly LayoutChild[];
}

/** The same dotted `parent.child` target the ports list emits for a sub-slot. */
export function childTargetOf(it: LayoutTarget, kid: LayoutChild): LayoutTarget {
  const kids = kid.rawPorts.length > 0 ? kid.rawPorts : [kid.port];
  return { slot: it.slot, count: kid.count, child: kid, rawPorts: it.rawPorts.flatMap((p) => kids.map((k) => `${p}.${k}`)) };
}

/** A gun mount speaks through the gun it holds, the same rule the pin label follows; every other slot through itself. */
export function partFocusOf(it: LayoutTarget, section: ShipModuleSection | null): PartFocus {
  const kids = it.slot.children ?? [];
  const held = section === 'weapons' ? kids.find((c) => !!c.name) : undefined;
  if (held) {
    return {
      name: held.name,
      size: held.size,
      typeLabel: held.typeLabel,
      manufacturerCode: held.manufacturerCode ?? null,
      grade: held.grade ?? null,
      stats: held.stats ?? [],
      className: held.className,
      kind: held.kind,
      target: childTargetOf(it, held),
      mount: it.slot,
      others: kids.filter((k) => k !== held),
    };
  }
  return {
    name: it.slot.name,
    size: it.slot.size ?? it.slot.portSize ?? null,
    typeLabel: it.slot.typeLabel ?? null,
    manufacturerCode: it.slot.manufacturerCode,
    grade: it.slot.grade,
    stats: it.slot.stats ?? [],
    className: it.slot.className,
    kind: it.slot.kind,
    target: it,
    mount: null,
    others: kids,
  };
}

/** What a list chip says about the size: the held gun's for a mount, else the slot's. */
function chipSize(pin: StagePin): number | null {
  const slot = pin.slot;
  if (!slot) return null;
  const held = pin.section === 'weapons' ? slot.children?.find((c) => !!c.name) : undefined;
  return held?.size ?? slot.size ?? slot.portSize ?? null;
}

/**
 * The Holotable panel's Bauteile tab: the parts as chips by block (the look of
 * the list that used to sit under the model), or the selected part with its
 * values, its standard icons, the swap and a preview of its detail page. Below
 * "Alle Teile" the list shows every part of the package with its eye toggle.
 *
 * Purely presentational apart from the standard icons: the stage resolves the
 * target and owns every write to the loadout.
 */
@Component({
  selector: 'sc-codex-holo-inspector',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, RouterLink, ItemPathComponent, HoloDiffMarkerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target(); as it) {
      <!-- Keyed on the port: every new part re-enters with the card animation. -->
      @for (key of [inspectedPort()]; track key) {
        @if (focusPart(); as part) {
        <div class="inspector" role="region" [attr.aria-label]="'codex.holo.stage.tab.parts' | translate">
          <div class="insp-top">
            <button type="button" class="back inspector-close" (click)="closed.emit()" [scTooltip]="'codex.holo.stage.backHint' | translate" scTooltipTier="label">‹ {{ 'codex.holo.stage.backToParts' | translate }}</button>
          </div>
          <div class="pn">
            <h2>@if (isChanged(inspectedPort())) { <sc-holo-diff-marker class="dm" /> }{{ part.name ? itemName(part.name) : ((it.slot.emptyLabelKey ?? 'codex.holo.stage.emptyBay') | translate) }}</h2>
            <small>{{ partMeta(part) }}</small>
          </div>
          @if (patchPin(); as pin) {
            <!-- The per-PORT occupant delta for the part under inspection. -->
            <p class="inspector-patch-delta" [class.unresolved]="pin.unresolved">
              <span [scTooltip]="pin.fromClassName ?? ''">{{ pinName(pin.fromClassName) }}</span> →
              @if (pin.unresolved) {
                {{ 'codex.holo.pinUnresolved' | translate }}
              } @else {
                <span [scTooltip]="pin.toClassName ?? ''">{{ pinName(pin.toClassName) }}</span>
              }
            </p>
          }
          @if (partValues(part).length > 0) {
            <dl class="insp-stats">
              @for (v of partValues(part); track v.key) {
                <div><dt>{{ v.key | translate }}</dt><dd>{{ v.value }}</dd></div>
              }
            </dl>
          }
          @if (it.slot.draftState; as ds) {
            <p class="insp-draft">
              <span class="tag draft" [class.pending]="ds === 'pending'" [class.unresolved]="ds === 'unresolved'">{{ ('codex.loadout.draftState.' + ds) | translate }}</span>
              @if (it.slot.draftPaths?.length && !readOnly()) {
                <button type="button" class="lnk" (click)="reverted.emit(it.slot.draftPaths!)">{{ 'codex.loadout.revert' | translate }}</button>
              }
            </p>
          }
          @if (iconsOf(part)) {
            <div class="act">
              <sc-item-path [kind]="part.kind!" [className]="part.className!" [name]="itemName(part.name ?? '')" level="tertiary" />
            </div>
          }
          @if (!isRawPort()) {
            <div class="insp-actions">
              @if (!readOnly()) {
                <button type="button" class="swap" (click)="swapRequested.emit(part.target)">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7" /></svg>
                  {{ 'codex.assetPackage.swap' | translate }}
                </button>
              }
              <button type="button" class="lnk" (click)="inspected.emit(part.target)">{{ 'codex.inspect.openStats' | translate }}</button>
            </div>
          } @else {
            <p class="mut">{{ 'codex.holo.stage.rawPortHint' | translate }}</p>
          }
          <div class="prev">
            <small>{{ 'codex.holo.stage.previewTitle' | translate }}</small>
            <ul>
              <li><span>{{ 'codex.holo.stage.previewMaker' | translate }}</span>{{ maker(part.manufacturerCode) ?? '—' }}</li>
              <li><span>{{ 'codex.holo.stage.previewFitted' | translate }}</span>{{ shipName() || '—' }}</li>
              <li><span>{{ 'codex.holo.stage.previewBuy' | translate }}</span>—</li>
              <li><span>{{ 'codex.holo.stage.previewAlternatives' | translate }}</span>—</li>
            </ul>
            @if (part.className && part.kind) {
              <a class="more" [routerLink]="['/codex', part.kind, part.className]">{{ 'codex.holo.stage.previewOpen' | translate }} ›</a>
            }
          </div>
          <!-- The rest of this hardpoint: the mount around the gun, what a rack carries. -->
          @if (part.mount; as mount) {
            <div class="insp-kid">
              <div class="insp-head">
                @if (sizeBadge(mount); as b) { <span class="size-tag">{{ b }}</span> }
                <div class="insp-ident">
                  <b>{{ mount.name ? itemName(mount.name) : '—' }}</b>
                  <small>{{ meta(mount) }}</small>
                </div>
              </div>
              <div class="insp-actions">
                @if (!readOnly()) {
                  <button type="button" class="btn quiet ico" [scTooltip]="('codex.swap.open' | translate) + ': ' + (mount.name ? itemName(mount.name) : '')" scTooltipTier="label"
                          [attr.aria-label]="('codex.swap.open' | translate) + ': ' + (mount.name ? itemName(mount.name) : '')" (click)="swapRequested.emit(it)">⇄</button>
                }
                <button type="button" class="btn quiet ico" [scTooltip]="('codex.inspect.openStats' | translate) + ': ' + (mount.name ? itemName(mount.name) : '')" scTooltipTier="label"
                        [attr.aria-label]="('codex.inspect.openStats' | translate) + ': ' + (mount.name ? itemName(mount.name) : '')" (click)="inspected.emit(it)">≡</button>
              </div>
            </div>
          }
          @for (kid of part.others; track kid.port) {
            <div class="insp-kid" [class.empty]="!kid.className">
              <div class="insp-head">
                @if (kid.size != null) { <span class="size-tag">{{ kid.count > 1 ? kid.count + '×' : '' }}S{{ kid.size }}</span> }
                <div class="insp-ident">
                  <b>{{ kid.name ? itemName(kid.name) : '—' }}</b>
                  <small>{{ kidMeta(kid) }}</small>
                </div>
              </div>
              @if (kid.stats?.length) {
                <dl class="insp-stats">
                  @for (st of kid.stats!.slice(0, 4); track st.labelKey) {
                    <div><dt>{{ st.labelKey | translate }}</dt><dd>{{ fmtStat(st) }}</dd></div>
                  }
                </dl>
              }
              <div class="insp-actions">
                @if ((kid.className || kid.rawTypes.length > 0) && !readOnly()) {
                  <button type="button" class="btn quiet ico" [scTooltip]="('codex.swap.open' | translate) + ': ' + (kid.name ? itemName(kid.name) : '')" scTooltipTier="label"
                          [attr.aria-label]="('codex.swap.open' | translate) + ': ' + (kid.name ? itemName(kid.name) : '')" (click)="swapRequested.emit(childTarget(it, kid))">⇄</button>
                }
                @if (kid.className) {
                  <button type="button" class="btn quiet ico" [scTooltip]="('codex.inspect.openStats' | translate) + ': ' + (kid.name ? itemName(kid.name) : '')" scTooltipTier="label"
                          [attr.aria-label]="('codex.inspect.openStats' | translate) + ': ' + (kid.name ? itemName(kid.name) : '')" (click)="inspected.emit(childTarget(it, kid))">≡</button>
                }
              </div>
            </div>
          }
        </div>
        }
      }
    } @else if (allParts() && packageRows().length > 0) {
      <!-- "Alle Teile": every part of the package, with the eye that hides it on the model. -->
      <div class="plist" role="region" [attr.aria-label]="'codex.holo.stage.tab.parts' | translate">
        <p class="plist-head"><b>{{ 'codex.holo.stage.partsTotal' | translate: { n: packageRows().length } }}</b></p>
        @for (g of rowGroups(); track g.group) {
          <div class="pgroup">
            <span class="pg-head"><b>{{ ('codex.assetPackage.groups.' + g.group) | translate }}</b></span>
            <div class="pchips">
              @for (r of g.rows; track r.p.id) {
                <span class="pline" [class.off]="!r.visible">
                  @if (!r.free) {
                    <button type="button" class="eye" [attr.aria-pressed]="r.visible"
                            [attr.aria-label]="(r.visible ? 'codex.assetPackage.hide' : 'codex.assetPackage.show') | translate: { name: r.name }"
                            [scTooltip]="(r.visible ? 'codex.assetPackage.hide' : 'codex.assetPackage.show') | translate: { name: r.name }" scTooltipTier="label"
                            (click)="rowEye.emit(r.p.id)">{{ r.visible ? '●' : '○' }}</button>
                  }
                  @if (r.href) {
                    <a class="part" [attr.href]="r.href" [class.active]="activePorts().includes(r.p.portName)"
                       (mouseenter)="rowFocus.emit(r)" (mouseleave)="rowFocus.emit(null)" (focus)="rowFocus.emit(r)" (blur)="rowFocus.emit(null)"
                       (click)="pickRow($event, r)">
                      @if (r.p.itemSize !== null) { <i>S{{ r.p.itemSize }}</i> }<span class="pname">{{ r.name }}</span>
                    </a>
                  } @else {
                    <button type="button" class="part" [class.active]="activePorts().includes(r.p.portName)"
                            (mouseenter)="rowFocus.emit(r)" (mouseleave)="rowFocus.emit(null)" (focus)="rowFocus.emit(r)" (blur)="rowFocus.emit(null)"
                            (click)="pickRow($event, r)">
                      @if (r.p.itemSize !== null) { <i>S{{ r.p.itemSize }}</i> }<span class="pname">{{ r.free ? ('codex.assetPackage.freeSlot' | translate: { types: r.p.port?.types?.join(', ') ?? '' }) : r.name }}</span>
                    </button>
                  }
                </span>
              }
            </div>
          </div>
        }
      </div>
    } @else if (pinGroups().length > 0) {
      <!-- Nothing selected: the parts by block. Hover lights the part on the model, a click selects it. -->
      <div class="plist" role="region" [attr.aria-label]="'codex.holo.stage.tab.parts' | translate">
        <p class="plist-head">
          <b>{{ 'codex.holo.stage.partsTotal' | translate: { n: total() } }}</b>
          @if (changedPorts().size > 0) {
            <small class="plist-legend"><sc-holo-diff-marker />{{ 'codex.holo.inspector.diffLegend' | translate }}</small>
          }
        </p>
        @for (g of pinGroups(); track g.key) {
          <div class="pgroup">
            <span class="pg-head"><b>{{ g.labelKey | translate }}</b></span>
            <div class="pchips">
              @for (pin of g.pins; track pin.portName) {
                @if (pinHref(pin); as href) {
                  <a class="part" [attr.href]="href"
                     [class.gold]="pin.tone === 'gold'"
                     [class.active]="activePorts().includes(pin.portName)"
                     [class.q]="isQuiet(pin.portName)"
                     [class.unlocated]="isUnlocated(pin.portName)"
                     [scTooltip]="isUnlocated(pin.portName) ? ('codex.holo.components.unknownPosition' | translate) : null" scTooltipTier="label"
                     (mouseenter)="hovered.emit([pin.portName])"
                     (mouseleave)="hovered.emit(null)"
                     (focus)="hovered.emit([pin.portName])"
                     (blur)="hovered.emit(null)"
                     (click)="pickPin($event, pin.portName)">
                    @if (isChanged(pin.portName)) { <sc-holo-diff-marker class="dm" /> }@if (sizeOf(pin) !== null) { <i>S{{ sizeOf(pin) }}</i> }<span class="pname">{{ pin.label }}</span>
                  </a>
                } @else {
                  <button type="button" class="part"
                          [class.gold]="pin.tone === 'gold'"
                          [class.active]="activePorts().includes(pin.portName)"
                          [class.q]="isQuiet(pin.portName)"
                          [class.unlocated]="isUnlocated(pin.portName)"
                          [scTooltip]="isUnlocated(pin.portName) ? ('codex.holo.components.unknownPosition' | translate) : null" scTooltipTier="label"
                          (mouseenter)="hovered.emit([pin.portName])"
                          (mouseleave)="hovered.emit(null)"
                          (focus)="hovered.emit([pin.portName])"
                          (blur)="hovered.emit(null)"
                          (click)="pinInspect.emit(pin.portName)">
                    @if (isChanged(pin.portName)) { <sc-holo-diff-marker class="dm" /> }@if (sizeOf(pin) !== null) { <i>S{{ sizeOf(pin) }}</i> }<span class="pname">{{ pin.label }}</span>
                  </button>
                }
              }
            </div>
          </div>
        }
      </div>
    } @else {
      <div class="empty">
        <b>{{ 'codex.holo.stage.inspectorEmptyTitle' | translate }}</b>
        {{ 'codex.holo.stage.noPorts' | translate }}
      </div>
    }
  `,
  styles: [`
    :host { display: grid; gap: 10px; align-content: start; min-width: 0;
      --f: var(--sc-fs-floor); --d: var(--sc-font-display); --m: var(--font-monospace, "Share Tech Mono", monospace);
      --e-out: var(--holo-e-out); --hair: color-mix(in srgb, var(--sc-accent) 24%, transparent); }
    .empty b, .insp-stats dt, .pg-head { font-family: var(--d); text-transform: uppercase; }
    .lnk { background: none; border: none; padding: 0; color: var(--sc-accent); cursor: pointer; font: inherit;
      font-size: max(11px, var(--f)); min-height: var(--sc-tap-min, 24px); justify-self: start; }
    .lnk:hover { text-decoration: underline; }
    .btn { min-height: var(--sc-tap-min, 28px); padding: 3px 8px; border-radius: 3px; border: 1px solid var(--hair); background: none;
      color: var(--sc-fg-1); cursor: pointer; font: inherit; font-size: max(11px, var(--f));
      transition: border-color 160ms ease, color 160ms ease; }
    .btn:hover, .btn:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
    .empty { display: grid; place-items: center; text-align: center; gap: 8px; color: var(--sc-fg-2); padding: 40px 10px; font-size: max(12px, var(--f)); }
    .empty b { font-size: max(11px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-1); font-weight: 400; }
    .mut { margin: 0; font-size: max(12px, var(--f)); color: var(--sc-fg-2); }

    /* ── The selected part ── */
    .inspector { display: grid; gap: 10px; min-width: 0; animation: insp-in var(--holo-t-base) var(--e-out) backwards; }
    @keyframes insp-in { from { opacity: 0; transform: translateY(var(--holo-rise)); } }
    .insp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .back { background: none; border: 0; border-radius: 5px; color: var(--sc-accent); cursor: pointer; font: inherit; font-size: max(12.5px, var(--f)); padding: 3px 9px 3px 6px;
      min-height: var(--sc-tap-min, 26px); transition: background 160ms ease; }
    .back:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .back:focus-visible, .lnk:focus-visible, .swap:focus-visible, .act button:focus-visible, .more:focus-visible, .part:focus-visible, .eye:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pn { display: grid; gap: 1px; min-width: 0; }
    .pn h2 { margin: 0; font-family: var(--sc-font-body); font-size: 19px; font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; line-height: 1.2; }
    .pn small { font-size: max(12px, var(--f)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .inspector-patch-delta { margin: 0; font-size: max(11px, var(--f)); color: var(--sc-accent); font-family: var(--m); overflow-wrap: anywhere; }
    .inspector-patch-delta.unresolved { color: var(--sc-fg-2); font-style: italic; }
    /* minmax(0,1fr): a long label ("Geschossgeschwindigkeit") wraps inside its cell. */
    .insp-stats { margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px 6px; }
    .insp-stats div { display: grid; gap: 2px; align-content: space-between; min-width: 0; }
    .insp-stats dt { font-family: inherit; text-transform: none; font-size: max(9.5px, var(--f)); color: var(--sc-fg-2); overflow-wrap: normal; word-break: normal; hyphens: manual; }
    .insp-stats dd { margin: 0; font-family: var(--m); font-size: 15px; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .insp-draft { margin: 0; display: flex; align-items: center; gap: 8px; }
    .tag.draft { font-size: max(10px, var(--f)); color: var(--sc-accent); border: 1px solid var(--sc-accent); border-radius: 2px; padding: 1px 6px; }
    .tag.draft.pending { color: var(--sc-fg-2); border-color: var(--sc-fg-2); }
    .tag.draft.unresolved { color: var(--sc-warning); border-color: var(--sc-warning); }
    .act { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .act button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: max(46px, var(--sc-tap-min, 0px)); padding: 0 2px; background: none;
      border: 1px solid var(--hair); border-radius: 7px; color: var(--sc-fg-1); cursor: pointer; font: inherit; font-size: max(11px, var(--f)); min-width: 0;
      transition: border-color 160ms ease, background 160ms ease, color 160ms ease; }
    .act button:hover { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-fg-0); }
    .act button[aria-pressed='true'] { border-color: var(--sc-accent); color: var(--sc-accent); }
    .act svg, .swap svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .act span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .insp-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .insp-actions:empty { display: none; }
    .insp-kid .btn.ico { min-inline-size: var(--sc-tap-min, 32px); min-block-size: var(--sc-tap-min, 32px); padding-inline: 8px; }
    .swap { flex: 1 1 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: max(38px, var(--sc-tap-min, 0px)); border: 1px solid var(--sc-accent); border-radius: 7px;
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); cursor: pointer; font: inherit; font-size: max(13px, var(--f)); font-weight: 600; transition: background 160ms ease; }
    .swap:hover { background: color-mix(in srgb, var(--sc-accent) 28%, transparent); }
    .prev { display: grid; gap: 7px; padding-block: 10px; border-block: 1px solid var(--hair); }
    .prev > small { font-size: max(10px, var(--f)); letter-spacing: 0.09em; text-transform: uppercase; color: var(--sc-fg-2); }
    .prev ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: max(12px, var(--f)); color: var(--sc-fg-0); }
    .prev li { display: flex; justify-content: space-between; gap: 8px; min-width: 0; text-align: end; }
    .prev li span { color: var(--sc-fg-2); text-align: start; }
    .more { justify-self: start; color: var(--sc-accent); font-size: max(12.5px, var(--f)); text-decoration: none; border-bottom: 1px solid transparent; }
    .more:hover { border-bottom-color: var(--sc-accent); }
    @media (pointer: coarse) { .more { display: inline-flex; align-items: center; min-height: var(--sc-tap-min); } }
    .insp-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .size-tag { font-family: var(--m); font-size: 10px; color: var(--sc-fg-2); border: 1px solid var(--hair); border-radius: 2px; padding: 1px 5px; flex: none; margin-top: 2px; }
    .insp-ident { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .insp-ident b { font-weight: 500; color: var(--sc-fg-0); font-size: max(12.5px, var(--f)); overflow-wrap: anywhere; }
    .insp-ident small { font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .insp-kid { display: grid; gap: 8px; min-width: 0; }
    .insp-kid.empty .insp-ident b { color: var(--sc-fg-2); font-weight: 400; }

    /* ── The parts as chips (the look of the old list under the model) ── */
    .plist { display: grid; gap: 7px; min-width: 0; animation: list-in var(--holo-t-base) var(--e-out) backwards; }
    @keyframes list-in { from { opacity: 0; } }
    .plist-head { margin: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: max(13px, var(--f)); color: var(--sc-fg-0); }
    .plist-head b { font-weight: 600; white-space: nowrap; }
    .plist-legend { display: inline-flex; align-items: center; gap: 6px; font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); white-space: nowrap; }
    .dm { margin-inline-end: 6px; vertical-align: middle; }
    .pgroup { display: grid; gap: 3px; min-width: 0; }
    .pg-head { font-family: inherit; text-transform: none; font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); }
    .pg-head b { font-family: var(--d); text-transform: uppercase; font-weight: 500; font-size: max(10px, var(--f)); letter-spacing: 0.09em; color: var(--sc-fg-1); }
    .pchips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .part { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; min-height: max(25px, var(--sc-tap-min, 0px)); padding: 0 7px; box-sizing: border-box;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 20%, transparent); border-radius: 5px; background: color-mix(in srgb, var(--sc-bg-2) 55%, transparent);
      color: var(--sc-fg-0); cursor: pointer; font: inherit; font-size: max(12.5px, var(--f)); text-decoration: none; white-space: nowrap;
      transition: border-color 120ms ease, background 120ms ease, opacity 120ms ease; }
    .part i { font-family: var(--m); font-style: normal; font-weight: 600; font-size: max(12px, var(--f)); color: var(--holo-e, var(--sc-accent)); }
    .part.gold i { color: var(--holo-gold, var(--sc-accent)); }
    .pname { min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.15; }
    .part:hover, .part:focus-visible, .part.active { border-color: var(--holo-e, var(--sc-accent)); background: color-mix(in srgb, var(--holo-e, var(--sc-accent)) 20%, transparent); }
    /* Not what the picked Einsatz is about: quiet, still reachable. */
    .part.q { opacity: 0.5; }
    .part.q:hover, .part.q:focus-visible, .part.q.active { opacity: 1; }
    .part.unlocated { border-style: dashed; }
    .pline { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; min-width: 0; }
    .pline.off .part { opacity: 0.5; }
    .eye { flex: none; background: none; border: 0; border-radius: 3px; padding: 0; min-width: max(20px, var(--sc-tap-min, 0px)); min-height: max(20px, var(--sc-tap-min, 0px));
      color: var(--sc-accent); cursor: pointer; font-size: 11px; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  `],
})
export class CodexHoloInspectorComponent {
  /** Resolved with the first selected part: a ship page that only looks never starts the services behind it. */
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly locationStrategy = inject(LocationStrategy);


  readonly target = input<LayoutTarget | null>(null);
  /** The inspected part has no loadout slot behind it: nothing to swap. */
  readonly isRawPort = input(false);
  readonly patchPin = input<PortPinBadge | null>(null);
  readonly inspectedPort = input<string | null>(null);
  /** The loadout block of the selected part (a gun mount speaks through its gun). */
  readonly section = input<ShipModuleSection | null>(null);
  readonly shipName = input('');
  /** Which part of how many, as the numbered pins count them; 0 = not a numbered pin. */
  readonly index = input(0);
  readonly total = input(0);
  readonly pinGroups = input<readonly PinGroup[]>([]);
  /** Ports whose part differs from the Werk loadout — the ◆ marker (C19). */
  readonly changedPorts = input<ReadonlySet<string>>(new Set());
  readonly activePorts = input<readonly string[]>([]);
  /** A shared link's loadout is on the table (#646): no swap, undo or save. */
  readonly readOnly = input(false);
  /** Ports the picked Einsatz leaves lit; null = every part is. */
  readonly relevantPorts = input<ReadonlySet<string> | null>(null);
  /** Ports the 3D model can place; null = no model on the table, so nothing to say about it. */
  readonly modelPorts = input<ReadonlySet<string> | null>(null);
  /** "Alle Teile" is on and the package's rows are here. */
  readonly allParts = input(false);
  readonly packageRows = input<readonly PlacementRow[]>([]);

  readonly closed = output<void>();
  readonly pinInspect = output<string>();
  readonly hovered = output<string[] | null>();
  readonly swapRequested = output<LayoutTarget>();
  readonly inspected = output<LayoutTarget>();
  readonly reverted = output<string[]>();
  readonly rowPick = output<PlacementRow>();
  readonly rowFocus = output<PlacementRow | null>();
  readonly rowEye = output<string>();

  /** Manufacturer code -> name, from the codex facet read (cached per kind by the service). */
  private readonly makerNames = signal<Readonly<Record<string, string>>>({});
  private readonly makerKinds = new Set<string>();
  private readonly makerLoad = effect(() => {
    const part = this.focusPart();
    if (!part) return;
    const kinds = new Set<CodexKind>();
    for (const k of [part.kind, part.mount?.kind, ...part.others.map((o) => o.kind)]) if (k) kinds.add(k);
    // A slot often arrives without a kind (a power plant from the module sheet):
    // the component facet still knows its maker's name.
    if (part.manufacturerCode) kinds.add('component');
    for (const kind of kinds) {
      if (this.makerKinds.has(kind)) continue;
      this.makerKinds.add(kind);
      const lang = toLang(this.injector.get(TranslateService).getCurrentLang());
      void this.injector.get(CodexService).facetValues(kind).then((fv) => {
        if (!fv) { this.makerKinds.delete(kind); return; }
        const next = { ...this.makerNames() };
        for (const m of fv.manufacturers) {
          const label = manufacturerLabel({ manufacturerCode: m.code, payload: { manufacturer: { name: m.name } } }, lang);
          if (label && label !== m.code) next[m.code] = label;
        }
        this.makerNames.set(next);
      }).catch(() => undefined);
    }
  });

  /** The maker's name where the data has it, else its code. */
  maker(code: string | null | undefined): string | null {
    return code ? (this.makerNames()[code] ?? code) : null;
  }

  readonly focusPart = computed<PartFocus | null>(() => {
    const it = this.target();
    return it ? partFocusOf(it, this.section()) : null;
  });


  readonly rowGroups = computed(() => {
    const groups = new Map<string, PlacementRow[]>();
    for (const r of this.packageRows()) {
      const hit = groups.get(r.p.group);
      if (hit) hit.push(r);
      else groups.set(r.p.group, [r]);
    }
    return [...groups.entries()].map(([group, rows]) => ({ group, rows }));
  });

  /** What an icon said last ("Auf der Wunschliste"); an icon press is not silent. */

  iconsOf(part: PartFocus): SearchRowIcons | null {
    if (!part.className || !part.kind) return null;
    const ic = resolveIcons({ type: 'hit', kind: part.kind as PolyHitKind });
    return ic.wishlist || ic.lager ? ic : null;
  }

  itemName(name: string): string {
    return displayItemName(name);
  }

  /** A patch pin's class id as a readable name (AUD-188); the raw id stays in the tooltip. */
  pinName(cls: string | null | undefined): string {
    return cls ? displayItemName(cls) : '—';
  }

  childTarget(it: LayoutTarget, kid: LayoutChild): LayoutTarget {
    return childTargetOf(it, kid);
  }

  sizeBadge(slot: LayoutSlot): string | null {
    const size = slot.size ?? slot.portSize;
    return size != null ? `S${size}` : null;
  }

  sizeOf(pin: StagePin): number | null {
    return chipSize(pin);
  }

  partMeta(part: PartFocus): string {
    const size = part.size != null ? `S${part.size}` : null;
    // The type in the reader's language ("Gatling", "Kühler"), not the extract's English "Weapon Gun" (B13).
    const typeKey = partTypeKey(this.section(), part.className);
    const type = typeKey ? this.injector.get(TranslateService).instant(typeKey) : part.typeLabel;
    return [size, type, this.maker(part.manufacturerCode)].filter((x): x is string => !!x).join(' · ');
  }

  /** The part's values: its size and grade, then what the extract knows about it. */
  partValues(part: PartFocus): { key: string; value: string }[] {
    const out: { key: string; value: string }[] = [];
    if (part.size != null) out.push({ key: 'codex.holo.stage.partSize', value: `S${part.size}` });
    if (part.grade) out.push({ key: 'codex.holo.stage.partGrade', value: part.grade });
    for (const st of part.stats.slice(0, 6 - out.length)) out.push({ key: shortStatKey(st.labelKey), value: formatEquippedStat(st) });
    return out;
  }

  kidMeta(kid: LayoutChild): string {
    return [this.maker(kid.manufacturerCode), kid.typeLabel, kid.port].filter((x): x is string => !!x).join(' · ');
  }

  meta(slot: LayoutSlot): string {
    return [this.maker(slot.manufacturerCode), slot.typeLabel, slot.port].filter((x): x is string => !!x).join(' · ');
  }

  fmtStat(stat: EquippedStat): string {
    return formatEquippedStat(stat);
  }

  isChanged(port: string | null): boolean {
    return !!port && this.changedPorts().has(port);
  }

  isQuiet(port: string): boolean {
    const lit = this.relevantPorts();
    return !!lit && lit.size > 0 && !lit.has(port);
  }

  isUnlocated(port: string): boolean {
    const placed = this.modelPorts();
    return !!placed && placed.size > 0 && !placed.has(port);
  }

  /** A chip whose part has a Codex page is an anchor: Ctrl/middle click open it, a plain click selects. */
  pinHref(pin: StagePin): string | null {
    const slot = pin.slot;
    if (!slot) return null;
    const held = pin.section === 'weapons' ? slot.children?.find((c) => !!c.name && !!c.className && !!c.kind) : undefined;
    const kind = held?.kind ?? slot.kind;
    const cls = held?.className ?? slot.className;
    if (!kind || !cls) return null;
    return this.locationStrategy.prepareExternalUrl(this.router.serializeUrl(this.router.createUrlTree(['/codex', kind, cls])));
  }

  pickPin(ev: MouseEvent, port: string): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.pinInspect.emit(port);
  }

  pickRow(ev: MouseEvent, r: PlacementRow): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.rowPick.emit(r);
  }
}
