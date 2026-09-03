import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ScSegmentedComponent, ScSegmentOption } from '../shared/segmented-control.component';
import { SupabaseClientProvider } from '../core/supabase.client';
import { useAutoRefresh } from '../core/auto-refresh';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import {
  ALL_PRODUCTS,
  allProductsRow,
  mergeProductRows,
  normaliseProductParam,
  productLabelKey,
  sharePct,
  type ProductRow,
} from './telemetry-products';

interface VersionRow { version: string; crashes: number; usage: number; sessions: number; }
interface CountRow { name?: string; role?: string; count: number; }
interface ChannelRow { channel: string; events: number; sessions: number; crashes: number; }
interface MetricRow { metric: string; count: number; sessions: number; }
interface RecentCrash {
  version: string;
  product?: string;
  role: string | null;
  name: string | null;
  message: string;
  at: number;
}
/** Aborted P4K extraction, broken down by why it stopped. */
interface AbortReasonRow { reason: string; count: number; }
interface RecentAbort {
  version: string;
  reason: string;
  phase: string | null;
  pct: number | null;
  message: string;
  at: number;
}
interface ExtractAborts { total: number; byReason: AbortReasonRow[]; recent: RecentAbort[]; }
interface TelemetryStats {
  generatedAt: number;
  windowDays: number;
  /** Which product the server actually aggregated, or 'all'. */
  product?: string;
  /** Per-product roll-up — always the full window, never narrowed by the filter. */
  products?: ProductRow[];
  totals: { crashes: number; usage: number; installs: number; sessions: number; extractAborts?: number };
  byVersion: VersionRow[];
  /** Release-ring split. Absent until the starscape-product migration is deployed. */
  byChannel?: ChannelRow[];
  /** What the opt-in usage events actually are. Absent on an older backend. */
  usageByMetric?: MetricRow[];
  crashesByType: CountRow[];
  crashesByRole: CountRow[];
  recentCrashes: RecentCrash[];
  /** Absent until the telemetry_extract_aborts migration is deployed. */
  extractAborts?: ExtractAborts;
}

/** Abort reasons the uploader can send — anything else renders verbatim. */
const KNOWN_ABORT_REASONS = ['cancelled', 'quit', 'error'];

/** Release rings we ship a label for; anything else renders verbatim. */
const KNOWN_CHANNELS = ['stable', 'beta', 'alpha', 'dev'];

/** Time-range options (days); also the i18n key suffixes. */
const WINDOWS = [7, 30, 90] as const;

