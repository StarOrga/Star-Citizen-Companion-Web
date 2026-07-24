import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BundleDiffSummary, ChannelTag, P4kBundleRow, P4kService } from './p4k.service';
import { RoleService } from '../auth/role.service';
import { useAutoRefresh } from '../core/auto-refresh';

@Component({
  selector: 'sc-p4k-history',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hist">
      @if (!embedded()) {
        <header class="head">
          <div>
            <h1>{{ 'p4k.title' | translate }}</h1>
            <p class="hint">{{ 'p4k.subtitle' | translate }}</p>
          </div>
        </header>
      }

      <div class="hist-body" [class.card]="!embedded()">
        <!-- Section header — matches the "Aktuelle Version" header on the merged
             Data Upload page so release + history read as one panel. -->
        <div class="sec-head">
          <span class="t">{{ 'desktop.bundleHistory' | translate }}</span>
          @if (roles.isAdmin()) {
            <button type="button" class="icon-toggle"
                    [class.active]="svc.includeDisabled()"
                    (click)="svc.toggleDisabled()"
                    [attr.aria-pressed]="svc.includeDisabled()"
                    [attr.aria-label]="'p4k.toggle.disabled' | translate"
                    [title]="'p4k.toggle.disabled' | translate">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          }
        </div>

        @if (svc.errorMsg(); as err) {
          <div class="err">
            <strong>{{ 'p4k.errorTitle' | translate }}:</strong> {{ err }}
          </div>
        }

        @if (bundles().length === 0 && svc.busy()) {
          <div class="state">{{ 'p4k.loading' | translate }}</div>
        } @else if (bundles().length === 0 && !svc.busy()) {
          <div class="state empty">
            <strong>{{ 'p4k.empty.title' | translate }}</strong>
            <p>{{ 'p4k.empty.hint' | translate }}</p>
          </div>
        } @else {
          <!-- One card per patch version; expand to reveal its individual uploads. -->
          <div class="hist-list">
            @for (g of patchGroups(); track g.patch_version) {
              <div class="patch" [class.superseded]="g.allSuperseded">
                <div class="patch-main" role="button" tabindex="0"
                     (click)="toggleGroup(g.patch_version)"
                     (keydown.enter)="toggleGroup(g.patch_version)"
                     (keydown.space)="toggleGroup(g.patch_version); $event.preventDefault()"
                     [attr.aria-expanded]="isGroupExpanded(g.patch_version)">
                  <span class="chev">{{ isGroupExpanded(g.patch_version) ? '▾' : '▸' }}</span>
                  <span class="patch-ver mono">
                    {{ g.patch_version }}
                    @if (g.allSuperseded) {
                      <span class="badge">{{ 'p4k.superseded.badge' | translate }}</span>
                    }
                  </span>
                  <div class="patch-mid">
                    <div class="pills">
                      @for (ch of g.channels; track ch) {
                        <span class="ch-pill" [class]="ch">{{ ch.toUpperCase() }}</span>
                      }
                    </div>
                    <div class="qbar">
                      <div class="qbar-fill"
                           [class.q-green]="(g.quality_score ?? 0) >= 80"
                           [class.q-yellow]="(g.quality_score ?? 0) >= 50 && (g.quality_score ?? 0) < 80"
                           [class.q-red]="(g.quality_score ?? 0) < 50"
                           [style.width.%]="g.quality_score ?? 0"></div>
                      <span class="qbar-text">{{ g.quality_score !== null ? (g.quality_score | number:'1.0-0') : '—' }}</span>
                    </div>
                    <span class="meta-mini">
                      <b>{{ g.uploadCount | number }}</b> {{ 'p4k.col.uploads' | translate }}
                      · <b>{{ g.entities | number }}</b> {{ 'p4k.col.entities' | translate }}
                    </span>
                  </div>
                  <span class="patch-when">{{ g.latest_at | date:'short' }}</span>
                </div>

                @if (isGroupExpanded(g.patch_version)) {
                  <div class="uploads">
                    @for (b of g.uploads; track b.id) {
                      <div class="up-row"
                           [class.disabled-row]="b.disabled && !b.superseded_at"
                           [class.superseded-row]="isSuperseded(b)">
                        <div class="up-left">
                          <span class="ch-pill" [class]="b.channel">{{ b.channel.toUpperCase() }}</span>
                          @if (isSuperseded(b)) {
                            <span class="badge" [title]="b.disabled_reason ?? ''">{{ 'p4k.superseded.badge' | translate }}</span>
                          }
                          <span class="up-b mono">{{ b.build_number || '—' }}</span>
                          <div class="qbar">
                            <div class="qbar-fill"
                                 [class.q-green]="(b.quality_score ?? 0) >= 80"
                                 [class.q-yellow]="(b.quality_score ?? 0) >= 50 && (b.quality_score ?? 0) < 80"
                                 [class.q-red]="(b.quality_score ?? 0) < 50"
                                 [style.width.%]="b.quality_score ?? 0"></div>
                            <span class="qbar-text">{{ b.quality_score !== null ? (b.quality_score | number:'1.0-0') : '—' }}</span>
                          </div>
                          <div class="up-ent">
                            @for (ent of entityKeys(b); track ent.key) {
                              <span class="echip" [title]="ent.key">{{ ent.icon }} {{ ent.value | number }}</span>
                            }
                          </div>
                        </div>
                        <div class="up-right">
                          <span class="diff-mini">
                            @if (b.diff_summary?.summary) {
                              <span class="d-add">+{{ b.diff_summary!.summary!.entities_added | number }}</span>
                              /
                              <span class="d-rem">−{{ b.diff_summary!.summary!.entities_removed | number }}</span>
                            } @else {
                              <span class="small">—</span>
                            }
                          </span>
                          <span class="up-tool mono small" [title]="'p4k.col.tool' | translate">{{ b.tool_version ?? '—' }}</span>
                          <div class="uploader-cell">
                            <span class="n">{{ b.uploaded_by_name ?? '—' }}</span>
                            <span class="e mono">{{ b.uploaded_by_email }}</span>
                          </div>
                          <span class="up-when">{{ b.created_at | date:'short' }}</span>
                          @if (b.diff_summary) {
                            <button class="expand-btn" type="button"
                                    (click)="toggleExpand(b.id)"
                                    [attr.aria-expanded]="isExpanded(b.id)"
                                    [attr.aria-label]="'p4k.col.diff' | translate">
                              {{ isExpanded(b.id) ? '▾' : '▸' }}
                            </button>
                          }
                          @if (roles.isAdmin()) {
                            <div class="acts">
                              @if (isSuperseded(b)) {
                                <!-- superseded = history; re-enabling would create a second
                                     active bundle for the same key, so only allow delete -->
                              } @else if (b.disabled) {
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
                            </div>
                          }
                        </div>
                      </div>

                      @if (isExpanded(b.id) && b.diff_summary) {
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
                            <p class="disabled-note" [class.superseded-note]="isSuperseded(b)">
                              <strong>{{ (isSuperseded(b) ? 'p4k.superseded.title' : 'p4k.disabled.title') | translate }}:</strong>
                              {{ b.disabled_reason ?? ('p4k.disabled.noReason' | translate) }}
                            </p>
                          }
                        </div>
                      }
                    }
                  </div>
                }
              </div>
            }
          </div>

          <p class="retention-hint">{{ 'p4k.retentionHint' | translate }}</p>
        }
      </div>
    </section>
  `,
  styles: [`
    .hist { display: flex; flex-direction: column; }
    .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .hint { color: var(--sc-fg-2); margin: 4px 0 0; }

    /* Standalone (/p4k direct) wraps itself in a card; embedded relies on the
       host Data Upload panel and only draws a top divider on its section head. */
    .hist-body.card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 12px; overflow: hidden; }

    .sec-head {
      display: flex; align-items: center; gap: 12px;
      padding: 13px 20px;
      background: var(--sc-bg-2);
      border-bottom: 1px solid var(--sc-border);
    }
    .hist-body:not(.card) .sec-head { border-top: 1px solid var(--sc-border); }
    .sec-head .t {
      font-family: var(--sc-font-display);
      font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--sc-fg-1);
    }
    .icon-toggle {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; margin-left: auto;
      background: transparent; color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); border-radius: 6px;
      transition: color 0.18s ease, border-color 0.18s ease, background 0.18s ease;
    }
    .icon-toggle:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .icon-toggle.active {
      color: var(--sc-accent); border-color: var(--sc-accent);
      background: rgba(var(--accent-primary-rgb), 0.12);
    }

    .err {
      margin: 14px 20px 0;
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }

    .state { padding: 32px 20px; text-align: center; color: var(--sc-fg-2); }
    .state.empty strong { color: var(--sc-fg-1); }
    .state.empty p { margin: 6px 0 0; }
    .go-desktop { align-self: flex-start; margin: 0 20px 4px; }

    .retention-hint {
      margin: 0; padding: 12px 20px 16px;
      font-size: 0.74rem; color: var(--sc-fg-2);
    }

    /* Channel pill (shared visual grammar with the summary). */
    .ch-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-family: var(--sc-font-display); font-size: 0.68rem; letter-spacing: 0.08em;
      &.live { background: rgba(0, 212, 255, 0.18); color: var(--sc-accent); }
      &.ptu { background: rgba(74, 222, 128, 0.18); color: var(--sc-success); }
      &.eptu { background: rgba(251, 191, 36, 0.18); color: var(--sc-warning); }
      &.tech-preview { background: rgba(255, 87, 34, 0.18); color: var(--sc-accent-hot); }
      &.unknown { background: rgba(122, 134, 156, 0.18); color: var(--sc-fg-2); }
    }
    .badge {
      display: inline-block; padding: 1px 7px; border-radius: 999px;
      font-family: var(--sc-font-display); font-size: 0.6rem;
      letter-spacing: 0.06em; text-transform: uppercase; vertical-align: middle;
      background: rgba(122, 134, 156, 0.16); color: var(--sc-fg-2);
      border: 1px solid var(--sc-border);
    }

    .mono { font-family: monospace; }
    .small { font-size: 0.76rem; color: var(--sc-fg-2); }
    .num { font-variant-numeric: tabular-nums; text-align: right; }

    /* Quality bar (reused for patch + upload rows). */
    .qbar {
      position: relative; width: 88px; height: 16px;
      background: var(--sc-bg-2); border-radius: 4px; overflow: hidden; flex: none;
    }
    .qbar-fill {
      position: absolute; left: 0; top: 0; bottom: 0; transition: width 0.2s;
      &.q-green { background: rgba(74, 222, 128, 0.55); }
      &.q-yellow { background: rgba(251, 191, 36, 0.55); }
      &.q-red { background: rgba(248, 113, 113, 0.55); }
    }
    .qbar-text {
      position: absolute; inset: 0; display: grid; place-items: center;
      font-size: 0.72rem; font-variant-numeric: tabular-nums; color: var(--sc-fg-0); font-weight: 600;
    }

    /* ── Patch cards ── */
    .hist-list { display: flex; flex-direction: column; gap: 10px; padding: 16px 20px; }
    .patch {
      border: 1px solid var(--sc-border); border-radius: 10px;
      background: var(--sc-bg-0); overflow: hidden;
      transition: border-color 0.15s ease;
    }
    .patch:hover { border-color: color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border)); }
    .patch.superseded { opacity: 0.72; }
    .patch-main {
      display: grid; grid-template-columns: auto minmax(84px, auto) 1fr auto;
      align-items: center; gap: 14px; padding: 12px 14px; cursor: pointer;
    }
    .patch-main:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; border-radius: 8px; }
    .chev { color: var(--sc-accent); font-size: 0.9rem; width: 16px; text-align: center; }
    .patch-ver { font-size: 1.05rem; color: var(--sc-fg-0); display: flex; align-items: center; gap: 8px; }
    .patch-mid { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .pills { display: flex; gap: 6px; flex-wrap: wrap; }
    .meta-mini { color: var(--sc-fg-2); font-size: 0.72rem; white-space: nowrap; }
    .meta-mini b { color: var(--sc-fg-1); font-variant-numeric: tabular-nums; font-weight: 600; }
    .patch-when {
      color: var(--sc-fg-2); font-size: 0.74rem;
      font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap;
    }

    /* ── Expanded uploads ── */
    .uploads { border-top: 1px solid var(--sc-border); background: rgba(0, 212, 255, 0.03); padding: 6px; }
    .up-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 16px; flex-wrap: wrap; padding: 9px 10px; border-radius: 8px;
    }
    .up-row:hover { background: rgba(0, 212, 255, 0.05); }
    .up-row.disabled-row { opacity: 0.5; }
    .up-row.disabled-row .ch-pill { filter: grayscale(0.7); }
    .up-row.superseded-row { opacity: 0.72; }
    .up-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
    .up-right { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: flex-end; }
    .up-b { font-size: 0.78rem; color: var(--sc-fg-1); }
    .up-ent { display: flex; gap: 5px; flex-wrap: wrap; }
    .echip {
      padding: 1px 6px; background: var(--sc-bg-2); border-radius: 3px;
      font-size: 0.74rem; color: var(--sc-fg-1); font-variant-numeric: tabular-nums;
    }
    .diff-mini { font-family: monospace; font-size: 0.76rem; font-variant-numeric: tabular-nums; }
    .d-add { color: var(--sc-success); }
    .d-rem { color: var(--sc-danger); }
    .up-tool { color: var(--sc-fg-2); }
    .uploader-cell { display: flex; flex-direction: column; line-height: 1.15; text-align: right; }
    .uploader-cell .n { font-size: 0.8rem; overflow-wrap: anywhere; }
    .uploader-cell .e { font-size: 0.72rem; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .up-when { color: var(--sc-fg-2); font-size: 0.72rem; font-variant-numeric: tabular-nums; }

    .expand-btn {
      background: transparent; border: none; color: var(--sc-accent); cursor: pointer;
      font-size: 0.9rem; padding: 2px 6px; border-radius: 4px; transition: background 0.15s;
    }
    .expand-btn:hover { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }

    .acts { display: flex; gap: 6px; flex-wrap: wrap; }
    .sc-btn.micro { padding: 4px 10px; font-size: 0.7rem; letter-spacing: 0.04em; }
    .sc-btn.micro.danger { color: var(--sc-danger); border-color: var(--sc-danger); }
    .sc-btn.micro.danger:hover:not(:disabled) { background: var(--sc-danger); color: var(--sc-bg-0); }

    /* Diff detail (per-upload expand). */
    .diff-detail { padding: 10px 14px 12px 34px; }
    .diff-detail > strong {
      font-family: var(--sc-font-display); font-size: 0.72rem;
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-fg-2);
    }
    .diff-table { width: 100%; max-width: 560px; margin-top: 8px; border-collapse: collapse; }
    .diff-table th, .diff-table td { padding: 4px 10px; border-bottom: 1px solid var(--sc-border); font-size: 0.82rem; }
    .diff-table th {
      text-align: left; font-family: var(--sc-font-display); font-size: 0.68rem;
      letter-spacing: 0.06em; color: var(--sc-fg-2); text-transform: uppercase;
    }
    .disabled-note {
      margin-top: 10px; padding: 8px 12px;
      background: rgba(122, 134, 156, 0.12);
      border-left: 3px solid var(--sc-fg-2); border-radius: 0 4px 4px 0;
      font-size: 0.85rem; color: var(--sc-fg-1);
    }
    .disabled-note.superseded-note { background: rgba(0, 212, 255, 0.08); border-left-color: var(--sc-accent); }

    @media (max-width: 640px) {
      .patch-main { grid-template-columns: auto 1fr auto; gap: 10px; }
      .patch-mid { order: 3; grid-column: 1 / -1; }
      .up-right { justify-content: flex-start; }
    }
  `],
})
export class P4kHistoryComponent implements OnInit {
  readonly svc = inject(P4kService);
  readonly roles = inject(RoleService);
  private readonly translate = inject(TranslateService);

  /** When embedded under the Data Upload page, the page title/subtitle chrome
   *  is dropped and the standalone card wrapper is skipped — the host panel
   *  supplies the surrounding card and section rhythm. */
  readonly embedded = input(false);

  constructor() {
    useAutoRefresh(() => this.refresh(), { enabled: () => !this.svc.busy() });
  }

  private readonly _expanded = signal<Set<string>>(new Set());
  private readonly _groupExpanded = signal<Set<string>>(new Set());

  readonly bundles = computed(() => this.svc.bundles());

  /** Uploads grouped by patch version — the history's top-level cards. */
  readonly patchGroups = computed<PatchGroup[]>(() => groupBundlesByPatch(this.bundles()));

  ngOnInit() {
    this.refresh();
  }

  async refresh() {
    await this.svc.listBundles();
  }

  /** A bundle auto-retired by a newer tool-version upload — history, not a
   *  manual moderation disable. */
  isSuperseded(b: P4kBundleRow): boolean {
    return b.disabled && b.superseded_at !== null;
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

  isGroupExpanded(patch: string): boolean {
    return this._groupExpanded().has(patch);
  }

  toggleGroup(patch: string): void {
    const next = new Set(this._groupExpanded());
    if (next.has(patch)) next.delete(patch);
    else next.add(patch);
    this._groupExpanded.set(next);
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

/** Sort order for channel pills within a patch group: live first, then the rest. */
const CHANNEL_ORDER: readonly ChannelTag[] = ['live', 'ptu', 'eptu', 'tech-preview', 'unknown'];

export interface PatchGroup {
  patch_version: string;
  /** All uploads for this patch, newest upload first — the "sub-uploads". */
  uploads: P4kBundleRow[];
  /** Distinct channels present, live-first. */
  channels: ChannelTag[];
  uploadCount: number;
  /** Representative quality — the newest still-active upload (else the newest). */
  quality_score: number | null;
  /** Representative entity total (same source upload as the quality score). */
  entities: number;
  /** Newest upload timestamp across the group. */
  latest_at: string;
  /** Every upload in the group is superseded history (none currently active). */
  allSuperseded: boolean;
}

/**
 * Group a flat bundle list into one entry per patch version. Each group carries
 * its uploads (newest first) so the history can render a patch as an expandable
 * card whose detail is the list of individual uploads beneath it. Groups are
 * ordered by patch version descending (newest patch first).
 */
export function groupBundlesByPatch(bundles: readonly P4kBundleRow[]): PatchGroup[] {
  const byPatch = new Map<string, P4kBundleRow[]>();
  for (const b of bundles) {
    const arr = byPatch.get(b.patch_version);
    if (arr) arr.push(b);
    else byPatch.set(b.patch_version, [b]);
  }
  const groups: PatchGroup[] = [];
  for (const [patch, ups] of byPatch) {
    const uploads = [...ups].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const channels = CHANNEL_ORDER.filter((ch) => uploads.some((u) => u.channel === ch));
    const representative = uploads.find((u) => !u.disabled) ?? uploads[0];
    groups.push({
      patch_version: patch,
      uploads,
      channels,
      uploadCount: uploads.length,
      quality_score: representative.quality_score,
      entities: sumCounts(representative.entity_counts),
      latest_at: uploads[0].created_at,
      allSuperseded: uploads.every((u) => u.disabled && u.superseded_at !== null),
    });
  }
  return groups.sort((a, b) => compareVersion(b.patch_version, a.patch_version));
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
