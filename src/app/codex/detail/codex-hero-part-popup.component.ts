import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AssetPackageViewerComponent, type PlacementSelection } from '../asset-package/asset-package-viewer.component';
import { AssetPackageService } from '../asset-package/asset-package.service';
import type { AssetPackageKind, AssetPackageRow } from '../asset-package/asset-package.model';
import type { LayoutSection, LayoutSlot } from '../codex-hardpoint-layout.component';
import { formatEquippedStat } from '../codex-equipped-stats';
import { displayItemName } from '../codex-format';
import { partFocusOf, type PartFocus } from '../holo/codex-holo-inspector.component';
import { ItemPathComponent } from '../../shared/item-path/item-path.component';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { logWarn } from '../../core/log';

/** A hotspot picked in the classic 3D overlay, with the port names up its mount chain (nearest first). */
export interface HeroPartPick extends PlacementSelection {
  readonly portChain: readonly string[];
}

/**
 * The picked hotspot as the Holotisch's Bauteile tab reads it: the loadout slot
 * of the nearest port in the chain that has one, spoken through `partFocusOf`
 * (a gun mount through the gun it holds). A part with no loadout slot still has
 * its class: it gets a bare focus with that name and no values.
 */
export function resolveHeroPart(sections: readonly LayoutSection[], pick: HeroPartPick): PartFocus {
  for (const port of pick.portChain) {
    for (const s of sections) {
      const slot = s.slots.find((sl) => (sl.rawPort ?? sl.port) === port);
      if (slot) return partFocusOf({ slot, count: 1, child: null, rawPorts: [port] }, s.section);
    }
  }
  const slot: LayoutSlot = {
    port: pick.portName,
    rawPort: pick.portName,
    className: pick.itemClass,
    kind: null,
    name: pick.itemClass,
    size: null,
    grade: null,
    manufacturerCode: null,
    portSize: null,
  };
  return partFocusOf({ slot, count: 1, child: null, rawPorts: [pick.portName] }, null);
}

/**
 * The classic ship page's part popup (#334, follow-up): a click on a hotspot in
 * the classic 3D overlay opens this small card over the "Einordnung" column —
 * no scrim, no blur. It shows the part's own 3D model when its asset package
 * exists (the same viewer and lookup the item pages use) and its values under
 * it, the ones the Holotisch's Bauteile tab lists. Another hotspot swaps the
 * content; the X or Escape closes it.
 */
