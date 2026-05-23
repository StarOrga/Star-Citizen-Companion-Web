import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { P4kBundleRow, P4kService } from './p4k.service';

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
        <button class="sc-btn" (click)="refresh()" [disabled]="svc.busy()">
          {{ 'p4k.refresh' | translate }}
        </button>
      </header>

      <div class="sc-card kpi-row">
        <div class="kpi">
          <span class="kpi-label">{{ 'p4k.kpi.total' | translate }}</span>
          <span class="kpi-value">{{ bundles().length }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">{{ 'p4k.kpi.channels' | translate }}</span>
          <span class="kpi-value">{{ uniqueChannels() }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">{{ 'p4k.kpi.avgQuality' | translate }}</span>
          <span class="kpi-value" [class.q-green]="avgQuality() >= 80" [class.q-yellow]="avgQuality() >= 50 && avgQuality() < 80" [class.q-red]="avgQuality() < 50">
            {{ avgQuality() | number:'1.0-0' }}
          </span>
        </div>
        <div class="kpi">
          <span class="kpi-label">{{ 'p4k.kpi.entitiesTotal' | translate }}</span>
          <span class="kpi-value">{{ totalEntities() | number }}</span>
        </div>
      </div>

      @if (svc.errorMsg(); as err) {
        <div class="err">
          <strong>{{ 'p4k.errorTitle' | translate }}:</strong> {{ err }}
        </div>
      }

      @if (bundles().length === 0 && !svc.busy()) {
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
              <th>{{ 'p4k.col.channel' | translate }}</th>
              <th>{{ 'p4k.col.version' | translate }}</th>
              <th>{{ 'p4k.col.quality' | translate }}</th>
              <th>{{ 'p4k.col.entities' | translate }}</th>
              <th>{{ 'p4k.col.tool' | translate }}</th>
              <th>{{ 'p4k.col.uploader' | translate }}</th>
              <th>{{ 'p4k.col.when' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (b of bundles(); track b.id) {
              <tr>
                <td><span class="ch-pill" [class]="b.channel">{{ b.channel.toUpperCase() }}</span></td>
                <td class="mono">{{ b.patch_version }}</td>
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
                <td class="mono small">{{ b.tool_version ?? '—' }}</td>
                <td>
                  <div class="uploader">
                    <span>{{ b.uploaded_by_name ?? '—' }}</span>
                    <span class="mono small">{{ b.uploaded_by_email }}</span>
                  </div>
                </td>
                <td>{{ b.created_at | date:'short' }}</td>
              </tr>
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
    .err {
      padding: 10px 14px;
      background: rgba(248, 113, 113, 0.1);
      border: 1px solid var(--sc-danger);
      color: var(--sc-danger);
      border-radius: 4px;
    }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 18px;
      padding: 16px 22px;
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
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--sc-border);
      font-size: 0.86rem;
      vertical-align: middle;
    }
    .table thead th {
      background: var(--sc-bg-2);
      font-family: var(--sc-font-display);
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .table tbody tr:hover { background: rgba(0, 212, 255, 0.04); }
    .mono { font-family: monospace; color: var(--sc-fg-1); }
    .small { font-size: 0.76rem; color: var(--sc-fg-2); }

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
  `],
})
export class P4kHistoryComponent implements OnInit {
  readonly svc = inject(P4kService);

  readonly bundles = computed(() => this.svc.bundles());
  readonly uniqueChannels = computed(() => new Set(this.bundles().map((b) => b.channel)).size);
  readonly totalEntities = computed(() =>
    this.bundles().reduce((sum, b) => sum + sumCounts(b.entity_counts), 0),
  );
  readonly avgQuality = computed(() => {
    const scored = this.bundles().filter((b) => b.quality_score !== null);
    if (scored.length === 0) return 0;
    return scored.reduce((s, b) => s + (b.quality_score ?? 0), 0) / scored.length;
  });

  ngOnInit() {
    this.refresh();
  }

  async refresh() {
    await this.svc.listBundles();
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
}

function sumCounts(counts: Record<string, unknown> | null): number {
  if (!counts) return 0;
  return Object.values(counts).reduce<number>((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
}
