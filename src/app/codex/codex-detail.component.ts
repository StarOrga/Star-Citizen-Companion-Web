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
  ManufacturerPayload,
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
import { CodexCompareTrayComponent } from './codex-compare-tray.component';

// Lazy-loaded compatible-items state per hardpoint (keyed by port_index).
interface PortCompat {
  loading: boolean;
  error: string | null;
  items: CompatibleItem[];
}

// A flat key/value pair for a rendered stat group.
interface StatRow {
  key: string;
  value: string;
}
interface StatGroup {
  title: string;
  rows: StatRow[];
}
interface LoadoutView {
  port: string;
  className: string | null;
  kind: CodexKind | null;
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
        <header class="head">
          <div class="title-block">
            <h1>{{ displayName() }}</h1>
            <code class="cls">{{ detail()!.classNameSlug }}</code>
            <span class="kind-tag">{{ ('codex.kindSingular.' + detail()!.kind) | translate }}</span>
          </div>
          <div class="head-actions">
            <button type="button" class="pin" [class.pinned]="isPinned()" (click)="togglePin()">
              {{ isPinned() ? '★' : '☆' }} {{ (isPinned() ? 'codex.compare.pinned' : 'codex.compare.pin') | translate }}
            </button>
          </div>
        </header>

        @if (provenance(); as p) {
          <div class="provenance" [attr.title]="'codex.provenance.tooltip' | translate">
            <span class="prov-label">{{ 'codex.provenance.label' | translate }}</span>
            <strong>{{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}</strong>
          </div>
        }

        <!-- Preview image + dimensions overlay -->
        @if (previewUrl(); as src) {
          <section class="sc-card block preview-block">
            <figure class="preview">
              <img [src]="src" [alt]="displayName()" loading="lazy" />
              @if (dimensions(); as d) {
                <figcaption class="dim-overlay">
                  <span class="dim"><b>L</b> {{ d.length }} m</span>
                  <span class="dim"><b>B</b> {{ d.width }} m</span>
                  <span class="dim"><b>H</b> {{ d.height }} m</span>
                </figcaption>
              }
            </figure>
          </section>
        } @else if (dimensions(); as d) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.dimensions' | translate }}</h2>
            <dl class="props grid-props">
              <div class="prop"><dt>{{ 'codex.detail.length' | translate }}</dt><dd>{{ d.length }} m</dd></div>
              <div class="prop"><dt>{{ 'codex.detail.width' | translate }}</dt><dd>{{ d.width }} m</dd></div>
              <div class="prop"><dt>{{ 'codex.detail.height' | translate }}</dt><dd>{{ d.height }} m</dd></div>
            </dl>
          </section>
        }

