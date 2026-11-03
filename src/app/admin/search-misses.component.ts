import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { toErrorKey } from '../core/describe-error';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

/** One row of `public.admin_search_misses(p_limit)` (migration 20261102121000). */
export interface SearchMissRow {
  query: string;
  hits: number;
  last_at: string;
}

const LIMIT = 50;

/**
 * Admin tile (concept 2026-11-02, C10): searches that found nothing, counted
 * anonymously (text + count, no user id). The RPC raises 42501 for anyone but
 * an admin; a load failure shows an error with retry, never the empty state.
 */
@Component({
  selector: 'sc-search-misses',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-card misses-card">
      <h2>{{ 'admin.searchMisses.title' | translate }}</h2>
      <p class="hint">{{ 'admin.searchMisses.subtitle' | translate }}</p>
      @if (errorKey(); as key) {
        <div class="err" role="alert">
          <span><strong>{{ 'admin.errorTitle' | translate }}:</strong> {{ key | translate }}</span>
          <button type="button" class="sc-btn" (click)="load()" [disabled]="loading()">{{ 'admin.searchMisses.retry' | translate }}</button>
        </div>
      } @else if (loading() && rows() === null) {
        <div class="empty">{{ 'admin.loading' | translate }}</div>
      } @else if (!rows()?.length) {
        <div class="empty">{{ 'admin.searchMisses.empty' | translate }}</div>
      } @else {
        <div class="sc-table-scroll">
          <table>
            <thead><tr>
              <th scope="col">{{ 'admin.searchMisses.query' | translate }}</th>
              <th scope="col" class="num">{{ 'admin.searchMisses.hits' | translate }}</th>
              <th scope="col">{{ 'admin.searchMisses.last' | translate }}</th>
            </tr></thead>
            <tbody>
              @for (r of rows(); track r.query) {
                <tr><td class="q">{{ r.query }}</td><td class="num">{{ r.hits }}</td><td>{{ r.last_at | scDate: 'datetime' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: [`
    h2 { margin: 0 0 4px; font-size: 1rem; }
    .hint { color: var(--sc-fg-2); margin: 0 0 12px; }
    .err {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 10px 14px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-danger) 10%, transparent); color: var(--sc-danger);
    }
    .empty { color: var(--sc-fg-2); padding: 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: max(0.85rem, var(--sc-fs-floor)); }
    th { text-align: left; color: var(--sc-fg-2); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--sc-border); }
    td { padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 50%, transparent); }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .q { color: var(--sc-fg-0); word-break: break-word; }
  `],
})
export class SearchMissesComponent implements OnInit {
  private readonly sb = inject(SupabaseClientProvider);

  readonly rows = signal<SearchMissRow[] | null>(null);
  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const { data, error } = await this.sb.client.rpc('admin_search_misses' as never, { p_limit: LIMIT } as never);
      if (error) throw error;
      this.rows.set(((data ?? []) as SearchMissRow[]).filter((r) => r && typeof r.query === 'string'));
    } catch (err) {
      this.errorKey.set(toErrorKey('admin', 'search misses', err));
    } finally {
      this.loading.set(false);
    }
  }
}
