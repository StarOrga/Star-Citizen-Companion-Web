import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  AmmunitionPayload,
  BaseEntityPayload,
  CodexBlueprintIngredient,
  CodexItemPort,
  ComponentPayload,
  Dimensions,
  ItemPayload,
  Lang,
  LoadoutEntry,
  ShipPayload,
  WeaponPayload,
} from './codex.types';
import {
  BlueprintRef,
  CodexDetail,
  CodexKind,
  CodexService,
  CompatibleItem,
  ResolvedEntity,
  pickLocalized,
  toLang,
} from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import {
  computeLoadoutStats,
  findStat,
  type QuantumStats,
  type ResolvedLoadoutLine,
} from '../hangar/loadout-stats';
import {
  DamageRow,
  HARDPOINT_CATEGORY_ORDER,
  HardpointCategory,
  SpecSection,
  StatGroup,
  StatRow,
  PortSummaryEntry,
  ammoDamage,
  categorizePort,
  cleanLocaleValue,
  curateComponentStats,
  flattenSpec,
  groupStatRows,
  humanizeClassName,
  formatCraftTime,
  formatNumber,
  humanizePortType,
  meaningfulRows,
  summarizePorts,
  unescapeText,
} from './codex-format';
import {
  ammoClassNameFor,
  ammoClassNamesFor,
  damageChannelsOf,
  equippedStats,
  equippedTypeLabel,
  isWeaponMountPort,
  weaponStatsUnavailable,
} from './codex-equipped-stats';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexHardpointLayoutComponent, LayoutGroup, LayoutSlot } from './codex-hardpoint-layout.component';
import { CodexSwapDockComponent } from './codex-swap-dock.component';
import { ShipHardpointMapComponent } from './ship-hardpoint-map.component';
import {
  HardpointFrame,
  HardpointMarker,
  HardpointMarkerInput,
  HardpointTransform,
  buildHardpointMarkers,
  readHardpointFrame,
  readHardpointTransforms,
} from './hardpoint-map';
import { ShipSkinViewerComponent } from './ship-skin-viewer.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { ShipLinkService } from './ship-link.service';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { BuyOption, UexShopService } from './uex-shop.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Lazy-loaded compatible-items state per hardpoint (keyed by port_index).
interface PortCompat {
  loading: boolean;
  error: string | null;
  items: CompatibleItem[];
}

// A compact hero fact chip (manufacturer, role, crew, size, …).
interface Fact {
  label: string;
  value: string;
  accent?: boolean;
}

// Hardpoints grouped by functional category for display.
interface PortGroup {
  category: HardpointCategory;
  ports: CodexItemPort[];
}

// Tech spec facts derived from the stock loadout's component payloads (#137):
// quantum drive numbers plus summed hydrogen / quantum fuel tank capacities.
interface ShipTechStats {
  quantum: QuantumStats;
  quantumDriveClassName: string | null;
  hydrogenCapacity: number | null;
  quantumFuelCapacity: number | null;
}

interface LoadoutItem {
  port: string;
  className: string | null;
  kind: CodexKind | null;
  name: string | null; // friendly name (falls back to className)
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
}
interface LoadoutGroup {
  category: HardpointCategory;
  items: LoadoutItem[];
}

// The recipe that PRODUCES this entity (#187: "which materials do I need").
interface GearRecipe {
  classNameSlug: string;
  craftTimeSec: number | null;
  ingredients: CodexBlueprintIngredient[];
}

