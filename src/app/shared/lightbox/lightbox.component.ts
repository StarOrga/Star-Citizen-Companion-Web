import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../dialog/sc-dialog.directive';
import { OverlayNeighbour } from '../overlay-frame/overlay-frame.component';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

/** What the lightbox shows - the same shape for the routed item and the starscape wall. */
export interface LightboxImage {
  readonly title: string | null;
  readonly sourceUrl: string;
  /** Phone-sized stand-in for the original (<= 900 px wide screens). */
  readonly previewUrl: string;
  readonly articleUrl: string;
}

/** Wider than this the picture is zoomed to fill the stage; narrower ones get the mirrored blur. */
const WIDE_RATIO = 1.5;

/**
 * ONE image popup for the Verse gallery, the gallery detail route and the
 * Starscape page: the picture is the focus, every control fades in on hover /
 * keyboard focus (always visible on touch devices, which have no hover).
 *
 * - top right: open original (real anchor), full screen, close
 * - bottom left: download original, view on RSI (real anchors)
 * - left / right edge: previous / next (real anchors to the routed item, they
 *   REPLACE the history entry so the stack does not grow per image); the arrow
 *   keys do the same, in full screen too
 * - the stage is a fixed 16:9 box: widescreen art is zoomed to fit, portrait
 *   art sits on a mirrored, blurred copy of itself
 * - full screen = the Fullscreen API (a page cannot press F11); only the image
 *   and the hover controls stay, Esc / F11 end it.
 *
 * `overlay=false` renders the same stage inline in the page frame (direct load).
 */
