import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  CodexService,
  PortQuery,
  ResolvedEntity,
  pickLocalized,
} from '../codex/codex.service';
import {
  HARDPOINT_CATEGORY_ORDER,
  HardpointCategory,
  categorizePort,
  cleanLocaleValue,
  formatNumber,
  humanizeClassName,
  humanizePortType,
} from '../codex/codex-format';
import type { CodexItemPort, ShipPayload } from '../codex/codex.types';
import { ShipSkinViewerComponent } from '../codex/ship-skin-viewer.component';
import { HangarItemPickerComponent, PickedItem } from './hangar-item-picker.component';
import { HangarService } from './hangar.service';
import {
  ConfigLoadoutEntry,
  HangarShip,
  HangarShipConfig,
  SHIP_CONFIG_ROLES,
  ShipConfigRole,
} from './hangar.types';
import {
  ComponentKeyStat,
  LoadoutStats,
  componentKeyStats,
  computeLoadoutStats,
  mergeLoadout,
} from './loadout-stats';

interface PortRow {
  port: CodexItemPort;
  category: HardpointCategory;
  /** className currently on the port (override > stock), null = empty */
  assigned: string | null;
  /** true when the assignment differs from stock */
  overridden: boolean;
  stockClassName: string | null;
}

/**
 * Hangar ship detail — the personal configurator: hardpoints with per-port
 * component swaps (compatible-items resolver), named role configs, aggregate
 * loadout stats, 3D skin viewer. Codex data stays read-only; everything the
 * user changes lands in hangar_ship_configs.loadout.
 */
