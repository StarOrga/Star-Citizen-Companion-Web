import { StarTriggerService } from '../verse/starmap/star-trigger.service';
import { toErrorKey } from '../core/describe-error';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { BlueprintDetail, CodexKind, CodexService, ResolvedEntity, pickLocalized } from './codex.service';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { ClassChipComponent } from '../shared/class-chip/class-chip.component';
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
  formatQuantity,
  hasQualityRequirement,
  humanizeBlueprintCategory,
  humanizeBlueprintName,
  humanizeClassName,
  humanizeKey,
  ingredientRoleLabel,
  unescapeText,
} from './codex-format';
import { NeuroFieldDirective } from '../core/neuro-field.directive';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { NavOriginService, PageCrumb, originTrail } from '../shared/page-header/nav-origin.service';

@Component({
  selector: 'sc-blueprint-detail',
  standalone: true,
  imports: [PageHeaderComponent, NeuroFieldDirective, RouterLink, TranslatePipe, CodexCategoryIconComponent, ClassChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-page">
      <sc-page-header [crumbs]="crumbs()" [rememberAs]="detail() ? displayName() : null" />

      @if (loading()) {
        <div class="sc-card skel-card sc-skel-field" scNeuroField></div>
      } @else if (error(); as err) {
        <div class="sc-card err" role="alert">
          <span><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err | translate }}</span>
          <button type="button" class="retry" (click)="retry()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      } @else if (!detail()) {
        <div class="sc-card empty">{{ 'codex.detail.notFound' | translate }}</div>
      } @else {
        <!-- Hero: the shared detail shape (styles.scss, DETAIL PAGE). A
             blueprint has no render of its own; the glyph is the one of what
             it crafts, so a weapon recipe reads as a weapon at a glance. -->
        <header class="hero sc-card sc-detail-hero">
          <figure class="sc-detail-hero__art icon-only">
            <sc-codex-icon [kind]="outputKind()" />
          </figure>
          <div class="sc-detail-hero__body">
            <span class="sc-kind-tag">{{ 'codex.kindSingular.blueprint' | translate }}</span>
            <h1 class="entity-name">{{ displayName() }}</h1>
            @if (outputEntity()?.manufacturerCode; as mfr) { <p class="sc-detail-mfr">{{ mfr }}</p> }
            <sc-class-chip class="cls" [value]="detail()!.classNameSlug" />
            @if (facts().length > 0) {
              <ul class="sc-detail-facts">
                @for (f of facts(); track f.label) {
                  <li class="sc-detail-fact" [class.accent]="f.accent">
                    <span class="sc-detail-fact__label">{{ f.label }}</span>
                    <span class="sc-detail-fact__value">{{ f.value }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </header>

        @if (description(); as desc) {
          <section class="section sc-card sc-detail-block">
            <h2>{{ 'codex.detail.description' | translate }}</h2>
            <p class="desc">{{ desc }}</p>
          </section>
        }

        <!-- What goes in, and what comes out of it: side by side on a wide
             frame, stacked below 1120px (the shared .analysis-grid in
             styles.scss). The page itself runs the full frame. -->
        <div class="analysis-grid" [class.single]="!(outputInfo() || qualityStats().length > 0)">
          <div class="analysis-col">
            <!-- Ingredients -->
            <div class="section sc-card sc-detail-block">
              <h2>{{ 'blueprint.detail.ingredients' | translate }}</h2>
              @if (ingredients().length === 0) {
                <p class="muted">{{ 'blueprint.detail.noIngredients' | translate }}</p>
              } @else {
                <div class="ingredient-list">
                  @for (ing of ingredients(); track ing.ingredientIndex) {
                    <div class="ingredient-row" [class.unresolved]="!ing.ingredientClassName">
                      <!-- Ingredient amounts are SCU in the recipe data (audit L29). -->
                      <div class="ing-qty"><span class="q">{{ formatQuantity(ing.quantity) }}</span><span class="ing-unit"> {{ 'blueprint.detail.unitScu' | translate }}</span></div>
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
                        <!-- The class name is a secondary line, and only when it says
                             something the name does not ("Agricium Agricium", L29). -->
                        @if (showClassLine(ing)) {
                          <sc-class-chip class="ing-cls" [value]="ing.ingredientClassName!" />
                        }
                        <div class="ing-meta">
                          @if (roleLabel(ing); as role) {
                            <span class="badge role">{{ role }}</span>
                          }
                          @if (hasQualityRequirement(ing.minQuality)) {
                            <span class="badge quality">{{ 'blueprint.detail.minQuality' | translate }}: {{ formatQuality(ing.minQuality) }}</span>
                          }
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          @if (outputInfo() || qualityStats().length > 0) {
            <div class="analysis-col">
              <!-- Output -->
              @if (outputInfo(); as out) {
                <div class="section sc-card sc-detail-block">
                  <h2>{{ 'blueprint.detail.output' | translate }}</h2>
                  <div class="output-row">
                    <div class="ing-qty">× {{ formatQuantity(out.quantity) }}</div>
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
                        <sc-class-chip class="ing-cls" [value]="out.className" />
                      }
                    </div>
                  </div>
                </div>
              }

              <!-- Static quality summary (v2: interactive sliders) -->
              @if (qualityStats().length > 0) {
                <div class="section sc-card sc-detail-block">
                  <h2>{{ 'blueprint.detail.qualitySummary' | translate }}</h2>
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
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* The full page frame (styles.scss, "PAGE FRAME") — no width of its own;
       the sections below share it in two columns. */
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }
    /* Section cards: the global .sc-card (density padding) + .sc-detail-block. */
    .skel-card { min-height: 200px; }
    .desc { margin: 0; color: var(--sc-fg-1); white-space: pre-wrap; line-height: 1.55; max-width: var(--sc-measure); }
    .ing-cls { align-self: flex-start; }

    .ingredient-list { display: flex; flex-direction: column; gap: 8px; }
    .ing-unit { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em; color: var(--sc-fg-2); }
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
    .ing-meta { display: flex; flex-wrap: wrap; gap: 5px; }

    .badge { font-size: max(0.66rem, var(--sc-fs-floor)); padding: 2px 7px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    /* Every ingredient names its slot, so the slot badge stays quiet; the rare
       real quality requirement is the one a crafter has to act on. */
    .badge.role { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-1); }
    .badge.quality { background: color-mix(in srgb, var(--sc-warning) 16%, transparent); border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent); }

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
    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }
    .err .retry:hover { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .err .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }

  `],
})
export class BlueprintDetailComponent implements OnInit {
  private readonly stars = inject(StarTriggerService);
  private readonly navOrigin = inject(NavOriginService);
  /** Codex › where the reader came from, else the blueprint index. */
  readonly crumbs = computed<PageCrumb[]>(() => {
    this.detail();
    return originTrail(this.navOrigin, {
      labelKey: 'codex.kinds.blueprint', link: '/codex/index', queryParams: { kind: 'blueprint' },
    });
  });
  readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly detail = signal<BlueprintDetail | null>(null);
  readonly loading = signal(true);
  /** i18n key, never raw text. */
  readonly error = signal<string | null>(null);
  /** Bumped per load, so a late answer for an earlier blueprint never lands on a newer one. */
  private loadSeq = 0;

  // Expose format helpers for template use
  readonly formatCraftTime = formatCraftTime;
  readonly formatQuality = formatQuality;
  readonly formatNumber = formatNumber;
  readonly formatQuantity = formatQuantity;
  readonly hasQualityRequirement = hasQualityRequirement;
  readonly humanizeKey = humanizeKey;

  private get payload(): BlueprintPayload | null {
    const d = this.detail();
    if (!d) return null;
    return (d.row['payload'] as BlueprintPayload) ?? null;
  }

  private get lang(): Lang {
    const l = this.translate.getCurrentLang() ?? 'en';
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
      facts.push({ label: t('blueprint.detail.outputQty'), value: formatQuantity(outQty) });
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
    // The payload holds the class name only; the resolved entity (loaded after
    // the blueprint) adds its readable name and its kind, which makes the
    // output a link into its own Codex page.
    const e = this.outputEntity();
    const resolved = e?.className === className ? e : null;
    const name =
      (resolved?.name ? pickLocalized(resolved.name, this.lang) : '') ||
      cleanLocaleValue(resolved?.nameLocalized) ||
      humanizeClassName(className);
    return { className, quantity: qty, name, entityKind: (resolved?.kind ?? null) as string | null };
  });

  /** What the blueprint crafts, resolved in the catalog; null until known (or unknown). */
  readonly outputEntity = signal<ResolvedEntity | null>(null);
  /** The hero glyph: the crafted thing's kind, the generic glyph while unknown. */
  readonly outputKind = computed<CodexKind>(() => this.outputEntity()?.kind ?? 'blueprint');

  readonly qualityStats = computed((): QualityStatSummary[] => {
    return this.payload?.qualityStats ?? [];
  });

  ingredientName(ing: CodexBlueprintIngredient): string {
    return (
      cleanLocaleValue(ing.nameLocalized) ||
      humanizeClassName(ing.ingredientClassName)
    );
  }

  /** Whether the raw class name adds anything below the display name. */
  showClassLine(ing: CodexBlueprintIngredient): boolean {
    const cls = ing.ingredientClassName;
    if (!cls) return false;
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    return norm(cls) !== norm(this.ingredientName(ing));
  }

  /** The slot badge — CIG's slot name, readable; '' when the row names none. */
  roleLabel(ing: CodexBlueprintIngredient): string {
    return ingredientRoleLabel(ing.role, (key) => this.translate.instant(key));
  }

  /**
   * Params are SUBSCRIBED, not snapshotted: the router reuses this page when
   * one blueprint leads to another — the header's poly search, back/forward
   * between two blueprint pages — so a snapshot read leaves the new URL over
   * the old blueprint. The first emission is synchronous, so a deep link
   * loads exactly as before.
   */
  ngOnInit(): void {
    void this.stars.earn('cx-blueprint');
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      void this.load(params.get('className') ?? '');
    });
  }

  /** Loads the blueprint the route asked for last again — the error card's retry. */
  retry(): void {
    void this.load(this.lastClassName);
  }

  private lastClassName = '';

  private async load(className: string): Promise<void> {
    this.lastClassName = className;
    const seq = ++this.loadSeq;
    this.detail.set(null);
    this.outputEntity.set(null);
    this.error.set(null);
    this.loading.set(true);
    try {
      const result = await this.svc.getBlueprint(className);
      if (seq !== this.loadSeq) return;
      this.detail.set(result);
      void this.resolveOutput(seq);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.error.set(toErrorKey('codex', 'blueprint', err, { className }));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  /**
   * Best effort: an output the catalog cannot resolve keeps its humanized name
   * and stays a plain line — the recipe itself is still complete.
   */
  private async resolveOutput(seq: number): Promise<void> {
    const out = this.outputInfo();
    if (!out?.className) return;
    try {
      const map = await this.svc.resolveEntities([out.className]);
      if (seq === this.loadSeq) this.outputEntity.set(map.get(out.className) ?? null);
    } catch {
      /* the plain humanized line stays */
    }
  }
}
