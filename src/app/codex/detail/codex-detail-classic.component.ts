import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { CompareIconComponent } from '../compare-icon.component';
import { AssetPackageViewerComponent } from '../asset-package/asset-package-viewer.component';
import { FallbackImageComponent } from '../fallback-image.component';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import { ClassChipComponent } from '../../shared/class-chip/class-chip.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CodexVariantPickerComponent } from './codex-variant-picker.component';
import { AddToSetComponent } from '../set/add-to-set.component';
import { CodexRankCardComponent } from '../codex-rank-card.component';
import { FeedbackSpotDirective } from '../../feedback/feedback-spot.directive';
import { CodexPortListComponent } from './codex-port-list.component';
import { CodexRecipeCardComponent } from './codex-recipe-card.component';
import { CodexSpecSheetComponent } from './codex-spec-sheet.component';
import { NgTemplateOutlet } from '@angular/common';
import type { CodexDetailComponent } from '../codex-detail.component';

/**
 * What the frozen Klassisch page may read from the page component. Anything not listed here cannot
 * reach it: the page's own templates may change freely, this view only follows these members.
 */
export type CodexClassicCtx = Pick<
  CodexDetailComponent,
  'detail' | 'kind' | 'isMissile' | 'heroArt' | 'heroSub' | 'heroAttachType' | 'displayName' | 'manufacturerName' | 'missileKeywords' | 'skinOptions' | 'skinPickerOptions' | 'currentLivery' | 'editionOptions' | 'editionPickerOptions' | 'currentEdition' | 'facts' | 'isPinned' | 'shareFab' | 'linkCopied' | 'fpsSetPiece' | 'itemPackage' | 'prefersReducedMotion' | 'missileRecord' | 'missileRank' | 'missileCohortLoading' | 'missileRankGapKey' | 'missileRankScope' | 'missileStats' | 'missileCombatMissing' | 'description' | 'buyLoading' | 'buyError' | 'buyOptions' | 'damage' | 'componentStatGroups' | 'weaponParamGroups' | 'armorStatGroups' | 'hardpointGroups' | 'hasLoadoutSection' | 'hardpointFrame' | 'hardpointMarkers' | 'activePorts' | 'locatablePorts' | 'expandedPort' | 'compatByPort' | 'recipeView' | 'usedInBlueprints' | 'specSections' | 'showSpec' | 'showRaw' | 'rawJson' | 'provenance' | 'missileRankScopes' | 'missileRankCopy' | 'missileScopeChoice' | 'togglePin' | 'copyShareLink' | 'fmt' | 'damagePct' | 'showStatGroupHeaders' | 'humanizeName' | 'fmtCraft' | 'togglePort' | 'setActivePorts' | 'toggleSpec' | 'toggleRaw'
>;

/**
 * Klassisch, the non-ship codex detail page as it stood on 2026-11-07 (hero | Einordnung, then the stat
 * blocks), frozen as its own component with its own copy of every template and style it renders
 * (concept batch-feedback-codex-hq, #9: "Bitte ändere die klassische nicht"). Do NOT edit this to
 * follow a change of the Holotisch view or of the ship page; the Holotisch is the item stage in
 * codex-detail.component.ts. The host is display:contents so the cards sit in the page's own flow.
 */