@Component({
  selector: 'sc-telemetry-stats',
  standalone: true,
  imports: [ScDatePipe, DecimalPipe, TranslateModule, RouterLink, ScSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'telemetry.title' | translate }}</h1>
          <p class="hint">{{ 'telemetry.subtitle' | translate }}</p>
        </div>
        <!-- Real anchors: the time range is part of the URL, so an admin can
             bookmark "last 90 days" and middle-click it into a new tab. The
             shared control keeps that link mode; see sc-segmented. -->
        <sc-segmented
          class="window-seg"
          [options]="windowOptions"
          [value]="windowValue()"
          [ariaLabel]="'telemetry.window.label' | translate" />
      </header>

      @if (errorMsg()) {
        <div class="err"><strong>{{ 'telemetry.errorTitle' | translate }}:</strong> {{ errorMsg() }}</div>
      }

      @if (busy() && !stats()) {
        <div class="sc-card empty">{{ 'telemetry.loading' | translate }}</div>
      } @else if (stats(); as s) {
        <!-- ── Every product at a glance. One card per product, plus the
             cross-product card; the selected one is the drill-down below. ── -->
        <h2 class="section-h">{{ 'telemetry.products.title' | translate }}</h2>
        <p class="hint">{{ 'telemetry.products.hint' | translate }}</p>
        <div class="products">
          @for (p of productCards(); track p.product) {
            <a
              class="sc-card product"
              [class.active]="product() === p.product"
              [class.silent]="!p.events"
              [attr.aria-current]="product() === p.product ? 'true' : null"
              [routerLink]="[]"
              [queryParams]="{ product: p.product }"
              queryParamsHandling="merge"
            >
              <span class="product-head">
                <span class="product-name">
                  @if (productLabel(p.product); as key) {
                    {{ key | translate }}
                  } @else {
                    <span class="mono">{{ p.product }}</span>
                  }
                </span>
                @if (p.crashes) {
                  <span class="chip warn">{{ p.crashes | number }} {{ 'telemetry.products.crashesShort' | translate }}</span>
                } @else if (p.events) {
                  <span class="chip ok">{{ 'telemetry.products.healthy' | translate }}</span>
                } @else {
                  <span class="chip">{{ 'telemetry.products.silent' | translate }}</span>
                }
              </span>
              <span class="kpis">
                <span class="kpi"><b>{{ p.installs | number }}</b><i>{{ 'telemetry.totals.installs' | translate }}</i></span>
                <span class="kpi"><b>{{ p.sessions | number }}</b><i>{{ 'telemetry.totals.sessions' | translate }}</i></span>
                <span class="kpi"><b>{{ p.usage | number }}</b><i>{{ 'telemetry.totals.usage' | translate }}</i></span>
              </span>
              <!-- Share of all events in the window: the comparison the old
                   binary switch could never show. -->
              <span class="share" aria-hidden="true">
                <span class="share-fill" [style.width.%]="sharePct(p.events, maxProductEvents())"></span>
              </span>
              <span class="product-foot hint">
                @if (p.lastSeen) {
                  {{ 'telemetry.products.lastSeen' | translate }}: {{ p.lastSeen | scDate: 'datetime' }}
                } @else {
                  {{ 'telemetry.products.never' | translate }}
                }
              </span>
            </a>
          }
        </div>

        <!-- ── Drill-down: everything below is scoped to the selected product. ── -->
        <h2 class="section-h">
          {{ 'telemetry.detail.title' | translate }} ·
          @if (productLabel(product()); as key) {
            {{ key | translate }}
          } @else {
            <span class="mono">{{ product() }}</span>
          }
        </h2>

        <div class="totals">
          <div class="sc-card stat"><div class="num">{{ s.totals.crashes | number }}</div><div class="lbl">{{ 'telemetry.totals.crashes' | translate }}</div></div>
          <div class="sc-card stat"><div class="num">{{ s.totals.usage | number }}</div><div class="lbl">{{ 'telemetry.totals.usage' | translate }}</div></div>
          <div class="sc-card stat"><div class="num">{{ s.totals.installs | number }}</div><div class="lbl">{{ 'telemetry.totals.installs' | translate }}</div></div>
          <div class="sc-card stat"><div class="num">{{ s.totals.sessions | number }}</div><div class="lbl">{{ 'telemetry.totals.sessions' | translate }}</div></div>
        </div>

        <div class="cols">
          <div class="sc-card">
            <h2>{{ 'telemetry.byVersion' | translate }}</h2>
            @for (v of s.byVersion; track v.version) {
              <div class="bar-row">
                <span class="bar-label mono">{{ v.version }}</span>
                <span class="bar"><span class="bar-fill" [style.width.%]="sharePct(v.crashes, maxVersionCrashes())"></span></span>
                <span class="bar-num">{{ v.crashes | number }}</span>
              </div>
            } @empty { <p class="hint">{{ 'telemetry.empty' | translate }}</p> }

            @if (channels().length) {
              <h2 class="sub">{{ 'telemetry.byChannel' | translate }}</h2>
              <div class="pills">
                @for (c of channels(); track c.channel) {
                  <span class="role-pill">
                    @if (channelLabel(c.channel); as key) {
                      {{ key | translate }}
                    } @else {
                      <span class="mono">{{ c.channel }}</span>
                    }
                    · {{ c.sessions | number }}
                  </span>
                }
              </div>
            }

            @if (usageMetrics().length) {
              <h2 class="sub">{{ 'telemetry.usageByMetric' | translate }}</h2>
              @for (m of usageMetrics(); track m.metric) {
                <div class="bar-row">
                  <span class="bar-label mono">{{ m.metric }}</span>
                  <span class="bar"><span class="bar-fill" [style.width.%]="sharePct(m.count, maxUsageMetric())"></span></span>
                  <span class="bar-num">{{ m.count | number }}</span>
                </div>
              }
            }
          </div>

          <div class="sc-card">
            <h2>{{ 'telemetry.crashesByType' | translate }}</h2>
            @for (c of s.crashesByType; track c.name) {
              <div class="bar-row">
                <span class="bar-label mono">{{ c.name }}</span>
                <span class="bar"><span class="bar-fill warn" [style.width.%]="sharePct(c.count, maxTypeCount())"></span></span>
                <span class="bar-num">{{ c.count | number }}</span>
              </div>
            } @empty { <p class="hint">{{ 'telemetry.empty' | translate }}</p> }
            <h2 class="sub">{{ 'telemetry.crashesByRole' | translate }}</h2>
            <div class="pills">
              @for (r of s.crashesByRole; track r.role) {
                <span class="role-pill">{{ r.role }} · {{ r.count | number }}</span>
              } @empty { <span class="hint">{{ 'telemetry.empty' | translate }}</span> }
            </div>
          </div>
        </div>

        @if (aborts(); as a) {
          <div class="sc-card">
            <h2>
              {{ 'telemetry.aborts.title' | translate }}
              <span class="count-badge">{{ a.total | number }}</span>
            </h2>
            <p class="hint">{{ 'telemetry.aborts.hint' | translate }}</p>
            @if (a.total) {
              <h2 class="sub">{{ 'telemetry.aborts.byReason' | translate }}</h2>
              @for (r of a.byReason; track r.reason) {
                <div class="bar-row">
                  <span class="bar-label">
                    @if (reasonLabelKey(r.reason); as key) {
                      {{ key | translate }}
                    } @else {
                      <span class="mono">{{ r.reason }}</span>
                    }
                  </span>
                  <span class="bar"><span class="bar-fill warn" [style.width.%]="sharePct(r.count, maxAbortReason())"></span></span>
                  <span class="bar-num">{{ r.count | number }}</span>
                </div>
              }
              <h2 class="sub">{{ 'telemetry.aborts.recent' | translate }}</h2>
              <table class="table">
                <thead><tr>
                  <th>{{ 'telemetry.col.at' | translate }}</th>
                  <th>{{ 'telemetry.col.version' | translate }}</th>
                  <th>{{ 'telemetry.aborts.col.reason' | translate }}</th>
                  <th>{{ 'telemetry.aborts.col.phase' | translate }}</th>
                  <th>{{ 'telemetry.aborts.col.progress' | translate }}</th>
                </tr></thead>
                <tbody>
                  @for (r of a.recent; track $index) {
                    <tr>
                      <td class="mono">{{ r.at | scDate: 'datetime' }}</td>
                      <td class="mono">{{ r.version }}</td>
                      <td>
                        @if (reasonLabelKey(r.reason); as key) {
                          {{ key | translate }}
                        } @else {
                          <span class="mono">{{ r.reason }}</span>
                        }
                      </td>
                      <td class="mono">{{ r.phase ?? '—' }}</td>
                      <td class="mono">{{ r.pct != null ? (r.pct | number:'1.0-0') + '%' : '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="hint">{{ 'telemetry.empty' | translate }}</p>
            }
          </div>
        }

        <div class="sc-card">
          <h2>{{ 'telemetry.recent' | translate }}</h2>
          @if (s.recentCrashes.length) {
            <table class="table">
              <thead><tr>
                <th>{{ 'telemetry.col.at' | translate }}</th>
                @if (showCrashProduct()) { <th>{{ 'telemetry.product.label' | translate }}</th> }
                <th>{{ 'telemetry.col.version' | translate }}</th>
                <th>{{ 'telemetry.col.role' | translate }}</th>
                <th>{{ 'telemetry.col.name' | translate }}</th>
                <th>{{ 'telemetry.col.message' | translate }}</th>
              </tr></thead>
              <tbody>
                @for (c of s.recentCrashes; track $index) {
                  <tr>
                    <td class="mono">{{ c.at | scDate: 'datetime' }}</td>
                    @if (showCrashProduct()) {
                      <td>
                        @if (productLabel(c.product ?? ''); as key) {
                          {{ key | translate }}
                        } @else {
                          <span class="mono">{{ c.product ?? '—' }}</span>
                        }
                      </td>
                    }
                    <td class="mono">{{ c.version }}</td>
                    <td>{{ c.role ?? '—' }}</td>
                    <td class="mono">{{ c.name ?? '—' }}</td>
                    <td class="msg">{{ c.message }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else { <p class="hint">{{ 'telemetry.empty' | translate }}</p> }
        </div>

        <p class="gen hint">{{ 'telemetry.generatedAt' | translate }}: {{ s.generatedAt | scDate: 'datetime' }}</p>
      }
    </section>
  `,
  styles: [`
    .page { padding: 1rem; max-width: 1100px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
    .hint { color: var(--sc-text-dim, #8b97a8); font-size: 0.85rem; }
    .err { background: rgba(248,81,73,.12); color: #f85149; padding: 0.6rem 0.9rem; border-radius: 8px; margin-bottom: 1rem; }
    .empty { text-align: center; color: var(--sc-text-dim, #8b97a8); }
    .section-h { font-size: 0.95rem; margin: 1.4rem 0 0.25rem; }
    .section-h:first-of-type { margin-top: 0; }

    /* ---- Product overview ---- */
    .products {
      display: grid; gap: 0.75rem; margin: 0.75rem 0 1rem;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }
    .product {
      display: flex; flex-direction: column; gap: 0.5rem;
      padding: 0.9rem; text-decoration: none; color: inherit;
      border: 1px solid transparent; min-height: 48px;
    }
    .product:hover { border-color: rgba(255,255,255,.18); }
    .product.active { border-color: var(--sc-accent, #52c1e6); box-shadow: 0 0 0 1px var(--sc-accent, #52c1e6) inset; }
    .product.silent { opacity: .72; }
    .product-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .product-name { font-weight: 600; font-size: 0.95rem; overflow-wrap: anywhere; }
    .chip {
      background: rgba(255,255,255,.06); color: var(--sc-text-dim, #8b97a8); border-radius: 12px;
      padding: 2px 9px; font-size: max(0.72rem, var(--sc-fs-floor)); white-space: nowrap;
    }
    .chip.warn { background: rgba(210,153,34,.18); color: #d29922; }
    .chip.ok { background: rgba(63,185,80,.16); color: #3fb950; }
    .kpis { display: flex; gap: 1rem; flex-wrap: wrap; }
    .kpi { display: flex; flex-direction: column; }
    .kpi b { font-size: 1.25rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .kpi i {
      font-style: normal; color: var(--sc-text-dim, #8b97a8);
      font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: .3px;
    }
    .share { display: block; background: rgba(255,255,255,.06); border-radius: 4px; height: 6px; overflow: hidden; }
    .share-fill { display: block; height: 100%; background: var(--sc-accent, #52c1e6); border-radius: 4px; }
    .product-foot { font-size: max(0.72rem, var(--sc-fs-floor)); }

    /* ---- Drill-down ---- */
    .totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 1rem; }
    .stat { text-align: center; padding: 1rem; }
    .stat .num { font-size: 1.8rem; font-weight: 700; }
    .stat .lbl { color: var(--sc-text-dim, #8b97a8); font-size: 0.8rem; text-transform: uppercase; letter-spacing: .3px; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem; }
    h2 { font-size: 0.95rem; margin: 0 0 0.75rem; } h2.sub { margin-top: 1.2rem; }
    .bar-row { display: grid; grid-template-columns: 120px 1fr 48px; align-items: center; gap: 0.5rem; margin: 0.3rem 0; }
    .bar-label { font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { background: rgba(255,255,255,.06); border-radius: 4px; height: 14px; overflow: hidden; }
    .bar-fill { display: block; height: 100%; background: var(--sc-accent, #52c1e6); border-radius: 4px; }
    .bar-fill.warn { background: #d29922; }
    .bar-num { text-align: right; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
    .count-badge {
      background: rgba(210,153,34,.18); color: #d29922; border-radius: 12px;
      padding: 1px 9px; font-size: max(0.78rem, var(--sc-fs-floor)); font-variant-numeric: tabular-nums; margin-left: 0.4rem;
    }
    .pills { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .role-pill { background: rgba(255,255,255,.06); border-radius: 12px; padding: 2px 10px; font-size: max(0.78rem, var(--sc-fs-floor)); }
    .table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .table th, .table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.07); vertical-align: top; }
    .table .msg { color: var(--sc-text-dim, #8b97a8); max-width: 360px; overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .gen { text-align: right; margin-top: 0.5rem; }

    @media (max-width: 760px) { .totals { grid-template-columns: repeat(2,1fr); } .cols { grid-template-columns: 1fr; } }
    @media (max-width: 560px) {
      .page { padding: 0; }
      .head { flex-direction: column; align-items: stretch; }
      /* Full width so all three ranges stay a comfortable thumb target. */
      .window-seg { display: block; }
      .products { grid-template-columns: 1fr; }
      .stat .num { font-size: 1.45rem; }
      .bar-row { grid-template-columns: 90px 1fr 40px; gap: 0.4rem; }
      .table .msg { max-width: 200px; }
      .table {
        display: block;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      .table thead, .table tbody { display: table; width: 100%; min-width: 480px; }
    }
  `],
})
export class TelemetryStatsComponent {
  private readonly supabase = inject(SupabaseClientProvider);
  private readonly route = inject(ActivatedRoute);

  readonly windows = WINDOWS;
  /**
   * The time range as segments. Links, not buttons: the range lives in the URL
   * (see `windowDays`), so each one has to be openable in a new tab.
   */
  readonly windowOptions: readonly ScSegmentOption[] = WINDOWS.map((w) => ({
    value: String(w),
    labelKey: `telemetry.window.short.${w}`,
    titleKey: `telemetry.window.${w}`,
    link: { commands: [], queryParams: { days: w }, queryParamsHandling: 'merge' as const },
  }));

  readonly stats = signal<TelemetryStats | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);

  /**
   * Selection lives in the URL, not in component state: the product cards and
   * the time range are real links, so an admin can middle-click a product into
   * a new tab and share "starscape, last 90 days" as a plain URL.
   */
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly windowDays = computed(() => {
    const raw = Number(this.params().get('days'));
    return (WINDOWS as readonly number[]).includes(raw) ? raw : 30;
  });
  /** The active range as the segmented control's string id. */
  readonly windowValue = computed(() => String(this.windowDays()));

  /** Products the server has actually seen — the accepted filter values. */
  private readonly reportedProducts = computed(() =>
    (this.stats()?.products ?? []).map((p) => p.product));

  readonly product = computed(() =>
    normaliseProductParam(this.params().get('product'), this.reportedProducts()));

  /** Overview cards: every reported product, the silent known ones, then "all". */
  readonly productCards = computed<ProductRow[]>(() => {
    const rows = mergeProductRows(this.stats()?.products);
    return [...rows, allProductsRow(rows)];
  });
  readonly maxProductEvents = computed(() =>
    Math.max(1, ...mergeProductRows(this.stats()?.products).map((p) => p.events)));

  readonly maxVersionCrashes = computed(() =>
    Math.max(1, ...(this.stats()?.byVersion ?? []).map((v) => v.crashes)));
  readonly maxTypeCount = computed(() =>
    Math.max(1, ...(this.stats()?.crashesByType ?? []).map((c) => c.count)));

  /** Absent on a backend without the starscape-product migration → section hidden. */
  readonly channels = computed<ChannelRow[]>(() => this.stats()?.byChannel ?? []);
  readonly usageMetrics = computed<MetricRow[]>(() => this.stats()?.usageByMetric ?? []);
  readonly maxUsageMetric = computed(() =>
    Math.max(1, ...this.usageMetrics().map((m) => m.count)));

  /** The product column only earns its width in the cross-product view. */
  readonly showCrashProduct = computed(() => this.product() === ALL_PRODUCTS);

  /**
   * Aborted extractions — only the Data Uploader reports them, so the card stays
   * hidden for every other single-product view. Also absent (→ hidden) until the
   * RPC that returns the block is deployed, so an older backend degrades cleanly.
   */
  readonly aborts = computed<ExtractAborts | null>(() => {
    const s = this.stats();
    if (!s?.extractAborts) return null;
    const p = this.product();
    if (p !== ALL_PRODUCTS && p !== 'data-uploader') return null;
    return s.extractAborts;
  });
  readonly maxAbortReason = computed(() =>
    Math.max(1, ...(this.aborts()?.byReason ?? []).map((r) => r.count)));

  constructor() {
    // Reload whenever the URL selection changes — including the first render.
    effect(() => {
      const days = this.windowDays();
      const product = this.product();
      void this.load(days, product);
    });
    useAutoRefresh(() => this.load(this.windowDays(), this.product()), {
      enabled: () => !this.busy(),
    });
  }

  /** i18n key for a known product, or null to render the raw id. */
  productLabel(product: string): string | null {
    return productLabelKey(product);
  }

  /** i18n key for a known release ring, or null to render the raw value. */
  channelLabel(channel: string): string | null {
    return KNOWN_CHANNELS.includes(channel) ? `telemetry.channel.${channel}` : null;
  }

  /** i18n key for a known abort reason, or null to render the raw value. */
  reasonLabelKey(reason: string): string | null {
    return KNOWN_ABORT_REASONS.includes(reason) ? `telemetry.aborts.reason.${reason}` : null;
  }

  sharePct(value: number, max: number): number {
    return sharePct(value, max);
  }

  async load(days: number, product: string): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.supabase.client.rpc('get_telemetry_stats', {
      window_days: days,
      // 'all' → null: no product restriction server-side.
      product_filter: product === ALL_PRODUCTS ? null : product,
    });
    if (error) {
      this.errorMsg.set(error.message);
      this.stats.set(null);
    } else {
      this.stats.set(data as TelemetryStats);
    }
    this.busy.set(false);
  }
}
