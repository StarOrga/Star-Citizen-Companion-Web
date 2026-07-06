import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';

interface VersionRow { version: string; crashes: number; usage: number; sessions: number; }
interface CountRow { name?: string; role?: string; count: number; }
interface RecentCrash { version: string; role: string | null; name: string | null; message: string; at: number; }
interface TelemetryStats {
  generatedAt: number;
  windowDays: number;
  totals: { crashes: number; usage: number; installs: number; sessions: number };
  byVersion: VersionRow[];
  crashesByType: CountRow[];
  crashesByRole: CountRow[];
  recentCrashes: RecentCrash[];
}

@Component({
  selector: 'sc-telemetry-stats',
  standalone: true,
  imports: [DatePipe, DecimalPipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <div>
          <h1>{{ 'telemetry.title' | translate }}</h1>
          <p class="hint">{{ 'telemetry.subtitle' | translate }}</p>
        </div>
        <div class="head-actions">
          <select class="sc-select" [value]="windowDays()" (change)="setWindow($event)" [disabled]="busy()">
            <option [value]="7">{{ 'telemetry.window.7' | translate }}</option>
            <option [value]="30">{{ 'telemetry.window.30' | translate }}</option>
            <option [value]="90">{{ 'telemetry.window.90' | translate }}</option>
          </select>
          <button class="sc-btn" (click)="load()" [disabled]="busy()">{{ 'telemetry.refresh' | translate }}</button>
        </div>
      </header>

      @if (errorMsg()) {
        <div class="err"><strong>{{ 'telemetry.errorTitle' | translate }}:</strong> {{ errorMsg() }}</div>
      }

      @if (busy() && !stats()) {
        <div class="sc-card empty">{{ 'telemetry.loading' | translate }}</div>
      } @else if (stats(); as s) {
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
                <span class="bar"><span class="bar-fill" [style.width.%]="pct(v.crashes, maxVersionCrashes())"></span></span>
                <span class="bar-num">{{ v.crashes | number }}</span>
              </div>
            } @empty { <p class="hint">{{ 'telemetry.empty' | translate }}</p> }
          </div>

          <div class="sc-card">
            <h2>{{ 'telemetry.crashesByType' | translate }}</h2>
            @for (c of s.crashesByType; track c.name) {
              <div class="bar-row">
                <span class="bar-label mono">{{ c.name }}</span>
                <span class="bar"><span class="bar-fill warn" [style.width.%]="pct(c.count, maxTypeCount())"></span></span>
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

        <div class="sc-card">
          <h2>{{ 'telemetry.recent' | translate }}</h2>
          @if (s.recentCrashes.length) {
            <table class="table">
              <thead><tr>
                <th>{{ 'telemetry.col.at' | translate }}</th>
                <th>{{ 'telemetry.col.version' | translate }}</th>
                <th>{{ 'telemetry.col.role' | translate }}</th>
                <th>{{ 'telemetry.col.name' | translate }}</th>
                <th>{{ 'telemetry.col.message' | translate }}</th>
              </tr></thead>
              <tbody>
                @for (c of s.recentCrashes; track $index) {
                  <tr>
                    <td class="mono">{{ c.at | date:'short' }}</td>
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

        <p class="gen hint">{{ 'telemetry.generatedAt' | translate }}: {{ s.generatedAt | date:'medium' }}</p>
      }
    </section>
  `,
  styles: [`
    .page { padding: 1rem; max-width: 1100px; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
    .head-actions { display: flex; gap: 0.5rem; align-items: center; }
    .hint { color: var(--sc-text-dim, #8b97a8); font-size: 0.85rem; }
    .err { background: rgba(248,81,73,.12); color: #f85149; padding: 0.6rem 0.9rem; border-radius: 8px; margin-bottom: 1rem; }
    .empty { text-align: center; color: var(--sc-text-dim, #8b97a8); }
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
    .pills { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .role-pill { background: rgba(255,255,255,.06); border-radius: 12px; padding: 2px 10px; font-size: 0.78rem; }
    .table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .table th, .table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.07); vertical-align: top; }
    .table .msg { color: var(--sc-text-dim, #8b97a8); max-width: 360px; overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
    .gen { text-align: right; margin-top: 0.5rem; }
    @media (max-width: 760px) { .totals { grid-template-columns: repeat(2,1fr); } .cols { grid-template-columns: 1fr; } }
    @media (max-width: 560px) {
      .page { padding: 0; }
      .head { flex-direction: column; align-items: stretch; }
      .head-actions { flex-wrap: wrap; }
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
export class TelemetryStatsComponent implements OnInit {
  private readonly supabase = inject(SupabaseClientProvider);

  readonly stats = signal<TelemetryStats | null>(null);
  readonly busy = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly windowDays = signal(30);

  readonly maxVersionCrashes = computed(() =>
    Math.max(1, ...(this.stats()?.byVersion ?? []).map((v) => v.crashes)));
  readonly maxTypeCount = computed(() =>
    Math.max(1, ...(this.stats()?.crashesByType ?? []).map((c) => c.count)));

  ngOnInit(): void {
    void this.load();
  }

  setWindow(ev: Event): void {
    this.windowDays.set(Number((ev.target as HTMLSelectElement).value) || 30);
    void this.load();
  }

  pct(n: number, max: number): number {
    return Math.round((n / max) * 100);
  }

  async load(): Promise<void> {
    this.busy.set(true);
    this.errorMsg.set(null);
    const { data, error } = await this.supabase.client.rpc('get_telemetry_stats', {
      window_days: this.windowDays(),
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