@Component({
  selector: 'sc-codex-detail-classic',
  standalone: true,
  imports: [TranslatePipe, RouterLink, CompareIconComponent, AssetPackageViewerComponent, FallbackImageComponent, CodexCategoryIconComponent, ClassChipComponent, ScTooltipDirective, CodexVariantPickerComponent, AddToSetComponent, CodexRankCardComponent, FeedbackSpotDirective, CodexPortListComponent, CodexRecipeCardComponent, CodexSpecSheetComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="m-top" [class.missile-mode]="c.isMissile()" [scFeedbackSpot]="'feedbackSpot.headline'">
<div class="hero-stack">
<header class="hero sc-card" [class.missile]="c.isMissile()">
          <figure class="hero-art" [class.icon-only]="c.heroArt().length === 0">
            
            @if (c.isMissile() && c.itemPackage(); as pkg) {
              @defer (on viewport) {
                <sc-asset-package-viewer class="pkg-viewer" [row]="pkg" facing="nose" [still]="c.prefersReducedMotion()" />
              } @placeholder {
                <div class="pkg-viewer" aria-hidden="true"></div>
              }
            } @else {
            <div class="art">
              <sc-fallback-image [candidates]="c.heroArt()" [alt]="c.displayName()" [eager]="true">
                <span class="art-fallback">
                  <sc-codex-icon class="hero-icon" [kind]="c.detail()!.kind" [sub]="c.heroSub()" [attachType]="c.heroAttachType()" />
                </span>
              </sc-fallback-image>
            </div>
            }
          </figure>
          <div class="hero-body">
            <span class="kind-tag">{{ ('codex.kindSingular.' + c.detail()!.kind) | translate }}</span>
            <h1>{{ c.displayName() }}</h1>
            @if (c.manufacturerName(); as mfr) { <p class="mfr">{{ mfr }}</p> }
            <sc-class-chip class="cls" [value]="c.detail()!.classNameSlug" />

            @if (c.missileKeywords().length > 0) {
              <ul class="mchips" [attr.aria-label]="'codex.missile.keywordsLabel' | translate">
                @for (k of c.missileKeywords(); track k.id) {
                  <li class="mchip" tabindex="0" [scTooltip]="k.tipKey | translate">{{ k.labelKey | translate }}</li>
                }
              </ul>
            }
            @if (c.skinOptions().length > 1) {
              <sc-codex-variant-picker variant="skin" [kind]="c.detail()!.kind" [currentSlug]="c.detail()!.classNameSlug"
                [options]="c.skinPickerOptions()" [current]="c.currentLivery()" />
            }
            @if (c.editionOptions().length > 1) {
              <sc-codex-variant-picker variant="edition" [kind]="c.detail()!.kind" [currentSlug]="c.detail()!.classNameSlug"
                [options]="c.editionPickerOptions()" [current]="c.currentEdition()" />
            }

            @if (c.facts().length > 0) {
              <ul class="facts">
                @for (f of c.facts(); track f.label) {
                  <li class="fact" [class.accent]="f.accent">
                    <span class="f-label">{{ f.label }}</span>
                    <span class="f-value">{{ f.value }}</span>
                  </li>
                }
              </ul>
            }

            <div class="hero-actions">
              <button type="button" class="pin" [class.pinned]="c.isPinned()" (click)="c.togglePin()">
                <sc-compare-icon [on]="c.isPinned()" /> {{ (c.isPinned() ? 'codex.compare.pinned' : 'codex.compare.pin') | translate }}
              </button>
              @if (!c.shareFab()) {
                <button type="button" class="pin" (click)="c.copyShareLink()">
                  {{ 'codex.detail.actionCopyLink' | translate }}
                  @if (c.linkCopied()) {
                    <span class="copy-toast" role="status">{{ 'codex.detail.linkCopied' | translate }}</span>
                  }
                </button>
              }
              
              @if (c.fpsSetPiece(); as piece) {
                <sc-add-to-set [className]="piece.className" [kind]="piece.kind" [subType]="piece.subType"
                               [attachType]="piece.attachType" [itemName]="c.displayName()" />
              }
            </div>
          </div>
</header>
</div>
@if (c.isMissile()) {
          <sc-codex-rank-card
            [shipName]="c.displayName()"
            [sizeClass]="c.missileRecord()?.size ?? null"
            [result]="c.missileRank()"
            [loading]="c.missileCohortLoading()"
            [profiles]="[]"
            [scopes]="c.missileRankScopes"
            [copy]="c.missileRankCopy"
            [gapKey]="c.missileRankGapKey()"
            [scope]="c.missileRankScope()"
            (scopeChange)="c.missileScopeChoice.set($event)" />
}
</div>
        @if (c.isMissile() && c.missileStats().length > 0) {
          <section class="sc-card block" [scFeedbackSpot]="'codex.missile.data.title'">
            <h2>{{ 'codex.missile.data.title' | translate }}</h2>
            @for (g of c.missileStats(); track g.id) {
              <h3 class="sg-head">{{ ('codex.missile.group.' + g.id) | translate }}</h3>
              <div class="stat-grid">
                @for (s of g.rows; track s.key) {
                  <div class="stat"><span class="s-label">{{ s.labelKey | translate }}</span><span class="s-value">@if (s.valueKey) { {{ s.valueKey | translate }} } @else { {{ c.fmt(s.value!) }} }@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
            @if (c.missileCombatMissing()) {
              <p class="hint">{{ 'codex.missile.data.combatMissing' | translate }}</p>
            }
          </section>
        }
<div class="m-cols single"></div>
    
    <ng-container [ngTemplateOutlet]="descriptionCard" />
    @if (!c.isMissile() && c.itemPackage(); as pkg) {
      <section class="sc-card block pkg-block">
        <h2>{{ 'codex.assetPackage.title' | translate }}</h2>
        @defer (on viewport) {
          <sc-asset-package-viewer class="pkg-viewer" [row]="pkg" [still]="c.prefersReducedMotion()" />
        } @placeholder {
          <div class="pkg-viewer" aria-hidden="true"></div>
        }
      </section>
    }

    <ng-container [ngTemplateOutlet]="whereToBuy" />
    @if (c.damage().length > 0) {
      <section class="sc-card block">
        <h2>{{ 'codex.detail.damage' | translate }}</h2>
        <div class="dmg-list">
          @for (row of c.damage(); track row.channel) {
            <div class="dmg" [attr.data-ch]="row.channel">
              <span class="dmg-label">{{ ('codex.damage.' + row.channel) | translate }}</span>
              <span class="dmg-bar"><span class="dmg-fill" [style.width.%]="c.damagePct(row)"></span></span>
              <span class="dmg-val">{{ c.fmt(row.value) }}</span>
            </div>
          }
        </div>
      </section>
    }
    @if (c.componentStatGroups().length > 0) {
      <section class="sc-card block">
        <h2>{{ 'codex.detail.keyStats' | translate }}</h2>
        @for (g of c.componentStatGroups(); track g.purpose) {
          @if (c.showStatGroupHeaders(c.componentStatGroups())) {
            <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
          }
          <div class="stat-grid">
            @for (s of g.rows; track s.key) {
              <div class="stat"><span class="s-label">{{ s.i18nKey ? (s.i18nKey | translate) : s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
            }
          </div>
        }
      </section>
    }
    @if (c.weaponParamGroups().length > 0) {
      <section class="sc-card block">
        <h2>{{ 'codex.detail.weaponParams' | translate }}</h2>
        @for (g of c.weaponParamGroups(); track g.purpose) {
          @if (c.showStatGroupHeaders(c.weaponParamGroups())) {
            <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
          }
          <div class="stat-grid">
            @for (s of g.rows; track s.key) {
              <div class="stat"><span class="s-label">{{ s.i18nKey ? (s.i18nKey | translate) : s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
            }
          </div>
        }
      </section>
    }
    @if (c.armorStatGroups().length > 0) {
      <section class="sc-card block">
        <h2>{{ 'codex.detail.armorStats' | translate }}</h2>
        @for (g of c.armorStatGroups(); track g.purpose) {
          @if (c.showStatGroupHeaders(c.armorStatGroups())) {
            <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
          }
          <div class="stat-grid">
            @for (s of g.rows; track s.key) {
              <div class="stat"><span class="s-label">{{ s.i18nKey ? (s.i18nKey | translate) : s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
            }
          </div>
        }
      </section>
    }
    @if (c.hardpointGroups().length > 0) {
      <section class="sc-card block">
        <h2>{{ 'codex.detail.hardpoints' | translate }} <span class="ct">{{ c.detail()!.ports.length }}</span></h2>
        <p class="hint">{{ 'codex.detail.hardpointsHint' | translate }}</p>
        <sc-codex-port-list
          [groups]="c.hardpointGroups()"
          [frame]="c.hardpointFrame()"
          [showMap]="!c.hasLoadoutSection()"
          [markers]="c.hardpointMarkers()"
          [activePorts]="c.activePorts()"
          [locatablePorts]="c.locatablePorts()"
          [expandedPort]="c.expandedPort()"
          [compat]="c.compatByPort()"
          (portToggle)="c.togglePort($event)"
          (hovered)="c.setActivePorts($event)" />
      </section>
    }
    @if (c.recipeView(); as rv) {
      <sc-codex-recipe-card [recipe]="rv" />
    }
    @if (c.usedInBlueprints().length > 0) {
      <section class="sc-card block">
        <h2>{{ 'codex.detail.usedInBlueprints' | translate }} <span class="ct">{{ c.usedInBlueprints().length }}</span></h2>
        <p class="hint">{{ 'codex.detail.usedInBlueprintsHint' | translate }}</p>
        <ul class="compat-list">
          @for (b of c.usedInBlueprints(); track b.classNameSlug) {
            <li>
              <a class="compat-link" [routerLink]="['/codex', 'blueprint', b.classNameSlug]">
                {{ b.nameLocalized || c.humanizeName(b.classNameSlug) }}
              </a>
              <span class="compat-meta">
                @if (b.tier != null) { <span class="chip">T{{ b.tier }}</span> }
                @if (b.craftTimeSec != null) { <span class="chip">{{ c.fmtCraft(b.craftTimeSec) }}</span> }
              </span>
            </li>
          }
        </ul>
      </section>
    }
          <sc-codex-spec-sheet
      [sections]="c.specSections()"
      [showSpec]="c.showSpec()"
      [showRaw]="c.showRaw()"
      [rawJson]="c.rawJson()"
      [provenance]="c.provenance()"
      (toggleSpec)="c.toggleSpec()"
      (toggleRaw)="c.toggleRaw()" />
      <ng-template #whereToBuy>
        @if (c.kind() === 'item' || c.kind() === 'weapon') {
          <section class="sc-card block" >
            <h2>{{ 'codex.detail.whereToBuy' | translate }}</h2>
            @if (c.buyLoading()) {
              <p class="muted">{{ 'codex.detail.whereToBuyLoading' | translate }}</p>
            } @else if (c.buyError()) {
              <p class="err-inline">{{ 'codex.detail.whereToBuyError' | translate }}</p>
            } @else if (c.buyOptions().length === 0) {
              <p class="muted">{{ 'codex.detail.whereToBuyEmpty' | translate }}</p>
            } @else {
              <table class="buy-table">
                <thead>
                  <tr>
                    <th>{{ 'codex.detail.whereToBuyPrice' | translate }}</th>
                    <th>{{ 'codex.detail.whereToBuyTerminal' | translate }}</th>
                    <th>{{ 'codex.detail.whereToBuyLocation' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (opt of c.buyOptions(); track opt.terminal + opt.price) {
                    <tr>
                      <td class="buy-price">{{ c.fmt(opt.price) }} aUEC</td>
                      <td>{{ opt.terminal }}</td>
                      <td class="muted">{{ opt.location }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
            <p class="hint buy-attribution">{{ 'codex.detail.whereToBuyAttribution' | translate }}</p>
          </section>
        }
      </ng-template>
      <ng-template #descriptionCard>
        @if (c.description(); as d) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.description' | translate }}</h2>
            <p class="desc">{{ d }}</p>
          </section>
        }
      </ng-template>

  `,
  styles: [`
:host { display: contents; }
:host .sc-card, :host .sc-card.block { border-radius: 4px; box-shadow: none; }
.m-top { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
.m-top.missile-mode { grid-template-columns: 1fr 1fr; }
.m-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.m-cols.single { grid-template-columns: 1fr; }
@media (max-width: 1100px) {
.m-top.missile-mode { grid-template-columns: 1fr; }
.m-cols { grid-template-columns: 1fr; }
}
.hero-stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.pin { position: relative; display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; min-height: 48px; border: 1px solid var(--sc-border); border-radius: 3px; background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent); color: var(--sc-fg-2); font-family: var(--sc-font-display); text-decoration: none; font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; }
@media (pointer: fine) {
.pin { min-height: 24px; }
}
.pin:hover { color: var(--sc-fg-0); border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); }
.pin.pinned { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
.pin:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
.pin:disabled { opacity: 0.38; cursor: not-allowed; }
.hero { display: grid; grid-template-columns: minmax(200px, 320px) 1fr; gap: 22px; padding: 0; overflow: hidden; }
.hero-art { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 240px; --sc-img-max-h: 320px; --sc-img-shadow: drop-shadow(0 6px 24px rgba(0,0,0,0.55)); --sc-icon-max: 132px; background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--sc-accent) 12%, var(--sc-bg-1)), var(--sc-bg-0)); }
.hero-art.icon-only { background: radial-gradient(circle at 50% 40%, var(--sc-bg-2), var(--sc-bg-0)); }
.hero:not(.bay) .hero-art { --sc-img-w: min(60%, 168px); }
.hero-art .art { flex: 1 1 auto; align-self: stretch; min-width: 0; display: flex; align-items: center; justify-content: center; }
.hero-art .art-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px; box-sizing: border-box; }
.hero-art .hero-icon { width: 100%; min-height: 120px; }
.hero-body { padding: 22px 24px 22px 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.kind-tag { align-self: flex-start; font-size: max(0.64rem, var(--sc-fs-floor)); padding: 3px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.1em; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); color: var(--sc-accent); }
.hero-body h1 { margin: 2px 0 0; font-size: 1.7rem; line-height: 1.15; overflow-wrap: anywhere; }
.hero-body .mfr { margin: 0; color: var(--sc-fg-1); font-size: 0.96rem; overflow-wrap: anywhere; }
.cls { align-self: flex-start; }
.hero.missile { grid-template-columns: minmax(0, 1fr); gap: 0; }
.hero.missile .hero-art { display: block; min-height: 0; }
.hero.missile .hero-art .art { min-height: 240px; }
.hero.missile .pkg-viewer { height: clamp(15rem, 34vh, 21rem); min-height: 15rem; }
.hero.missile .hero-body { padding: 16px 18px; }
.mchips { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.mchip { font-size: max(10px, var(--sc-fs-floor)); padding: 3px 7px; border-radius: 3px; letter-spacing: 0.12em; text-transform: uppercase; background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent); border: 1px solid var(--sc-border); color: var(--sc-fg-1); cursor: default; }
.mchip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
.facts { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.fact { display: flex; flex-direction: column; gap: 1px; padding: 6px 12px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
.fact.accent { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
.f-label { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
.f-value { font-size: 0.9rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
.fact.accent .f-value { color: var(--sc-accent); }
.hero-actions { display: flex; align-items: center; gap: 14px; margin-top: auto; padding-top: 12px; flex-wrap: wrap; }
.copy-toast { position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); background: var(--sc-bg-1, #14161b); color: var(--sc-fg-1); border: 1px solid var(--sc-accent); border-radius: var(--radius-sm, 4px); padding: 2px 8px; font-size: max(0.7rem, var(--sc-fs-floor)); white-space: nowrap; pointer-events: none; }
.block { padding: 16px 18px; }
.pkg-viewer { display: block; height: clamp(18rem, 45vh, 32rem); }
.block h2 { margin: 0 0 12px; font-size: max(10.5px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; color: var(--sc-accent); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.block h2 .ct { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
.desc { margin: 0; color: var(--sc-fg-1); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.sg-head { margin: 14px 0 8px; font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.07em; color: var(--sc-fg-1); display: flex; align-items: center; gap: 8px; }
.sg-head::after { content: ''; flex: 1; height: 1px; background: var(--sc-border); }
.sg-head:first-of-type { margin-top: 0; }
.sg-head[data-purpose="offense"] { color: var(--sc-offense); }
.sg-head[data-purpose="defense"] { color: var(--sc-accent); }
.stat-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.stat-grid + .sg-head { margin-top: 14px; }
.stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); min-width: 0; }
.s-label { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); overflow-wrap: anywhere; }
.s-value { font-size: 1.05rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); overflow-wrap: anywhere; }
.s-unit { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: system-ui, sans-serif; }
.buy-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
.buy-table th { text-align: left; padding: 6px 10px; font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); border-bottom: 1px solid var(--sc-border); }
.buy-table td { padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
.buy-price { color: var(--sc-accent); font-family: var(--sc-font-display); white-space: nowrap; }
.buy-attribution { margin: 10px 0 0; font-style: italic; }
.dmg-list { display: flex; flex-direction: column; gap: 8px; }
.dmg { display: grid; grid-template-columns: 96px 1fr 64px; align-items: center; gap: 10px; }
.dmg-label { font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
.dmg-bar { height: 8px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
.dmg-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
.dmg[data-ch="energy"] .dmg-fill { background: var(--sc-accent); }
.dmg[data-ch="physical"] .dmg-fill { background: var(--sc-offense); }
.dmg[data-ch="thermal"] .dmg-fill { background: #ff5252; }
.dmg[data-ch="distortion"] .dmg-fill { background: #a674ff; }
.dmg[data-ch="biochemical"] .dmg-fill { background: #5fd35f; }
.dmg[data-ch="stun"] .dmg-fill { background: #f0c419; }
.dmg-val { font-size: 0.84rem; text-align: right; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
.chip { font-size: max(10px, var(--sc-fs-floor)); padding: 0 3px; border-radius: 2px; background: transparent; color: var(--sc-fg-1); border: 1px solid var(--sc-border); white-space: nowrap; }
.muted { color: var(--sc-fg-2); margin: 0; font-size: 0.82rem; }
.hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: max(0.74rem, var(--sc-fs-floor)); }
.err-inline { color: var(--sc-danger); font-size: 0.8rem; }
.compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
.compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; }
.compat-link:hover { text-decoration: underline; }
.compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }
@media (max-width: 760px) {
.hero { grid-template-columns: 1fr; }
.hero-art { min-height: 180px; }
.hero-body { padding: 20px; }
.dmg { grid-template-columns: 84px 1fr 56px; }
}
@media (max-width: 400px) {
.hero-body { padding: 16px; }
.hero-body h1 { font-size: 1.4rem; }
.stat-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
}

  `],
})
export class CodexDetailClassicComponent {
  readonly ctx = input.required<CodexClassicCtx>();
  /** The template's handle on the page. */
  protected get c(): CodexClassicCtx { return this.ctx(); }
}
