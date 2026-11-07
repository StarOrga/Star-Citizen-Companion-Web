import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { silhouetteKindsOf } from '../../shared/sil-thumb/sil-thumbs.service';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { AssetPackageViewerComponent } from '../asset-package/asset-package-viewer.component';
import type { AssetPackageRow } from '../asset-package/asset-package.model';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import { CodexService, type CodexKind } from '../codex.service';
import { FallbackImageComponent } from '../fallback-image.component';
import type { HoloSilhouette } from '../holo-silhouette';

/** What the stage shows: the traced outline, or the 3D model of the asset package. */
export type ItemStageView = 'silhouette' | '3d';

/**
 * `<sc-codex-item-stage>` - the stage of an item page (weapon, component, FPS gear), built like the ship Holotable's
 * table (concept nachschub-hq r4-d1-s9): one head row above the surface - eyebrow left, the Silhouette | 3D-Modell
 * switch right, then the page's own tools (projected: `[stageTools]`) - the model lying on the page with its glow, and a
 * foot row for paint and edition pickers (projected: `[stageFoot]`).
 *
 * The 3D switch is disabled with a reason in its tooltip when the build has no 3D model of the item (aria-disabled, so
 * it stays reachable by keyboard and explains itself). The silhouette is the uploader's traced contour
 * (`codex_silhouettes`); without one the preview image, else the kind icon, stands in and the head says so.
 */