@Component({
  selector: 'sc-lightbox',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (overlay()) {
      <div class="root overlay" #root (click)="closed.emit()">
        <div class="stage" role="dialog" aria-modal="true" scDialog scDialogInitialFocus="container"
             (scDialogEscape)="closed.emit()" [attr.aria-label]="image().title || ('overlay.gallery.image' | translate)"
             (click)="$event.stopPropagation()">
          <ng-container *ngTemplateOutlet="inner" />
        </div>
      </div>
    } @else {
      <div class="root page" #root>
        <div class="stage"><ng-container *ngTemplateOutlet="inner" /></div>
      </div>
    }
    <ng-template #inner>
      <img class="mirror" [src]="image().previewUrl" alt="" aria-hidden="true" />
      <picture>
        <source media="(max-width: 900px)" [srcset]="image().previewUrl" />
        <img class="pic" [class.wide]="wide()" [src]="image().sourceUrl" [alt]="image().title ?? ''"
             (load)="onLoad($event)" />
      </picture>

      @if (prev(); as p) {
        <a class="edge l ctl" [routerLink]="p.commands" [replaceUrl]="true" [attr.aria-label]="'overlay.prev' | translate"
           [scTooltip]="'overlay.prev' | translate" scTooltipTier="label"><span class="chev">‹</span></a>
      }
      @if (next(); as n) {
        <a class="edge r ctl" [routerLink]="n.commands" [replaceUrl]="true" [attr.aria-label]="'overlay.next' | translate"
           [scTooltip]="'overlay.next' | translate" scTooltipTier="label"><span class="chev">›</span></a>
      }

      @if (image().title) { <p class="ttl ctl">{{ image().title }}</p> }

      <div class="tools ctl">
        <a class="ib" [href]="image().sourceUrl" target="_blank" rel="noopener noreferrer"
           [attr.aria-label]="'overlay.openOriginal' | translate" [scTooltip]="'overlay.openOriginal' | translate" scTooltipTier="label">↗</a>
        @if (canFullscreen) {
          <button type="button" class="ib" (click)="toggleFullscreen()"
                  [attr.aria-label]="(fullscreen() ? 'overlay.exitFullscreen' : 'overlay.fullscreen') | translate"
                  [scTooltip]="(fullscreen() ? 'overlay.exitFullscreen' : 'overlay.fullscreen') | translate" scTooltipTier="label">
            {{ fullscreen() ? '⤡' : '⤢' }}
          </button>
        }
        @if (overlay()) {
          <button type="button" class="ib" (click)="closed.emit()" [attr.aria-label]="'overlay.close' | translate"
                  [scTooltip]="'overlay.close' | translate" scTooltipTier="label">✕</button>
        }
      </div>

      <div class="acts ctl">
        <a class="ab" [href]="image().sourceUrl" target="_blank" rel="noopener noreferrer" download>{{ 'overlay.gallery.download' | translate }}</a>
        <a class="ab" [href]="image().articleUrl" target="_blank" rel="noopener noreferrer">{{ 'overlay.gallery.article' | translate }} ↗</a>
      </div>
      <div class="extra ctl"><ng-content /></div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .root.overlay {
      position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; cursor: zoom-out;
      padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
      background: rgba(0, 0, 0, 0.85); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    }
    .stage {
      position: relative; overflow: hidden; cursor: default; isolation: isolate;
      width: min(100%, 1480px, calc(88vh * 16 / 9)); width: min(100%, 1480px, calc(88dvh * 16 / 9));
      aspect-ratio: 16 / 9; border-radius: 12px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border);
    }
    .stage:focus { outline: none; }
    .root.page .stage { width: 100%; }
    .root:fullscreen { display: grid; place-items: center; background: #000; padding: 0; }
    .root:fullscreen .stage { width: 100vw; height: 100vh; height: 100dvh; aspect-ratio: auto; border: 0; border-radius: 0; }
    .root:fullscreen.overlay { cursor: default; }

    .mirror {
      position: absolute; inset: -8%; width: 116%; height: 116%; object-fit: cover; z-index: 0;
      filter: blur(28px) saturate(1.2) brightness(0.7); pointer-events: none;
    }
    picture { display: contents; }
    .pic { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; z-index: 1; }
    .pic.wide { object-fit: cover; }

    /* Every control rides one layer: hidden until the stage is hovered or holds
       keyboard focus; touch devices have no hover, so there they stay visible. */
    .ctl { position: absolute; z-index: 2; opacity: 0; transition: opacity 160ms ease; }
    .stage:hover .ctl, .stage:focus-within .ctl, .stage:focus .ctl { opacity: 1; }
    @media (hover: none) { .ctl { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .ctl { transition: none; } }

    .ttl {
      top: 0; left: 0; right: 120px; margin: 0; padding: 14px 16px 28px; font-size: 0.95rem; font-weight: 600; color: #fff;
      background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent); pointer-events: none;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .tools { top: 10px; right: 10px; display: flex; gap: 6px; }
    .ib {
      display: inline-grid; place-items: center; min-width: 36px; min-height: max(36px, var(--sc-tap-min, 0px)); border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(0, 0, 0, 0.5); color: #fff;
      font: inherit; font-size: 1rem; line-height: 1; text-decoration: none; cursor: pointer;
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    }
    .ib:hover, .ib:focus-visible, .ab:hover, .ab:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); text-decoration: none; }
    .acts { left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; gap: 8px; max-width: calc(100% - 24px); }
    .ab {
      padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(0, 0, 0, 0.55);
      color: #fff; font-size: max(0.82rem, var(--sc-fs-floor, 0px)); text-decoration: none; text-transform: uppercase; letter-spacing: 0.05em;
      -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
    }
    .extra { right: 12px; bottom: 12px; display: flex; gap: 8px; align-items: center; }
    .extra:empty { display: none; }

    /* A full-height strip is the click target, the chevron only its visible part. */
    .edge {
      top: 0; bottom: 0; width: 16%; max-width: 160px; display: flex; align-items: center; color: #fff; text-decoration: none;
    }
    .edge.l { left: 0; justify-content: flex-start; padding-left: 12px; background: linear-gradient(to right, rgba(0, 0, 0, 0.35), transparent); }
    .edge.r { right: 0; justify-content: flex-end; padding-right: 12px; background: linear-gradient(to left, rgba(0, 0, 0, 0.35), transparent); }
    .chev { font-size: 2.6rem; line-height: 1; text-shadow: 0 1px 8px rgba(0, 0, 0, 0.7); }
    .edge:hover .chev, .edge:focus-visible .chev { color: var(--sc-accent); }
    .edge:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    @media (max-width: 720px) {
      .stage { border-radius: 8px; }
      .edge { width: 22%; }
      .ab { padding: 6px 10px; }
    }
  `],
})
export class LightboxComponent {
  private readonly router = inject(Router);

  readonly image = input.required<LightboxImage>();
  readonly prev = input<OverlayNeighbour | null>(null);
  readonly next = input<OverlayNeighbour | null>(null);
  /** true: fixed takeover over the page; false: inline stage in the page frame. */
  readonly overlay = input(true);
  readonly closed = output<void>();

  protected readonly wide = signal(false);
  protected readonly fullscreen = signal(false);
  protected readonly canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');


  protected onLoad(ev: Event): void {
    const img = ev.target as HTMLImageElement;
    this.wide.set(img.naturalHeight > 0 && img.naturalWidth / img.naturalHeight >= WIDE_RATIO);
  }

  protected toggleFullscreen(): void {
    const el = this.root()?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  @HostListener('document:fullscreenchange')
  protected onFullscreenChange(): void {
    this.fullscreen.set(document.fullscreenElement === this.root()?.nativeElement);
  }

  /** ←/→ walk the neighbours (replacing the history entry), also in full screen. */
  @HostListener('document:keydown', ['$event'])
  protected onKey(ev: KeyboardEvent): void {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const n = ev.key === 'ArrowLeft' ? this.prev() : ev.key === 'ArrowRight' ? this.next() : null;
    if (!n) return;
    ev.preventDefault();
    void this.router.navigate([...n.commands], { replaceUrl: true });
  }
}
