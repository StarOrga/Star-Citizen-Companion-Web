import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CODEX_KINDS, CodexService } from './codex.service';
import { RoleService } from '../auth/role.service';

interface CoverageRow {
  kind: string;
  seeded: number;
  total: number;
  pct: number;
}

/**
 * Viewer-visible data provenance for the current catalog build (UC-12). Codex
 * routes are already authGuard-only (no roleGuard), so this needs no guard
 * change — it simply surfaces build, patch, freshness and per-kind coverage
 * that were previously hidden. Quality is flagged as preliminary until the
 * extractor computes a real score (today it seeds a flat 100).
 */
@Component({
  selector: 'sc-codex-status-banner',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (svc.build(); as b) {
      <div class="banner" [class.open]="expanded()">
        <button type="button" class="bar" (click)="toggle()" [attr.aria-expanded]="expanded()">
          <span class="prov-label">{{ 'codex.provenance.label' | translate }}</span>
          <strong class="build">{{ 'codex.provenance.build' | translate: { channel: b.channel, patch: b.patchVersion, build: b.buildNumber } }}</strong>
          @if (b.qualityScore != null) {
            <span class="prov-q" [attr.title]="'codex.status.qualityHint' | translate">
              {{ 'codex.provenance.quality' | translate: { score: b.qualityScore } }}
            </span>
          }
          <span class="caret" aria-hidden="true">{{ expanded() ? '▾' : '▸' }}</span>
        </button>

        @if (svc.stale()) {
          <div class="stale" role="status">
            <span class="stale-dot" aria-hidden="true">●</span>
            <span class="stale-txt">{{ 'codex.status.stale' | translate }}</span>
            @if (roles.isCollaborator()) {
              <a class="stale-link" routerLink="/uploader">{{ 'codex.status.staleUploadLink' | translate }} →</a>
            }
          </div>
        }

        @if (expanded()) {
          <div class="detail">
            @if (extractedLabel(); as e) {
              <div class="meta-row"><span>{{ 'codex.status.extracted' | translate }}</span><strong>{{ e }}</strong></div>
            }
            @if (b.toolVersion) {
              <div class="meta-row"><span>{{ 'codex.status.tool' | translate }}</span><strong>{{ b.toolVersion }}</strong></div>
            }
            @if (coverage().length > 0) {
              <div class="cov-head">{{ 'codex.status.coverage' | translate }}</div>
              <ul class="cov">
                @for (c of coverage(); track c.kind) {
                  <li>
                    <span class="cov-k">{{ ('codex.kinds.' + c.kind) | translate }}</span>
                    <span class="cov-bar"><span class="cov-fill" [style.width.%]="c.pct"></span></span>
                    <span class="cov-n">{{ c.seeded }}<span class="cov-tot">/{{ c.total }}</span></span>
                  </li>
                }
              </ul>
            }
            <p class="hint">{{ 'codex.status.qualityHint' | translate }}</p>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .banner { border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); overflow: hidden; min-width: 220px; }
      .banner.open { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
      .bar { width: 100%; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 8px 14px;
        background: transparent; border: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
      .bar:hover { background: color-mix(in srgb, var(--sc-accent) 7%, transparent); }
      .prov-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-fg-2); }
      .build { font-family: var(--sc-font-display); font-size: 0.82rem; letter-spacing: 0.04em; color: var(--sc-accent); }
      .prov-q { font-size: 0.68rem; color: var(--sc-fg-2); }
      .caret { margin-left: auto; color: var(--sc-fg-2); font-size: 0.7rem; }
      .detail { border-top: 1px solid var(--sc-border); padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
      .meta-row { display: flex; justify-content: space-between; gap: 12px; font-size: 0.74rem; }
      .meta-row span { color: var(--sc-fg-2); }
      .meta-row strong { color: var(--sc-fg-0); font-family: var(--sc-font-display); font-weight: 500; }
      .cov-head { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); margin-top: 4px; }
      .cov { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
      .cov li { display: grid; grid-template-columns: 84px 1fr auto; align-items: center; gap: 8px; }
      .cov-k { font-size: 0.72rem; color: var(--sc-fg-1); }
      .cov-bar { height: 5px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
      .cov-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
      .cov-n { font-size: 0.68rem; color: var(--sc-fg-0); font-family: var(--sc-font-mono, monospace); white-space: nowrap; }
      .cov-tot { color: var(--sc-fg-2); }
      .hint { margin: 4px 0 0; font-size: 0.66rem; color: var(--sc-fg-2); font-style: italic; }
      .stale { display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
        padding: 7px 14px; border-top: 1px solid var(--sc-border);
        background: color-mix(in srgb, var(--sc-warning, #d29922) 12%, transparent); }
      .stale-dot { color: var(--sc-warning, #d29922); font-size: 0.6rem; line-height: 1; }
      .stale-txt { font-size: 0.7rem; color: var(--sc-fg-1); }
      .stale-link { font-size: 0.7rem; font-weight: 600; color: var(--sc-accent);
        text-decoration: none; white-space: nowrap; margin-left: auto; }
      .stale-link:hover { text-decoration: underline; }
    `,
  ],
})
export class CodexStatusBannerComponent {
  readonly svc = inject(CodexService);
  readonly roles = inject(RoleService);
  readonly translate = inject(TranslateService);
  readonly expanded = signal(false);

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  /** Per-kind seeded/total coverage from the build's entity_counts. */
  readonly coverage = computed<CoverageRow[]>(() => {
    const counts = this.svc.build()?.entityCounts as Record<string, unknown> | undefined;
    if (!counts) return [];
    const seeded = counts['seeded'] as Record<string, number> | undefined;
    const rows: CoverageRow[] = [];
    for (const k of CODEX_KINDS) {
      // No kind is skipped: blueprints used to be excluded here while their
      // catalog was empty, which kept them invisible long after ingest started.
      // A kind the manifest doesn't report is filtered out below anyway.
      const plural = k === 'ammunition' ? 'ammunition' : `${k}s`;
      const total = counts[plural];
      if (typeof total !== 'number') continue;
      const s = seeded && typeof seeded[plural] === 'number' ? seeded[plural] : total;
      rows.push({ kind: k, seeded: s, total, pct: total > 0 ? Math.round((s / total) * 100) : 0 });
    }
    return rows;
  });

  /** Human date for the build's extraction timestamp, or null. */
  extractedLabel(): string | null {
    const at = this.svc.build()?.extractedAt;
    if (!at) return null;
    const d = new Date(at);
    // Locale-aware: honour the app's de/en toggle instead of the browser locale
    // (bare toLocaleDateString() ignored the active language — ISO 8601 / i18n).
    return isNaN(d.getTime())
      ? at
      : d.toLocaleDateString(this.translate.currentLang || 'en', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  }
}
