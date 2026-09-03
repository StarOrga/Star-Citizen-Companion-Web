import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/** Which half of the Codex-landing surface this rail re-opens. */
export type ZoneRailKind = 'board' | 'hangar';

/**
 * The collapsed half of the AN BORD ⇄ IM HANGAR switcher (feedback e80cc831).
 *
 * The two zones used to be columns that each grew with their content, so the
 * page jumped every time something was selected. They are ONE toggle now: the
 * expanded zone keeps its panel, the other one shrinks to this rail — a slim
 * vertical strip on tablet/desktop, a 52px horizontal bar below 760px, where a
 * vertical strip would eat a third of a phone's width for two words.
 *
 * A real `<button>`, not an anchor: it switches a view, it does not take you
 * anywhere. The zone's own entrances (set name, six positions, /hangar link)
 * come back with the expanded panel.
 *
 * Split out of `codex-landing.component.ts` for the same reason
 * `codex-board-panel.component.ts` was: that file's inline styles sit against
 * an 18 kB budget and these rules push it over.
 */
@Component({
  selector: 'sc-codex-zone-rail',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="zone-rail"
      [class.board]="kind() === 'board'"
      [class.hangar]="kind() === 'hangar'"
      aria-expanded="false"
      [attr.aria-controls]="'zone-' + kind()"
      [attr.aria-label]="labelKey() | translate"
      (click)="expand.emit()"
    >
      <span class="rail-chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7" /></svg>
      </span>
      <span class="rail-text">
        <span class="rail-eyebrow">{{ eyebrowKey() | translate }}</span>
        <span class="rail-sub">
          @if (summary(); as s) {
            {{ s }}
          } @else {
            {{ fallbackKey() | translate }}
          }
        </span>
      </span>
    </button>
  `,
  styles: [
    `
      /* The button itself is the grid item of .surface, so the host must not
         sit between them — same trick the board panel uses. */
      :host { display: contents; }
      .zone-rail {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        padding: 14px 0;
        border: 0;
        border-left: 2px solid var(--tint);
        background: color-mix(in srgb, var(--tint) 5%, transparent);
        color: inherit;
        font: inherit;
        cursor: pointer;
        overflow: hidden;
        transition: background 0.16s ease;
      }
      .zone-rail.board { --tint: var(--sc-warning, #ffc14d); }
      .zone-rail.hangar { --tint: var(--sc-accent); }
      .zone-rail:hover { background: color-mix(in srgb, var(--tint) 12%, transparent); }
      .zone-rail:focus-visible {
        outline: none;
        background: color-mix(in srgb, var(--tint) 12%, transparent);
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--tint) 60%, transparent);
      }
      .rail-chevron { width: 16px; height: 16px; flex: 0 0 16px; color: var(--tint); }
      .rail-chevron svg { width: 100%; height: 100%; display: block; }
      .rail-text { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 0; }
      .rail-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--tint);
        white-space: nowrap;
      }
      .rail-sub {
        min-width: 0;
        font-size: max(0.72rem, var(--sc-fs-floor));
        color: var(--sc-fg-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Vertical rail: the label reads bottom-to-top, the way a spine does. */
      @media (min-width: 761px) {
        .zone-rail { flex-direction: column; justify-content: flex-start; }
        .rail-text { writing-mode: vertical-rl; transform: rotate(180deg); max-height: 100%; }
        .zone-rail.hangar .rail-chevron { transform: rotate(180deg); }
      }
      /* Phone/small tablet: a horizontal bar. The chevron points at the space
         the zone will take — down for the top half, up for the bottom one. */
      @media (max-width: 760px) {
        .zone-rail { height: 100%; padding: 0 14px; border-left: 0; border-top: 2px solid var(--tint); }
        .rail-text { flex: 1; }
        .zone-rail.board .rail-chevron { transform: rotate(90deg); }
        .zone-rail.hangar .rail-chevron { transform: rotate(-90deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .zone-rail { transition: none; }
      }
    `,
  ],
})
export class CodexZoneRailComponent {
  readonly kind = input.required<ZoneRailKind>();
  /** i18n key of the zone name ("An Bord" / "Im Hangar"). */
  readonly eyebrowKey = input.required<string>();
  /** i18n key of the button's accessible name ("… aufklappen"). */
  readonly labelKey = input.required<string>();
  /** What is inside, in plain data (set name, flagship name) — may be absent. */
  readonly summary = input<string | null>(null);
  /** i18n key shown instead when there is nothing to name yet. */
  readonly fallbackKey = input.required<string>();

  readonly expand = output<void>();
}
