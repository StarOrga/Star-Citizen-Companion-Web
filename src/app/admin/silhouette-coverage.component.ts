import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { useAutoRefresh } from '../core/auto-refresh';
import { toErrorKey } from '../core/describe-error';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

/** Why the uploader's silhouette build skipped a hull (#842). */
export type SilhouetteSkipReason = 'no_mesh' | 'convert_failed' | 'empty';
const SKIP_REASONS: readonly SilhouetteSkipReason[] = ['no_mesh', 'convert_failed', 'empty'];

/** One hull of the build without a silhouette row. */
export interface SilhouetteMissingShip {
  class_name: string;
  name: string | null;
  /** Null: the uploader recorded no reason (older uploader, or the step did not run). */
  reason: SilhouetteSkipReason | null;
  /** The uploader's own log detail (converter error, missing path), English. */
  detail: string | null;
}

/** Shape of `public.silhouette_coverage(p_build_id)` (migration 20261008193000). */
export interface SilhouetteCoverage {
  build: { id: string; channel: string; patch_version: string; build_number: string };
  total: number;
  with_silhouette: number;
  with_anchors: number;
  without_silhouette: number;
  /** Without silhouette, but a datamined preview image exists. */
  fallback_icon: number;
  /** Without silhouette and without preview: RSI art or the glyph (decided in the browser). */
  fallback_none: number;
  /** Hulls without a silhouette, per recorded skip reason. */
  reasons: Record<SilhouetteSkipReason, number>;
  /** Hulls without a silhouette and without a recorded reason. */
  unexplained: number;
  missing: SilhouetteMissingShip[];
}

/** A silhouette coverage refresh every few minutes is plenty: it only moves on an ingest. */
const REFRESH_MS = 5 * 60_000;

/**
 * Admin tile (#647): how many hulls of the current LIVE build have a Holotable
 * silhouette, how many of those carry hardpoint anchors, and which hulls have
 * none — each linked to its Codex page. The RPC is admin-only; RSI art vs the
 * glyph is decided in the browser, so "without" is split only by what the
 * database knows (datamined preview icon or not).
 */
