import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import type { PageCrumb } from '../../shared/page-header/nav-origin.service';
import { TranslationGlossaryComponent } from './translation-glossary.component';
import {
  CurrentBuild,
  TranslationJob,
  TranslationLanguage,
  TranslationSettings,
  TranslationsService,
} from './translations.service';
import { canApprove, canCancel, jobErrorKey, judgeScore, spendPercent } from './translations.logic';

type Tab = 'overview' | 'glossary';

/**
 * `/admin/translations` — admin only (roleGuard on the route). Switch + caps of
 * the Claude translation pipeline, approved languages, the job list and the
 * glossary editor (second tab). Contract: docs/translation/ARCHITECTURE.md.
 */
@Component({
  selector: 'sc-admin-translations',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, PageHeaderComponent, TranslationGlossaryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header
      [crumbs]="crumbs"
      [eyebrow]="'admin.translations.eyebrow' | translate"
      [title]="'admin.translations.title' | translate"
      [subtitle]="'admin.translations.subtitle' | translate" />

    <div class="tabs" role="tablist" [attr.aria-label]="'admin.translations.title' | translate">
      @for (t of tabs; track t) {
        <button type="button" role="tab" class="tab" [class.active]="tab() === t"
                [attr.aria-selected]="tab() === t" (click)="tab.set(t)">
          {{ 'admin.translations.tabs.' + t | translate }}
        </button>
      }
    </div>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.kind === 'error'" role="status">{{ f.key | translate }}</p>
    }

    @if (tab() === 'glossary') {
      <sc-translation-glossary [languages]="languages()" />
    } @else if (loadError()) {
      <div class="sc-card state error" role="alert">
        <p>{{ loadError()! | translate }}</p>
        <button type="button" class="sc-btn" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
      </div>
    } @else if (loading()) {
      <div class="sc-card state" role="status">{{ 'admin.translations.loading' | translate }}</div>
    } @else {
      <section class="sc-card block">
        <div class="switch-row">
          <button type="button" role="switch" class="switch" [class.on]="settings().enabled"
                  [attr.aria-checked]="settings().enabled" [disabled]="busy()"
                  [attr.aria-label]="'admin.translations.switch.label' | translate"
                  (click)="toggleEnabled()"><span class="knob"></span></button>
          <div>
            <h2>{{ 'admin.translations.switch.label' | translate }}</h2>
            <p class="hint">{{ 'admin.translations.switch.hint' | translate }}</p>
          </div>
        </div>
        <div class="caps">
          <label class="field">
            <span>{{ 'admin.translations.caps.upload' | translate }}</span>
            <input class="sc-input" type="number" min="0" step="1" inputmode="decimal"
                   [value]="settings().upload_cap_usd" (change)="saveCap('upload_cap_usd', $event)" />
          </label>
          <label class="field">
            <span>{{ 'admin.translations.caps.monthly' | translate }}</span>
            <input class="sc-input" type="number" min="0" step="1" inputmode="decimal"
                   [value]="settings().monthly_cap_usd" (change)="saveCap('monthly_cap_usd', $event)" />
          </label>
        </div>
        <div class="spend">
          <div class="spend-line">
            <span>{{ 'admin.translations.spend.month' | translate }}</span>
            <strong>{{ spend().toFixed(2) }} $ / {{ settings().monthly_cap_usd.toFixed(2) }} $</strong>
          </div>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="spendPct()">
            <i [style.width.%]="spendPct()" [class.hot]="spendPct() >= 90"></i>
          </div>
        </div>
      </section>

      <section class="sc-card block">
        <h2>{{ 'admin.translations.languages.title' | translate }}</h2>
        <ul class="langs" role="list">
          @for (l of languages(); track l.lang) {
            <li class="lang">
              <span class="code">{{ l.lang }}</span>
              <span class="folder">{{ l.cig_folder }}</span>
              <span class="pill" [class.ok]="l.approved">
                {{ (l.approved ? 'admin.translations.languages.approved' : 'admin.translations.languages.notApproved') | translate }}
              </span>
              <span class="grow"></span>
              @if (l.approved) {
                <button type="button" class="sc-btn micro" [disabled]="busy()" (click)="startFull(l)">
                  {{ 'admin.translations.languages.fullRun' | translate }}
                </button>
              }
              <button type="button" class="sc-btn micro" [class.danger]="l.approved" [disabled]="busy()"
                      (click)="toggleLanguage(l)">
                {{ (l.approved ? 'admin.translations.languages.revoke' : 'admin.translations.languages.approve') | translate }}
              </button>
            </li>
          }
        </ul>
      </section>

      <section class="sc-card block">
        <div class="block-head">
          <h2>{{ 'admin.translations.jobs.title' | translate }}</h2>
          <button type="button" class="sc-btn micro" (click)="reloadJobs()">{{ 'admin.translations.refresh' | translate }}</button>
        </div>
        @if (jobs().length === 0) {
          <p class="hint">{{ 'admin.translations.jobs.empty' | translate }}</p>
        } @else {
          <div class="sc-table-scroll">
            <table class="jobs">
              <thead>
                <tr>
                  <th>{{ 'admin.translations.jobs.cols.build' | translate }}</th>
                  <th>{{ 'admin.translations.jobs.cols.lang' | translate }}</th>
                  <th>{{ 'admin.translations.jobs.cols.mode' | translate }}</th>
                  <th>{{ 'admin.translations.jobs.cols.status' | translate }}</th>
                  <th class="num">{{ 'admin.translations.jobs.cols.strings' | translate }}</th>
                  <th class="num">{{ 'admin.translations.jobs.cols.estimate' | translate }}</th>
                  <th class="num">{{ 'admin.translations.jobs.cols.spent' | translate }}</th>
                  <th class="num">{{ 'admin.translations.jobs.cols.judge' | translate }}</th>
                  <th>{{ 'admin.translations.jobs.cols.created' | translate }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (j of jobs(); track j.id) {
                  <tr>
                    <td>{{ j.build ? j.build.patch_version + ' · ' + j.build.channel : '—' }}</td>
                    <td>{{ j.lang }}</td>
                    <td>{{ 'admin.translations.jobs.mode.' + j.mode | translate }}</td>
                    <td>
                      <span class="pill" [class.ok]="j.status === 'published'" [class.bad]="j.status === 'failed'">
                        {{ 'admin.translations.jobs.status.' + j.status | translate }}
                      </span>
                      @if (errorKey(j); as ek) {
                        <div class="err-line">{{ ek | translate }}</div>
                      }
                    </td>
                    <td class="num">{{ j.string_count ?? '—' }}</td>
                    <td class="num">{{ j.estimate_usd === null ? '—' : j.estimate_usd.toFixed(2) + ' $' }}</td>
                    <td class="num">{{ j.spent_usd.toFixed(2) }} $</td>
                    <td class="num">{{ score(j) ?? '—' }}</td>
                    <td>{{ j.created_at | scDate: 'datetime' }}</td>
                    <td class="actions">
                      @if (canApprove(j.status)) {
                        <button type="button" class="sc-btn micro sc-btn-primary" [disabled]="busy()" (click)="approve(j)">
                          {{ 'admin.translations.jobs.approve' | translate }}
                        </button>
                      }
                      @if (canCancel(j.status)) {
                        <button type="button" class="sc-btn micro danger" [disabled]="busy()" (click)="cancel(j)">
                          {{ 'admin.translations.jobs.cancel' | translate }}
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; padding-block: var(--sc-space-5) var(--sc-space-7); }
      .tabs { display: flex; gap: var(--sc-space-2); margin-block: var(--sc-space-4); flex-wrap: wrap; }
      .tab {
        min-height: 44px; padding: 0 var(--sc-space-4); border-radius: 999px; cursor: pointer;
        border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-1); font: inherit;
      }
      .tab.active { border-color: var(--sc-accent-hot); color: var(--sc-fg-0);
        background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); }
      .block { display: grid; gap: var(--sc-space-4); margin-bottom: var(--sc-space-4); }
      .block-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sc-space-3); }
      h2 { margin: 0; font-size: 1.05rem; }
      .hint { margin: 0; color: var(--sc-fg-2); font-size: 0.88rem; }
      .state { display: grid; gap: var(--sc-space-3); justify-items: start; }
      .state.error { border-color: var(--sc-danger); }
      .flash { margin: 0 0 var(--sc-space-3); color: var(--sc-success, var(--sc-accent)); }
      .flash.err { color: var(--sc-danger); }
      .switch-row { display: flex; gap: var(--sc-space-4); align-items: flex-start; }
      .switch {
        flex: none; width: 52px; height: 30px; border-radius: 999px; padding: 3px; cursor: pointer;
        border: 1px solid var(--sc-border); background: var(--sc-bg-0); position: relative;
      }
      .switch .knob { display: block; width: 22px; height: 22px; border-radius: 50%; background: var(--sc-fg-2);
        transition: transform 0.15s ease, background 0.15s ease; }
      .switch.on { border-color: var(--sc-accent); }
      .switch.on .knob { transform: translateX(22px); background: var(--sc-accent); }
      .switch:disabled { opacity: 0.5; cursor: not-allowed; }
      .caps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--sc-space-4); }
      .field { display: grid; gap: var(--sc-space-2); font-size: 0.85rem; color: var(--sc-fg-1); }
      .spend { display: grid; gap: var(--sc-space-2); }
      .spend-line { display: flex; justify-content: space-between; gap: var(--sc-space-3); flex-wrap: wrap; }
      .bar { height: 8px; border-radius: 4px; background: var(--sc-bg-0); overflow: hidden; }
      .bar i { display: block; height: 100%; background: var(--sc-accent); }
      .bar i.hot { background: var(--sc-warning); }
      .langs { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sc-space-2); }
      .lang { display: flex; align-items: center; gap: var(--sc-space-3); flex-wrap: wrap;
        padding: var(--sc-space-2) 0; border-bottom: 1px solid var(--sc-border); }
      .lang .code { font-weight: 600; min-width: 4.5em; }
      .lang .folder { color: var(--sc-fg-2); font-size: 0.85rem; }
      .grow { flex: 1 1 auto; }
      .pill { padding: 2px 10px; border-radius: 999px; font-size: 0.78rem; border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
      .pill.ok { border-color: var(--sc-accent); color: var(--sc-accent); }
      .pill.bad { border-color: var(--sc-danger); color: var(--sc-danger); }
      .jobs { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
      .jobs th, .jobs td { text-align: start; padding: var(--sc-space-2) var(--sc-space-3); border-bottom: 1px solid var(--sc-border); white-space: nowrap; }
      .jobs .num { text-align: end; font-variant-numeric: tabular-nums; }
      .jobs .actions { display: flex; gap: var(--sc-space-2); }
      .err-line { color: var(--sc-danger); font-size: 0.78rem; white-space: normal; max-width: 28ch; }
      .sc-btn.danger { border-color: var(--sc-danger); color: var(--sc-danger); }
    `,
  ],
})
export class AdminTranslationsComponent implements OnInit {
  private readonly svc = inject(TranslationsService);
  private readonly confirmSvc = inject(ScConfirmService);

  readonly tabs: readonly Tab[] = ['overview', 'glossary'];
  readonly crumbs: PageCrumb[] = [{ labelKey: 'adminHub.title', link: '/admin/hub' }];
  readonly tab = signal<Tab>('overview');
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly flash = signal<{ kind: 'ok' | 'error'; key: string } | null>(null);

  readonly settings = signal<TranslationSettings>({ enabled: false, upload_cap_usd: 20, monthly_cap_usd: 190 });
  readonly languages = signal<TranslationLanguage[]>([]);
  readonly jobs = signal<TranslationJob[]>([]);
  readonly builds = signal<CurrentBuild[]>([]);
  readonly spend = signal(0);
  readonly spendPct = computed(() => spendPercent(this.spend(), this.settings().monthly_cap_usd));

  readonly canApprove = canApprove;
  readonly canCancel = canCancel;
  readonly errorKey = (j: TranslationJob) => jobErrorKey(j.error);
  readonly score = (j: TranslationJob) => {
    const s = judgeScore(j.stats);
    return s === null ? null : s.toFixed(2);
  };

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [settings, languages, jobs, builds, spend] = await Promise.all([
        this.svc.getSettings(),
        this.svc.listLanguages(),
        this.svc.listJobs(),
        this.svc.currentBuilds(),
        this.svc.monthSpend(),
      ]);
      this.settings.set(settings);
      this.languages.set(languages);
      this.jobs.set(jobs);
      this.builds.set(builds);
      this.spend.set(spend);
    } catch (e) {
      this.loadError.set(toErrorKey('admin-translations', 'load', e));
    } finally {
      this.loading.set(false);
    }
  }

  async reloadJobs(): Promise<void> {
    try {
      const [jobs, spend] = await Promise.all([this.svc.listJobs(), this.svc.monthSpend()]);
      this.jobs.set(jobs);
      this.spend.set(spend);
    } catch (e) {
      this.flash.set({ kind: 'error', key: toErrorKey('admin-translations', 'reload-jobs', e) });
    }
  }

  /** Runs a write; an error becomes a translated flash, success an optional refresh. */
  private async run(op: string, fn: () => Promise<unknown>, after?: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      await fn();
      if (after) await after();
      this.flash.set({ kind: 'ok', key: 'admin.translations.saved' });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const key = code ? jobErrorKey(code) : null;
      this.flash.set({ kind: 'error', key: key ?? toErrorKey('admin-translations', op, e) });
    } finally {
      this.busy.set(false);
    }
  }

  toggleEnabled(): Promise<void> {
    const enabled = !this.settings().enabled;
    return this.run('toggle-enabled', () => this.svc.saveSettings({ enabled }), async () => {
      this.settings.update((s) => ({ ...s, enabled }));
    });
  }

  saveCap(field: 'upload_cap_usd' | 'monthly_cap_usd', ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const v = Number(input.value);
    if (!Number.isFinite(v) || v < 0) {
      input.value = String(this.settings()[field]);
      return Promise.resolve();
    }
    return this.run('save-cap', () => this.svc.saveSettings({ [field]: v }), async () => {
      this.settings.update((s) => ({ ...s, [field]: v }));
    });
  }

  async toggleLanguage(l: TranslationLanguage): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: l.approved ? 'admin.translations.languages.revokeTitle' : 'admin.translations.languages.approveTitle',
      messageKey: l.approved ? 'admin.translations.languages.revokeText' : 'admin.translations.languages.approveText',
      params: { lang: l.lang },
      tone: l.approved ? 'danger' : 'default',
    });
    if (!ok) return;
    await this.run('set-approved', () => this.svc.setApproved(l.lang, !l.approved), async () => {
      this.languages.update((ls) => ls.map((x) => (x.lang === l.lang ? { ...x, approved: !l.approved } : x)));
    });
  }

  async approve(j: TranslationJob): Promise<void> {
    await this.run('approve', () => this.svc.approve(j.id), () => this.reloadJobs());
  }

  async cancel(j: TranslationJob): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.jobs.cancelTitle',
      messageKey: 'admin.translations.jobs.cancelText',
      params: { lang: j.lang },
      tone: 'danger',
    });
    if (!ok) return;
    await this.run('cancel', () => this.svc.cancel(j.id), () => this.reloadJobs());
  }

  /** Full run for the current build: dry-run estimate → danger confirm → start (still needs approval). */
  async startFull(l: TranslationLanguage): Promise<void> {
    const build = this.builds()[0];
    if (!build) {
      this.flash.set({ kind: 'error', key: 'admin.translations.jobs.noBuild' });
      return;
    }
    this.busy.set(true);
    this.flash.set(null);
    let estimate;
    try {
      estimate = await this.svc.estimateFull(build.id, l.lang);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      this.flash.set({ kind: 'error', key: (code ? jobErrorKey(code) : null) ?? toErrorKey('admin-translations', 'estimate', e) });
      return;
    } finally {
      this.busy.set(false);
    }
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.fullRun.title',
      messageKey: 'admin.translations.fullRun.text',
      params: { lang: l.lang, usd: estimate.estimate_usd.toFixed(2), count: estimate.string_count },
      confirmKey: 'admin.translations.fullRun.confirm',
      tone: 'danger',
    });
    if (!ok) return;
    await this.run('start-full', () => this.svc.startFull(build.id, l.lang), () => this.reloadJobs());
  }
}
