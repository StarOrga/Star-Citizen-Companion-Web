import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  AmmunitionPayload,
  BaseEntityPayload,
  CodexItemPort,
  ComponentPayload,
  Dimensions,
  Lang,
  LoadoutEntry,
  ShipPayload,
  WeaponPayload,
} from './codex.types';
import {
  CodexDetail,
  CodexKind,
  CodexService,
  CompatibleItem,
  pickLocalized,
} from './codex.service';
import {
  DamageRow,
  HARDPOINT_CATEGORY_ORDER,
  HardpointCategory,
  StatRow,
  ammoDamage,
  categorizePort,
  curateComponentStats,
  formatNumber,
  humanizePortType,
  meaningfulRows,
  unescapeText,
} from './codex-format';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';

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

interface LoadoutItem {
  port: string;
  className: string | null;
  kind: CodexKind | null;
}
interface LoadoutGroup {
  category: HardpointCategory;
  items: LoadoutItem[];
}

@Component({
  selector: 'sc-codex-detail',
  standalone: true,
  imports: [RouterLink, TranslateModule, CodexCompareTrayComponent],
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
        <!-- ── Hero ──────────────────────────────────────────────── -->
        <header class="hero sc-card" [class.no-art]="!previewUrl()">
          @if (previewUrl(); as src) {
            <figure class="hero-art">
              <img [src]="src" [alt]="displayName()" loading="eager" />
            </figure>
          }
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

            <div class="hero-actions">
              <button type="button" class="pin" [class.pinned]="isPinned()" (click)="togglePin()">
                {{ isPinned() ? '★' : '☆' }} {{ (isPinned() ? 'codex.compare.pinned' : 'codex.compare.pin') | translate }}
              </button>
              @if (provenance(); as p) {
                <span class="prov" [attr.title]="'codex.provenance.tooltip' | translate">
                  {{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}
                </span>
              }
            </div>
          </div>
        </header>

        <!-- ── Description ───────────────────────────────────────── -->
        @if (description(); as d) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.description' | translate }}</h2>
            <p class="desc">{{ d }}</p>
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

        <!-- ── Component key stats ───────────────────────────────── -->
        @if (componentStats().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.keyStats' | translate }}</h2>
            <div class="stat-grid">
              @for (s of componentStats(); track s.key) {
                <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}</span></div>
              }
            </div>
          </section>
        }

        <!-- ── Weapon parameters (filtered) ──────────────────────── -->
        @if (weaponParams().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.weaponParams' | translate }}</h2>
            <div class="stat-grid">
              @for (s of weaponParams(); track s.key) {
                <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}</span></div>
              }
            </div>
          </section>
        }

        <!-- ── Hardpoints, grouped by category ───────────────────── -->
        @if (hardpointGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.hardpoints' | translate }} <span class="ct">{{ detail()!.ports.length }}</span></h2>
            <p class="hint">{{ 'codex.detail.hardpointsHint' | translate }}</p>
            @for (g of hardpointGroups(); track g.category) {
              <div class="hp-group">
                <h3 class="hp-cat">
                  {{ ('codex.portCategory.' + g.category) | translate }}
                  <span class="hp-ct">{{ g.ports.length }}</span>
                </h3>
                <ul class="hp-list">
                  @for (port of g.ports; track port.portIndex) {
                    <li class="hp" [class.expandable]="port.types.length > 0" [class.open]="expandedPort() === port.portIndex">
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

        <!-- ── Default loadout, grouped ──────────────────────────── -->
        @if (loadoutGroups().length > 0) {
          <section class="sc-card block">
            <h2>
              {{ 'codex.detail.loadout' | translate }}
              <span class="ct">{{ installedCount() }}</span>
              @if (emptyLoadoutCount() > 0) {
                <button type="button" class="ghost-toggle" (click)="toggleEmptyLoadout()">
                  {{ (showEmptyLoadout() ? 'codex.detail.hideEmptyPorts' : 'codex.detail.showEmptyPorts') | translate: { count: emptyLoadoutCount() } }}
                </button>
              }
            </h2>
            @for (g of loadoutGroups(); track g.category) {
              <div class="hp-group">
                <h3 class="hp-cat">{{ ('codex.portCategory.' + g.category) | translate }}<span class="hp-ct">{{ g.items.length }}</span></h3>
                <ul class="ld-list">
                  @for (l of g.items; track l.port) {
                    <li class="ld" [class.empty]="!l.className">
                      <span class="ld-port">{{ humanizePort(l.port) }}</span>
                      @if (l.className && l.kind) {
                        <a class="ld-link" [routerLink]="['/codex', l.kind, l.className]">{{ l.className }}</a>
                      } @else if (l.className) {
                        <code class="ld-cls">{{ l.className }}</code>
                      } @else {
                        <span class="ld-empty">{{ 'codex.detail.loadoutEmpty' | translate }}</span>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }

        <!-- ── Raw payload (power users) ─────────────────────────── -->
        <section class="sc-card block raw-block">
          <button type="button" class="raw-toggle" (click)="toggleRaw()">
            {{ (showRaw() ? 'codex.detail.hideRaw' : 'codex.detail.showRaw') | translate }}
          </button>
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
    .hero { display: grid; grid-template-columns: minmax(220px, 360px) 1fr; gap: 22px; padding: 0; overflow: hidden; }
    .hero.no-art { grid-template-columns: 1fr; }
    .hero-art { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 240px;
      background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--sc-accent) 12%, var(--sc-bg-1)), var(--sc-bg-0)); }
    .hero-art img { max-width: 100%; max-height: 320px; object-fit: contain; filter: drop-shadow(0 6px 24px rgba(0,0,0,0.55)); }
    .hero-body { padding: 22px 24px 22px 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .hero.no-art .hero-body { padding: 22px 24px; }
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

    .hero-actions { display: flex; align-items: center; gap: 14px; margin-top: auto; padding-top: 12px; flex-wrap: wrap; }
    .pin { padding: 8px 16px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font-family: var(--sc-font-display); font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .pin:hover, .pin.pinned { color: var(--sc-accent); border-color: var(--sc-accent); }
    .prov { font-size: 0.72rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }

    /* Generic block */
    .block { padding: 16px 18px; }
    .block h2 { margin: 0 0 12px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .block h2 .ct { font-size: 0.7rem; color: var(--sc-fg-2); }
    .desc { margin: 0; color: var(--sc-fg-1); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }

    /* Stat grid (components / weapons) */
    .stat-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .s-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); }
    .s-value { font-size: 1.05rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); }

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
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }
    .compat-head { color: var(--sc-fg-2); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; margin: 4px 0 8px; }
    .compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; }
    .compat-link:hover { text-decoration: underline; }
    .compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }

    .ld { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 6px; background: var(--sc-bg-1); align-items: center; }
    .ld.empty { background: transparent; border: 1px dashed var(--sc-border); }
    .ld-port { color: var(--sc-fg-2); font-size: 0.76rem; overflow-wrap: anywhere; }
    .ld-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; text-align: right; }
    .ld-link:hover { text-decoration: underline; }
    .ld-cls { color: var(--sc-fg-1); font-size: 0.76rem; overflow-wrap: anywhere; }
    .ld-empty { color: var(--sc-fg-2); font-size: 0.76rem; font-style: italic; }
    .ghost-toggle { margin-left: auto; padding: 3px 10px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-family: inherit; font-size: 0.68rem; text-transform: none; letter-spacing: 0; cursor: pointer; }
    .ghost-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .raw-block { padding-top: 14px; }
    .raw-toggle { padding: 7px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: 0.76rem; cursor: pointer; }
    .raw-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .raw { margin: 12px 0 0; padding: 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-size: 0.74rem; overflow: auto; max-height: 460px; }

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
  `],
})
export class CodexDetailComponent implements OnInit {
  private readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly t = inject(TranslateService);

  readonly detail = signal<CodexDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly showRaw = signal(false);
  readonly showEmptyLoadout = signal(false);

  // Hardpoint slot-compatibility: which port is expanded + its lazy item list.
  readonly expandedPort = signal<number | null>(null);
  private readonly compatMap = signal<Map<number, PortCompat>>(new Map());

  // Resolved localized values for raw @-keys (ship role, …).
  private readonly localeMap = signal<Map<string, string>>(new Map());

  // Resolved deep-link kinds for default-loadout entries.
  private readonly loadoutKinds = signal<Map<string, CodexKind | null>>(new Map());

  private get lang(): Lang {
    const l = this.t.getCurrentLang() ?? 'en';
    return l === 'de' ? 'de' : 'en';
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
    this.showEmptyLoadout.set(false);
    try {
      const d = await this.svc.getDetail(kind, className);
      this.detail.set(d);
      if (d) await Promise.all([this.resolveLoadoutKinds(d), this.resolveLocale(d)]);
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
    this.localeMap.set(await this.svc.resolveLocaleKeys(keys, this.lang));
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

  private async resolveLoadoutKinds(d: CodexDetail): Promise<void> {
    if (d.kind !== 'ship') return;
    const payload = d.payload as ShipPayload | undefined;
    const entries = payload?.defaultLoadout ?? [];
    const classNames = Array.from(
      new Set(entries.map((e) => e.entityClassName).filter((c): c is string => !!c)),
    );
    const map = new Map<string, CodexKind | null>();
    await Promise.all(
      classNames.map(async (cn) => {
        map.set(cn, await this.svc.resolveKind(cn));
      }),
    );
    this.loadoutKinds.set(map);
  }

  // ── derived views ──────────────────────────────────────────────────────────
  readonly displayName = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const name = p?.name ? pickLocalized(p.name, this.lang) : '';
    return name || (d.row['name_localized'] as string) || d.classNameSlug;
  });

  readonly manufacturerName = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { manufacturer?: { name?: { de: string; en: string; key: string }; code?: string } } | undefined;
    const fromPayload = p?.manufacturer?.name ? pickLocalized(p.manufacturer.name, this.lang) : '';
    return fromPayload || (d.row['manufacturer_code'] as string) || '';
  });

  readonly description = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { description?: { de: string; en: string; key: string } } | undefined;
    return unescapeText(p?.description ? pickLocalized(p.description, this.lang) : '');
  });

  readonly provenance = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const p = d.payload as { source?: { channel: string; patch: string; build: string } } | undefined;
    return p?.source ?? null;
  });

  readonly previewUrl = computed(() => {
    const p = this.detail()?.payload as BaseEntityPayload | undefined;
    return this.svc.previewUrl(p?.previewImage);
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
      const roleVal = typeof role === 'string' ? (this.localeMap().get(role) ?? (role.startsWith('@') ? '' : role)) : '';
      add('codex.detail.role', roleVal);
      add('codex.detail.crew', row['crew_size']);
      const dim = this.dimensions();
      if (dim) {
        out.push({
          label: this.t.instant('codex.detail.dimensions'),
          value: `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m`,
        });
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
    const kinds = this.loadoutKinds();
    return entries.map((e) => ({
      port: e.itemPortName || '—',
      className: e.entityClassName,
      kind: e.entityClassName ? (kinds.get(e.entityClassName) ?? null) : null,
    }));
  });

  readonly installedCount = computed(() => this.loadoutAll().filter((l) => l.className).length);
  readonly emptyLoadoutCount = computed(() => this.loadoutAll().filter((l) => !l.className).length);

  /** Default loadout grouped by category; empty stock ports hidden by default. */
  readonly loadoutGroups = computed<LoadoutGroup[]>(() => {
    const all = this.loadoutAll();
    if (all.length === 0) return [];
    const visible = this.showEmptyLoadout() ? all : all.filter((l) => l.className);
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

  isPinned(): boolean {
    const d = this.detail();
    return d ? this.svc.isPinned(d.kind, d.classNameSlug) : false;
  }
  togglePin(): void {
    const d = this.detail();
    if (d) this.svc.togglePin(d.kind, d.classNameSlug);
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