@Component({
  selector: 'sc-codex-detail',
  standalone: true,
  imports: [RouterLink, TranslateModule, CodexCompareTrayComponent, CodexHardpointLayoutComponent, CodexSwapDockComponent, ShipHardpointMapComponent, ShipSkinViewerComponent, CodexCategoryIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-page">
      <a class="back" routerLink="/codex">← {{ 'codex.detail.back' | translate }}</a>

      @if (loading()) {
        <div class="sc-card skel-card"></div>
      } @else if (error(); as err) {
        <div class="sc-card err"><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}</div>
      } @else if (!detail()) {
        <div class="sc-card empty">{{ 'codex.detail.notFound' | translate }}</div>
      } @else {
        <!-- ── Hero (ships get the dim Bay scene — P2 frame, same content) ── -->
        <header class="hero sc-card" [class.bay]="kind() === 'ship'">
          <figure class="hero-art" [class.icon-only]="!previewUrl()">
            @if (previewUrl(); as src) {
              <img [src]="src" [alt]="displayName()" loading="eager" (error)="onArtError()" />
            } @else {
              <sc-codex-icon class="hero-icon" [kind]="detail()!.kind" [sub]="heroSub()" />
            }
          </figure>
          <div class="hero-body">
            <span class="kind-tag">{{ ('codex.kindSingular.' + detail()!.kind) | translate }}</span>
            <h1>{{ displayName() }}</h1>
            @if (manufacturerName(); as mfr) { <p class="mfr">{{ mfr }}</p> }
            <code class="cls">{{ detail()!.classNameSlug }}</code>

            @if (facts().length > 0) {
              <ul class="facts">
                @for (f of facts(); track f.label) {
                  <li class="fact" [class.accent]="f.accent">
                    <span class="f-label">{{ f.label }}</span>
                    <span class="f-value">{{ f.value }}</span>
                  </li>
                }
              </ul>
            }

            @if (portSummary().length > 0) {
              <ul class="loadout-summary" [attr.aria-label]="'codex.detail.equipment' | translate">
                @for (s of portSummary(); track s.category) {
                  <li class="ls-item" [attr.data-cat]="s.category">
                    <span class="ls-count">{{ s.count }}</span>
                    <span class="ls-cat">{{ ('codex.portCategory.' + s.category) | translate }}</span>
                  </li>
                }
              </ul>
            }

            <div class="hero-actions">
              <button type="button" class="pin" [class.pinned]="isPinned()" (click)="togglePin()">
                {{ isPinned() ? '★' : '☆' }} {{ (isPinned() ? 'codex.compare.pinned' : 'codex.compare.pin') | translate }}
              </button>
              @if (kind() === 'ship') {
                @if (inHangar()) {
                  <button type="button" class="pin add-hangar" (click)="configureLoadout()">
                    {{ 'codex.detail.configureLoadout' | translate }}
                  </button>
                } @else {
                  <button type="button" class="pin add-hangar" (click)="addToHangar()">
                    {{ 'quickSearch.addToHangar' | translate }}
                  </button>
                }
                <!-- Deep-link out to the official RSI site. We have no reliable
                     per-ship RSI slug (our classNameSlug ≠ RSI URL slug), so
                     without a pinned link this lands on the official ships
                     listing (admin-chosen target: name-sorted) rather than
                     404-ing on a guessed deeplink. Users can pin the real
                     pledge page themselves (feedback f7d3bd9a) — that value is
                     attacker-controlled, so it is bound with [href] on a plain
                     anchor and nothing else: no innerHTML, no LLM prompt. -->
                @if (pledgeLink(); as pledge) {
                  <a
                    class="pin rsi-link"
                    [href]="pledge"
                    target="_blank"
                    rel="noopener noreferrer nofollow">
                    {{ 'codex.detail.viewOnRsi' | translate }} ↗
                  </a>
                } @else {
                  <a
                    class="pin rsi-link"
                    href="https://robertsspaceindustries.com/en/pledge/ships?sortField=name&sortDirection=asc"
                    target="_blank"
                    rel="noopener noreferrer">
                    {{ 'codex.detail.viewOnRsi' | translate }} ↗
                  </a>
                }
                @if (auth.user()) {
                  <button type="button" class="raw-toggle" (click)="toggleLinkForm()">
                    {{ (myPledgeLink() ? 'codex.shipLink.edit' : 'codex.shipLink.add') | translate }}
                  </button>
                }
                <!-- 3D-print guide lives here in the codex (ship context: the
                     guide scales prints by these very dimensions) instead of
                     the global footer. -->
                <a class="pin" routerLink="/tools/3d-print">
                  {{ 'printGuide.linkLabel' | translate }}
                </a>
              }
              @if (provenance(); as p) {
                <span class="prov" [attr.title]="'codex.provenance.tooltip' | translate">
                  {{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}
                </span>
              }
            </div>

            <!-- Pin your own RSI pledge link (feedback f7d3bd9a). Private to
                 you; an admin can publish one for everyone, never automatic. -->
            @if (kind() === 'ship' && showLinkForm()) {
              <form class="ship-link-form" (submit)="saveShipLink($event)">
                <p class="sl-hint">{{ 'codex.shipLink.hint' | translate }}</p>
                <div class="sl-row">
                  <input
                    type="url"
                    class="sl-input"
                    [value]="shipLinkInput()"
                    (input)="onShipLinkInput($event)"
                    [attr.placeholder]="'codex.shipLink.placeholder' | translate"
                    [attr.aria-label]="'codex.shipLink.label' | translate"
                    [attr.aria-invalid]="shipLinkError() ? 'true' : null" />
                  <button type="submit" class="pin" [disabled]="shipLinks.saving()">
                    {{ 'codex.shipLink.save' | translate }}
                  </button>
                  @if (myPledgeLink()) {
                    <button type="button" class="raw-toggle" [disabled]="shipLinks.saving()"
                            (click)="removeShipLink()">
                      {{ 'codex.shipLink.remove' | translate }}
                    </button>
                  }
                  <button type="button" class="raw-toggle" (click)="toggleLinkForm()">
                    {{ 'codex.shipLink.cancel' | translate }}
                  </button>
                </div>
                @if (shipLinkError(); as errKey) {
                  <p class="sl-error" role="alert">
                    {{ ('codex.shipLink.error.' + errKey) | translate }}
                  </p>
                }
                @if (shipLinkSaved()) {
                  <p class="sl-ok" role="status">{{ 'codex.shipLink.saved' | translate }}</p>
                }
                @if (role.isAdmin()) {
                  <div class="sl-admin">
                    <span class="sl-admin-tag">{{ 'codex.shipLink.adminTitle' | translate }}</span>
                    <button type="button" class="raw-toggle" [disabled]="shipLinks.saving()"
                            (click)="promoteShipLink()">
                      {{ 'codex.shipLink.promote' | translate }}
                    </button>
                    @if (globalPledgeLink()) {
                      <button type="button" class="raw-toggle" [disabled]="shipLinks.saving()"
                              (click)="unpromoteShipLink()">
                        {{ 'codex.shipLink.unpromote' | translate }}
                      </button>
                    }
                    <span class="sl-admin-hint">{{ 'codex.shipLink.adminHint' | translate }}</span>
                  </div>
                }
              </form>
            }
          </div>
        </header>

        <!-- ── Ship liveries — always-on 3D view at hero level (#137 part 2) ──
             Moved directly beneath the hero so the interactive 3D model stays
             on-screen (RSI-site feel) instead of being buried below the spec
             sheet. The viewer itself keeps its deliberate lazy-load: expanded
             by default on desktop (the ~3 MB glb loads immediately), collapsed
             by default on mobile (opened on demand to spare cellular data).
             Comparison is intentionally NOT duplicated here — the existing
             floating compare tray (<sc-codex-compare-tray/>, pinned via the hero
             ★ action) is the single comparison surface. -->
        @if (shipClassName(); as cls) {
          <sc-ship-skin-viewer [shipId]="cls" />
        }

        <!-- ── Description ───────────────────────────────────────── -->
        @if (description(); as d) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.description' | translate }}</h2>
            <p class="desc">{{ d }}</p>
          </section>
        }

        <!-- ── Where to buy (#254/#255): UEX Corp purchase locations for FPS
             armor pieces and personal weapons. Best-effort — the section only
             appears for the relevant kinds and quietly shows "no data" rather
             than an error state for anything unmatched. ───────────────── -->
        @if (kind() === 'item' || kind() === 'weapon') {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.whereToBuy' | translate }}</h2>
            @if (buyLoading()) {
              <p class="muted">{{ 'codex.detail.whereToBuyLoading' | translate }}</p>
            } @else if (buyError()) {
              <p class="err-inline">{{ 'codex.detail.whereToBuyError' | translate }}</p>
            } @else if (buyOptions().length === 0) {
              <p class="muted">{{ 'codex.detail.whereToBuyEmpty' | translate }}</p>
            } @else {
              <table class="buy-table">
                <thead>
                  <tr>
                    <th>{{ 'codex.detail.whereToBuyPrice' | translate }}</th>
                    <th>{{ 'codex.detail.whereToBuyTerminal' | translate }}</th>
                    <th>{{ 'codex.detail.whereToBuyLocation' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (opt of buyOptions(); track opt.terminal + opt.price) {
                    <tr>
                      <td class="buy-price">{{ fmt(opt.price) }} aUEC</td>
                      <td>{{ opt.terminal }}</td>
                      <td class="muted">{{ opt.location }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
            <p class="hint buy-attribution">{{ 'codex.detail.whereToBuyAttribution' | translate }}</p>
          </section>
        }

        <!-- ── Ammunition: damage + ballistics ───────────────────── -->
        @if (damage().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.damage' | translate }}</h2>
            <div class="dmg-list">
              @for (row of damage(); track row.channel) {
                <div class="dmg" [attr.data-ch]="row.channel">
                  <span class="dmg-label">{{ ('codex.damage.' + row.channel) | translate }}</span>
                  <span class="dmg-bar"><span class="dmg-fill" [style.width.%]="damagePct(row)"></span></span>
                  <span class="dmg-val">{{ fmt(row.value) }}</span>
                </div>
              }
            </div>
          </section>
        }

        <!-- ── Component key stats, grouped by purpose ───────────── -->
        @if (componentStatGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.keyStats' | translate }}</h2>
            @for (g of componentStatGroups(); track g.purpose) {
              @if (showStatGroupHeaders(componentStatGroups())) {
                <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
              }
              <div class="stat-grid">
                @for (s of g.rows; track s.key) {
                  <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
          </section>
        }

        <!-- ── Weapon parameters, grouped by purpose ─────────────── -->
        @if (weaponParamGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.weaponParams' | translate }}</h2>
            @for (g of weaponParamGroups(); track g.purpose) {
              @if (showStatGroupHeaders(weaponParamGroups())) {
                <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
              }
              <div class="stat-grid">
                @for (s of g.rows; track s.key) {
                  <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
          </section>
        }

        <!-- ── Armor / undersuit stats, grouped by purpose ───────── -->
        @if (armorStatGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.armorStats' | translate }}</h2>
            @for (g of armorStatGroups(); track g.purpose) {
              @if (showStatGroupHeaders(armorStatGroups())) {
                <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
              }
              <div class="stat-grid">
                @for (s of g.rows; track s.key) {
                  <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
          </section>
        }

        <!-- ── Hardpoints, grouped by category ───────────────────── -->
        @if (hardpointGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.hardpoints' | translate }} <span class="ct">{{ detail()!.ports.length }}</span></h2>
            <p class="hint">{{ 'codex.detail.hardpointsHint' | translate }}</p>
            <!-- The hull map lives with the loadout list when there is one; a
                 ship with only structural ports gets it here instead, so it is
                 never shown twice and never withheld. -->
            @if (!hasLoadoutSection() && hardpointFrame(); as frame) {
              <sc-ship-hardpoint-map
                [markers]="hardpointMarkers()"
                [frame]="frame"
                [activePorts]="activePorts()"
                (hovered)="setActivePorts($event)" />
            }
            @for (g of hardpointGroups(); track g.category) {
              <div class="hp-group">
                <h3 class="hp-cat">
                  {{ ('codex.portCategory.' + g.category) | translate }}
                  <span class="hp-ct">{{ g.ports.length }}</span>
                </h3>
                <ul class="hp-list">
                  @for (port of g.ports; track port.portIndex) {
                    <li class="hp" [class.expandable]="port.types.length > 0" [class.open]="expandedPort() === port.portIndex"
                        [class.located]="isPortLocated(port)" [class.on]="isPortActive(port)"
                        (mouseenter)="hoverPort(port)" (mouseleave)="setActivePorts(null)">
                      <button type="button" class="hp-head" (click)="togglePort(port)" [disabled]="port.types.length === 0">
                        <span class="hp-caret">{{ port.types.length ? (expandedPort() === port.portIndex ? '▾' : '▸') : '·' }}</span>
                        <span class="hp-name">{{ humanizePort(port.portName) }}</span>
                        <span class="hp-meta">
                          <span class="hp-size">{{ sizeRange(port.minSize, port.maxSize) }}</span>
                          @for (t of port.types; track t) { <span class="chip">{{ humanizeType(t) }}</span> }
                        </span>
                      </button>
                      @if (expandedPort() === port.portIndex) {
                        <div class="compat">
                          @if (compat(port.portIndex); as c) {
                            @if (c.loading) {
                              <span class="muted">{{ 'codex.detail.compatLoading' | translate }}</span>
                            } @else if (c.error) {
                              <span class="err-inline">{{ c.error }}</span>
                            } @else if (c.items.length === 0) {
                              <span class="muted">{{ 'codex.detail.compatNone' | translate }}</span>
                            } @else {
                              <div class="compat-head">{{ 'codex.detail.compatCount' | translate: { count: c.items.length } }}</div>
                              <ul class="compat-list">
                                @for (it of c.items; track it.kind + it.classNameSlug) {
                                  <li>
                                    <a class="compat-link" [routerLink]="['/codex', it.kind, it.classNameSlug]">
                                      {{ it.nameLocalized || it.classNameSlug }}
                                    </a>
                                    <span class="compat-meta">
                                      @if (it.size != null) { <span class="chip">S{{ it.size }}</span> }
                                      @if (it.grade) { <span class="chip">{{ it.grade }}</span> }
                                      @if (it.manufacturerCode) { <span class="chip">{{ it.manufacturerCode }}</span> }
                                    </span>
                                  </li>
                                }
                              </ul>
                            }
                          }
                        </div>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }

        <!-- ── Default loadout as read-only hardpoint layout (Rung 1) ─ -->
        @if (loadoutGroups().length > 0) {
          <section class="sc-card block">
            <h2>
              {{ 'codex.detail.loadout' | translate }}
              <span class="ct">{{ installedCount() }}</span>
              @if (hiddenEmptyCount() > 0) {
                <button type="button" class="ghost-toggle" (click)="toggleEmptyLoadout()">
                  {{ (showEmptyLoadout() ? 'codex.detail.hideEmptyPorts' : 'codex.detail.showEmptyPorts') | translate: { count: hiddenEmptyCount() } }}
                </button>
              }
            </h2>
            <!-- "What even IS a hardpoint?" — answered up front, once. -->
            <p class="hint">{{ 'codex.detail.hardpointExplainer' | translate }}</p>
            <p class="hint">{{ 'codex.detail.layoutHint' | translate }}</p>
            @if (emptyWeaponMounts() > 0) {
              <p class="hint warn">
                {{ 'codex.equipped.armamentMissing' | translate: { count: emptyWeaponMounts() } }}
              </p>
            }
            <!-- WHERE each hardpoint sits on the hull (#137 part 3). Rendered
                 only when this ship's extract carries coordinates; every ship
                 without them keeps exactly the previous list-only layout. -->
            @if (hardpointFrame(); as frame) {
              <sc-ship-hardpoint-map
                [markers]="hardpointMarkers()"
                [frame]="frame"
                [activePorts]="activePorts()"
                (hovered)="setActivePorts($event)" />
            }
            <sc-codex-hardpoint-layout
              [groups]="layoutGroups()"
              [locatablePorts]="locatablePorts()"
              [activePorts]="activePorts()"
              (hovered)="setActivePorts($event)"
              (swapRequested)="openSwapDock($event)" />
            @if (swapSlot()) {
              <sc-codex-swap-dock class="swap-host" [slot]="swapSlot()" (closed)="swapSlot.set(null)" />
            }
          </section>
        }

        <!-- ── Crafting recipe: what this item costs to make (#187) ─ -->
        @if (recipe(); as r) {
          <section class="sc-card block">
            <h2>
              {{ 'codex.detail.craftedFrom' | translate }}
              @if (r.craftTimeSec != null) { <span class="ct">{{ fmtCraft(r.craftTimeSec) }}</span> }
            </h2>
            <p class="hint">{{ 'codex.detail.craftedFromHint' | translate }}</p>
            @if (r.ingredients.length > 0) {
              <ul class="compat-list">
                @for (i of r.ingredients; track i.ingredientIndex) {
                  <li>
                    <span class="compat-link plain">{{ ingredientName(i) }}</span>
                    <span class="compat-meta">
                      @if (i.role) { <span class="chip subtle">{{ i.role }}</span> }
                      @if (i.quantity != null) { <span class="chip">{{ fmt(i.quantity) }} SCU</span> }
                      @if (i.minQuality) { <span class="chip subtle">{{ 'codex.detail.minQuality' | translate: { value: i.minQuality } }}</span> }
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <p class="muted">{{ 'codex.detail.noIngredients' | translate }}</p>
            }
            <a class="compat-link" [routerLink]="['/codex', 'blueprint', r.classNameSlug]">
              {{ 'codex.detail.openBlueprint' | translate }}
            </a>
          </section>
        }

        <!-- ── Used in crafting blueprints (reverse ingredient lookup) ─ -->
        @if (usedInBlueprints().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.usedInBlueprints' | translate }} <span class="ct">{{ usedInBlueprints().length }}</span></h2>
            <p class="hint">{{ 'codex.detail.usedInBlueprintsHint' | translate }}</p>
            <ul class="compat-list">
              @for (b of usedInBlueprints(); track b.classNameSlug) {
                <li>
                  <a class="compat-link" [routerLink]="['/codex', 'blueprint', b.classNameSlug]">
                    {{ b.nameLocalized || humanizeName(b.classNameSlug) }}
                  </a>
                  <span class="compat-meta">
                    @if (b.tier != null) { <span class="chip">T{{ b.tier }}</span> }
                    @if (b.craftTimeSec != null) { <span class="chip">{{ fmtCraft(b.craftTimeSec) }}</span> }
                  </span>
                </li>
              }
            </ul>
          </section>
        }

        <!-- ── Full spec sheet (Manifest, collapsed) + raw payload ── -->
        <section class="sc-card block raw-block">
          <div class="spec-toggles">
            @if (specSections().length > 0) {
              <button type="button" class="raw-toggle" (click)="toggleSpec()">
                {{ (showSpec() ? 'codex.detail.hideFullSpec' : 'codex.detail.showFullSpec') | translate }}
              </button>
            }
            <button type="button" class="raw-toggle" (click)="toggleRaw()">
              {{ (showRaw() ? 'codex.detail.hideRaw' : 'codex.detail.showRaw') | translate }}
            </button>
          </div>
          @if (showSpec()) {
            <div class="spec">
              @for (sec of specSections(); track sec.title) {
                @if (sec.title) { <h3 class="sg-head">{{ sec.title }}</h3> }
                <table class="spec-table">
                  <tbody>
                    @for (r of sec.rows; track r.key) {
                      <tr>
                        <td class="sp-key">{{ r.key }}</td>
                        <td class="sp-val">{{ r.value }}@if (r.unit) {<span class="s-unit"> {{ r.unit }}</span>}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
              @if (provenance(); as p) {
                <p class="spec-prov">{{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}</p>
              }
            </div>
          }
          @if (showRaw()) { <pre class="raw">{{ rawJson() }}</pre> }
        </section>
      }

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 90px; }
    .back { font-size: 0.82rem; color: var(--sc-accent); text-decoration: none; align-self: flex-start; }
    .back:hover { text-decoration: underline; }

    /* Hero */
    .hero { display: grid; grid-template-columns: minmax(200px, 320px) 1fr; gap: 22px; padding: 0; overflow: hidden; }
    .hero-art { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 240px;
      background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--sc-accent) 12%, var(--sc-bg-1)), var(--sc-bg-0)); }
    .hero-art.icon-only { background: radial-gradient(circle at 50% 40%, var(--sc-bg-2), var(--sc-bg-0)); }
    .hero-art img { max-width: 100%; max-height: 320px; object-fit: contain; filter: drop-shadow(0 6px 24px rgba(0,0,0,0.55)); }
    /* Bay scene (ships): dim hangar light + rim glow around the hull. The
       frame gets atmospheric — every number stays on the calm right side. */
    .hero.bay .hero-art {
      background:
        radial-gradient(ellipse at 50% 62%, color-mix(in srgb, var(--sc-accent) 17%, #05080d), #04060a 78%);
      border-right: 1px solid color-mix(in srgb, var(--sc-accent) 20%, transparent); }
    .hero.bay .hero-art img {
      filter: drop-shadow(0 12px 34px rgba(0,0,0,0.72))
              drop-shadow(0 0 22px color-mix(in srgb, var(--sc-accent) 28%, transparent)); }
    @media (prefers-reduced-motion: no-preference) {
      .hero.bay .hero-art img { animation: bay-drift 6s ease-in-out infinite alternate; }
      @keyframes bay-drift { from { transform: translateY(-3px); } to { transform: translateY(3px); } }
    }
    .hero-art .hero-icon { width: 100%; height: 100%; min-height: 200px; }
    .hero-body { padding: 22px 24px 22px 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .kind-tag { align-self: flex-start; font-size: 0.64rem; padding: 3px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.1em;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); color: var(--sc-accent); }
    .hero-body h1 { margin: 2px 0 0; font-size: 1.7rem; line-height: 1.15; overflow-wrap: anywhere; }
    .hero-body .mfr { margin: 0; color: var(--sc-fg-1); font-size: 0.96rem; overflow-wrap: anywhere; }
    .hero-body .cls { font-size: 0.74rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); overflow-wrap: anywhere; }

    .facts { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .fact { display: flex; flex-direction: column; gap: 1px; padding: 6px 12px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .fact.accent { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .f-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .f-value { font-size: 0.9rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
    .fact.accent .f-value { color: var(--sc-accent); }

    .loadout-summary { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .ls-item { display: inline-flex; align-items: baseline; gap: 5px; padding: 5px 11px; border-radius: 999px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .ls-count { font-family: var(--sc-font-display); font-size: 0.95rem; color: var(--sc-fg-0); }
    .ls-cat { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); }
    .ls-item[data-cat="weapons"] { border-color: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 45%, transparent); }
    .ls-item[data-cat="weapons"] .ls-count { color: var(--sc-accent-hot, #ff7a45); }
    .ls-item[data-cat="missiles"] { border-color: color-mix(in srgb, #ff5252 45%, transparent); }
    .ls-item[data-cat="defense"] { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }

    .hero-actions { display: flex; align-items: center; gap: 14px; margin-top: auto; padding-top: 12px; flex-wrap: wrap; }
    .pin { padding: 8px 16px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font-family: var(--sc-font-display); font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .pin:hover, .pin.pinned { color: var(--sc-accent); border-color: var(--sc-accent); }
    .add-hangar { color: var(--sc-accent); }
    a.rsi-link { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }

    .ship-link-form { margin-top: 14px; padding: 12px 14px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .sl-hint { margin: 0 0 8px; font-size: 0.76rem; color: var(--sc-fg-2); }
    .sl-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .sl-input { flex: 1 1 320px; min-width: 0; padding: 8px 12px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.82rem; }
    .sl-input:focus { outline: none; border-color: var(--sc-accent); }
    .sl-input[aria-invalid='true'] { border-color: var(--sc-danger); }
    .sl-error { margin: 8px 0 0; font-size: 0.76rem; color: var(--sc-danger); }
    .sl-ok { margin: 8px 0 0; font-size: 0.76rem; color: var(--sc-accent); }
    .sl-admin { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sc-border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .sl-admin-tag { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .sl-admin-hint { font-size: 0.72rem; color: var(--sc-fg-2); flex: 1 1 220px; }
    .in-hangar { font-size: 0.74rem; color: var(--sc-fg-2); font-style: italic; }
    .prov { font-size: 0.72rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }

    /* Generic block */
    .block { padding: 16px 18px; }
    .block h2 { margin: 0 0 12px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .block h2 .ct { font-size: 0.7rem; color: var(--sc-fg-2); }
    .desc { margin: 0; color: var(--sc-fg-1); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }

    /* Stat grid (components / weapons), grouped by purpose */
    .sg-head { margin: 14px 0 8px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--sc-fg-1); display: flex; align-items: center; gap: 8px; }
    .sg-head::after { content: ''; flex: 1; height: 1px; background: var(--sc-border); }
    .sg-head:first-of-type { margin-top: 0; }
    .sg-head[data-purpose="offense"] { color: var(--sc-accent-hot, #ff7a45); }
    .sg-head[data-purpose="defense"] { color: var(--sc-accent); }
    .stat-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .stat-grid + .sg-head { margin-top: 14px; }
    .stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .s-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); }
    .s-value { font-size: 1.05rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
    .s-unit { font-size: 0.7rem; color: var(--sc-fg-2); font-family: system-ui, sans-serif; }

    /* Where to buy */
    .buy-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
    .buy-table th { text-align: left; padding: 6px 10px; font-size: 0.66rem; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--sc-fg-2); border-bottom: 1px solid var(--sc-border); }
    .buy-table td { padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .buy-price { color: var(--sc-accent); font-family: var(--sc-font-display); white-space: nowrap; }
    .buy-attribution { margin: 10px 0 0; font-style: italic; }

    /* Damage bars */
    .dmg-list { display: flex; flex-direction: column; gap: 8px; }
    .dmg { display: grid; grid-template-columns: 96px 1fr 64px; align-items: center; gap: 10px; }
    .dmg-label { font-size: 0.76rem; color: var(--sc-fg-1); }
    .dmg-bar { height: 8px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
    .dmg-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
    .dmg[data-ch="energy"] .dmg-fill { background: var(--sc-accent); }
    .dmg[data-ch="physical"] .dmg-fill { background: var(--sc-accent-hot, #ff7a45); }
    .dmg[data-ch="thermal"] .dmg-fill { background: #ff5252; }
    .dmg[data-ch="distortion"] .dmg-fill { background: #a674ff; }
    .dmg[data-ch="biochemical"] .dmg-fill { background: #5fd35f; }
    .dmg[data-ch="stun"] .dmg-fill { background: #f0c419; }
    .dmg-val { font-size: 0.84rem; text-align: right; color: var(--sc-fg-0); font-family: var(--sc-font-display); }

    /* Hardpoint / loadout groups */
    .hp-group { margin-top: 12px; }
    .hp-group:first-of-type { margin-top: 0; }
    .hp-cat { margin: 0 0 6px; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-1);
      display: flex; align-items: center; gap: 6px; }
    .hp-cat .hp-ct { font-size: 0.64rem; padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .hp-list, .ld-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }

    .hp { border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); overflow: hidden; }
    .hp.open { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    /* A port whose position on the hull is known gets a locator rail; hovering
       it lights up its marker on the hull map (and vice versa). Ports without
       coordinates look exactly as they did before. */
    .hp.located { border-left: 2px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .hp.located.on { border-left-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-1)); }
    .hp-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: transparent; border: none;
      color: inherit; font: inherit; text-align: left; cursor: default; }
    .hp.expandable .hp-head { cursor: pointer; }
    .hp.expandable .hp-head:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .hp-caret { width: 14px; color: var(--sc-fg-2); flex: 0 0 auto; }
    .hp.open .hp-caret { color: var(--sc-accent); }
    .hp-name { font-size: 0.82rem; color: var(--sc-fg-0); flex: 1 1 auto; overflow-wrap: anywhere; }
    .hp-meta { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: flex-end; flex: 0 1 auto; }
    .hp-size { font-size: 0.7rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .compat { padding: 4px 12px 12px 34px; background: var(--sc-bg-0); }

    .chip { font-size: 0.62rem; padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-2); color: var(--sc-fg-2); border: 1px solid var(--sc-border); white-space: nowrap; }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.82rem; }
    .hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: 0.74rem; }
    /* Data-gap disclosure: visible enough to be read, quiet enough not to
       look like an app error — the data is missing, nothing is broken. */
    .hint.warn { border-left: 2px solid color-mix(in srgb, var(--sc-warn, #e8a33d) 60%, transparent);
      padding-left: 8px; }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }
    .compat-head { color: var(--sc-fg-2); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; margin: 4px 0 8px; }
    .compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; }
    .compat-link:hover { text-decoration: underline; }
    /* A raw resource has no codex page of its own, so it is listed as plain
       text — a dead link would be worse than no link. */
    .compat-link.plain { color: var(--sc-fg-0); }
    .compat-link.plain:hover { text-decoration: none; }
    .chip.subtle { background: transparent; }
    .compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }

    .ghost-toggle { margin-left: auto; padding: 3px 10px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-family: inherit; font-size: 0.68rem; text-transform: none; letter-spacing: 0; cursor: pointer; }
    .ghost-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .raw-block { padding-top: 14px; }
    .spec-toggles { display: flex; gap: 8px; flex-wrap: wrap; }
    .raw-toggle { padding: 7px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: 0.76rem; cursor: pointer; }
    .raw-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .spec { margin-top: 12px; }
    .spec-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 4px; }
    .spec-table td { padding: 5px 10px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .sp-key { color: var(--sc-fg-2); width: 45%; overflow-wrap: anywhere; }
    .sp-val { color: var(--sc-fg-0); font-family: var(--sc-font-display); overflow-wrap: anywhere; }
    .spec-prov { margin: 10px 0 0; font-size: 0.72rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .raw { margin: 12px 0 0; padding: 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-size: 0.74rem; overflow: auto; max-height: 460px; }

    .swap-host { display: block; margin-top: 12px; }
    .skel-card { height: 260px; background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .err { color: var(--sc-danger); padding: 16px; }
    .empty { text-align: center; padding: 40px; color: var(--sc-fg-2); }

    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
      .hero-art { min-height: 180px; }
      .hero-body { padding: 20px; }
      .dmg { grid-template-columns: 84px 1fr 56px; }
    }
    @media (max-width: 400px) {
      .hero-body { padding: 16px; }
      .hero-body h1 { font-size: 1.4rem; }
      .stat-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    }
  `],
})
export class CodexDetailComponent implements OnInit {
  private readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);
  private readonly hangar = inject(HangarService);
  // User-supplied RSI pledge links (feedback f7d3bd9a) — public members because
  // the template reads `saving()` / `isAdmin()` / the signed-in user directly.
  readonly shipLinks = inject(ShipLinkService);
  readonly role = inject(RoleService);
  readonly auth = inject(AuthService);
  private readonly uexShop = inject(UexShopService);

  readonly detail = signal<CodexDetail | null>(null);
  readonly kind = computed(() => this.detail()?.kind ?? null);
  /** Ship pages only: whether this ship is already in the user's hangar. */
  readonly inHangar = computed(() => {
    const d = this.detail();
    return !!d && this.hangar.ships().some((s) => s.shipClassName === d.classNameSlug);
  });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly showRaw = signal(false);
  readonly showEmptyLoadout = signal(false);

  // ── user-supplied RSI pledge link (feedback f7d3bd9a) ───────────────────────
  // The catalog has no dependable per-ship RSI store slug, so the user may pin
  // the real pledge page. Their link is PRIVATE (owner-only RLS); a globally
  // promoted link is admin-curated. Own link wins so a user's correction always
  // beats the catalog-wide one.
  readonly showLinkForm = signal(false);
  readonly shipLinkInput = signal('');
  /** i18n key suffix under `codex.shipLink.error.*`, or null. */
  readonly shipLinkError = signal<string | null>(null);
  readonly shipLinkSaved = signal(false);

  readonly myPledgeLink = computed(() => {
    const d = this.detail();
    return d ? (this.shipLinks.myLinks().get(d.classNameSlug) ?? null) : null;
  });
  readonly globalPledgeLink = computed(() => {
    const d = this.detail();
    return d ? (this.shipLinks.globalLinks().get(d.classNameSlug) ?? null) : null;
  });
  readonly pledgeLink = computed(() => this.myPledgeLink() ?? this.globalPledgeLink());

  // Reverse ingredient lookup: crafting blueprints that consume this entity.
  readonly usedInBlueprints = signal<BlueprintRef[]>([]);

  // "Where to buy" (#254/#255): UEX Corp purchase locations for FPS armor
  // pieces and personal weapons. Best-effort — never blocks/fails the page.
  readonly buyOptions = signal<BuyOption[]>([]);
  readonly buyLoading = signal(false);
  readonly buyError = signal(false);
  private buySeq = 0;

  // Forward crafting lookup (#187): the recipe that PRODUCES this item, so the
  // codex can answer "which materials does this cost". Null for the vast
  // majority of catalog entries, which are not craftable.
  readonly recipe = signal<GearRecipe | null>(null);

  // Hardpoint slot-compatibility: which port is expanded + its lazy item list.
  readonly expandedPort = signal<number | null>(null);
  private readonly compatMap = signal<Map<number, PortCompat>>(new Map());

  // Resolved localized values for raw @-keys (ship role, …).
  private readonly localeMap = signal<Map<string, string>>(new Map());

  // Resolved deep-link target + display fields for default-loadout entries.
  private readonly loadoutEntities = signal<Map<string, ResolvedEntity>>(new Map());

  // Full payloads of the stock-loadout occupants, plus the `<class>_AMMO`
  // projectile payloads for the guns among them. Together these back the
  // per-hardpoint stat readout (damage/velocity/range, shield HP/regen, …).
  private readonly loadoutPayloads = signal<Map<string, { kind: CodexKind; payload: unknown }>>(
    new Map(),
  );
  private readonly ammoPayloads = signal<Map<string, unknown>>(new Map());

  // Ship tech stats derived from the stock loadout's component payloads (#137):
  // quantum range/speed + fuel capacities. Best-effort — null when unresolvable.
  private readonly techStats = signal<ShipTechStats | null>(null);

  // Star Citizen content exists in both DE and EN (DE is ~97.6% genuinely
  // translated, not an English copy). We render datamined CONTENT (names,
  // descriptions, manufacturer, role) in the app language with EN as the
  // guaranteed fallback, reacting to language switches. (UC-08)
  private readonly lang = signal<Lang>(toLang(this.t.currentLang || this.t.getDefaultLang()));

  constructor() {
    this.t.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe((e) => this.lang.set(toLang(e.lang)));
  }

  async ngOnInit(): Promise<void> {
    const kind = this.route.snapshot.paramMap.get('kind') as CodexKind | null;
    const className = this.route.snapshot.paramMap.get('className');
    if (!kind || !className) {
      this.error.set('Invalid route');
      this.loading.set(false);
      return;
    }
    await this.load(kind, className);
  }

  private async load(kind: CodexKind, className: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.expandedPort.set(null);
    this.compatMap.set(new Map());
    this.localeMap.set(new Map());
    this.techStats.set(null);
    this.loadoutPayloads.set(new Map());
    this.ammoPayloads.set(new Map());
    this.showEmptyLoadout.set(false);
    this.usedInBlueprints.set([]);
    this.recipe.set(null);
    this.artBroken.set(false);
    this.swapSlot.set(null);
    this.showLinkForm.set(false);
    this.shipLinkInput.set('');
    this.shipLinkError.set(null);
    this.shipLinkSaved.set(false);
    this.buyOptions.set([]);
    this.buyLoading.set(false);
    this.buyError.set(false);
    try {
      const d = await this.svc.getDetail(kind, className);
      this.detail.set(d);
      if (d) {
        await Promise.all([
          this.resolveLoadoutEntities(d),
          this.resolveLocale(d),
          this.resolveShipTech(d),
        ]);
        if (kind === 'item' || kind === 'weapon') void this.loadWhereToBuy(d);
        // Ships are not crafting ingredients; skip the reverse lookup for them.
        if (kind !== 'ship') void this.loadUsedInBlueprints(d.classNameSlug);
        // Ships are not craftable either, so skip the forward lookup as well.
        if (kind !== 'ship') void this.loadRecipe(d.classNameSlug);
        // Ship pages: hangar membership backs the add-to-hangar action.
        if (kind === 'ship' && this.hangar.ships().length === 0) void this.hangar.loadAll();
        // Ship pages: resolve the pinned pledge link (own > global). Best
        // effort — a missing link just falls back to the RSI ships listing.
        if (kind === 'ship') void this.shipLinks.loadForShip(d.classNameSlug);
      }
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resolve raw @-keys on the row (currently the ship role) to localized text. */
  private async resolveLocale(d: CodexDetail): Promise<void> {
    const keys: string[] = [];
    const role = d.row['role'];
    if (typeof role === 'string' && role.startsWith('@')) keys.push(role);
    if (keys.length === 0) return;
    this.localeMap.set(await this.svc.resolveLocaleKeys(keys, this.lang()));
  }

  // ── hardpoint slot compatibility ────────────────────────────────────────────
  compat(portIndex: number): PortCompat | undefined {
    return this.compatMap().get(portIndex);
  }

  async togglePort(port: CodexItemPort): Promise<void> {
    if (port.types.length === 0) return;
    if (this.expandedPort() === port.portIndex) {
      this.expandedPort.set(null);
      return;
    }
    this.expandedPort.set(port.portIndex);
    if (this.compatMap().has(port.portIndex)) return; // cached
    this.setCompat(port.portIndex, { loading: true, error: null, items: [] });
    try {
      const items = await this.svc.getCompatibleItems({
        types: port.types,
        minSize: port.minSize,
        maxSize: port.maxSize,
      });
      this.setCompat(port.portIndex, { loading: false, error: null, items });
    } catch (e) {
      this.setCompat(port.portIndex, {
        loading: false,
        error: (e as Error).message ?? 'error',
        items: [],
      });
    }
  }

  private setCompat(idx: number, v: PortCompat): void {
    const m = new Map(this.compatMap());
    m.set(idx, v);
    this.compatMap.set(m);
  }

  private async resolveLoadoutEntities(d: CodexDetail): Promise<void> {
    if (d.kind !== 'ship') return;
    const entries = (d.payload as ShipPayload | undefined)?.defaultLoadout ?? [];
    const classNames = entries
      .map((e) => e.entityClassName)
      .filter((c): c is string => !!c);
    this.loadoutEntities.set(await this.svc.resolveEntities(classNames));
  }

  /**
   * Derive ship tech facts (#137 part 1) from the STOCK loadout's component
   * payloads: quantum jump range / drive speed and the summed hydrogen /
   * quantum fuel tank capacities. Reuses the hangar's loadout-stats math so
   * codex and hangar always agree. Best-effort: failures leave the hero
   * facts without tech chips instead of breaking the page.
   */
  private async resolveShipTech(d: CodexDetail): Promise<void> {
    if (d.kind !== 'ship') return;
    const entries = (d.payload as ShipPayload | undefined)?.defaultLoadout ?? [];
    const classNames = [
      ...new Set(entries.map((e) => e.entityClassName).filter((c): c is string => !!c)),
    ];
    if (classNames.length === 0) return;
    try {
      const payloads = await this.svc.getEntityPayloads(classNames);
      // Publish the payloads first: the per-hardpoint stat readout depends only
      // on them, so it must survive a failure in the aggregate tech math below.
      this.loadoutPayloads.set(payloads);
      await this.resolveLoadoutAmmo(payloads);
      const lines: ResolvedLoadoutLine[] = [];
      for (const e of entries) {
        if (!e.entityClassName) continue;
        const hit = payloads.get(e.entityClassName);
        lines.push({
          portName: e.itemPortName ?? null,
          className: e.entityClassName,
          kind: hit?.kind ?? 'component',
          payload: hit?.payload ?? null,
        });
      }
      const stats = computeLoadoutStats(lines);
      let hydrogen: number | null = null;
      let qtFuel: number | null = null;
      let qdClassName: string | null = null;
      for (const line of lines) {
        const p = line.payload as ComponentPayload | null;
        if (!p || typeof p !== 'object' || (p as { entityKind?: string }).entityKind !== 'component') continue;
        const s = p.stats as Record<string, Record<string, unknown>> | undefined;
        // The payload `kind` union is narrower than the live extract — fuel
        // tanks arrive with kinds outside ComponentPayload['kind'], so match
        // on the raw string.
        const compKind = (p as { kind?: string }).kind ?? '';
        if (compKind === 'FuelTank') {
          const c = findStat(s, 'fuel', ['capacity', 'Capacity']);
          if (c !== null) hydrogen = (hydrogen ?? 0) + c;
        } else if (compKind === 'QuantumFuelTank') {
          const c = findStat(s, 'fuel', ['capacity', 'Capacity']);
          if (c !== null) qtFuel = (qtFuel ?? 0) + c;
        } else if (compKind === 'QuantumDrive') {
          qdClassName = line.className;
        }
      }
      this.techStats.set({
        quantum: stats.quantum,
        quantumDriveClassName: qdClassName,
        hydrogenCapacity: hydrogen,
        quantumFuelCapacity: qtFuel,
      });
    } catch {
      // tech chips are a bonus — never fail the detail page for them
    }
  }

  /**
   * Resolve the projectile ("ammo") payloads for the guns in a stock loadout.
   * The extract leaves every weapon's ammoContainerRecord null, so the only
   * link is the `<weaponClass>_AMMO` name convention — one batched query, and
   * whatever does not exist simply yields no projectile stats.
   */
  private async resolveLoadoutAmmo(
    payloads: Map<string, { kind: CodexKind; payload: unknown }>,
  ): Promise<void> {
    const weaponClasses = [...payloads.entries()]
      .filter(([, v]) => (v.payload as { entityKind?: string } | null)?.entityKind === 'weapon')
      .map(([className]) => className);
    const ammoNames = ammoClassNamesFor(weaponClasses);
    if (ammoNames.length === 0) return;
    try {
      this.ammoPayloads.set(await this.svc.getAmmoPayloads(ammoNames));
    } catch {
      // projectile stats are a bonus — a failed lookup just hides those rows
    }
  }

  /** Reverse lookup: crafting blueprints that consume this entity as an ingredient. */
  private async loadUsedInBlueprints(className: string): Promise<void> {
    try {
      this.usedInBlueprints.set(await this.svc.blueprintsUsingIngredient(className));
    } catch {
      this.usedInBlueprints.set([]);
    }
  }

  /** Forward lookup: the recipe that produces this entity, with its materials. */
  private async loadRecipe(className: string): Promise<void> {
    try {
      const bp = await this.svc.getCraftingRecipe(className);
      this.recipe.set(bp ? {
        classNameSlug: bp.classNameSlug,
        craftTimeSec: (bp.row['craft_time_seconds'] as number | null) ?? null,
        ingredients: bp.ingredients,
      } : null);
    } catch {
      // Crafting data is supplementary — a failed lookup just hides the panel.
      this.recipe.set(null);
    }
  }

  /**
   * "Where to buy" (#254/#255): resolve UEX Corp purchase locations for an FPS
   * armor piece (`kind === 'item'`) or personal weapon (`kind === 'weapon'`).
   * Best-effort — an upstream failure surfaces the error state, never breaks
   * the rest of the detail page.
   */
  private async loadWhereToBuy(d: CodexDetail): Promise<void> {
    const seq = ++this.buySeq;
    this.buyLoading.set(true);
    this.buyError.set(false);
    // Match against the ENGLISH name: UEX's catalog is English-only, so the
    // German display name ("A03-Snipergewehr") would never match "A03 Sniper
    // Rifle". Fall back to the display name when no English name exists.
    const p = d.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const name = (p?.name ? pickLocalized(p.name, 'en') : '') || this.displayName();
    const row = d.row;
    try {
      const options = await this.uexShop.whereToBuy({
        name,
        attachType: (row['attach_type'] as string | null) ?? null,
        weaponClass: (row['weapon_class'] as string | null) ?? null,
        subType: (row['sub_type'] as string | null) ?? null,
      });
      if (seq !== this.buySeq) return;
      this.buyOptions.set(options);
    } catch {
      if (seq !== this.buySeq) return;
      this.buyError.set(true);
    } finally {
      if (seq === this.buySeq) this.buyLoading.set(false);
    }
  }

  /** Ingredient display name — falls back to a humanized resource class name. */
  ingredientName(i: CodexBlueprintIngredient): string {
    return cleanLocaleValue(i.nameLocalized)
      || humanizeClassName(i.ingredientClassName ?? '')
      || (i.ingredientClassName ?? '');
  }

  // ── derived views ──────────────────────────────────────────────────────────
  readonly displayName = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const name = p?.name ? pickLocalized(p.name, this.lang()) : '';
    // name_localized may itself be an unresolved @-key — drop it if so.
    return name || cleanLocaleValue(d.row['name_localized'] as string) || humanizeClassName(d.classNameSlug);
  });

  readonly manufacturerName = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { manufacturer?: { name?: { de: string; en: string; key: string }; code?: string } } | undefined;
    const fromPayload = p?.manufacturer?.name ? pickLocalized(p.manufacturer.name, this.lang()) : '';
    return fromPayload || (d.row['manufacturer_code'] as string) || '';
  });

  readonly description = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { description?: { de: string; en: string; key: string } } | undefined;
    return unescapeText(p?.description ? pickLocalized(p.description, this.lang()) : '');
  });

  readonly provenance = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const p = d.payload as { source?: { channel: string; patch: string; build: string } } | undefined;
    return p?.source ?? null;
  });

  // Set when the hero artwork fails to load → fall back to the category icon.
  readonly artBroken = signal(false);
  onArtError(): void {
    this.artBroken.set(true);
  }

  readonly previewUrl = computed(() => {
    if (this.artBroken()) return null;
    const p = this.detail()?.payload as BaseEntityPayload | undefined;
    return this.svc.previewUrl(p?.previewImage);
  });

  /** Sub-category that refines the hero fallback icon (componentKind/weaponClass/subType). */
  heroSub(): string | null {
    const row = this.detail()?.row;
    if (!row) return null;
    return (row['kind'] as string) || (row['weapon_class'] as string) || (row['sub_type'] as string) || null;
  }

  // Original class_name (e.g. 'DRAK_Cutlass_Black') for the skin selector —
  // matches public.ship_skins.ship_id. Empty string for non-ships (hides it).
  readonly shipClassName = computed(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return '';
    const raw = d.row?.['class_name'];
    return typeof raw === 'string' && raw ? raw : d.classNameSlug;
  });

  private readonly dimensions = computed<Dimensions | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    const dim = (d.payload as ShipPayload | undefined)?.dimensions ?? null;
    if (!dim || (!dim.length && !dim.width && !dim.height)) return null;
    return dim;
  });

  /** Compact hero facts — kind-aware, only meaningful values. */
  readonly facts = computed<Fact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const out: Fact[] = [];
    const row = d.row;
    const add = (label: string, value: unknown, accent = false) => {
      if (value == null || value === '' || value === 0) return;
      out.push({ label: this.t.instant(label), value: String(value), accent });
    };

    if (d.kind === 'ship') {
      const role = row['role'];
      const roleVal =
        typeof role === 'string'
          ? cleanLocaleValue(this.localeMap().get(role) ?? role)
          : '';
      add('codex.detail.role', roleVal);
      add('codex.detail.crew', row['crew_size']);
      const dim = this.dimensions();
      if (dim) {
        out.push({
          label: this.t.instant('codex.detail.dimensions'),
          value: `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m`,
        });
      }
      // Tech facts from the stock loadout (#137): quantum + fuel numbers.
      const tech = this.techStats();
      if (tech) {
        if (tech.quantum.jumpRangeMm != null) {
          add('codex.detail.quantumRange', this.fmtGm(tech.quantum.jumpRangeMm), true);
        }
        if (tech.quantum.driveSpeedMs != null) {
          add('codex.detail.quantumSpeed', formatNumber(tech.quantum.driveSpeedMs / 1000) + ' km/s');
        }
        add('codex.detail.quantumFuel', tech.quantumFuelCapacity == null ? '' : formatNumber(tech.quantumFuelCapacity));
        add('codex.detail.fuelCapacity', tech.hydrogenCapacity == null ? '' : formatNumber(tech.hydrogenCapacity));
      }
    } else if (d.kind === 'weapon') {
      const wc = row['weapon_class'];
      if (typeof wc === 'string') add('codex.detail.weaponClass', this.t.instant('codex.weaponClass.' + wc));
      add('codex.detail.subType', row['sub_type']);
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      add('codex.detail.grade', row['grade']);
      add('codex.detail.attachType', row['attach_type']);
    } else if (d.kind === 'component') {
      const ck = row['kind'];
      if (typeof ck === 'string') add('codex.detail.componentKind', this.t.instant('codex.componentKind.' + ck));
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      add('codex.detail.grade', row['grade']);
    } else if (d.kind === 'item') {
      add('codex.detail.subType', row['sub_type']);
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      add('codex.detail.grade', row['grade']);
      add('codex.detail.attachType', row['attach_type']);
    } else if (d.kind === 'ammunition') {
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      const speed = row['speed'];
      if (typeof speed === 'number' && speed > 0) add('codex.detail.speed', formatNumber(speed) + ' m/s');
      const range = this.ammoRange();
      if (range) add('codex.detail.range', formatNumber(range) + ' m');
    }
    return out;
  });

  /** Effective ballistic range = speed × lifetime (when both present). */
  private ammoRange(): number | null {
    const p = this.detail()?.payload as AmmunitionPayload | undefined;
    if (!p) return null;
    const speed = p.speed ?? (p.raw?.['speed'] as number | undefined) ?? null;
    const life = p.lifetime ?? (p.raw?.['lifetime'] as number | undefined) ?? null;
    return speed && life ? speed * life : null;
  }

  readonly componentStats = computed<StatRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'component') return [];
    return curateComponentStats((d.payload as ComponentPayload | undefined)?.stats);
  });

  readonly weaponParams = computed<StatRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'weapon') return [];
    return meaningfulRows((d.payload as WeaponPayload | undefined)?.weaponParams);
  });

  // Personal FPS armor / undersuit pieces carry an SCItem*Params stat block in
  // the same heterogeneous shape as components — reuse the exact same curation.
  readonly armorStats = computed<StatRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'item') return [];
    return curateComponentStats((d.payload as ItemPayload | undefined)?.stats);
  });

  // Decision stats grouped by what the thing is FOR (Slice 3) — not a flat dump.
  readonly componentStatGroups = computed<StatGroup[]>(() => groupStatRows(this.componentStats()));
  readonly weaponParamGroups = computed<StatGroup[]>(() => groupStatRows(this.weaponParams()));
  readonly armorStatGroups = computed<StatGroup[]>(() => groupStatRows(this.armorStats()));

  /** Group headers only help once the stats span ≥2 buckets. */
  showStatGroupHeaders(groups: StatGroup[]): boolean {
    return groups.length > 1 || (groups.length === 1 && groups[0].purpose !== 'general');
  }

  // Full spec sheet (Manifest graft): every meaningful payload value, readable.
  readonly showSpec = signal(false);
  readonly specSections = computed<SpecSection[]>(() => {
    const d = this.detail();
    return d ? flattenSpec(d.payload) : [];
  });
  toggleSpec(): void {
    this.showSpec.update((v) => !v);
  }

  // Swap-preview dock (Rung 2): the filled slot currently being explored.
  readonly swapSlot = signal<LayoutSlot | null>(null);
  openSwapDock(slot: LayoutSlot): void {
    this.swapSlot.set(this.swapSlot()?.port === slot.port ? null : slot);
  }

  // ── hardpoint positions on the hull (#137 part 3) ───────────────────────────
  // The coordinates come out of the ship's .cga mesh via the desktop uploader,
  // so an already-ingested catalog carries none of this and every computed below
  // resolves to empty — the loadout list then renders exactly as before.
  private readonly hardpointTransforms = computed<Map<string, HardpointTransform>>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return new Map();
    return readHardpointTransforms(
      (d.payload as { hardpointTransforms?: unknown } | undefined)?.hardpointTransforms,
    );
  });

  /** The raw, validated frame from the payload (null when absent/degenerate). */
  private readonly rawHardpointFrame = computed<HardpointFrame | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    return readHardpointFrame(
      (d.payload as { hardpointFrame?: unknown } | undefined)?.hardpointFrame,
    );
  });

  /**
   * One marker per hardpoint the loadout list actually shows a row for, in row
   * order. Mesh helpers no port references are deliberately NOT plotted: a dot
   * without a row is a riddle, not information. `codex_item_ports` rows are
   * included too — they carry their own coordinates since migration
   * 20260726220000 and are the ship's structural ports.
   */
  readonly hardpointMarkers = computed<HardpointMarker[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const transforms = this.hardpointTransforms();
    const frame = this.rawHardpointFrame();
    if (transforms.size === 0 || !frame) return [];
    const inputs: HardpointMarkerInput[] = [];
    const seen = new Set<string>();
    const add = (rawPort: string | null | undefined, itemName: string | null) => {
      if (!rawPort || seen.has(rawPort)) return;
      const hit = transforms.get(rawPort);
      if (!hit) return;
      seen.add(rawPort);
      inputs.push({
        port: rawPort,
        label: this.humanizePort(rawPort),
        itemName,
        position: hit.position,
      });
    };
    for (const item of this.loadoutAll()) add(item.port, item.className ? item.name : null);
    for (const port of d.ports) add(port.portName, null);
    return buildHardpointMarkers(inputs, frame);
  });

  /**
   * The frame handed to the map: only once at least one hardpoint resolved. A
   * frame alone would draw an empty hull outline, which reads as a broken
   * feature rather than as "no data yet".
   */
  readonly hardpointFrame = computed<HardpointFrame | null>(() =>
    this.hardpointMarkers().length > 0 ? this.rawHardpointFrame() : null,
  );

  /** Raw port names the map can actually locate — drives the row affordance. */
  readonly locatablePorts = computed<string[]>(() =>
    this.hardpointMarkers().map((m) => m.port),
  );

  /** Whether the loadout card renders (it hosts the hull map when it does). */
  readonly hasLoadoutSection = computed(() => this.loadoutGroups().length > 0);

  isPortLocated(port: CodexItemPort): boolean {
    return !!port.portName && this.locatablePorts().includes(port.portName);
  }
  isPortActive(port: CodexItemPort): boolean {
    return !!port.portName && this.activePorts().includes(port.portName);
  }
  hoverPort(port: CodexItemPort): void {
    this.setActivePorts(this.isPortLocated(port) ? [port.portName as string] : null);
  }

  /**
   * The hardpoint(s) currently highlighted, hovered from either side (a loadout
   * row or a marker). One signal for both directions keeps them in sync.
   */
  readonly activePorts = signal<readonly string[]>([]);
  setActivePorts(ports: string[] | null): void {
    this.activePorts.set(ports ?? []);
  }

  /** Loadout groups mapped to the hardpoint-layout input shape (Rung 1). */
  readonly layoutGroups = computed<LayoutGroup[]>(() => {
    // Jump range rendered as a chip directly on the quantum-drive slot (#137).
    const tech = this.techStats();
    const qdChip =
      tech?.quantumDriveClassName && tech.quantum.jumpRangeMm != null
        ? this.fmtGm(tech.quantum.jumpRangeMm)
        : null;
    const payloads = this.loadoutPayloads();
    const ammo = this.ammoPayloads();
    return this.loadoutGroups().map((g) => ({
      category: g.category,
      slots: g.items.map((l) => {
        // What is installed here decides WHICH stats show: a gun gets
        // damage/velocity/range, a shield HP/regen, a cooler only durability.
        const hit = l.className ? payloads.get(l.className) : undefined;
        const item = {
          kind: hit?.kind ?? l.kind,
          payload: hit?.payload ?? null,
          ammoPayload: l.className
            ? ammo.get(ammoClassNameFor(l.className) ?? '')
            : undefined,
        };
        return {
          port: this.humanizePort(l.port),
          // Raw name kept alongside the label so the hull map can match the row.
          rawPort: l.port,
          className: l.className,
          kind: l.kind,
          name: l.name,
          size: l.size,
          grade: l.grade,
          manufacturerCode: l.manufacturerCode,
          statChip: qdChip && l.className === tech!.quantumDriveClassName ? qdChip : null,
          typeLabel: equippedTypeLabel(item),
          damageChannels: damageChannelsOf(item.payload, item.ammoPayload),
          stats: equippedStats(item),
          statsMissing: weaponStatsUnavailable(item),
        };
      }),
    }));
  });

  /**
   * How many of the ship's weapon mounts have NO stock item in this extract.
   * Almost always > 0 today: CIG keeps default weapon fits in a separate
   * loadout record our P4K extractor does not resolve yet, so only a handful of
   * ships carry guns in `defaultLoadout`. Naming the gap beats letting a pilot
   * conclude the ship is unarmed.
   */
  readonly emptyWeaponMounts = computed<number>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return 0;
    return this.loadoutAll().filter((l) => isWeaponMountPort(l.port) && !l.className).length;
  });

  /** jumpRange comes in metres → giga-metre display (Gm), same as the hangar. */
  private fmtGm(v: number): string {
    return `${formatNumber(Math.round(v / 1_000_000))} Gm`;
  }

  readonly damage = computed<DamageRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ammunition') return [];
    return ammoDamage(d.payload);
  });

  private readonly maxDamage = computed(() =>
    this.damage().reduce((m, r) => Math.max(m, r.value), 0),
  );

  damagePct(row: DamageRow): number {
    const max = this.maxDamage();
    return max > 0 ? Math.max(4, Math.round((row.value / max) * 100)) : 0;
  }

  /**
   * Ship equipment summary (weapon/shield/… counts) for the hero. Derived from
   * the INSTALLED default-loadout, not codex_item_ports — a ship's item_ports
   * are structural only (fuel/ATC/relay/lifesupport) and carry no weapon/shield
   * hardpoints, so the loadout is the only source that reflects real equipment.
   */
  readonly portSummary = computed<PortSummaryEntry[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const installed = this.loadoutAll().filter((l) => l.className);
    return summarizePorts(installed.map((l) => ({ types: [], portName: l.port })));
  });

  /** Hardpoints grouped into functional categories, in display order. */
  readonly hardpointGroups = computed<PortGroup[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const buckets = new Map<HardpointCategory, CodexItemPort[]>();
    for (const port of d.ports) {
      const cat = categorizePort(port.types, port.portName);
      (buckets.get(cat) ?? buckets.set(cat, []).get(cat)!).push(port);
    }
    return HARDPOINT_CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => ({
      category: c,
      ports: buckets.get(c)!,
    }));
  });

  private readonly loadoutAll = computed<LoadoutItem[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const entries: LoadoutEntry[] = (d.payload as ShipPayload | undefined)?.defaultLoadout ?? [];
    const resolved = this.loadoutEntities();
    return entries.map((e) => {
      const r = e.entityClassName ? resolved.get(e.entityClassName) : undefined;
      return {
        port: e.itemPortName || '—',
        className: e.entityClassName,
        kind: r?.kind ?? null,
        name: cleanLocaleValue(r?.nameLocalized) || e.entityClassName,
        size: r?.size ?? null,
        grade: r?.grade ?? null,
        manufacturerCode: r?.manufacturerCode ?? null,
      };
    });
  });

  readonly installedCount = computed(() => this.loadoutAll().filter((l) => l.className).length);
  readonly emptyLoadoutCount = computed(() => this.loadoutAll().filter((l) => !l.className).length);

  /**
   * Empty ports the toggle would reveal. Empty WEAPON mounts are always shown
   * (see loadoutGroups), so counting them here would promise rows the toggle
   * does not actually add.
   */
  readonly hiddenEmptyCount = computed(
    () => this.loadoutAll().filter((l) => !l.className && !isWeaponMountPort(l.port)).length,
  );

  /**
   * Default loadout grouped by category. Empty stock ports are hidden behind
   * the toggle — EXCEPT empty weapon mounts: "this ship has three size-3 gun
   * mounts and the extract knows no stock gun for them" is the answer to the
   * pilot's question, not noise to fold away.
   */
  readonly loadoutGroups = computed<LoadoutGroup[]>(() => {
    const all = this.loadoutAll();
    if (all.length === 0) return [];
    const visible = this.showEmptyLoadout()
      ? all
      : all.filter((l) => l.className || isWeaponMountPort(l.port));
    const buckets = new Map<HardpointCategory, LoadoutItem[]>();
    for (const item of visible) {
      const cat = categorizePort([], item.port);
      (buckets.get(cat) ?? buckets.set(cat, []).get(cat)!).push(item);
    }
    return HARDPOINT_CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => ({
      category: c,
      items: buckets.get(c)!,
    }));
  });

  readonly rawJson = computed(() => {
    const d = this.detail();
    return d ? JSON.stringify(d.payload, null, 2) : '';
  });

  // ── template helpers ─────────────────────────────────────────────────────────
  humanizePort(name: string | null): string {
    return name ? humanizePortType(name) : '—';
  }
  humanizeType(t: string): string {
    return humanizePortType(t);
  }
  fmt(n: number): string {
    return formatNumber(n);
  }
  humanizeName(cls: string): string {
    return humanizeClassName(cls);
  }
  fmtCraft(sec: number | null): string {
    return formatCraftTime(sec) ?? '';
  }

  isPinned(): boolean {
    const d = this.detail();
    return d ? this.svc.isPinned(d.kind, d.classNameSlug) : false;
  }
  togglePin(): void {
    const d = this.detail();
    if (d) this.svc.togglePin(d.kind, d.classNameSlug);
  }
  // ── user-supplied RSI pledge link (feedback f7d3bd9a) ───────────────────────
  // The typed value is validated client-side for a fast, friendly error, but
  // the `ship-link` edge function is the authority and re-validates everything.

  toggleLinkForm(): void {
    const next = !this.showLinkForm();
    this.showLinkForm.set(next);
    if (next) {
      this.shipLinkInput.set(this.myPledgeLink() ?? '');
      this.shipLinkError.set(null);
      this.shipLinkSaved.set(false);
    }
  }

  onShipLinkInput(e: Event): void {
    this.shipLinkInput.set((e.target as HTMLInputElement).value);
    if (this.shipLinkError()) this.shipLinkError.set(null);
    if (this.shipLinkSaved()) this.shipLinkSaved.set(false);
  }

  async saveShipLink(e: Event): Promise<void> {
    e.preventDefault();
    const slug = this.shipSlug();
    if (!slug) return;
    this.applyLinkResult(await this.shipLinks.setMyLink(slug, this.shipLinkInput()));
  }

  async removeShipLink(): Promise<void> {
    const slug = this.shipSlug();
    if (!slug) return;
    const err = await this.shipLinks.removeMyLink(slug);
    this.applyLinkResult(err);
    if (!err) this.shipLinkInput.set('');
  }

  /** ADMIN ONLY — publish the typed link for everyone. Server re-checks role. */
  async promoteShipLink(): Promise<void> {
    const slug = this.shipSlug();
    if (!slug) return;
    this.applyLinkResult(await this.shipLinks.promote(slug, this.shipLinkInput()));
  }

  /** ADMIN ONLY — withdraw the globally visible link. */
  async unpromoteShipLink(): Promise<void> {
    const slug = this.shipSlug();
    if (!slug) return;
    this.applyLinkResult(await this.shipLinks.unpromote(slug));
  }

  private shipSlug(): string | null {
    const d = this.detail();
    return d?.kind === 'ship' ? d.classNameSlug : null;
  }

  private applyLinkResult(err: string | null): void {
    this.shipLinkError.set(err);
    this.shipLinkSaved.set(err === null);
  }

  async addToHangar(): Promise<void> {
    const d = this.detail();
    if (d?.kind !== 'ship') return;
    const ship = await this.hangar.addShip(d.classNameSlug, 'owned');
    // UC-07: jump straight into the configurator instead of leaving a dead row.
    if (ship) await this.router.navigate(['/hangar/ship', ship.id]);
  }

  /** UC-07: open the hangar configurator for a ship already in the hangar. */
  configureLoadout(): void {
    const d = this.detail();
    const ship = d ? this.hangar.shipByClassName(d.classNameSlug) : null;
    void this.router.navigate(ship ? ['/hangar/ship', ship.id] : ['/hangar']);
  }
  toggleRaw(): void {
    this.showRaw.update((v) => !v);
  }
  toggleEmptyLoadout(): void {
    this.showEmptyLoadout.update((v) => !v);
  }

  sizeRange(min: number | null, max: number | null): string {
    if (min == null && max == null) return '—';
    if (min === max || max == null) return 'S' + String(min ?? max);
    if (min == null) return 'S' + String(max);
    return `S${min}–${max}`;
  }
}
