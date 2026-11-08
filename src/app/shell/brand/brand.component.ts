import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * The brand, from ONE source for the main header and the subheader (concept
 * 2026-11-01, round 2: "die marke und icon sollten ja auch gleich sein wenn es
 * den sub header nicht gibt sondern den header").
 *
 * `<sc-brand-logo>` — the mark with its accent glow, `--sc-brand-logo` square
 * (32px in both bars, so the header's logo lands on the subheader's slot at the
 * same size). `<sc-brand-name>` — the wordmark in the display font, 700,
 * 0.16em, uppercase, primary text colour, plus the channel marker ("Alpha") in
 * the accent. `channel="stack"` puts the marker under the name (main header),
 * `channel="inline"` beside it (subheader, whose second line is the path).
 *
 * The two stay separate elements because the subheader morphs the logo slot and
 * the name plate independently while docking.
 */
@Component({
  selector: 'sc-brand-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img class="logo" src="icons/brand/scc-mark.svg" alt="" width="32" height="32" />`,
  styles: [
    `
      :host {
        display: block;
        flex: none;
        width: var(--sc-brand-logo, 32px);
        height: var(--sc-brand-logo, 32px);
      }
      .logo {
        display: block;
        width: 100%;
        height: 100%;
        filter: drop-shadow(0 0 8px color-mix(in srgb, var(--sc-accent) 55%, transparent));
      }
    `,
  ],
})
export class BrandLogoComponent {}

@Component({
  selector: 'sc-brand-name',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-channel]': 'channel()' },
  template: `<span class="title">Verse Companion</span><span class="channel">{{ 'nav.phaseBadge' | translate }}</span>`,
  styles: [
    `
      :host {
        display: grid;
        min-width: 0;
        color: var(--sc-fg-0);
        font-family: var(--sc-font-display);
        text-transform: uppercase;
        white-space: nowrap;
      }
      :host([data-channel='inline']) {
        display: flex;
        align-items: baseline;
        gap: 0.7em;
      }
      .title {
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: var(--sc-brand-fs, 12px);
        font-weight: 700;
        letter-spacing: 0.16em;
      }
      .channel {
        flex: none;
        font-size: 9px;
        letter-spacing: 0.42em;
        color: var(--sc-accent);
      }
    `,
  ],
})
export class BrandNameComponent {
  /** Where the channel marker stands: under the name (main header) or beside it (subheader). */
  readonly channel = input<'stack' | 'inline'>('stack');
}
