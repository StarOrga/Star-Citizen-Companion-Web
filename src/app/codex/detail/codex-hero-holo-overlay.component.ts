import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AssetPackageViewerComponent, type PlacementSelection } from '../asset-package/asset-package-viewer.component';
import type { HeroPartPick } from './codex-hero-part-popup.component';
import { AssetPackageService } from '../asset-package/asset-package.service';
import type { AssetPackageRow } from '../asset-package/asset-package.model';
import { ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import type { HardpointPortRef } from '../hardpoint-port-ref';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { logWarn } from '../../core/log';

/**
 * The classic ship page's 3D view (#334): a panel laid over the hero picture
 * and the "Dein Exemplar" card under it — no scrim, no blur, the rest of the
 * page stays visible and usable. "Vollbild" lifts the same panel to a
 * viewport-filling popup; Escape or the X steps back (fullscreen → panel →
 * closed).
 *
 * The model is the Holotisch's own 3D view, not a copy of it: the same asset
 * package lookup and the same `sc-asset-package-viewer` in its table
 * interaction, and for hulls uploaded before asset packages the same legacy
 * `sc-ship-skin-viewer` in its holo treatment. The one difference is the start
 * view (design only): the hologram turns its nose to the reader (front-left)
 * and the idle turntable swings it counter-clockwise across the front. Reduced
 * motion: no turntable.
 */
@Component({
  selector: 'sc-codex-hero-holo-overlay',
  standalone: true,
  imports: [TranslatePipe, AssetPackageViewerComponent, ShipSkinViewerComponent, ScActionDirective, ScTooltipDirective, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.full]': 'full()' },
  template: `
    <section class="hho sc-card" scDialog [scDialogModal]="false" [attr.role]="full() ? 'dialog' : 'region'"
             [attr.aria-label]="'codex.detail.holoOverlay.label' | translate: { name: displayName() }"
             (scDialogEscape)="onEscape()">
      <div class="hho-bar">
        <button type="button" scAction tier="secondary" class="hho-full" [attr.aria-pressed]="full()"
                (click)="toggleFull()">
          {{ (full() ? 'codex.detail.holoOverlay.exitFullscreen' : 'codex.detail.holoOverlay.fullscreen') | translate }}
        </button>
        <button type="button" scAction tier="tertiary" class="hho-close"
                [attr.aria-label]="'codex.detail.holoOverlay.close' | translate"
                [scTooltip]="'codex.detail.holoOverlay.close' | translate" scTooltipTier="label"
                (click)="closed.emit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div class="hho-stage">
        @defer (on immediate) {
          @if (packageRow(); as row) {
            <sc-asset-package-viewer class="hho-viewer" [row]="row" [still]="still()"
              interaction="table" facing="nose" spin="ccw" [swapOffered]="false"
              [activePorts]="activePorts()" [selectedPort]="selectedPart()"
              (hovered)="hovered.emit($event)" (locatable)="locatable.emit($event)" (selectionChange)="onSelection($event)" />
          } @else if (packageRow() === null) {
            <sc-ship-skin-viewer class="hho-viewer" [shipId]="shipClassName()" [embedded]="true" [holo]="true" [still]="still()"
              [hardpointPorts]="hardpointPortRefs()" [activePorts]="activePorts()"
              (hovered)="hovered.emit($event)" (locatable)="locatable.emit($event)" />
          } @else {
            <div class="hho-viewer is-placeholder" aria-hidden="true"></div>
          }
        } @placeholder {
          <div class="hho-viewer is-placeholder" aria-hidden="true"></div>
        }
      </div>
    </section>
  `,
  styles: [`
    /* Covers its positioned parent (the hero picture + the ownership card). */
    :host { position: absolute; inset: 0; z-index: 5; display: block; }
    /* Fullscreen: the same panel, filling the viewport (dvh after its vh fallback). */
    :host(.full) { position: fixed; inset: 0; z-index: 1000; height: 100vh; height: 100dvh; }
    .hho { position: relative; width: 100%; height: 100%; box-sizing: border-box; margin: 0;
      display: flex; flex-direction: column; overflow: hidden; padding: 0;
      background: var(--sc-bg-1); border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border));
      box-shadow: 0 12px 32px color-mix(in srgb, var(--sc-bg-0) 70%, transparent); }
    :host(.full) .hho { border-radius: 0; border-width: 0; }
    .hho:focus { outline: none; }
    .hho:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .hho-bar { position: absolute; top: 8px; inset-inline-end: 8px; z-index: 2;
      display: flex; align-items: center; gap: 6px; }
    .hho-close svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .hho-stage { position: relative; flex: 1 1 auto; min-height: 0; }
    .hho-viewer { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
    .hho-viewer.is-placeholder { background: radial-gradient(ellipse at 50% 60%,
      color-mix(in srgb, var(--sc-accent) 12%, transparent), transparent 70%); }
  `],
})
export class CodexHeroHoloOverlayComponent {
  readonly shipClassName = input.required<string>();
  readonly displayName = input('');
  readonly still = input(false);
  readonly hardpointPortRefs = input<HardpointPortRef[]>([]);
  readonly activePorts = input<readonly string[]>([]);

  readonly closed = output<void>();
  readonly hovered = output<string[] | null>();
  readonly locatable = output<string[]>();
  /** A hotspot click (or Escape in the model) picked a part, with its mount chain; null clears it. */
  readonly partPicked = output<HeroPartPick | null>();
  /** The panel went fullscreen or back. */
  readonly fullChange = output<boolean>();
  /** The part the host shows: its placement id or raw port, null = none. */
  readonly selectedPart = input<string | null>(null);

  private readonly viewer = viewChild(AssetPackageViewerComponent);

  /** Panel over the hero (false) or fullscreen popup (true). */
  readonly full = signal(false);
  /** The ship's asset package, looked up the way the Holotisch does: undefined while asking, null = none (legacy viewer). */
  readonly packageRow = signal<AssetPackageRow | null | undefined>(undefined);

  private readonly packages = inject(AssetPackageService);
  private lookup = 0;

  constructor() {
    effect(() => {
      const ship = this.shipClassName();
      const token = ++this.lookup;
      if (!ship) {
        this.packageRow.set(null);
        return;
      }
      this.packageRow.set(undefined);
      this.packages.findRow(['ship'], ship).then(
        (row) => {
          if (token === this.lookup) this.packageRow.set(row);
        },
        (err: unknown) => {
          logWarn('hero-holo-overlay', 'asset package lookup failed', { ship, err });
          if (token === this.lookup) this.packageRow.set(null);
        },
      );
    });
  }

  toggleFull(): void {
    this.full.update((v) => !v);
    this.fullChange.emit(this.full());
  }

  /** The viewer picked a part: add the port names up its mount chain, so the host finds the loadout slot. */
  onSelection(sel: PlacementSelection | null): void {
    if (!sel) {
      this.partPicked.emit(null);
      return;
    }
    const byId = this.viewer()?.byId();
    const chain: string[] = [sel.portName];
    for (let up = byId?.get(sel.id)?.parentPort; up; up = byId?.get(up)?.parentPort) {
      const port = byId?.get(up)?.portName;
      if (port) chain.push(port);
    }
    this.partPicked.emit({ ...sel, portChain: chain });
  }

  /** Escape steps back one level: fullscreen → panel, panel → closed. */
  onEscape(): void {
    if (this.full()) {
      this.full.set(false);
      this.fullChange.emit(false);
    } else this.closed.emit();
  }
}
