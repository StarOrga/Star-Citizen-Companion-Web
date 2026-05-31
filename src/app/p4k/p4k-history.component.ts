import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BundleDiffSummary, ChannelTag, P4kBundleRow, P4kService } from './p4k.service';
import { RoleService } from '../auth/role.service';

@Component({
  selector: 'sc-p4k-history',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'p4k.title' | translate }}</h1>
          <p class="hint">{{ 'p4k.subtitle' | translate }}</p>
        </div>
        <div class="header-actions">
          <label class="toggle">
            <input type="checkbox" [checked]="svc.includeHistory()" (change)="svc.toggleHistory()" />
            {{ 'p4k.toggle.history' | translate }}
          </label>
          @if (roles.isAdmin()) {
            <label class="toggle">
              <input type="checkbox" [checked]="svc.includeDisabled()" (change)="svc.toggleDisabled()" />
              {{ 'p4k.toggle.disabled' | translate }}
            </label>
          }
          <button class="sc-btn" (click)="refresh()" [disabled]="svc.busy()">
            {{ 'p4k.refresh' | translate }}
          </button>
        </div>
      </header>

      <div class="sc-card summary">
        <div class="summary-general">
          <div class="kpi">
            <span class="kpi-label">{{ 'p4k.kpi.total' | translate }}</span>
            <span class="kpi-value">{{ bundles().length }}</span>
          </div>
          <div class="kpi">
            <span class="kpi-label">{{ 'p4k.kpi.channels' | translate }}</span>
            <span class="kpi-value">{{ uniqueChannels() }}</span>
          </div>
        </div>

        @if (channelSummaries().length > 0) {
          <div class="summary-channels">
            <span class="summary-channels-label">{{ 'p4k.kpi.latestPerChannel' | translate }}</span>
            @for (c of channelSummaries(); track c.channel) {
              <div class="summary-row">
                <span class="ch-pill" [class]="c.channel">{{ c.channel.toUpperCase() }}</span>
                <span class="sum-patch mono">{{ c.patch_version }}</span>
                <div class="sum-metric">
                  <span class="kpi-label">{{ 'p4k.kpi.quality' | translate }}</span>
                  <span class="sum-quality"
                        [class.q-green]="(c.quality_score ?? 0) >= 80"
                        [class.q-yellow]="(c.quality_score ?? 0) >= 50 && (c.quality_score ?? 0) < 80"
                        [class.q-red]="(c.quality_score ?? 0) < 50">
                    {{ c.quality_score !== null ? (c.quality_score | number:'1.0-0') : '—' }}
                  </span>
                </div>
                <div class="sum-metric">
                  <span class="kpi-label">{{ 'p4k.col.entities' | translate }}</span>
                  <span class="sum-entities">{{ c.entities | number }}</span>
                </div>
              </div>
            }
          </div>
        }
      </div>

      @if (svc.errorMsg(); as err) {
        <div class="err">
          <strong>{{ 'p4k.errorTitle' | translate }}:</strong> {{ err }}
        </div>
      }

      @if (bundles().length === 0 && svc.busy()) {
        <div class="sc-card empty">
          <p>{{ 'p4k.loading' | translate }}</p>
        </div>
      } @else if (bundles().length === 0 && !svc.busy()) {
        <div class="sc-card empty">
          <h2>{{ 'p4k.empty.title' | translate }}</h2>
          <p>{{ 'p4k.empty.hint' | translate }}</p>
          <a routerLink="/desktop" class="sc-btn sc-btn-primary" style="margin-top: 12px;">
            {{ 'p4k.empty.goDesktop' | translate }}
          </a>
        </div>
      } @else {
        <table class="sc-card table">
          <thead>
            <tr>
              <th></th>
              <th>{{ 'p4k.col.channel' | translate }}</th>
              <th>{{ 'p4k.col.version' | translate }}</th>
              <th>{{ 'p4k.col.build' | translate }}</th>
              <th>{{ 'p4k.col.quality' | translate }}</th>
              <th>{{ 'p4k.col.entities' | translate }}</th>
              <th>{{ 'p4k.col.diff' | translate }}</th>
              <th>{{ 'p4k.col.tool' | translate }}</th>
              <th>{{ 'p4k.col.uploader' | translate }}</th>
              <th>{{ 'p4k.col.when' | translate }}</th>
              @if (roles.isAdmin()) {
                <th>{{ 'p4k.col.actions' | translate }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (b of bundles(); track b.id) {
              <tr [class.disabled-row]="b.disabled">
                <td>
                  @if (b.diff_summary) {
                    <button class="expand-btn"
                            (click)="toggleExpand(b.id)"
                            [attr.aria-expanded]="isExpanded(b.id)"
                            [attr.aria-label]="'p4k.expand' | translate">
                      {{ isExpanded(b.id) ? '▾' : '▸' }}
                    </button>
                  }
                </td>
                <td><span class="ch-pill" [class]="b.channel">{{ b.channel.toUpperCase() }}</span></td>
                <td class="mono">{{ b.patch_version }}</td>
                <td class="mono small">{{ b.build_number || '—' }}</td>
                <td>
                  <div class="qbar">
                    <div class="qbar-fill"
                         [class.q-green]="(b.quality_score ?? 0) >= 80"
                         [class.q-yellow]="(b.quality_score ?? 0) >= 50 && (b.quality_score ?? 0) < 80"
                         [class.q-red]="(b.quality_score ?? 0) < 50"
                         [style.width.%]="b.quality_score ?? 0"></div>
                    <span class="qbar-text">{{ b.quality_score !== null ? (b.quality_score | number:'1.0-0') : '—' }}</span>
                  </div>
                </td>
                <td>
                  <div class="entity-row">
                    @for (ent of entityKeys(b); track ent.key) {
                      <span class="entity-chip" [title]="ent.key">
                        {{ ent.icon }} {{ ent.value | number }}
                      </span>
                    }
                  </div>
                </td>
                <td class="diff-cell">
                  @if (b.diff_summary?.summary) {
                    <span class="diff-mini">
                      <span class="d-add">+{{ b.diff_summary!.summary!.entities_added | number }}</span>
                      /
                      <span class="d-rem">−{{ b.diff_summary!.summary!.entities_removed | number }}</span>
                    </span>
                  } @else {
                    <span class="small">—</span>
                  }
                </td>
                <td class="mono small">{{ b.tool_version ?? '—' }}</td>
                <td>
                  <div class="uploader">
                    <span>{{ b.uploaded_by_name ?? '—' }}</span>
                    <span class="mono small">{{ b.uploaded_by_email }}</span>
                  </div>
                </td>
                <td>{{ b.created_at | date:'short' }}</td>
                @if (roles.isAdmin()) {
                  <td class="actions">
                    @if (b.disabled) {
                      <button class="sc-btn micro" (click)="reenable(b)" [disabled]="svc.busy()">
                        {{ 'p4k.actions.reenable' | translate }}
                      </button>
                    } @else {
                      <button class="sc-btn micro danger" (click)="disable(b)" [disabled]="svc.busy()">
                        {{ 'p4k.actions.disable' | translate }}
                      </button>
                    }
                    <button class="sc-btn micro danger" (click)="remove(b)" [disabled]="svc.busy()">
                      {{ 'p4k.actions.delete' | translate }}
                    </button>
                  </td>
                }
              </tr>
              @if (isExpanded(b.id) && b.diff_summary) {
                <tr class="expand-row">
                  <td colspan="11">
                    <div class="diff-detail">
                      <strong>{{ 'p4k.diff.title' | translate }}</strong>
                      <table class="diff-table">
                        <thead>
                          <tr>
                            <th>{{ 'p4k.diff.entity' | translate }}</th>
                            <th>{{ 'p4k.diff.prev' | translate }}</th>
                            <th>{{ 'p4k.diff.new' | translate }}</th>
                            <th>{{ 'p4k.diff.delta' | translate }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (d of diffEntries(b.diff_summary!); track d.key) {
                            <tr>
                              <td class="mono small">{{ d.key }}</td>
                              <td class="num">{{ d.prev | number }}</td>
                              <td class="num">{{ d.new | number }}</td>
                              <td class="num" [class.d-add]="d.delta > 0" [class.d-rem]="d.delta < 0">
                                {{ d.delta > 0 ? '+' : '' }}{{ d.delta | number }}
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                      @if (b.disabled) {
                        <p class="disabled-note">
                          <strong>{{ 'p4k.disabled.title' | translate }}:</strong>
                          {{ b.disabled_reason ?? ('p4k.disabled.noReason' | translate) }}
                        </p>
                      }
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      }
    </section>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; gap: 20px; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }
    .header-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .toggle {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.85rem; color: var(--sc-fg-1);
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
      cursor: pointer;
    }
    .toggle input { accent-color: var(--sc-accent); }
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .summary { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
    .summary-general {
      display: flex;
      gap: 32px;
      padding: 16px 22px;
      border-bottom: 1px solid var(--sc-border);
    }
    .summary-channels { display: flex; flex-direction: column; }
    .summary-channels-label {
      font-family: var(--sc-font-display);
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      padding: 12px 22px 4px;
    }
    .summary-row {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 10px 22px;
      border-top: 1px solid var(--sc-border);
    }
    .summary-row:first-of-type { border-top: none; }
    .sum-patch { font-size: 1.1rem; color: var(--sc-fg-0); min-width: 64px; }
    .sum-metric { display: flex; flex-direction: column; gap: 2px; }
    .sum-quality {
      font-family: var(--sc-font-display);
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
      color: var(--sc-fg-0);
    }
    .sum-quality.q-green { color: var(--sc-success); }
    .sum-quality.q-yellow { color: var(--sc-warning); }
    .sum-quality.q-red { color: var(--sc-danger); }
    .sum-entities {
      font-family: var(--sc-font-display);
      font-size: 1.25rem;
      font-variant-numeric: tabular-nums;
      color: var(--sc-fg-1);
    }
    .kpi { display: flex; flex-direction: column; gap: 4px; }
    .kpi-label {
      font-family: var(--sc-font-display);
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .kpi-value {
      font-family: var(--sc-font-display);
      font-size: 1.45rem;
      color: var(--sc-fg-0);
      font-variant-numeric: tabular-nums;
    }
    .kpi-value.q-green { color: var(--sc-success); }
    .kpi-value.q-yellow { color: var(--sc-warning); }
    .kpi-value.q-red { color: var(--sc-danger); }

    .empty { text-align: center; padding: 40px 24px; color: var(--sc-fg-2); }
    .empty h2 { margin: 0 0 8px; }

    .table { width: 100%; padding: 0; border-collapse: collapse; overflow: hidden; }
    .table th, .table td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--sc-border);
      font-size: 0.86rem;
      vertical-align: middle;
    }
    .table thead th {
      background: var(--sc-bg-2);
      font-family: var(--sc-font-display);
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .table tbody tr:hover { background: rgba(0, 212, 255, 0.04); }
    .table tbody tr.disabled-row { opacity: 0.5; }
    .table tbody tr.disabled-row .ch-pill { filter: grayscale(0.7); }
    .mono { font-family: monospace; color: var(--sc-fg-1); }
    .small { font-size: 0.76rem; color: var(--sc-fg-2); }
    .num { font-variant-numeric: tabular-nums; text-align: right; }

    .ch-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 999px;
      font-family: var(--sc-font-display);
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      &.live { background: rgba(0, 212, 255, 0.18); color: var(--sc-accent); }
      &.ptu { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.eptu { background: rgba(251, 191, 36, 0.18); color: var(--sc-warning); }
      &.tech-preview { background: rgba(255, 87, 34, 0.18); color: var(--sc-accent-hot); }
      &.unknown { background: rgba(122, 134, 156, 0.18); color: var(--sc-fg-2); }
    }

    .qbar {
      position: relative;
      width: 100%;
      max-width: 100px;
      height: 18px;
      background: var(--sc-bg-2);
      border-radius: 4px;
      overflow: hidden;
    }
    .qbar-fill {
      position: absolute; left: 0; top: 0; bottom: 0;
      transition: width 0.2s;
      &.q-green { background: rgba(74, 222, 128, 0.55); }
      &.q-yellow { background: rgba(251, 191, 36, 0.55); }
      &.q-red { background: rgba(248, 113, 113, 0.55); }
    }
    .qbar-text {
      position: absolute; inset: 0;
      display: grid; place-items: center;
      font-size: 0.72rem;
      font-variant-numeric: tabular-nums;
      color: var(--sc-fg-0);
      font-weight: 600;
    }

    .entity-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .entity-chip {
      padding: 1px 6px;
      background: var(--sc-bg-2);
      border-radius: 3px;
      font-size: 0.76rem;
      font-variant-numeric: tabular-nums;
      color: var(--sc-fg-1);
    }

    .uploader { display: flex; flex-direction: column; gap: 2px; line-height: 1.2; }

    .diff-cell .diff-mini {
      font-family: monospace;
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
    }
    .d-add { color: var(--sc-success); }
    .d-rem { color: var(--sc-danger); }

    .expand-btn {
      background: transparent;
      border: none;
      color: var(--sc-accent);
      cursor: pointer;
      font-size: 0.9rem;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background 0.15s, color 0.15s;
    }
    .expand-btn:hover {
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      color: var(--sc-accent);
    }
    .expand-row {
      background: rgba(0, 212, 255, 0.03);
    }
    .diff-detail {
      padding: 12px 16px;
    }
    .diff-detail strong {
      font-family: var(--sc-font-display);
      font-size: 0.78rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .diff-table {
      width: 100%;
      max-width: 600px;
      margin-top: 8px;
      border-collapse: collapse;
    }
    .diff-table th, .diff-table td {
      padding: 4px 10px;
      border-bottom: 1px solid var(--sc-border);
      font-size: 0.82rem;
    }
    .diff-table th {
      text-align: left;
      font-family: var(--sc-font-display);
      font-size: 0.7rem;
      letter-spacing: 0.06em;
      color: var(--sc-fg-2);
      text-transform: uppercase;
    }
    .disabled-note {
      margin-top: 10px;
      padding: 8px 12px;
      background: rgba(122, 134, 156, 0.12);
      border-left: 3px solid var(--sc-fg-2);
      border-radius: 0 4px 4px 0;
      font-size: 0.85rem;
      color: var(--sc-fg-1);
    }

    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .sc-btn.micro {
      padding: 4px 10px;
      font-size: 0.7rem;
      letter-spacing: 0.04em;
    }
    .sc-btn.micro.danger {
      color: var(--sc-danger);
      border-color: var(--sc-danger);
    }
    .sc-btn.micro.danger:hover:not(:disabled) {
      background: var(--sc-danger);
      color: var(--sc-bg-0);
    }
  `],
})
export class P4kHistoryComponent implements OnInit {
  readonly svc = inject(P4kService);
  readonly roles = inject(RoleService);
  private readonly translate = inject(TranslateService);

  private readonly _expanded = signal<Set<string>>(new Set());

  readonly bundles = computed(() => this.svc.bundles());
  readonly uniqueChannels = computed(() => new Set(this.bundles().map((b) => b.channel)).size);

  /**
   * One row per channel, each pointing at that channel's patch-latest bundle
   * (highest patch_version by semantic compare, NOT upload date — builds within
   * the same patch tiebreak by created_at). Ordered: `live` first, then the rest
   * by patch_version descending.
   */
  readonly channelSummaries = computed<ChannelSummary[]>(() => summarizeChannels(this.bundles()));

  ngOnInit() {
    this.refresh();
  }

  async refresh() {
    await this.svc.listBundles();
  }

  isExpanded(id: string): boolean {
    return this._expanded().has(id);
  }

  toggleExpand(id: string): void {
    const next = new Set(this._expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expanded.set(next);
  }

  async disable(b: P4kBundleRow): Promise<void> {
    const name = `${b.channel.toUpperCase()} ${b.patch_version} ${b.build_number}`;
    const reason = window.prompt(this.translate.instant('p4k.prompts.disable', { name }), '');
    if (reason === null) return; // cancelled
    await this.svc.setDisabled(b.id, true, reason.trim() || null);
  }

  async reenable(b: P4kBundleRow): Promise<void> {
    const name = `${b.channel.toUpperCase()} ${b.patch_version}`;
    if (!window.confirm(this.translate.instant('p4k.prompts.reenable', { name }))) return;
    await this.svc.setDisabled(b.id, false, null);
  }

  async remove(b: P4kBundleRow): Promise<void> {
    const name = `${b.channel.toUpperCase()} ${b.patch_version} ${b.build_number}`;
    if (!window.confirm(this.translate.instant('p4k.prompts.delete', { name }))) return;
    await this.svc.deleteBundle(b.id);
  }

  entityKeys(b: P4kBundleRow): Array<{ key: string; icon: string; value: number }> {
    const icons: Record<string, string> = {
      ships: '🛸',
      weapons: '🔫',
      items: '📦',
      components: '⚙',
      strings: '💬',
      missions: '🎯',
    };
    const counts = b.entity_counts ?? {};
    return Object.entries(counts)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([key, value]) => ({
        key,
        icon: icons[key] ?? '·',
        value: value as number,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  diffEntries(diff: BundleDiffSummary): Array<{ key: string; prev: number; new: number; delta: number }> {
    const counts = diff.count_diffs ?? {};
    return Object.entries(counts)
      .map(([key, v]) => ({ key, prev: v.prev, new: v.new, delta: v.delta }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }
}

export interface ChannelSummary {
  channel: ChannelTag;
  patch_version: string;
  quality_score: number | null;
  entities: number;
}

/**
 * Reduce a bundle list to one summary row per channel, each pointing at that
 * channel's patch-latest bundle (highest patch_version, NOT newest upload).
 * Ordered: `live` first, then remaining channels by patch_version descending.
 */
export function summarizeChannels(bundles: readonly P4kBundleRow[]): ChannelSummary[] {
  const latest = new Map<ChannelTag, P4kBundleRow>();
  for (const b of bundles) {
    const cur = latest.get(b.channel);
    if (!cur || comparePatch(b, cur) > 0) latest.set(b.channel, b);
  }
  return Array.from(latest.values())
    .map((b) => ({
      channel: b.channel,
      patch_version: b.patch_version,
      quality_score: b.quality_score,
      entities: sumCounts(b.entity_counts),
    }))
    .sort((a, b) => {
      if ((a.channel === 'live') !== (b.channel === 'live')) {
        return a.channel === 'live' ? -1 : 1;
      }
      return compareVersion(b.patch_version, a.patch_version);
    });
}

/** Compare two patch strings like "4.8.0" segment-by-segment; ignores suffixes. */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(/\D+/).filter(Boolean).map(Number);
  const pb = b.split(/\D+/).filter(Boolean).map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Pick the more-current bundle within a channel: higher patch wins, newer build breaks ties. */
function comparePatch(a: P4kBundleRow, b: P4kBundleRow): number {
  const v = compareVersion(a.patch_version, b.patch_version);
  return v !== 0 ? v : a.created_at.localeCompare(b.created_at);
}

function sumCounts(counts: Record<string, unknown> | null): number {
  if (!counts) return 0;
  return Object.values(counts).reduce<number>(
    (sum, v) => sum + (typeof v === 'number' ? v : 0),
    0,
  );
}