@Component({
  selector: 'sc-codex-hero-part-popup',
  standalone: true,
  imports: [TranslatePipe, AssetPackageViewerComponent, ItemPathComponent, ScActionDirective, ScTooltipDirective, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.over-full]': 'overFull()' },
  template: `
    <section class="hpp sc-card" scDialog [scDialogModal]="false" scDialogInitialFocus="container" role="region"
             [attr.aria-label]="'codex.detail.partPopup.label' | translate: { name: title() }"
             (scDialogEscape)="closed.emit()">
      <header class="hpp-head">
        <div class="hpp-id">
          <p class="hpp-eyebrow">{{ 'codex.detail.partPopup.eyebrow' | translate }}</p>
          <h2 class="hpp-name">{{ title() || ('codex.holo.stage.emptyBay' | translate) }}</h2>
          @if (meta(); as m) { <small class="hpp-meta">{{ m }}</small> }
        </div>
        <button type="button" scAction tier="tertiary" class="hpp-close"
                [attr.aria-label]="'codex.detail.partPopup.close' | translate"
                [scTooltip]="'codex.detail.partPopup.close' | translate" scTooltipTier="label"
                (click)="closed.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>
      @if (packageRow() !== null) {
        <div class="hpp-stage">
          @defer (on immediate) {
            @if (packageRow(); as row) {
              <sc-asset-package-viewer class="hpp-viewer" [row]="row" [still]="still()" />
            } @else {
              <div class="hpp-viewer is-placeholder" aria-hidden="true"></div>
            }
          } @placeholder {
            <div class="hpp-viewer is-placeholder" aria-hidden="true"></div>
          }
        </div>
      }
      @if (values().length > 0) {
        <dl class="hpp-stats">
          @for (v of values(); track v.key) {
            <div><dt>{{ v.key | translate }}</dt><dd>{{ v.value }}</dd></div>
          }
        </dl>
      } @else {
        <p class="hpp-empty">{{ 'codex.detail.partPopup.noValues' | translate }}</p>
      }
      @if (part().kind && part().className) {
        <div class="hpp-act">
          <sc-item-path [kind]="part().kind!" [className]="part().className!" [name]="title()" level="tertiary" />
        </div>
      }
    </section>
  `,
  styles: [`
    /* Over the Einordnung column (its positioned parent); grows with its content, scrolls past the column. */
    :host { position: absolute; inset-block-start: 0; inset-inline: 0; z-index: 6; display: block;
      max-height: max(100%, 420px); }
    /* The 3D overlay is fullscreen: the popup follows it to the viewport's right edge. */
    :host(.over-full) { position: fixed; inset-block-start: 64px; inset-inline: auto 16px; z-index: 1001;
      width: min(360px, calc(100vw - 32px));
      max-height: calc(100vh - 80px - var(--sc-float-bottom, 16px));
      max-height: calc(100dvh - 80px - var(--sc-float-bottom, 16px)); }
    .hpp { box-sizing: border-box; height: auto; max-height: inherit; margin: 0; overflow: auto;
      display: flex; flex-direction: column; gap: 10px; padding: 12px 14px;
      background: var(--sc-bg-1); border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border));
      box-shadow: 0 12px 32px color-mix(in srgb, var(--sc-bg-0) 70%, transparent); }
    .hpp:focus { outline: none; }
    .hpp:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .hpp-head { display: flex; align-items: flex-start; gap: 8px; }
    .hpp-id { flex: 1 1 auto; min-width: 0; }
    .hpp-eyebrow { margin: 0; font-size: max(10px, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.16em; color: var(--sc-fg-2); }
    .hpp-name { margin: 2px 0 0; font-size: 1.05rem; line-height: 1.25; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .hpp-meta { display: block; margin-top: 2px; color: var(--sc-fg-2); font-size: max(0.75rem, var(--sc-fs-floor)); }
    .hpp-close svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .hpp-stage { position: relative; flex: 0 0 auto; height: 200px; border: 1px solid var(--sc-border); }
    .hpp-viewer { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
    .hpp-viewer.is-placeholder { background: radial-gradient(ellipse at 50% 60%,
      color-mix(in srgb, var(--sc-accent) 12%, transparent), transparent 70%); }
    .hpp-stats { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
    .hpp-stats div { min-width: 0; }
    .hpp-stats dt { font-size: max(10px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .hpp-stats dd { margin: 0; color: var(--sc-fg-0); font-variant-numeric: tabular-nums; }
    .hpp-empty { margin: 0; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .hpp-act { display: flex; justify-content: flex-end; }
  `],
})
export class CodexHeroPartPopupComponent {
  readonly part = input.required<PartFocus>();
  readonly still = input(false);
  /** The 3D overlay is fullscreen: the popup moves above it. */
  readonly overFull = input(false);
  readonly closed = output<void>();

  /** The part's own asset package: undefined while asking, null = none (no 3D stage). */
  readonly packageRow = signal<AssetPackageRow | null | undefined>(undefined);

  readonly title = computed(() => {
    const n = this.part().name;
    return n ? displayItemName(n) : '';
  });

  readonly meta = computed(() => {
    const p = this.part();
    return [p.size != null ? `S${p.size}` : null, p.typeLabel, p.manufacturerCode].filter((x): x is string => !!x).join(' · ');
  });

  /** The Bauteile tab's values: size and grade, then what the extract knows, six at most. */
  readonly values = computed(() => {
    const p = this.part();
    const out: { key: string; value: string }[] = [];
    if (p.size != null) out.push({ key: 'codex.holo.stage.partSize', value: `S${p.size}` });
    if (p.grade) out.push({ key: 'codex.holo.stage.partGrade', value: p.grade });
    for (const st of p.stats.slice(0, 6 - out.length)) out.push({ key: st.labelKey, value: formatEquippedStat(st) });
    return out;
  });

  private readonly packages = inject(AssetPackageService);
  private lookup = 0;

  constructor() {
    effect(() => {
      const p = this.part();
      const cls = p.className;
      const token = ++this.lookup;
      if (!cls) {
        this.packageRow.set(null);
        return;
      }
      const kinds: AssetPackageKind[] = p.kind === 'weapon' ? ['fps_weapon', 'item'] : ['item', 'fps_weapon'];
      this.packageRow.set(undefined);
      this.packages.findRow(kinds, cls).then(
        (row) => {
          if (token === this.lookup) this.packageRow.set(row);
        },
        (err: unknown) => {
          logWarn('hero-part-popup', 'asset package lookup failed', { cls, err });
          if (token === this.lookup) this.packageRow.set(null);
        },
      );
    });
  }
}
