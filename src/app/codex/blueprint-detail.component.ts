import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BlueprintDetail, CodexService, pickLocalized } from './codex.service';
import {
  BlueprintPayload,
  CodexBlueprintIngredient,
  Lang,
  QualityStatSummary,
} from './codex.types';
import {
  cleanLocaleValue,
  formatCraftTime,
  formatNumber,
  formatQuality,
  humanizeBlueprintCategory,
  humanizeBlueprintName,
  humanizeClassName,
  humanizeKey,
  unescapeText,
} from './codex-format';
import { NeuroFieldDirective } from '../core/neuro-field.directive';

@Component({
  selector: 'sc-blueprint-detail',
  standalone: true,
  imports: [NeuroFieldDirective, RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-page">
      <a class="back" [routerLink]="['/codex/blueprint']">← {{ 'blueprint.detail.back' | translate }}</a>

      @if (loading()) {
        <div class="sc-card skel-card sc-skel-field" scNeuroField></div>
      } @else if (error(); as err) {
        <div class="sc-card err"><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}</div>
      } @else if (!detail()) {
        <div class="sc-card empty">{{ 'codex.detail.notFound' | translate }}</div>
      } @else {
        <!-- Hero -->
        <div class="hero sc-card">
          <div class="hero-text">
            <h1 class="entity-name">{{ displayName() }}</h1>
            <code class="cls">{{ detail()!.classNameSlug }}</code>
            @if (description(); as desc) {
              <p class="desc">{{ desc }}</p>
            }
          </div>
          <div class="facts">
            @for (f of facts(); track f.label) {
              <div class="fact" [class.accent]="f.accent">
                <span class="fact-label">{{ f.label }}</span>
                <span class="fact-val">{{ f.value }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Ingredients -->
        <div class="section sc-card">
          <h2 class="section-title">{{ 'blueprint.detail.ingredients' | translate }}</h2>
          @if (ingredients().length === 0) {
            <p class="muted">{{ 'blueprint.detail.noIngredients' | translate }}</p>
          } @else {
            <div class="ingredient-list">
              @for (ing of ingredients(); track ing.ingredientIndex) {
                <div class="ingredient-row" [class.unresolved]="!ing.ingredientClassName">
                  <div class="ing-qty">× {{ ing.quantity }}</div>
                  <div class="ing-info">
                    @if (ing.ingredientClassName && ing.entityKind) {
                      <a class="ing-name link"
                         [routerLink]="['/codex', ing.entityKind, ing.ingredientClassName]">
                        {{ ingredientName(ing) }}
                      </a>
                    } @else if (ing.ingredientClassName) {
                      <span class="ing-name">{{ ingredientName(ing) }}</span>
                    } @else {
                      <span class="ing-name muted">{{ 'blueprint.detail.unresolved' | translate }}</span>
                    }
                    @if (ing.ingredientClassName) {
                      <code class="ing-cls">{{ ing.ingredientClassName }}</code>
                    }
                    <div class="ing-meta">
                      @if (ing.role && ing.role !== 'primary') {
                        <span class="badge role">{{ ('blueprint.role.' + ing.role) | translate }}</span>
                      }
                      @if (ing.minQuality != null) {
                        <span class="badge quality">{{ 'blueprint.detail.minQuality' | translate }}: {{ formatQuality(ing.minQuality) }}</span>
                      }
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Output -->
        @if (outputInfo(); as out) {
          <div class="section sc-card">
            <h2 class="section-title">{{ 'blueprint.detail.output' | translate }}</h2>
            <div class="output-row">
              <div class="ing-qty">× {{ out.quantity }}</div>
              <div class="ing-info">
                @if (out.className && out.entityKind) {
                  <a class="ing-name link"
                     [routerLink]="['/codex', out.entityKind, out.className]">
                    {{ out.name }}
                  </a>
                } @else {
                  <span class="ing-name">{{ out.name }}</span>
                }
                @if (out.className) {
                  <code class="ing-cls">{{ out.className }}</code>
                }
              </div>
            </div>
          </div>
        }

        <!-- Static quality summary (v2: interactive sliders) -->
        @if (qualityStats().length > 0) {
          <div class="section sc-card">
            <h2 class="section-title">{{ 'blueprint.detail.qualitySummary' | translate }}</h2>
            <p class="quality-note muted">{{ 'blueprint.detail.qualityNote' | translate }}</p>
            <div class="quality-table">
              @for (qs of qualityStats(); track qs.stat) {
                <div class="quality-row" [class.primary]="qs.primary">
                  <span class="q-label">{{ humanizeKey(qs.stat) }}</span>
                  <span class="q-val">
                    {{ qs.baseValue != null ? formatNumber(qs.baseValue) + (qs.unit ? ' ' + qs.unit : '') : ('codex.detail.naValue' | translate) }}
                  </span>
                  @if (qs.primary) {
                    <span class="q-primary-badge">{{ 'blueprint.detail.primary' | translate }}</span>
                  }
                </div>
              }
            </div>
          </div>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; max-width: 900px; margin: 0 auto; }

    .back { font-size: 0.82rem; color: var(--sc-fg-2); text-decoration: none; }
    .back:hover { color: var(--sc-accent); }

    .sc-card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 10px; padding: 20px 24px; }
    .skel-card { min-height: 200px; }

    .hero { display: flex; flex-direction: column; gap: 16px; }
    .hero-text { display: flex; flex-direction: column; gap: 6px; }
    .entity-name { margin: 0; font-size: 1.6rem; font-weight: 700; line-height: 1.2; }
    .cls { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .desc { margin: 0; color: var(--sc-fg-1); white-space: pre-wrap; line-height: 1.5; }

    .facts { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 8px; }
    .fact {
      display: flex; flex-direction: column; gap: 2px;
      padding: 8px 14px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      min-width: 100px;
    }
    .fact.accent { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .fact-label { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .fact-val { font-size: 0.92rem; font-weight: 600; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
    .fact.accent .fact-val { color: var(--sc-accent); }

    .section-title { margin: 0 0 14px; font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); border-bottom: 1px solid var(--sc-border); padding-bottom: 8px; }

    .ingredient-list { display: flex; flex-direction: column; gap: 8px; }
    .ingredient-row, .output-row {
      display: flex; gap: 14px; align-items: flex-start;
      padding: 10px 12px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border);
    }
    .ingredient-row.unresolved { opacity: 0.6; border-style: dashed; }
    .ing-qty { font-size: 1.1rem; font-weight: 700; color: var(--sc-accent); font-family: var(--sc-font-display); min-width: 36px; text-align: center; padding-top: 2px; }
    .ing-info { display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .ing-name { font-size: 0.92rem; font-weight: 600; color: var(--sc-fg-0); }
    .ing-name.link { color: var(--sc-accent); text-decoration: none; }
    .ing-name.link:hover { text-decoration: underline; }
    .ing-cls { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .ing-meta { display: flex; flex-wrap: wrap; gap: 5px; }

    .badge { font-size: max(0.66rem, var(--sc-fs-floor)); padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.role { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .badge.quality { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }

    .quality-note { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); margin: -6px 0 12px; font-style: italic; }
    .quality-table { display: flex; flex-direction: column; gap: 6px; }
    .quality-row {
      display: flex; align-items: center; gap: 12px;
      padding: 8px 12px; border-radius: 6px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border);
    }
    .quality-row.primary { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .q-label { flex: 1; font-size: 0.88rem; color: var(--sc-fg-1); }
    .q-val { font-weight: 600; font-family: var(--sc-font-display); color: var(--sc-fg-0); }
    .q-primary-badge { font-size: max(0.6rem, var(--sc-fs-floor)); padding: 2px 6px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 18%, transparent); color: var(--sc-accent); border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); text-transform: uppercase; letter-spacing: 0.06em; }

    .muted { color: var(--sc-fg-2); }
    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .err { color: var(--sc-danger); padding: 16px; }

    @media (max-width: 680px) {
      .sc-card { padding: 14px 16px; }
      .entity-name { font-size: 1.3rem; }
    }
  `],
})
export class BlueprintDetailComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  readonly detail = signal<BlueprintDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Expose format helpers for template use
  readonly formatCraftTime = formatCraftTime;
  readonly formatQuality = formatQuality;
  readonly formatNumber = formatNumber;
  readonly humanizeKey = humanizeKey;

  private get payload(): BlueprintPayload | null {
    const d = this.detail();
    if (!d) return null;
    return (d.row['payload'] as BlueprintPayload) ?? null;
  }

  private get lang(): Lang {
    const l = this.translate.currentLang ?? 'en';
    return (l === 'de' ? 'de' : 'en') as Lang;
  }

  readonly displayName = computed(() => {
    const p = this.payload;
    if (!p) return '';
    const fromPayload = p.name ? pickLocalized(p.name, this.lang) : '';
    return (
      fromPayload ||
      cleanLocaleValue(this.detail()?.row['name_localized'] as string) ||
      humanizeBlueprintName(this.detail()?.classNameSlug)
    );
  });

  readonly description = computed(() => {
    const p = this.payload;
    if (!p?.description) return '';
    return unescapeText(pickLocalized(p.description, this.lang));
  });

  readonly facts = computed(() => {
    const d = this.detail();
    const p = this.payload;
    if (!d || !p) return [];
    const facts: { label: string; value: string; accent?: boolean }[] = [];
    const t = (key: string) => this.translate.instant(key);

    const cat = d.row['category'] as string | null;
    if (cat) {
      // CIG buckets are open-ended — fall back to a humanized label rather than
      // printing the raw i18n key when a new one shows up.
      const key = `blueprint.category.${cat}`;
      const label = t(key);
      facts.push({
        label: t('blueprint.filters.category'),
        value: label && label !== key ? label : humanizeBlueprintCategory(cat),
      });
    }
    const tier = d.row['tier'] as number | null;
    if (tier != null) {
      facts.push({ label: t('blueprint.detail.tier'), value: String(tier), accent: true });
    }
    const craftSec = d.row['craft_time_seconds'] as number | null;
    const craftFormatted = formatCraftTime(craftSec);
    if (craftFormatted) {
      facts.push({ label: t('blueprint.detail.craftTime'), value: craftFormatted, accent: true });
    }
    const dismantleSec = d.row['dismantle_time_seconds'] as number | null;
    const dismantleFormatted = formatCraftTime(dismantleSec);
    if (dismantleFormatted) {
      facts.push({ label: t('blueprint.detail.dismantleTime'), value: dismantleFormatted });
    }
    const outQty = d.row['output_quantity'] as number | null;
    if (outQty != null && outQty !== 1) {
      facts.push({ label: t('blueprint.detail.outputQty'), value: String(outQty) });
    }
    return facts;
  });

  readonly ingredients = computed((): CodexBlueprintIngredient[] => {
    return this.detail()?.ingredients ?? [];
  });

  readonly outputInfo = computed(() => {
    const d = this.detail();
    const p = this.payload;
    if (!d || !p) return null;
    const className = (d.row['output_class_name'] as string | null) ?? p.outputClassName ?? null;
    if (!className) return null;
    const qty = (d.row['output_quantity'] as number | null) ?? p.outputQuantity ?? 1;
    // Try to find a name from ingredients list (the payload holds className only)
    const name = humanizeClassName(className);
    // entity kind: we don't know without resolving — leave null, route won't deep-link
    // The detail view shows it with humanized class name; seeded data will have entityKind
    return { className, quantity: qty, name, entityKind: null as string | null };
  });

  readonly qualityStats = computed((): QualityStatSummary[] => {
    return this.payload?.qualityStats ?? [];
  });

  ingredientName(ing: CodexBlueprintIngredient): string {
    return (
      cleanLocaleValue(ing.nameLocalized) ||
      humanizeClassName(ing.ingredientClassName)
    );
  }

  async ngOnInit(): Promise<void> {
    const className = this.route.snapshot.paramMap.get('className') ?? '';
    try {
      const result = await this.svc.getBlueprint(className);
      this.detail.set(result);
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }
}
