import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';
import { OverlayOriginService } from './overlay-origin.service';

/** A prev/next neighbour: router commands for its real anchor. */
export interface OverlayNeighbour {
  readonly commands: readonly unknown[];
}

/**
 * ONE frame for every routed overlay (`/verse/news/:id`, `/verse/gallery/:imageId`,
 * `/verse/patches/:line`): close button, title row, prev/next, scrim, focus
 * trap via `[scDialog]`.
 *
 * Two modes, decided by `OverlayOriginService`:
 * - overlay (opened from its list): fixed takeover - centred sheet on desktop,
 *   wide sheet on tablet, full-screen (`dvh`) on phones; Escape, scrim and the
 *   close button emit `closed`, the host navigates back to the list.
 * - page (direct load / refresh / shared link): the same content flows in the
 *   page frame, no scrim, no dialog semantics.
 * Prev/next are real anchors (`routerLink` leaves modified clicks to the browser).
 */
@Component({
  selector: 'sc-overlay-frame',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (overlay()) {
      <div class="scrim" (click)="closed.emit()">
        <div class="sheet" role="dialog" aria-modal="true" scDialog (scDialogEscape)="closed.emit()"
             [attr.aria-label]="heading()" (click)="$event.stopPropagation()">
          <ng-container *ngTemplateOutlet="inner" />
        </div>
      </div>
    } @else {
      <div class="sheet page"><ng-container *ngTemplateOutlet="inner" /></div>
    }
    <ng-template #inner>
      <header class="bar">
        <h2 class="ttl">{{ heading() }}</h2>
        <span class="nav">
          @if (prev(); as p) {
            <a class="nb" [routerLink]="p.commands" [attr.aria-label]="'overlay.prev' | translate"
               [scTooltip]="'overlay.prev' | translate" scTooltipTier="label">‹</a>
          }
          @if (next(); as n) {
            <a class="nb" [routerLink]="n.commands" [attr.aria-label]="'overlay.next' | translate"
               [scTooltip]="'overlay.next' | translate" scTooltipTier="label">›</a>
          }
          @if (overlay()) {
            <button type="button" class="nb x" (click)="closed.emit()" [attr.aria-label]="'overlay.close' | translate"
                    [scTooltip]="'overlay.close' | translate" scTooltipTier="label">✕</button>
          }
        </span>
      </header>
      <div class="content"><ng-content /></div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .scrim {
      position: fixed; inset: 0; z-index: 150; display: grid; place-items: center; padding: 32px;
      background: color-mix(in srgb, var(--sc-bg-0) 62%, transparent);
      -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
    }
    .sheet {
      display: flex; flex-direction: column; min-height: 0; background: var(--sc-bg-1);
      border: 1px solid var(--sc-border); border-radius: 16px; overflow: hidden;
    }
    .scrim .sheet { width: min(100%, 960px); max-height: 100%; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55); }
    .bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--sc-border); flex: 0 0 auto; }
    .ttl { margin: 0; flex: 1 1 auto; min-width: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
    .nav { display: inline-flex; gap: 6px; flex: 0 0 auto; }
    .nb {
      display: inline-grid; place-items: center; min-width: 36px; min-height: max(36px, var(--sc-tap-min)); border-radius: 999px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-0); color: var(--sc-fg-1); font: inherit; text-decoration: none; cursor: pointer;
    }
    .nb:hover, .nb:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); text-decoration: none; }
    .content { padding: 14px; overflow: auto; min-height: 0; }
    .page .bar { border-bottom: 0; padding-inline: 0; }
    .page .content { overflow: visible; padding-inline: 0; }
    @media (max-width: 1080px) { .scrim { padding: 16px; } .scrim .sheet { width: min(100%, 760px); } }
    @media (max-width: 600px) {
      .scrim { padding: 0; place-items: stretch; }
      .scrim .sheet { width: 100%; max-height: none; height: 100vh; height: 100dvh; border-radius: 0; border: 0; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .scrim .sheet { animation: sheet-in 160ms ease-out; }
    }
    @keyframes sheet-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  `],
})
export class OverlayFrameComponent {
  private readonly origin = inject(OverlayOriginService);

  readonly heading = input.required<string>();
  readonly prev = input<OverlayNeighbour | null>(null);
  readonly next = input<OverlayNeighbour | null>(null);
  readonly closed = output<void>();
  /** A popup opened from a button (not a routed overlay): always the takeover sheet, never the page mode. */
  readonly popup = input(false);

  /** Overlay over the list when opened from it, else a full page. */
  protected overlay(): boolean {
    return this.popup() || this.origin.overlaid();
  }
}