@Component({
  selector: 'sc-codex-item-stage',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, AssetPackageViewerComponent, CodexCategoryIconComponent, FallbackImageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="table" [attr.aria-label]="'itemStage.aria' | translate: { name: displayName() }">
      <div class="head">
        <p class="eyebrow">
          {{ (view() === '3d' ? 'itemStage.eyebrow3d' : 'itemStage.eyebrowSil') | translate }}
          @if (view() === 'silhouette' && !silhouette() && loaded()) {
            <span class="nogeo" tabindex="0" [scTooltip]="'itemStage.noSilhouetteReason' | translate" scTooltipTier="label">· {{ 'itemStage.noSilhouette' | translate }}</span>
          }
        </p>
        <div class="tools" role="group" [attr.aria-label]="'itemStage.viewAria' | translate">
          <button type="button" class="tt" [class.on]="view() === 'silhouette'" [attr.aria-pressed]="view() === 'silhouette'" (click)="pick('silhouette')">
            {{ 'itemStage.viewSilhouette' | translate }}
          </button>
          <span class="tipwrap" [scTooltip]="package() ? null : ('itemStage.no3dReason' | translate)" scTooltipTier="label">
            <button type="button" class="tt" [class.on]="view() === '3d'" [class.off]="!package()" [attr.aria-pressed]="view() === '3d'"
                    [attr.aria-disabled]="package() ? null : 'true'" (click)="pick('3d')">
              {{ 'itemStage.view3d' | translate }}
            </button>
          </span>
          <ng-content select="[stageTools]" />
        </div>
      </div>

      <div class="surface" [class.mode-3d]="view() === '3d'">
        @if (view() === '3d' && package(); as pkg) {
          @defer (on immediate) {
            <sc-asset-package-viewer class="pkg" [row]="pkg" [still]="still()" />
          } @placeholder {
            <div class="pkg" aria-hidden="true"></div>
          }
        } @else if (silhouette(); as s) {
          <svg class="sil ce-draw" [attr.viewBox]="s.viewBox" preserveAspectRatio="xMidYMid meet" role="img" [attr.aria-label]="displayName()">
            <defs>
              <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="var(--sc-accent)" stop-opacity="0.28" />
                <stop offset="1" stop-color="var(--sc-accent)" stop-opacity="0.04" />
              </linearGradient>
            </defs>
            <path [attr.d]="s.path" pathLength="1" [attr.fill]="'url(#' + gradId + ')'" vector-effect="non-scaling-stroke" />
          </svg>
        } @else {
          <div class="art" aria-hidden="true">
            <sc-fallback-image [candidates]="heroArt()" [alt]="displayName()" [eager]="true">
              <span class="art-fallback"><sc-codex-icon class="ico" [kind]="kind()" [sub]="heroSub()" [attachType]="heroAttachType()" /></span>
            </sc-fallback-image>
          </div>
        }
      </div>

      <div class="foot"><ng-content select="[stageFoot]" /></div>
    </section>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; min-height: 0; }
      .table { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
      .table::before {
        content: ''; position: absolute; inset: -40px -10px; z-index: 0; pointer-events: none;
        background: radial-gradient(ellipse 46% 44% at 50% 52%, color-mix(in srgb, var(--sc-accent) 16%, transparent), transparent 100%);
      }
      .head { position: relative; z-index: 5; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 4px; min-height: 34px; flex-wrap: wrap; }
      .eyebrow { flex: 1; min-width: 0; margin: 0; font: 500 max(9px, 0.62rem) var(--sc-font-display, inherit); text-transform: uppercase; letter-spacing: 0.14em; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .nogeo { cursor: help; }
      .tools { flex: none; display: flex; gap: 14px; align-items: center; margin-inline-start: auto; }
      .tipwrap { display: inline-flex; }
      .tt {
        position: relative; background: none; border: none; padding: 4px 2px; cursor: pointer; min-height: var(--sc-tap-min, 24px);
        font: 500 max(8.5px, 0.62rem) var(--sc-font-display, inherit); text-transform: uppercase; letter-spacing: 0.14em; color: var(--sc-fg-1);
        transition: color 160ms ease, text-shadow 160ms ease;
      }
      .tt::after { content: ''; position: absolute; left: 2px; right: 2px; bottom: 1px; height: 1px; background: currentColor; scale: 0 1; transition: scale 220ms ease; }
      .tt:hover:not(.off) { color: var(--sc-fg-0); }
      .tt:hover:not(.off)::after, .tt.on::after { scale: 1 1; }
      .tt.on { color: var(--sc-accent); text-shadow: 0 0 8px color-mix(in srgb, var(--sc-accent) 50%, transparent); }
      .tt.off { opacity: 0.4; cursor: not-allowed; }
      .tt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .surface { position: relative; z-index: 1; flex: 1 1 auto; min-height: 0; display: grid; place-items: center; padding: 8px 12px; }
      .sil { width: 100%; height: 100%; max-height: 100%; overflow: visible; filter: drop-shadow(0 0 10px color-mix(in srgb, var(--sc-accent) 45%, transparent)); }
      .sil path { stroke: var(--sc-accent); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
      .pkg { display: block; width: 100%; height: 100%; min-height: 240px; }
      .art { width: 100%; height: 100%; display: grid; place-items: center; }
      .art :where(img) { max-width: 100%; max-height: 100%; object-fit: contain; }
      .art-fallback { display: grid; place-items: center; width: 40%; max-width: 160px; color: var(--sc-fg-2); }
      .foot { position: relative; z-index: 2; flex: none; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 0; padding: 0 4px; }
      .foot:empty { display: none; }
      @media (max-width: 749px) { .surface { min-height: 260px; } }
    `,
  ],
})
export class CodexItemStageComponent {
  readonly kind = input.required<CodexKind>();
  readonly className = input.required<string>();
  readonly displayName = input.required<string>();
  readonly heroArt = input<readonly string[]>([]);
  readonly heroSub = input<string | null>(null);
  readonly heroAttachType = input<string | null>(null);
  /** The 3D asset package of the item, when the build carries one. */
  readonly package = input<AssetPackageRow | null>(null);
  readonly still = input(false);

  private readonly codex = inject(CodexService);
  protected readonly gradId = `ist-${Math.random().toString(36).slice(2, 8)}`;

  /** The chosen view; 3D falls back to the silhouette when the item has no model. */
  private readonly chosen = signal<ItemStageView>('silhouette');
  readonly view = computed<ItemStageView>(() => (this.chosen() === '3d' && this.package() ? '3d' : 'silhouette'));
  readonly silhouette = signal<HoloSilhouette | null>(null);
  readonly loaded = signal(false);

  constructor() {
    effect((onCleanup) => {
      const kinds = silhouetteKindsOf(this.kind());
      const cls = this.className();
      let live = true;
      onCleanup(() => (live = false));
      this.silhouette.set(null);
      this.loaded.set(false);
      if (!kinds.length || !cls) {
        this.loaded.set(true);
        return;
      }
      void (async () => {
        let found: HoloSilhouette | null = null;
        for (const k of kinds) {
          try {
            found = await this.codex.silhouette(k, cls);
          } catch {
            found = null;
          }
          if (found) break;
        }
        if (!live) return;
        this.silhouette.set(found);
        this.loaded.set(true);
      })();
    });
    // A new item starts on the silhouette again.
    effect(() => {
      this.className();
      this.chosen.set('silhouette');
    });
  }

  protected pick(v: ItemStageView): void {
    if (v === '3d' && !this.package()) return;
    this.chosen.set(v);
  }
}
