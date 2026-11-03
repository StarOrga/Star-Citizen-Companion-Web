// Minimal mission (contract) page — the target of the global search's
// "Missionen" group. Reads one row of the current LIVE build through the
// `codex_mission(p_class_name)` RPC (migration 20261103130000_codex_missions).
// Titles are CIG's text with the runtime ~mission(...) placeholders removed;
// the template as shipped is shown when it differs, never a guessed value.

import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { toErrorKey } from '../core/describe-error';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { NavOriginService, PageCrumb, originTrail } from '../shared/page-header/nav-origin.service';

/** A row of `codex_mission(p_class_name)`. */
export interface CodexMissionRow {
  class_name: string;
  title: string;
  title_raw: string | null;
  type_name: string | null;
  giver_name: string | null;
  location_name: string | null;
  reward_amount: number | null;
  reward_currency: string | null;
  lawful: boolean | null;
  category: string | null;
  description: string | null;
  variants: number | null;
  patch_version: string | null;
}

/** CIG's description with literal "\n" turned into line breaks and placeholders marked. */
export function missionDescription(text: string | null): string[] {
  if (!text) return [];
  return text
    .replace(/\\n/g, '\n')
    .replace(/~mission\(([^)|]*)(?:\|[^)]*)?\)/g, '‹$1›')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

@Component({
  selector: 'sc-mission-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, PageHeaderComponent],
  template: `
    <sc-page-header
      [crumbs]="crumbs()"
      [eyebrow]="'codex.contract.eyebrow' | translate"
      [title]="mission()?.title ?? null"
      [subtitle]="mission()?.type_name ?? null"
      [rememberAs]="mission()?.title ?? null"
    />
    @if (loading()) {
      <div class="sc-card skel" aria-busy="true"></div>
    } @else if (error(); as err) {
      <div class="sc-card err" role="alert">
        <span>{{ err | translate }}</span>
        <button type="button" class="retry" (click)="load()">{{ 'codex.error.retry' | translate }}</button>
      </div>
    } @else if (mission(); as m) {
      <section class="sc-card facts">
        <dl>
          @if (m.giver_name) {
            <dt>{{ 'codex.contract.giver' | translate }}</dt><dd>{{ m.giver_name }}</dd>
          }
          @if (m.location_name) {
            <dt>{{ 'codex.contract.location' | translate }}</dt><dd>{{ m.location_name }}</dd>
          }
          <dt>{{ 'codex.contract.reward' | translate }}</dt>
          <dd>
            @if (m.reward_amount) {
              {{ m.reward_amount.toLocaleString() }} {{ m.reward_currency === 'UEC' || !m.reward_currency ? 'aUEC' : m.reward_currency }}
            } @else {
              {{ 'codex.contract.rewardDynamic' | translate }}
            }
          </dd>
          @if (m.lawful !== null) {
            <dt>{{ 'codex.contract.legality' | translate }}</dt>
            <dd>{{ (m.lawful ? 'codex.contract.lawful' : 'codex.contract.unlawful') | translate }}</dd>
          }
          @if ((m.variants ?? 1) > 1) {
            <dt>{{ 'codex.contract.variantsLabel' | translate }}</dt>
            <dd>{{ 'codex.contract.variants' | translate: { n: m.variants } }}</dd>
          }
          @if (m.patch_version) {
            <dt>{{ 'codex.contract.patch' | translate }}</dt><dd>{{ m.patch_version }}</dd>
          }
        </dl>
      </section>
      @if (paragraphs().length) {
        <section class="sc-card desc">
          @for (p of paragraphs(); track $index) {
            <p>{{ p }}</p>
          }
          <p class="hint">{{ 'codex.contract.placeholderHint' | translate }}</p>
        </section>
      }
    } @else {
      <div class="sc-card empty">{{ 'codex.contract.notFound' | translate }}</div>
    }
  `,
  styles: [`
    :host { display: block; }
    .sc-card { margin-top: 16px; padding: 16px 20px; }
    .skel { min-height: 160px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; margin: 0; }
    dt { color: var(--sc-fg-2); }
    dd { margin: 0; }
    .desc { max-width: var(--sc-measure); }
    .desc p { margin: 0 0 12px; white-space: pre-line; }
    .hint { color: var(--sc-fg-2); font-size: 0.85em; }
    .err { display: flex; gap: 16px; align-items: center; justify-content: space-between; }
  `],
})
export class MissionDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly supabase = inject(SupabaseClientProvider);
  private readonly navOrigin = inject(NavOriginService);
  private readonly destroyRef = inject(DestroyRef);

  readonly mission = signal<CodexMissionRow | null>(null);
  readonly loading = signal(true);
  /** i18n key, never raw text. */
  readonly error = signal<string | null>(null);
  readonly paragraphs = computed(() => missionDescription(this.mission()?.description ?? null));
  /** Codex › where the reader came from (the search keeps no mission index). */
  readonly crumbs = computed<PageCrumb[]>(() => {
    this.mission();
    return originTrail(this.navOrigin, null);
  });
  private className = '';

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      this.className = p.get('className') ?? '';
      void this.load();
    });
  }

  async load(): Promise<void> {
    const cn = this.className;
    this.loading.set(true);
    this.error.set(null);
    try {
      const { data, error } = await this.supabase.client.rpc('codex_mission', { p_class_name: cn });
      if (error) throw error;
      if (cn !== this.className) return;
      const rows = (data ?? []) as CodexMissionRow[];
      this.mission.set(rows[0] ?? null);
    } catch (err) {
      this.mission.set(null);
      this.error.set(toErrorKey('codex', 'load', err));
    } finally {
      if (cn === this.className) this.loading.set(false);
    }
  }
}
