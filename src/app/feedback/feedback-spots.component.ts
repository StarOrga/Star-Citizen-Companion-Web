import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { FeedbackAreaService } from './feedback-area.service';
import type { FeedbackAreaView } from './feedback-area.types';
import { FeedbackSpot, FeedbackSpotLabel, FeedbackSpotService } from './feedback-spot.service';

/** Edge length of a spot button, px. Kept in sync with `.spot` below. */
export const SPOT_SIZE = 32;
/** Inset from the section's corner / the viewport edges, px. */
const SPOT_INSET = 6;
/** Below this width the feedback panel is a full-bleed sheet — no spots. */
const PHONE_QUERY = '(max-width: 599.98px)';

export interface SpotRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface PlacedSpot<T> {
  spot: T;
  top: number;
  left: number;
}

/**
 * Where each spot goes — pure, so the rules are testable without a layout.
 *
 * A spot sits in its section's top-right corner. A section taller than the
 * screen whose top has scrolled away keeps its spot pinned just below the
 * sticky header while enough of it is still on screen, so the section the
 * writer is looking at has a spot even half-way down. Skipped: sections with
 * no box (hidden), off screen or too narrow to hold the button; spots that
 * would sit under an open feedback panel or its launcher ("so das das
 * Feedback Panel es nicht überlappt"); and a spot landing on one already
 * placed (a heading marked inside a marked card — the one registered first
 * wins).
 */
export function placeSpots<T>(
  items: readonly { spot: T; rect: SpotRect }[],
  occluders: readonly SpotRect[],
  viewport: { width: number; height: number; topClear: number },
): PlacedSpot<T>[] {
  const placed: PlacedSpot<T>[] = [];
  const minTop = viewport.topClear + SPOT_INSET;
  for (const { spot, rect } of items) {
    if (rect.right - rect.left < SPOT_SIZE + 2 * SPOT_INSET) continue;
    if (rect.bottom - rect.top <= 0) continue;
    const maxTop = rect.bottom - SPOT_SIZE - SPOT_INSET;
    const top = Math.max(rect.top + SPOT_INSET, minTop);
    if (top > maxTop || top + SPOT_SIZE > viewport.height - SPOT_INSET) continue;
    const left = Math.min(rect.right - SPOT_SIZE - SPOT_INSET, viewport.width - SPOT_SIZE - SPOT_INSET);
    if (left < SPOT_INSET) continue;
    const box = { top, left, right: left + SPOT_SIZE, bottom: top + SPOT_SIZE };
    if (occluders.some((o) => intersects(box, o, SPOT_INSET))) continue;
    if (placed.some((p) => Math.abs(p.top - top) < SPOT_SIZE && Math.abs(p.left - left) < SPOT_SIZE)) continue;
    placed.push({ spot, top, left });
  }
  return placed;
}

function intersects(a: SpotRect, b: SpotRect, margin: number): boolean {
  if (b.right - b.left <= 0 || b.bottom - b.top <= 0) return false;
  return (
    a.left < b.right + margin &&
    a.right > b.left - margin &&
    a.top < b.bottom + margin &&
    a.bottom > b.top - margin
  );
}

/**
 * Compose the line: the page's view first where it has one (Codex ship page:
 * Holotisch / Klassisch — the area chip already says Codex), then the
 * section, then a quoted title.
 */
export function referenceLine(
  label: FeedbackSpotLabel,
  view: FeedbackAreaView | null,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  let section = t(label.key);
  if (label.subKey) section = `${section} ${t(label.subKey)}`;
  if (label.text) section = t('feedbackSpot.titled', { label: section, text: label.text });
  if (!view) return section;
  return `${t(`codex.holo.toggle.${view}Hint`)}: ${section}`;
}

/**
 * The reference buttons themselves (feedback #243), drawn once in the shell
 * for every `[scFeedbackSpot]` on the page while a feedback panel is open.
 *
 * Fixed-position and outside the page's DOM, so a marked card's `overflow`,
 * its stacking context or a `<details>` summary's own click never get in the
 * way. Layer 55: above page furniture (sticky header, compare tray, up to
 * 50), below the modal band (60+) — a popup in front of the page covers the
 * spots of the page behind it.
 *
 * Phones (< 600px) get none: there the panel is a full-bleed sheet, so no
 * section is visible next to it to point at.
 */