@Component({
  selector: 'sc-hangar-ship-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, ShipSkinViewerComponent, HangarItemPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <a class="back" routerLink="/hangar">← {{ 'hangar.detail.back' | translate }}</a>

      @if (notFound()) {
        <div class="sc-card empty">
          <strong>{{ 'hangar.detail.notFound' | translate }}</strong>
        </div>
      } @else if (ship(); as s) {
        <header class="head">
          <div class="title-block">
            <div class="name-row">
              @if (editingName()) {
                <input class="name-input" type="text" [ngModel]="nameDraft()" (ngModelChange)="nameDraft.set($event)"
                       (keyup.enter)="saveName()" (keyup.escape)="editingName.set(false)"
                       [attr.aria-label]="'hangar.detail.rename' | translate" />
                <button class="sc-btn small" type="button" (click)="saveName()">{{ 'hangar.detail.save' | translate }}</button>
              } @else {
                <h1>{{ s.customName || shipDisplayName() }}</h1>
                <button class="icon-btn" type="button" (click)="startEditName()"
                        [attr.aria-label]="'hangar.detail.rename' | translate">✎</button>
              }
            </div>
            @if (s.customName) { <p class="sub">{{ shipDisplayName() }}</p> }
            <div class="badges">
              @if (manufacturer()) { <span class="badge mfr">{{ manufacturer() }}</span> }
              @if (crewSize() != null) { <span class="badge">{{ 'codex.card.crew' | translate: { count: crewSize() } }}</span> }
              <span class="badge" [class.wishlist]="s.status === 'wishlist'">
                {{ ('hangar.status.' + s.status) | translate }}
              </span>
              @if (s.pinnedRank) { <span class="badge pin">#{{ s.pinnedRank }}</span> }
            </div>
          </div>
          <div class="head-actions">
            <label class="facet">
              <span>{{ 'hangar.detail.pinLabel' | translate }}</span>
              <select class="sc-select" [ngModel]="pinValue()" (ngModelChange)="setPin($event)">
                <option value="">—</option>
                <option value="1">#1</option>
                <option value="2">#2</option>
                <option value="3">#3</option>
              </select>
            </label>
            <button class="sc-btn small" type="button" (click)="toggleStatus()">
              {{ (s.status === 'owned' ? 'hangar.detail.moveToWishlist' : 'hangar.detail.moveToOwned') | translate }}
            </button>
            <a class="sc-btn small ghost" [routerLink]="['/codex', 'ship', s.shipClassName]">
              {{ 'hangar.detail.openCodex' | translate }}
            </a>
            <button class="sc-btn small danger" type="button" (click)="remove()">
              {{ 'hangar.detail.remove' | translate }}
            </button>
          </div>
        </header>

        <!-- 3D / skins -->
        <sc-ship-skin-viewer [shipId]="s.shipClassName" />

        <!-- Configs -->
        <div class="sc-card configs">
          <div class="configs-head">
            <h2>{{ 'hangar.configs.title' | translate }}</h2>
            <div class="new-config">
              <input class="cfg-name" type="text" [ngModel]="newConfigName()" (ngModelChange)="newConfigName.set($event)"
                     [attr.placeholder]="'hangar.configs.namePlaceholder' | translate"
                     [attr.aria-label]="'hangar.configs.namePlaceholder' | translate" />
              <select class="sc-select" [ngModel]="newConfigRole()" (ngModelChange)="newConfigRole.set($event)">
                @for (r of roles; track r) {
                  <option [value]="r">{{ ('hangar.roles.' + r) | translate }}</option>
                }
              </select>
              <button class="sc-btn small" type="button" [disabled]="!newConfigName().trim()" (click)="createConfig()">
                {{ 'hangar.configs.create' | translate }}
              </button>
            </div>
          </div>

          @if (configs().length === 0) {
            <p class="hint">{{ 'hangar.configs.empty' | translate }}</p>
          } @else {
            <div class="config-tabs">
              @for (c of configs(); track c.id) {
                <button type="button" class="cfg-tab" [class.active]="selectedConfigId() === c.id"
                        (click)="selectConfig(c)">
                  <span>{{ c.name }}</span>
                  <span class="cfg-role">{{ ('hangar.roles.' + c.role) | translate }}</span>
                  @if (c.isActive) { <span class="cfg-active">●</span> }
                </button>
              }
            </div>
            @if (selectedConfig(); as cfg) {
              <div class="cfg-actions">
                @if (!cfg.isActive) {
                  <button class="sc-btn small" type="button" (click)="activate(cfg)">{{ 'hangar.configs.activate' | translate }}</button>
                }
                @if (dirty()) {
                  <button class="sc-btn small primary" type="button" (click)="saveLoadout()">{{ 'hangar.configs.saveLoadout' | translate }}</button>
                  <button class="sc-btn small ghost" type="button" (click)="discardDraft()">{{ 'hangar.configs.discard' | translate }}</button>
                }
                <button class="sc-btn small danger ghost" type="button" (click)="deleteConfig(cfg)">{{ 'hangar.configs.delete' | translate }}</button>
              </div>
            }
          }
        </div>

        <!-- Standard components (factory/stock loadout from P4K) — read-only,
             always visible so the ship's default kit is listed without first
             creating a config. -->
        <div class="sc-card standard">
          <div class="std-head">
            <h2>{{ 'hangar.standard.title' | translate }}</h2>
            @if (stockCount() > 0) {
              <span class="std-ct">{{ 'hangar.standard.count' | translate: { count: stockCount() } }}</span>
            }
          </div>
          <p class="hint">{{ 'hangar.standard.subtitle' | translate }}</p>
          @if (stockCount() === 0) {
            <p class="hint std-empty">{{ 'hangar.standard.empty' | translate }}</p>
          } @else {
            @for (cat of stockCategories(); track cat) {
              <div class="cat">
                <h3>{{ ('codex.portCategory.' + cat) | translate }}</h3>
                <div class="std-list">
                  @for (row of stockPortsByCategory(cat); track row.port.portName) {
                    <div class="std-item">
                      <span class="std-name">{{ resolvedName(row.stockClassName!) }}</span>
                      <span class="std-meta">
                        @if (row.port.portName) { <span class="std-port">{{ row.port.portName }}</span> }
                        @if (row.port.minSize != null || row.port.maxSize != null) {
                          <span class="badge subtle">S{{ row.port.minSize ?? '?' }}–{{ row.port.maxSize ?? '?' }}</span>
                        }
                        @for (t of row.port.types.slice(0, 2); track t) {
                          <span class="badge subtle">{{ humanizeType(t) }}</span>
                        }
                      </span>
                      @if (portStats(row.stockClassName); as cstats) {
                        @if (cstats.length) {
                          <div class="comp-stats">
                            @for (st of cstats; track st.labelKey) {
                              <span class="comp-stat">
                                <span class="cs-k">{{ st.labelKey | translate }}</span>
                                <span class="cs-v">{{ st.text }}</span>
                              </span>
                            }
                          </div>
                        }
                      }
                    </div>
                  }
                </div>
              </div>
            }
          }
        </div>

        <!-- Aggregate stats -->
        @if (selectedConfig()) {
          <div class="sc-card stats">
            <h2>{{ 'hangar.stats.title' | translate }}</h2>
            <div class="stat-grid">
              <div class="stat">
                <span class="stat-label">{{ 'hangar.stats.weapons' | translate }}</span>
                <strong>{{ stats().weaponCount }}</strong>
                <span class="stat-sub">{{ weaponSizeSummary() }}</span>
              </div>
              <div class="stat">
                <span class="stat-label">{{ 'hangar.stats.shieldHp' | translate }}</span>
                <strong>{{ stats().shieldHp != null ? fmt(stats().shieldHp!) : '—' }}</strong>
                @if (stats().shieldRegen != null) {
                  <span class="stat-sub">+{{ fmt(stats().shieldRegen!) }}/s</span>
                }
              </div>
              <div class="stat">
                <span class="stat-label">{{ 'hangar.stats.quantumRange' | translate }}</span>
                <strong>{{ stats().quantum.jumpRangeMm != null ? fmtGm(stats().quantum.jumpRangeMm!) : '—' }}</strong>
                @if (stats().quantum.driveSpeedMs != null) {
                  <span class="stat-sub">{{ fmt(stats().quantum.driveSpeedMs! / 1000) }} km/s</span>
                }
              </div>
              <div class="stat">
                <span class="stat-label">{{ 'hangar.stats.assigned' | translate }}</span>
                <strong>{{ stats().totalAssigned }}</strong>
                <span class="stat-sub">{{ 'hangar.stats.ofPorts' | translate: { count: ports().length } }}</span>
              </div>
            </div>
            <p class="stats-note">{{ 'hangar.stats.note' | translate }}</p>
          </div>
        }

        <!-- Hardpoints / loadout editor -->
        @if (selectedConfig()) {
          <div class="sc-card hardpoints">
            <h2>{{ 'hangar.loadout.title' | translate }}</h2>
            @if (ports().length === 0) {
              <p class="hint">{{ 'hangar.loadout.noPorts' | translate }}</p>
            }
            @for (cat of categories(); track cat) {
              <div class="cat">
                <h3>{{ ('codex.portCategory.' + cat) | translate }}</h3>
                <div class="port-list">
                  @for (row of portsByCategory(cat); track row.port.portName) {
                    <div class="port" [class.overridden]="row.overridden">
                      <div class="port-info">
                        <span class="port-name">{{ row.port.portName || '—' }}</span>
                        <span class="port-meta">
                          @if (row.port.minSize != null || row.port.maxSize != null) {
                            <span class="badge subtle">S{{ row.port.minSize ?? '?' }}–{{ row.port.maxSize ?? '?' }}</span>
                          }
                          @for (t of row.port.types.slice(0, 2); track t) {
                            <span class="badge subtle">{{ humanizeType(t) }}</span>
                          }
                        </span>
                      </div>
                      <div class="port-assign">
                        @if (row.assigned) {
                          <span class="assign-name" [class.custom]="row.overridden">
                            {{ resolvedName(row.assigned) }}
                          </span>
                        } @else {
                          <span class="assign-name empty">{{ 'hangar.loadout.empty' | translate }}</span>
                        }
                        <button class="sc-btn tiny" type="button" (click)="openPicker(row)">
                          {{ 'hangar.loadout.change' | translate }}
                        </button>
                        @if (row.overridden) {
                          <button class="sc-btn tiny ghost" type="button" (click)="resetPort(row)">
                            {{ 'hangar.loadout.reset' | translate }}
                          </button>
                        }
                      </div>
                      @if (portStats(row.assigned); as cstats) {
                        @if (cstats.length) {
                          <div class="comp-stats">
                            @for (st of cstats; track st.labelKey) {
                              <span class="comp-stat">
                                <span class="cs-k">{{ st.labelKey | translate }}</span>
                                <span class="cs-v">{{ st.text }}</span>
                              </span>
                            }
                          </div>
                        }
                      }
                      @if (pickerPort() === row.port.portName) {
                        <sc-hangar-item-picker
                          [port]="portQuery(row.port)"
                          (picked)="onPicked(row, $event)"
                          (closed)="pickerPort.set(null)" />
                      }
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        } @else if (configs().length === 0) {
          <div class="sc-card empty">
            <p>{{ 'hangar.loadout.createConfigFirst' | translate }}</p>
          </div>
        }

        <!-- Notes -->
        <div class="sc-card notes">
          <h2>{{ 'hangar.detail.notes' | translate }}</h2>
          <textarea rows="3" [ngModel]="notesDraft()" (ngModelChange)="notesDraft.set($event)"
                    [attr.placeholder]="'hangar.detail.notesPlaceholder' | translate"></textarea>
          @if (notesDraft() !== (s.notes ?? '')) {
            <button class="sc-btn small" type="button" (click)="saveNotes()">{{ 'hangar.detail.save' | translate }}</button>
          }
        </div>
      } @else {
        <div class="sc-card empty">{{ 'hangar.detail.loading' | translate }}</div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 16px; }
    .back { color: var(--sc-fg-2); text-decoration: none; font-size: 0.82rem; }
    .back:hover { color: var(--sc-accent); }

    .head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
    .name-row { display: flex; align-items: center; gap: 10px; }
    .name-row h1 { margin: 0; }
    .name-input { padding: 8px 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-accent); color: var(--sc-fg-0); font-size: 1.2rem; font-family: inherit; }
    .icon-btn { border: none; background: transparent; color: var(--sc-fg-2); cursor: pointer; font-size: 1rem; }
    .icon-btn:hover { color: var(--sc-accent); }
    .sub { margin: 2px 0 0; color: var(--sc-fg-2); }
    .badges { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .badge { font-size: max(0.68rem, var(--sc-fs-floor)); padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .badge.wishlist { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .badge.pin { background: color-mix(in srgb, var(--sc-accent) 30%, transparent); }

    .head-actions { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
    .facet { display: flex; flex-direction: column; gap: 4px; }
    .facet > span { font-size: max(0.64rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .sc-select { background: var(--sc-bg-1); color: var(--sc-fg-0); border: 1px solid var(--sc-border); border-radius: 6px; padding: 7px 10px; font-family: inherit; font-size: 0.82rem; cursor: pointer; }
    .sc-btn { padding: 8px 14px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: max(0.74rem, var(--sc-fs-floor)); letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
    .sc-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .sc-btn:disabled { opacity: 0.5; cursor: default; }
    .sc-btn.small { padding: 7px 12px; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .sc-btn.tiny { padding: 4px 9px; font-size: max(0.64rem, var(--sc-fs-floor)); }
    .sc-btn.ghost { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .sc-btn.ghost:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .sc-btn.danger { border-color: var(--sc-danger); color: var(--sc-danger); }
    .sc-btn.danger:hover { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .sc-btn.primary { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }

    .sc-card h2 { margin: 0 0 12px; font-size: 1rem; }
    .hint { color: var(--sc-fg-2); font-size: 0.84rem; margin: 0; }
    .empty { text-align: center; padding: 28px; color: var(--sc-fg-2); }

    .configs-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; }
    .new-config { display: flex; gap: 8px; flex-wrap: wrap; }
    .cfg-name { padding: 7px 10px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.84rem; }
    .cfg-name:focus { outline: none; border-color: var(--sc-accent); }
    .config-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
    .cfg-tab { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-1); cursor: pointer; font-family: inherit; font-size: 0.8rem; }
    .cfg-tab:hover { border-color: var(--sc-accent); }
    .cfg-tab.active { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0); }
    .cfg-role { font-size: max(0.64rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .cfg-active { color: var(--sc-success, #4ade80); }
    .cfg-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

    .stat-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    .stat { display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .stat-label { font-size: max(0.64rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .stat strong { font-size: 1.3rem; font-family: var(--sc-font-display); color: var(--sc-accent); }
    .stat-sub { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .stats-note { margin: 10px 0 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .cat { margin-top: 14px; }
    .cat h3 { margin: 0 0 8px; font-size: max(0.78rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .port-list { display: flex; flex-direction: column; gap: 6px; }
    .port { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .port.overridden { border-color: color-mix(in srgb, var(--sc-accent) 50%, transparent); }
    .port-info { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .port-name { font-family: var(--sc-font-mono, monospace); font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-1); word-break: break-all; }
    .port-meta { display: flex; gap: 4px; flex-wrap: wrap; }
    .port-assign { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .assign-name { flex: 1; font-size: 0.86rem; min-width: 140px; }
    .assign-name.custom { color: var(--sc-accent); }
    .assign-name.empty { color: var(--sc-fg-2); font-style: italic; }

    .comp-stats { display: flex; flex-wrap: wrap; gap: 6px; }
    .std-item .comp-stats { flex: 1 1 100%; }
    .comp-stat { display: inline-flex; align-items: baseline; gap: 5px; padding: 2px 9px; border-radius: 999px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); }
    .cs-k { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .cs-v { font-size: max(0.74rem, var(--sc-fs-floor)); font-family: var(--sc-font-display); color: var(--sc-accent); }

    .std-head { display: flex; align-items: baseline; gap: 10px; }
    .std-head h2 { margin: 0; }
    .std-ct { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); padding: 1px 8px; border-radius: 999px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .standard .hint { margin: 6px 0 0; }
    .std-empty { margin-top: 10px; }
    .std-list { display: flex; flex-direction: column; gap: 6px; }
    .std-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); flex-wrap: wrap; }
    .std-name { font-size: 0.88rem; color: var(--sc-fg-0); flex: 1; min-width: 140px; }
    .std-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .std-port { font-family: var(--sc-font-mono, monospace); font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }

    .notes textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.86rem; resize: vertical; margin-bottom: 8px; }
    .notes textarea:focus { outline: none; border-color: var(--sc-accent); }

    @media (max-width: 720px) {
      .head { flex-direction: column; }
    }
    @media (max-width: 560px) {
      .stat strong { font-size: 1.15rem; }
      .assign-name { min-width: 0; flex: 1 1 100%; }
      .new-config, .new-config .cfg-name { flex: 1 1 100%; }
    }
  `],
})
export class HangarShipDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hangar = inject(HangarService);
  private readonly codex = inject(CodexService);

  readonly roles = SHIP_CONFIG_ROLES;

  readonly ship = signal<HangarShip | null>(null);
  readonly notFound = signal(false);
  readonly shipPayload = signal<ShipPayload | null>(null);
  readonly ports = signal<CodexItemPort[]>([]);
  readonly configs = signal<HangarShipConfig[]>([]);
  readonly selectedConfigId = signal<string | null>(null);

  /** Draft port overrides of the selected config (portName → entry). */
  readonly draft = signal<Map<string, ConfigLoadoutEntry>>(new Map());
  readonly dirty = signal(false);

  readonly editingName = signal(false);
  readonly nameDraft = signal('');
  readonly notesDraft = signal('');
  readonly newConfigName = signal('');
  readonly newConfigRole = signal<ShipConfigRole>('multipurpose');
  readonly pickerPort = signal<string | null>(null);

  private readonly resolved = signal<Map<string, ResolvedEntity>>(new Map());
  private readonly payloads = signal<Map<string, { kind: string; payload: unknown }>>(new Map());

  readonly selectedConfig = computed(
    () => this.configs().find((c) => c.id === this.selectedConfigId()) ?? null,
  );

  readonly shipDisplayName = computed(() => {
    const p = this.shipPayload();
    const en = p?.name ? pickLocalized(p.name, 'en') : '';
    return (
      en ||
      cleanLocaleValue(this.ship()?.shipClassName ?? null) ||
      humanizeClassName(this.ship()?.shipClassName)
    );
  });
  readonly manufacturer = computed(() => this.shipPayload()?.manufacturer?.code ?? null);
  readonly crewSize = computed(() => this.shipPayload()?.crew?.size ?? null);
  readonly pinValue = computed(() => (this.ship()?.pinnedRank ? String(this.ship()!.pinnedRank) : ''));

  /** stock + overrides, the loadout-stats input. */
  private readonly mergedLines = computed(() => {
    const overrides = [...this.draft().values()];
    return mergeLoadout(this.shipPayload(), overrides);
  });

  readonly stats = computed<LoadoutStats>(() => {
    const payloadMap = this.payloads();
    const lines = this.mergedLines().map((l) => ({
      portName: l.portName,
      className: l.className,
      kind: l.kind ?? payloadMap.get(l.className)?.kind ?? 'item',
      payload: payloadMap.get(l.className)?.payload ?? null,
    }));
    return computeLoadoutStats(lines);
  });

  readonly portRows = computed<PortRow[]>(() => {
    const stockByPort = new Map(
      (this.shipPayload()?.defaultLoadout ?? [])
        .filter((e) => e.itemPortName)
        .map((e) => [e.itemPortName!, e.entityClassName]),
    );
    const draft = this.draft();
    return this.ports().map((port) => {
      const name = port.portName ?? '';
      const override = name ? draft.get(name) : undefined;
      const stock = name ? (stockByPort.get(name) ?? null) : null;
      return {
        port,
        category: categorizePort(port.types, port.portName),
        assigned: override?.className ?? stock,
        overridden: !!override,
        stockClassName: stock,
      };
    });
  });

  readonly categories = computed<HardpointCategory[]>(() => {
    const present = new Set(this.portRows().map((r) => r.category));
    return HARDPOINT_CATEGORY_ORDER.filter((c) => present.has(c));
  });

  portsByCategory(cat: HardpointCategory): PortRow[] {
    return this.portRows().filter((r) => r.category === cat);
  }

  /** Ports that ship a factory/stock component (the ship's standard kit). */
  private readonly stockRows = computed<PortRow[]>(() =>
    this.portRows().filter((r) => r.stockClassName),
  );
  readonly stockCount = computed(() => this.stockRows().length);
  readonly stockCategories = computed<HardpointCategory[]>(() => {
    const present = new Set(this.stockRows().map((r) => r.category));
    return HARDPOINT_CATEGORY_ORDER.filter((c) => present.has(c));
  });

  stockPortsByCategory(cat: HardpointCategory): PortRow[] {
    return this.stockRows().filter((r) => r.category === cat);
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      return;
    }
    if (this.hangar.ships().length === 0) await this.hangar.loadAll();
    const ship = await this.hangar.getShip(id);
    if (!ship) {
      this.notFound.set(true);
      return;
    }
    this.ship.set(ship);
    this.notesDraft.set(ship.notes ?? '');

    const [detail, configs] = await Promise.all([
      this.codex.getDetail('ship', ship.shipClassName),
      this.hangar.listConfigs(ship.id),
    ]);
    if (detail) {
      this.shipPayload.set(detail.payload as ShipPayload);
      this.ports.set(detail.ports);
    }
    this.configs.set(configs);
    const active = configs.find((c) => c.isActive) ?? configs[0];
    if (active) this.selectConfig(active);
    else await this.refreshResolved();
  }

  selectConfig(cfg: HangarShipConfig): void {
    this.selectedConfigId.set(cfg.id);
    this.draft.set(new Map(cfg.loadout.map((e) => [e.portName, e])));
    this.dirty.set(false);
    this.pickerPort.set(null);
    void this.refreshResolved();
  }

  async createConfig(): Promise<void> {
    const ship = this.ship();
    const name = this.newConfigName().trim();
    if (!ship || !name) return;
    const cfg = await this.hangar.createConfig(ship.id, name, this.newConfigRole());
    if (cfg) {
      this.configs.set([cfg, ...this.configs()]);
      this.newConfigName.set('');
      this.selectConfig(cfg);
    }
  }

  async activate(cfg: HangarShipConfig): Promise<void> {
    const ship = this.ship();
    if (!ship) return;
    if (await this.hangar.activateConfig(cfg.id, ship.id)) {
      this.configs.set(
        this.configs().map((c) => ({ ...c, isActive: c.id === cfg.id })),
      );
    }
  }

  async deleteConfig(cfg: HangarShipConfig): Promise<void> {
    if (await this.hangar.deleteConfig(cfg.id)) {
      const rest = this.configs().filter((c) => c.id !== cfg.id);
      this.configs.set(rest);
      if (this.selectedConfigId() === cfg.id) {
        if (rest[0]) this.selectConfig(rest[0]);
        else {
          this.selectedConfigId.set(null);
          this.draft.set(new Map());
        }
      }
    }
  }

  async saveLoadout(): Promise<void> {
    const cfg = this.selectedConfig();
    if (!cfg) return;
    const loadout = [...this.draft().values()];
    const updated = await this.hangar.updateConfig(cfg.id, { loadout });
    if (updated) {
      this.configs.set(this.configs().map((c) => (c.id === updated.id ? updated : c)));
      this.dirty.set(false);
    }
  }

  discardDraft(): void {
    const cfg = this.selectedConfig();
    if (cfg) this.selectConfig(cfg);
  }

  openPicker(row: PortRow): void {
    this.pickerPort.set(row.port.portName);
  }

  portQuery(port: CodexItemPort): PortQuery {
    return { types: port.types, minSize: port.minSize, maxSize: port.maxSize };
  }

  onPicked(row: PortRow, item: PickedItem): void {
    const portName = row.port.portName;
    if (!portName) return;
    const next = new Map(this.draft());
    next.set(portName, { portName, className: item.className, kind: item.kind });
    this.draft.set(next);
    this.dirty.set(true);
    this.pickerPort.set(null);
    void this.refreshResolved();
  }

  resetPort(row: PortRow): void {
    const portName = row.port.portName;
    if (!portName) return;
    const next = new Map(this.draft());
    next.delete(portName);
    this.draft.set(next);
    this.dirty.set(true);
  }

  resolvedName(className: string): string {
    const r = this.resolved().get(className);
    return r?.nameLocalized || humanizeClassName(className);
  }

  humanizeType(t: string): string {
    return humanizePortType(t);
  }

  fmt(v: number): string {
    return formatNumber(Math.round(v));
  }

  /** jumpRange comes in metres → giga-metre display (Gm). */
  fmtGm(v: number): string {
    return `${formatNumber(Math.round(v / 1_000_000))} Gm`;
  }

  /**
   * Headline technical stats of the component on a port (e.g. the quantum
   * drive's jump range), formatted for display. Empty when the component has no
   * curated stats or its payload isn't resolved yet.
   */
  portStats(className: string | null): { labelKey: string; text: string }[] {
    if (!className) return [];
    const payload = this.payloads().get(className)?.payload ?? null;
    return componentKeyStats(payload).map((s) => ({
      labelKey: s.labelKey,
      text: this.formatCompStat(s),
    }));
  }

  private formatCompStat(s: ComponentKeyStat): string {
    switch (s.format) {
      case 'gm':
        return this.fmtGm(s.value);
      case 'kmPerSec':
        return `${this.fmt(s.value / 1000)} km/s`;
      case 'intPerSec':
        return `+${this.fmt(s.value)}/s`;
      default:
        return this.fmt(s.value);
    }
  }

  weaponSizeSummary(): string {
    const sizes = this.stats().weaponsBySize;
    return Object.entries(sizes)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([size, ct]) => `${ct}×S${size}`)
      .join(' · ');
  }

  startEditName(): void {
    this.nameDraft.set(this.ship()?.customName ?? '');
    this.editingName.set(true);
  }

  async saveName(): Promise<void> {
    const ship = this.ship();
    if (!ship) return;
    const name = this.nameDraft().trim() || null;
    if (await this.hangar.updateShip(ship.id, { customName: name })) {
      this.ship.set({ ...ship, customName: name });
    }
    this.editingName.set(false);
  }

  async saveNotes(): Promise<void> {
    const ship = this.ship();
    if (!ship) return;
    const notes = this.notesDraft().trim() || null;
    if (await this.hangar.updateShip(ship.id, { notes })) {
      this.ship.set({ ...ship, notes });
    }
  }

  async setPin(value: string): Promise<void> {
    const ship = this.ship();
    if (!ship) return;
    const rank = value ? (Number(value) as 1 | 2 | 3) : null;
    if (await this.hangar.pinShip(ship.id, rank)) {
      this.ship.set({ ...ship, pinnedRank: rank });
    }
  }

  async toggleStatus(): Promise<void> {
    const ship = this.ship();
    if (!ship) return;
    const status = ship.status === 'owned' ? 'wishlist' : 'owned';
    if (await this.hangar.updateShip(ship.id, { status })) {
      this.ship.set({ ...ship, status });
    }
  }

  async remove(): Promise<void> {
    const ship = this.ship();
    if (!ship) return;
    if (await this.hangar.removeShip(ship.id)) {
      void this.router.navigate(['/hangar']);
    }
  }

  /** Re-resolve display names + payloads for everything in the merged loadout. */
  private async refreshResolved(): Promise<void> {
    // Merged loadout names + all stock component names, so the read-only
    // "standard components" list resolves display names even for ports that
    // the active config has overridden (which drops them from mergedLines).
    const stock = (this.shipPayload()?.defaultLoadout ?? [])
      .map((e) => e.entityClassName)
      .filter((c): c is string => !!c);
    const names = [...new Set([...this.mergedLines().map((l) => l.className), ...stock])];
    if (names.length === 0) return;
    const [resolved, payloads] = await Promise.all([
      this.codex.resolveEntities(names),
      this.codex.getEntityPayloads(names),
    ]);
    this.resolved.set(resolved);
    this.payloads.set(payloads);
  }
}