        @if (description()) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.description' | translate }}</h2>
            <p class="desc">{{ description() }}</p>
          </section>
        }

        <!-- Promoted properties -->
        @if (properties().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.properties' | translate }}</h2>
            <dl class="props">
              @for (p of properties(); track p.key) {
                <div class="prop"><dt>{{ p.key }}</dt><dd>{{ p.value }}</dd></div>
              }
            </dl>
          </section>
        }

        <!-- Stat groups (weaponParams / component.stats / ammo damage / raw) -->
        @for (g of statGroups(); track g.title) {
          <section class="sc-card block">
            <h2>{{ g.title }}</h2>
            <dl class="props grid-props">
              @for (r of g.rows; track r.key) {
                <div class="prop"><dt>{{ r.key }}</dt><dd>{{ r.value }}</dd></div>
              }
            </dl>
          </section>
        }

        <!-- Default loadout (ships) with deep-links -->
        @if (loadout().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.loadout' | translate }}</h2>
            <ul class="loadout">
              @for (l of loadout(); track l.port) {
                <li>
                  <span class="port">{{ l.port }}</span>
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
          </section>
        }

        <!-- Hardpoints -->
        <section class="sc-card block">
          <h2>{{ 'codex.detail.hardpoints' | translate }} <span class="ct">{{ detail()!.ports.length }}</span></h2>
          @if (detail()!.ports.length > 0) {
            <p class="hint">{{ 'codex.detail.hardpointsHint' | translate }}</p>
            <table class="ports">
              <thead>
                <tr>
                  <th class="caret-h"></th>
                  <th>{{ 'codex.detail.port' | translate }}</th>
                  <th>{{ 'codex.detail.size' | translate }}</th>
                  <th>{{ 'codex.detail.types' | translate }}</th>
                  <th>{{ 'codex.detail.flags' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                @for (port of detail()!.ports; track port.portIndex) {
                  <tr
                    class="port-row"
                    [class.expandable]="port.types.length > 0"
                    [class.open]="expandedPort() === port.portIndex"
                    (click)="togglePort(port)"
                  >
                    <td class="caret">{{ port.types.length ? (expandedPort() === port.portIndex ? '▾' : '▸') : '' }}</td>
                    <td>{{ port.portName || '—' }}</td>
                    <td>{{ sizeRange(port.minSize, port.maxSize) }}</td>
                    <td>{{ port.types.length ? port.types.join(', ') : '—' }}</td>
                    <td class="flags">{{ port.flags.length ? port.flags.join(', ') : '—' }}</td>
                  </tr>
                  @if (expandedPort() === port.portIndex) {
                    <tr class="compat-row">
                      <td colspan="5">
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
                                    <span class="chip kind">{{ ('codex.kindSingular.' + it.kind) | translate }}</span>
                                  </span>
                                </li>
                              }
                            </ul>
                          }
                        }
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          } @else {
            <p class="muted">{{ 'codex.detail.noHardpoints' | translate }}</p>
          }
        </section>

        <!-- Raw payload toggle -->
        <section class="sc-card block">
          <button type="button" class="raw-toggle" (click)="toggleRaw()">
            {{ (showRaw() ? 'codex.detail.hideRaw' : 'codex.detail.showRaw') | translate }}
          </button>
          @if (showRaw()) {
            <pre class="raw">{{ rawJson() }}</pre>
          }
        </section>
      }

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }
    .back { font-size: 0.82rem; color: var(--sc-accent); text-decoration: none; align-self: flex-start; }
    .back:hover { text-decoration: underline; }

    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
    .title-block h1 { margin: 0 0 4px; }
    .title-block .cls { font-size: 0.8rem; color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .kind-tag { display: inline-block; margin-left: 10px; font-size: 0.66rem; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.08em; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); color: var(--sc-accent); vertical-align: middle; }
    .pin { padding: 8px 16px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-family: var(--sc-font-display); font-size: 0.74rem; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .pin:hover, .pin.pinned { color: var(--sc-accent); border-color: var(--sc-accent); }

    .provenance { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); align-self: flex-start; }
    .provenance .prov-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .provenance strong { font-family: var(--sc-font-display); font-size: 0.8rem; color: var(--sc-accent); }

    .preview-block { padding: 0; overflow: hidden; }
    .preview { margin: 0; position: relative; display: flex; justify-content: center; align-items: center;
      background: radial-gradient(circle at 50% 40%, var(--sc-bg-1), var(--sc-bg-0)); min-height: 200px; }
    .preview img { max-width: 100%; max-height: 340px; object-fit: contain; display: block;
      filter: drop-shadow(0 4px 18px rgba(0,0,0,0.5)); }
    .dim-overlay { position: absolute; bottom: 10px; right: 12px; display: flex; gap: 8px;
      background: color-mix(in srgb, var(--sc-bg-0) 78%, transparent); padding: 6px 10px; border-radius: 8px;
      border: 1px solid var(--sc-border); backdrop-filter: blur(4px); }
    .dim-overlay .dim { font-size: 0.74rem; color: var(--sc-fg-1); font-family: var(--sc-font-mono, monospace); }
    .dim-overlay .dim b { color: var(--sc-accent); margin-right: 3px; }

    .block { padding: 16px 18px; }
    .block h2 { margin: 0 0 12px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-accent); }
    .block h2 .ct { font-size: 0.7rem; color: var(--sc-fg-2); margin-left: 6px; }
    .desc { margin: 0; color: var(--sc-fg-1); line-height: 1.5; white-space: pre-wrap; }

    .props { display: grid; gap: 6px; margin: 0; grid-template-columns: 1fr; }
    .grid-props { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .prop { display: flex; justify-content: space-between; gap: 12px; padding: 6px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .prop dt { color: var(--sc-fg-2); font-size: 0.78rem; }
    .prop dd { margin: 0; color: var(--sc-fg-0); font-size: 0.82rem; text-align: right; word-break: break-word; }

    .loadout { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .loadout li { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 4px; background: var(--sc-bg-1); align-items: center; }
    .loadout .port { color: var(--sc-fg-2); font-size: 0.78rem; font-family: var(--sc-font-mono, monospace); }
    .ld-link { color: var(--sc-accent); text-decoration: none; font-size: 0.82rem; }
    .ld-link:hover { text-decoration: underline; }
    .ld-cls { color: var(--sc-fg-1); font-size: 0.78rem; }
    .ld-empty { color: var(--sc-fg-2); font-size: 0.78rem; font-style: italic; }

    .ports { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .ports th { text-align: left; color: var(--sc-fg-2); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 8px; border-bottom: 1px solid var(--sc-border); }
    .ports td { padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 50%, transparent); }
    .ports .flags { color: var(--sc-fg-2); }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.85rem; }
    .hint { color: var(--sc-fg-2); margin: 0 0 10px; font-size: 0.74rem; }

    .ports .caret-h { width: 20px; }
    .port-row .caret { color: var(--sc-fg-2); width: 20px; text-align: center; }
    .port-row.expandable { cursor: pointer; }
    .port-row.expandable:hover { background: var(--sc-bg-1); }
    .port-row.open { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .port-row.open .caret { color: var(--sc-accent); }

    .compat-row > td { padding: 8px 10px 12px 28px; background: var(--sc-bg-0); }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }
    .compat-head { color: var(--sc-fg-2); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
    .compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
    .compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .compat-link:hover { text-decoration: underline; }
    .compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }
    .chip { font-size: 0.62rem; padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-2); color: var(--sc-fg-2); border: 1px solid var(--sc-border); }
    .chip.kind { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 35%, transparent); }

    .raw-toggle { padding: 7px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: 0.76rem; cursor: pointer; }
    .raw-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .raw { margin: 12px 0 0; padding: 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-size: 0.74rem; overflow: auto; max-height: 460px; }

    .skel-card { height: 200px; background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .err { color: var(--sc-danger); padding: 16px; }
    .empty { text-align: center; padding: 40px; color: var(--sc-fg-2); }
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
    try {
      const d = await this.svc.getDetail(kind, className);
      this.detail.set(d);
      if (d) {
        await Promise.all([this.resolveLoadoutKinds(d), this.resolveLocale(d)]);
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
    // Resolve sequentially-ish but in parallel for speed.
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

  readonly description = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { description?: { de: string; en: string; key: string } } | undefined;
    return p?.description ? pickLocalized(p.description, this.lang) : '';
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

  readonly dimensions = computed<Dimensions | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    return (d.payload as ShipPayload | undefined)?.dimensions ?? null;
  });

  readonly properties = computed<StatRow[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const out: StatRow[] = [];
    const push = (labelKey: string, value: unknown) => {
      if (value == null || value === '') return;
      out.push({ key: this.t.instant(labelKey), value: String(value) });
    };
    const row = d.row;
    push('codex.detail.manufacturer', row['manufacturer_code']);
    const role = row['role'];
    push(
      'codex.detail.role',
      typeof role === 'string' ? (this.localeMap().get(role) ?? role) : role,
    );
    push('codex.detail.crew', row['crew_size']);
    const wc = row['weapon_class'];
    push('codex.detail.weaponClass', typeof wc === 'string' ? this.t.instant('codex.weaponClass.' + wc) : wc);
    const ck = row['kind'];
    push('codex.detail.componentKind', typeof ck === 'string' ? this.t.instant('codex.componentKind.' + ck) : ck);
    push('codex.detail.subType', row['sub_type']);
    push('codex.detail.attachType', row['attach_type']);
    push('codex.detail.size', row['size']);
    push('codex.detail.grade', row['grade']);
    push('codex.detail.speed', row['speed']);
    push('codex.detail.lifetime', row['lifetime']);
    push('codex.detail.guid', row['guid']);
    return out;
  });

  readonly statGroups = computed<StatGroup[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const groups: StatGroup[] = [];

    if (d.kind === 'weapon') {
      const p = d.payload as WeaponPayload | undefined;
      const rows = scalarRows(p?.weaponParams);
      if (rows.length) groups.push({ title: this.t.instant('codex.detail.weaponParams'), rows });
    }

    if (d.kind === 'component') {
      const p = d.payload as ComponentPayload | undefined;
      const stats = p?.stats ?? {};
      for (const [structName, struct] of Object.entries(stats)) {
        const rows = scalarRows(struct);
        if (rows.length) groups.push({ title: structName, rows });
      }
    }

    if (d.kind === 'ammunition') {
      const p = d.payload as AmmunitionPayload | undefined;
      const dmg = p?.impactDamage;
      if (dmg) {
        const rows: StatRow[] = [];
        for (const ch of ['physical', 'energy', 'distortion', 'thermal', 'biochemical', 'stun'] as const) {
          const v = dmg[ch];
          if (v != null) rows.push({ key: this.t.instant('codex.damage.' + ch), value: String(v) });
        }
        if (rows.length) groups.push({ title: this.t.instant('codex.detail.damage'), rows });
      }
    }

    if (d.kind === 'manufacturer') {
      // description already rendered; nothing extra here.
      void (d.payload as ManufacturerPayload | undefined);
    }

    return groups;
  });

  readonly loadout = computed<LoadoutView[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const payload = d.payload as ShipPayload | undefined;
    const entries: LoadoutEntry[] = payload?.defaultLoadout ?? [];
    const kinds = this.loadoutKinds();
    return entries.map((e) => ({
      port: e.itemPortName || '—',
      className: e.entityClassName,
      kind: e.entityClassName ? (kinds.get(e.entityClassName) ?? null) : null,
    }));
  });

  readonly rawJson = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return JSON.stringify(d.payload, null, 2);
  });

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

  sizeRange(min: number | null, max: number | null): string {
    if (min == null && max == null) return '—';
    if (min === max || max == null) return String(min ?? max);
    if (min == null) return String(max);
    return `${min}–${max}`;
  }
}

/** Flatten a record of scalars into displayable rows (skips null/empty). */
function scalarRows(
  obj: Record<string, string | number | boolean | null> | undefined,
): StatRow[] {
  if (!obj) return [];
  const out: StatRow[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value == null || value === '') continue;
    out.push({ key, value: typeof value === 'boolean' ? (value ? '✓' : '✗') : String(value) });
  }
  return out;
}