@Component({
  selector: 'sc-feedback-spots',
  standalone: true,
  imports: [ScTooltipDirective],
  // Part of the feedback UI, not of the page a screenshot is about.
  host: { 'data-sc-capture-hide': '' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of placed(); track p.spot) {
      <button
        type="button"
        class="spot"
        [class.hot]="hot()"
        [style.top.px]="p.top"
        [style.left.px]="p.left"
        (mousedown)="$event.preventDefault()"
        (click)="insert(p.spot)"
        [attr.aria-label]="ariaFor(p.spot)"
        [scTooltip]="ariaFor(p.spot)"
        scTooltipTier="label">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 4V5z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round" />
          <path d="M12 6.5v6M9 9.5h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }
    .spot {
      position: fixed;
      z-index: 55;
      width: 32px;
      height: 32px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 1px solid var(--sc-accent);
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      color: var(--sc-accent);
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      opacity: 0.9;
      transition: opacity 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
    }
    /* Same colour as the launcher it belongs to: the admin FAB is hot. */
    .spot.hot { border-color: var(--sc-accent-hot); color: var(--sc-accent-hot); }
    .spot:hover { opacity: 1; transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55); }
    .spot:focus-visible {
      outline: none;
      opacity: 1;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 45%, transparent);
    }
    .spot.hot:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent-hot) 45%, transparent); }
    @media (max-width: 599.98px) {
      .spot { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .spot { transition: none; }
      .spot:hover { transform: none; }
    }
  `],
})
export class FeedbackSpotsComponent {
  private readonly spots = inject(FeedbackSpotService);
  private readonly area = inject(FeedbackAreaService);
  private readonly translate = inject(TranslateService);
  private readonly lang = toSignal(this.translate.onLangChange, { initialValue: null });

  /** Bumped (once per frame at most) on scroll, resize and layout changes. */
  private readonly tick = signal(0);
  readonly hot = computed(() => this.spots.owner() === 'admin');

  readonly placed = computed<PlacedSpot<FeedbackSpot>[]>(() => {
    this.tick();
    if (!this.spots.open() || typeof window === 'undefined') return [];
    if (window.matchMedia?.(PHONE_QUERY).matches) return [];
    const items = this.spots.spots().map((spot) => ({ spot, rect: spot.el.getBoundingClientRect() }));
    const occluders = this.spots.occluders().map((el) => el.getBoundingClientRect());
    const topClear =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc-topbar-h')) || 0;
    return placeSpots(items, occluders, {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
      topClear,
    });
  });

  constructor() {
    effect((onCleanup) => {
      if (!this.spots.open() || typeof window === 'undefined') return;
      const els = this.spots.spots().map((s) => s.el);
      const occluders = this.spots.occluders();
      let frame = 0;
      const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          this.tick.update((n) => n + 1);
        });
      };
      window.addEventListener('scroll', schedule, { capture: true, passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      let ro: ResizeObserver | undefined;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(schedule);
        // The body catches a section above folding open or shut — that moves
        // every section below it without resizing any of them.
        ro.observe(document.body);
        for (const el of [...els, ...occluders]) ro.observe(el);
      }
      schedule();
      onCleanup(() => {
        window.removeEventListener('scroll', schedule, { capture: true });
        window.removeEventListener('resize', schedule);
        ro?.disconnect();
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }

  /** The line a spot inserts, e.g. "Klassische Ansicht: Loadout Bewaffnung". */
  lineFor(spot: FeedbackSpot): string {
    this.lang();
    return referenceLine(spot.label(), this.area.currentView(), (key, params) =>
      this.translate.instant(key, params),
    );
  }

  ariaFor(spot: FeedbackSpot): string {
    return this.translate.instant('feedbackSpot.insert', { line: this.lineFor(spot) });
  }

  insert(spot: FeedbackSpot): void {
    this.spots.insert(this.lineFor(spot));
  }
}
