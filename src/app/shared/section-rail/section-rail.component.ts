import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

/** One stop of a {@link SectionRailComponent}: a real link, an icon, a name and whether it is the one in view. */
export interface SectionRailItem {
  readonly id: string;
  /** Real URL: middle click, Ctrl/Cmd+click and "copy link address" work on it. */
  readonly href: string;
  /** The (already translated) name: shown beside the icon on hover/focus, and on the compact strip. */
  readonly label: string;
  /** Shorter name for the compact strip (a phone has one row to work with); defaults to `label`. */
  readonly short?: string;
  /** Icon as SVG path data in a 24x24 box, stroked. */
  readonly icon: string;
  readonly active: boolean;
  /** Accessible name when it should say more than the visible label ("Go to Planning"). */
  readonly ariaLabel?: string;
  /** `aria-current` token while active; a page's own pages are `page`, a section inside the page `location`. */
  readonly current?: 'page' | 'location';
  /** Extra hint through the app tooltip (the hotkey), shown on a long hover only. */
  readonly hint?: string | null;
  /** The key that jumps here, for assistive tech (`aria-keyshortcuts`). */
  readonly shortcut?: string | null;
  /** A small dot on the icon (open events); the text is its accessible name. */
  readonly dot?: string | null;
}

/** What the rail reports on a click: the page decides whether the plain left click stays in the page. */
export interface SectionRailGo {
  readonly event: MouseEvent;
  readonly item: SectionRailItem;
}

/**
 * The section rail of the camera world (concept kamera-welt, r3 "so wie bei HQ, wo sie am Bildschirmrand haengt ...
 * mit icons usw ... das ist der neue Stil", r4 "auf alle Seiten mit Abschnittsmenue"). It generalises the HQ rail:
 *
 *  - `edge` (default): slim icons hung on the left screen edge, outside the content column, vertically centred; the
 *    section in view carries a light bar and `aria-current`; hover/focus slides the name out beside the icon. Under
 *    1024 px the same links become a compact strip pinned under the header (icon + short name, scrolls sideways) so a
 *    phone keeps one-tap access to every section and nothing floats under the feedback launcher.
 *  - `inline`: the same icons in a column inside a panel (the patch file is a dialog, it has no screen edge of its own).
 *
 * Pure presentation: the page owns the hrefs, the click handling (scroll, router) and which item is active.
 * The icons glide in one after the other when the page root carries `.pm-on` (see page-motion).
 */
