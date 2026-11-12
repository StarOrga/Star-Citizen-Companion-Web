import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { BetaService } from '../../core/beta.service';
import { claimRootAttr } from '../../core/root-var';
import { PageCornerService } from '../../shell/corners/page-corner.service';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

/** The reading line: headings above it count as "the section the reader is in". */
const READING_LINE_PX = 140;
const TOAST_MS = 2400;

/**
 * Anchor of the section the reader is currently in: the last heading with an
 * `id` (h2/h3) whose top has passed the reading line. `null` above the first.
 */
export function currentAnchor(doc: ParentNode, line = READING_LINE_PX): string | null {
  let hit: string | null = null;
  for (const h of Array.from(doc.querySelectorAll<HTMLElement>('section[id], h2[id], h3[id]'))) {
    if (h.getBoundingClientRect().top <= line) hit = h.id;
    else break;
  }
  return hit;
}

/** The share URL: the page's own URL (no old fragment) plus the section anchor. */
export function shareUrl(loc: Pick<Location, 'origin' | 'pathname' | 'search'>, anchor: string | null): string {
  return `${loc.origin}${loc.pathname}${loc.search}${anchor ? `#${anchor}` : ''}`;
}

/**
 * Sticky share button for long pages (shell beta): shares URL + the current
 * section anchor - or, where the page registered one (`PageCornerService.setShare`, the ship
 * page's whole Holotisch state), the page's own URL - with no dialog - the Web Share API where it exists, else the
 * link goes to the clipboard and a small status toast says so.
 * Sits bottom-right beside the feedback launcher (`--sc-fab-clear-inline`), so it
 * never overlaps it nor the bottom-left hand-off button; on phones it rides above
 * the bottom bar (`--sc-bar-stack-h`).
 */
@Component({
  selector: 'sc-share-button',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <div class="dock" [class.beside]="!shell()">
        @if (toast(); as t) {
          <span class="toast" role="status">{{ t | translate }}</span>
        }
        <button type="button" class="fab" (click)="share($event)" [attr.aria-label]="'share.label' | translate"
                [attr.aria-haspopup]="page()?.open ? 'dialog' : null" [attr.aria-expanded]="page()?.open ? !!page()?.expanded?.() : null"
                [scTooltip]="'share.label' | translate" scTooltipTier="label">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
          </svg>
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    /* Bottom-right is the share button's corner, bottom-left the hand-off's: one
       owner per corner. Beside the feedback launcher (in its lane), on a phone
       above the bottom bar where the launcher's disc sits in the bar row. The corner moves as
       one unit or not at all: a page's own sticky bottom strip (the ship's Holotisch) ends
       before the share lane instead of lifting the share alone (concept codex-kopf-besitz C8). */
    .dock {
      position: fixed; z-index: 140; inset-inline-end: var(--sc-fab-clear-inline, 88px);
      /* Centred on the launcher's centre line, like the footer row. */
      bottom: calc(var(--sc-float-bottom, 16px) + (var(--sc-fab-size, 56px) - max(44px, var(--sc-tap-min, 44px))) / 2);
      display: flex; align-items: center; gap: 10px;
    }
    /* Phone, beta shell: the launcher sits in the bar row, the share rides above the bar in its
       column. Without the beta there is no bar: the share stays beside the launcher. */
    @media (max-width: 720px) {
      .dock:not(.beside) {
        inset-inline-end: var(--sc-fab-inset, 16px);
        bottom: calc(var(--sc-bar-stack-h, 0px) + var(--sc-float-bottom, 16px) + var(--sc-space-3));
      }
    }
    .fab {
      display: inline-grid; place-items: center; width: max(44px, var(--sc-tap-min)); height: max(44px, var(--sc-tap-min));
      border-radius: 50%; border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-fg-1);
      cursor: pointer; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }
    .fab:hover, .fab:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
    .toast {
      padding: 8px 12px; border-radius: 999px; border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-0); font-size: max(0.82rem, var(--sc-fs-floor));
    }
  `],
})
export class ShareButtonComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly shell = inject(BetaService).isEnabled('shell');
  private readonly corner = inject(PageCornerService);
  protected readonly page = this.corner.share;
  /** Beta shell everywhere; without it wherever a page registered its share (ship pages, C9/F5). */
  readonly enabled = computed(() => this.shell() || !!this.page());

  /** Title handed to the native share sheet. */
  readonly shareTitle = input<string>('');
  protected readonly toast = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The footer makes room for the dock: html[data-sc-share-dock], never html:has(sc-share-button .dock).
    effect(() => claimRootAttr('data-sc-share-dock', this, this.enabled() ? '' : null));
    this.destroyRef.onDestroy(() => {
      claimRootAttr('data-sc-share-dock', this, null);
      if (this.timer) clearTimeout(this.timer);
    });
  }

  async share(ev?: Event): Promise<void> {
    const page = this.corner.share();
    if (page?.open) {
      page.open((ev?.currentTarget as HTMLElement | null) ?? (this.doc.querySelector('sc-share-button .fab') as HTMLElement));
      return;
    }
    const url = page ? page.url() : shareUrl(this.doc.location, currentAnchor(this.doc));
    const nav = this.doc.defaultView?.navigator;
    if (nav?.share) {
      try {
        await nav.share({ title: this.shareTitle() || this.doc.title, url });
      } catch {
        /* sheet dismissed - nothing to report */
      }
      return;
    }
    try {
      if (!nav?.clipboard?.writeText) throw new Error('no clipboard');
      await nav.clipboard.writeText(url);
      this.flash('share.copied');
    } catch {
      this.flash('share.failed');
    }
  }

  private flash(key: string): void {
    this.toast.set(key);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.toast.set(null), TOAST_MS);
  }
}