@Component({
  selector: 'sc-silhouette-coverage',
  standalone: true,
  imports: [DecimalPipe, RouterLink, TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card cov-card">
      <div class="cov-head">
        <h2>{{ 'admin.silhouettes.title' | translate }}</h2>
        @if (data(); as d) {
          <p class="hint">
            {{ 'admin.silhouettes.build' | translate: { channel: d.build.channel, patch: d.build.patch_version, build: d.build.build_number } }}
          </p>
        } @else {
          <p class="hint">{{ 'admin.silhouettes.subtitle' | translate }}</p>
        }
      </div>

      @if (errorKey(); as key) {
        <div class="err" role="alert">
          <span><strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ key | translate }}</span>
          <button type="button" class="sc-btn" (click)="load()" [disabled]="loading()">
            {{ 'admin.silhouettes.retry' | translate }}
          </button>
        </div>
      } @else if (loading() && !data()) {
        <div class="empty">{{ 'admin.loading' | translate }}</div>
      } @else if (!data()) {
        <div class="empty">{{ 'admin.silhouettes.noBuild' | translate }}</div>
      } @else {
        @let d = data()!;
        <div class="nums">
          <div class="num-cell">
            <b>{{ d.total | number }}</b>
            <span class="lbl">{{ 'admin.silhouettes.total' | translate }}</span>
          </div>
          <div class="num-cell">
            <b>{{ d.with_silhouette | number }}</b>
            <span class="lbl">{{ 'admin.silhouettes.withSilhouette' | translate }}</span>
          </div>
          <div class="num-cell">
            <b>{{ d.with_anchors | number }}</b>
            <span class="lbl">{{ 'admin.silhouettes.withAnchors' | translate }}</span>
          </div>
          <div class="num-cell" [scTooltip]="'admin.silhouettes.withoutTip' | translate" tabindex="0">
            <b>{{ d.without_silhouette | number }}</b>
            <span class="lbl">{{ 'admin.silhouettes.without' | translate }}</span>
          </div>
        </div>

        <div class="bar" role="img"
             [attr.aria-label]="'admin.silhouettes.barLabel' | translate: { pct: percent() }">
          <span class="fill" [style.width.%]="percent()"></span>
        </div>
        <p class="bar-caption">
          {{ 'admin.silhouettes.barLabel' | translate: { pct: percent() } }}
          @if (d.without_silhouette > 0) {
            · {{ 'admin.silhouettes.fallbackSplit' | translate: { icon: d.fallback_icon, none: d.fallback_none } }}
          }
        </p>
        @if (d.without_silhouette > 0) {
          <p class="bar-caption">
            {{ 'admin.silhouettes.reasonSplit' | translate: {
              no_mesh: d.reasons.no_mesh, convert_failed: d.reasons.convert_failed,
              empty: d.reasons.empty, unexplained: d.unexplained } }}
          </p>
        }

        @if (d.missing.length > 0) {
          <details class="missing">
            <summary>{{ 'admin.silhouettes.missingToggle' | translate: { count: d.without_silhouette } }}</summary>
            <ul>
              @for (m of d.missing; track m.class_name) {
                <li>
                  <a [routerLink]="['/codex', 'ship', m.class_name]">{{ m.name || m.class_name }}</a>
                  <span class="reason" [class.unknown]="!m.reason" tabindex="0"
                        [scTooltip]="reasonTip(m)">{{ 'admin.silhouettes.reason.' + (m.reason ?? 'none') | translate }}</span>
                </li>
              }
            </ul>
          </details>
        }
      }
    </div>
  `,
  styles: [`
    .cov-head h2 { margin: 0 0 4px; font-size: 1rem; }
    .hint { color: var(--sc-fg-2); margin: 0 0 12px; }
    .err {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 20px; }
    .nums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .num-cell { display: flex; flex-direction: column; min-width: 0; }
    .num-cell b { font-size: 1.45rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .lbl {
      color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor));
      text-transform: uppercase; letter-spacing: .3px;
    }
    .bar {
      margin-top: 14px; height: 6px; border-radius: 3px; overflow: hidden;
      background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent);
    }
    .fill { display: block; height: 100%; background: var(--sc-accent); }
    .bar-caption { margin: 6px 0 0; color: var(--sc-fg-2); font-size: 0.85rem; }
    .missing { margin-top: 12px; }
    .missing summary { cursor: pointer; color: var(--sc-accent); min-height: max(32px, var(--sc-tap-min)); display: flex; align-items: center; }
    .missing ul {
      list-style: none; margin: 8px 0 0; padding: 0;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px 16px;
    }
    .missing li { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .missing a { color: var(--sc-fg-0); display: inline-flex; align-items: center; }
    .reason {
      color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor));
      border: 1px solid color-mix(in srgb, var(--sc-fg-2) 35%, transparent);
      border-radius: 3px; padding: 0 5px;
    }
    .reason.unknown { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 45%, transparent); }
    .missing a:hover, .missing a:focus-visible { color: var(--sc-accent); }
    @media (max-width: 640px) {
      .nums { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `],
})
export class SilhouetteCoverageComponent implements OnInit {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly translate = inject(TranslateService);

  readonly data = signal<SilhouetteCoverage | null>(null);
  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** Share of hulls with a silhouette, whole percent. */
  readonly percent = computed(() => {
    const d = this.data();
    if (!d || d.total <= 0) return 0;
    return Math.round((d.with_silhouette / d.total) * 100);
  });

  constructor() {
    useAutoRefresh(() => this.load(), { intervalMs: REFRESH_MS, enabled: () => !this.loading() });
  }

  /** The reason's explanation, plus the uploader's own detail line when it sent one. */
  reasonTip(m: SilhouetteMissingShip): string {
    const text = this.translate.instant(`admin.silhouettes.reasonTip.${m.reason ?? 'none'}`) as string;
    return m.detail ? `${text} — ${m.detail}` : text;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const { data, error } = await this.sb.client.rpc('silhouette_coverage', { p_build_id: null });
      if (error) throw error;
      this.data.set(normalize(data));
      this.errorKey.set(null);
    } catch (err) {
      this.errorKey.set(toErrorKey('admin', 'silhouette coverage', err));
    } finally {
      this.loading.set(false);
    }
  }
}

/** The RPC answers `null` without a current build; anything else is coerced to numbers. */
function normalize(raw: unknown): SilhouetteCoverage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<SilhouetteCoverage>;
  if (!r.build) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  return {
    build: r.build,
    total: n(r.total),
    with_silhouette: n(r.with_silhouette),
    with_anchors: n(r.with_anchors),
    without_silhouette: n(r.without_silhouette),
    fallback_icon: n(r.fallback_icon),
    fallback_none: n(r.fallback_none),
    reasons: {
      no_mesh: n(r.reasons?.no_mesh),
      convert_failed: n(r.reasons?.convert_failed),
      empty: n(r.reasons?.empty),
    },
    // An RPC from before #842 has no reasons at all: every gap is unexplained.
    unexplained: r.unexplained === undefined ? n(r.without_silhouette) : n(r.unexplained),
    missing: Array.isArray(r.missing)
      ? r.missing.filter((m) => !!m?.class_name).map((m) => ({
          class_name: m.class_name,
          name: m.name ?? null,
          reason: (SKIP_REASONS as readonly string[]).includes(m.reason as string) ? m.reason : null,
          detail: typeof m.detail === 'string' && m.detail ? m.detail : null,
        }))
      : [],
  };
}