@Component({
  selector: 'sc-section-rail',
  standalone: true,
  imports: [ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.inline]': "variant() === 'inline'" },
  template: `
    <nav class="rail" [attr.aria-label]="ariaLabel()">
      @for (it of items(); track it.id; let i = $index) {
        <a class="stop pm-glide" [style.--pm-i]="i"
           [href]="it.href" (click)="go.emit({ event: $event, item: it })"
           [scTooltip]="it.hint ?? null" [scTooltipDisabled]="noHover"
           [attr.aria-keyshortcuts]="it.shortcut ?? null"
           [attr.aria-current]="it.active ? (it.current ?? 'page') : null"
           [attr.aria-label]="it.ariaLabel ?? it.label">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="it.icon" /></svg>
          @if (it.dot; as dot) { <i class="evdot" role="img" [attr.aria-label]="dot"></i> }
          <span class="label" aria-hidden="true"><span class="full">{{ it.label }}</span><span class="short">{{ it.short ?? it.label }}</span></span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
      /* The icons glide in one after the other when the page root carries .pm-on (the minor-page entrance). */
      :host-context(.pm-on) .pm-glide { animation: pm-glide 340ms cubic-bezier(0.16, 0.84, 0.24, 1) calc(var(--pm-delay, 0ms) + var(--pm-i, 0) * 60ms) backwards; }
      @keyframes pm-glide { 0% { opacity: 0; transform: translateX(-26px); } 100% { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { :host-context(.pm-on) .pm-glide { animation: none; } }
      .evdot { position: absolute; top: 6px; right: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--sc-accent); box-shadow: 0 0 0 2px var(--sc-bg-1); }
      .stop { position: relative; }
      .stop svg { flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .label .short { display: none; }

      /* ── Phones and small windows: a strip pinned under the header, edge to edge ── */
      :host:not(.inline) {
        display: block;
        position: sticky;
        top: calc(var(--sc-imp-banner-h, 0px) + var(--sc-topbar-h, 0px));
        z-index: 5;
        margin: 0 calc(-1 * var(--sc-page-gutter, 16px)) var(--sc-space-3, 12px);
        padding: var(--sc-space-2, 8px) var(--sc-page-gutter, 16px);
        background: color-mix(in srgb, var(--sc-bg-0) 92%, transparent);
        border-bottom: 1px solid var(--sc-border);
      }
      :host:not(.inline) .rail {
        display: flex;
        flex-direction: row;
        gap: 6px;
        overflow-x: auto;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      :host:not(.inline) .rail::-webkit-scrollbar { display: none; }
      :host:not(.inline) .stop {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 40px;
        padding: 0 12px 0 10px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent);
        color: var(--sc-fg-1);
        text-decoration: none;
        white-space: nowrap;
        font-size: max(0.8rem, var(--sc-fs-floor));
        letter-spacing: 0.04em;
        transition: color 0.16s ease, background 0.16s ease;
      }
      :host:not(.inline) .stop svg { width: 18px; height: 18px; }
      :host:not(.inline) .label .full { display: none; }
      :host:not(.inline) .label .short { display: inline; }
      :host:not(.inline) .stop[aria-current] { background: var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; }
      :host:not(.inline) .evdot { top: 4px; right: 4px; box-shadow: 0 0 0 2px var(--sc-bg-0); }
      @media (pointer: coarse) { :host:not(.inline) .stop { min-height: 48px; } }
      /* A phone held sideways has ~360px of height: a pinned strip costs a sixth of it for the whole page. */
      @media (max-height: 480px) { :host:not(.inline) { position: static; } }

      /* ── Desktop: icons hung on the screen edge, the model is the HQ rail ── */
      @media (min-width: 1024px) {
        :host:not(.inline) {
          position: fixed;
          z-index: 5;
          top: 50%;
          left: max(var(--sc-fab-inset, 16px), env(safe-area-inset-left));
          translate: 0 -50%;
          margin: 0;
          padding: 0;
          background: none;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
          border: 0;
        }
        :host:not(.inline) .rail { flex-direction: column; gap: var(--sc-space-1, 4px); overflow: visible; }
      }
      @media (min-width: 1024px) {
        :host:not(.inline) .stop {
          display: flex;
          gap: var(--sc-space-2, 8px);
          width: 36px;
          height: 36px;
          min-height: 0;
          padding: 0 7px;
          box-sizing: border-box;
          border: 1px solid transparent;
          background: none;
          color: var(--sc-fg-2);
          font-weight: 400;
          letter-spacing: 0.06em;
          transition: width 0.2s ease, color 0.2s;
        }
        :host:not(.inline) .stop svg { width: 20px; height: 20px; }
        :host:not(.inline) .label .full { display: inline; }
        :host:not(.inline) .label .short { display: none; }
        :host:not(.inline) .stop:hover, :host:not(.inline) .stop:focus-visible { width: 148px; color: var(--sc-fg); }
        :host:not(.inline) .stop[aria-current] { background: none; color: var(--sc-accent); font-weight: 400; }
        :host:not(.inline) .stop[aria-current]::before {
          content: '';
          position: absolute;
          left: -8px;
          top: 8px;
          bottom: 8px;
          width: 2px;
          border-radius: 2px;
          background: var(--sc-accent);
          box-shadow: 0 0 8px var(--sc-accent);
        }
        :host:not(.inline) .label { opacity: 0; transition: opacity 0.15s; }
        :host:not(.inline) .stop:hover .label, :host:not(.inline) .stop:focus-visible .label { opacity: 1; }
        :host:not(.inline) .evdot { top: 6px; right: 8px; box-shadow: 0 0 0 2px var(--sc-bg-1); }
      }

      /* ── Inline (inside a panel): the same icon column, names on hover/focus ── */
      :host(.inline) { display: block; }
      :host(.inline) .rail { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); }
      :host(.inline) .stop {
        display: flex; align-items: center; gap: var(--sc-space-2, 8px); width: 36px; height: 36px; padding: 0 7px; box-sizing: border-box;
        border: 1px solid transparent; border-radius: 999px; color: var(--sc-fg-2); text-decoration: none; white-space: nowrap;
        transition: width 0.2s ease, color 0.2s;
      }
      :host(.inline) .stop svg { flex: none; width: 20px; height: 20px; }
      :host(.inline) .label { opacity: 0; transition: opacity 0.15s; }
      :host(.inline) .stop:hover, :host(.inline) .stop:focus-visible { width: 148px; color: var(--sc-fg); background: var(--sc-bg-1); }
      :host(.inline) .stop:hover .label, :host(.inline) .stop:focus-visible .label { opacity: 1; }
      :host(.inline) .stop[aria-current] { color: var(--sc-accent); }
      :host(.inline) .stop[aria-current]::before {
        content: ''; position: absolute; left: -6px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px;
        background: var(--sc-accent); box-shadow: 0 0 8px var(--sc-accent);
      }
      :host(.inline) .label .short { display: none; }
      @media (max-width: 720px) {
        /* A dialog on a phone: the same pill strip the edge variant becomes. */
        :host(.inline) { position: sticky; top: 0; z-index: 2; padding: 8px 12px; background: color-mix(in srgb, var(--sc-bg-0) 92%, transparent); border-bottom: 1px solid var(--sc-border); }
        :host(.inline) .rail { flex-direction: row; gap: 6px; overflow-x: auto; scrollbar-width: none; }
        :host(.inline) .rail::-webkit-scrollbar { display: none; }
        :host(.inline) .stop, :host(.inline) .stop:hover, :host(.inline) .stop:focus-visible {
          flex: 0 0 auto; width: auto; height: auto; min-height: 40px; padding: 0 12px 0 10px; background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent); color: var(--sc-fg-1);
        }
        :host(.inline) .label { opacity: 1; }
        :host(.inline) .label .full { display: none; }
        :host(.inline) .label .short { display: inline; }
        :host(.inline) .stop[aria-current], :host(.inline) .stop[aria-current]:hover { background: var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; }
        :host(.inline) .stop[aria-current]::before { display: none; }
      }

      .stop:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .label { text-shadow: 0 0 6px var(--sc-bg-0), 0 0 2px var(--sc-bg-0); }
      @media (pointer: coarse) { :host(.inline) .stop { width: 44px; height: 44px; } }
      @media (prefers-reduced-motion: reduce) {
        .stop, .label { transition: none; }
      }
    `,
  ],
})
export class SectionRailComponent {
  readonly items = input.required<readonly SectionRailItem[]>();
  readonly ariaLabel = input.required<string>();
  readonly variant = input<'edge' | 'inline'>('edge');
  readonly go = output<SectionRailGo>();

  /** No hover and no hardware keyboard to speak of: hotkey hints stay away. */
  protected readonly noHover = typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches;
}
