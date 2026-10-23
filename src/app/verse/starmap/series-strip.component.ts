import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { VerseExplorerState } from '../data/verse.models';
import { seriesStops } from './starmap.model';

/**
 * The series in one line: the current count, a `?` that explains how the
 * server counts it, and the reward road (unlocked · next · locked). Unlock
 * state always comes from the server's `rewards`, never from the numbers.
 */
@Component({
  selector: 'sc-series-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ScTooltipDirective],
  template: `
    @let st = state();
    <b class="label">
      {{ 'starmap.series.kind' | translate }}
      <em>{{ (st.streak.current === 1 ? 'starmap.series.countOne' : 'starmap.series.count') | translate: { n: st.streak.current } }}</em>
      <button type="button" class="info" [attr.aria-label]="'starmap.series.helpAria' | translate"
              [scTooltip]="helpText() | translate: { best: st.streak.best }">?</button>
    </b>
    <ol class="road" [attr.aria-label]="'starmap.series.roadAria' | translate">
      @for (s of stops(); track s.key) {
        <li class="rs" [class.on]="s.on" [class.next]="s.next" tabindex="0"
            [scTooltip]="(s.on ? 'starmap.series.stopOn' : s.next ? 'starmap.series.stopNext' : 'starmap.series.stopLocked') | translate: { title: ('starmap.reward.' + s.key + '.title' | translate), desc: ('starmap.reward.' + s.key + '.desc' | translate), at: s.at }">
          <i aria-hidden="true"></i>
          <em>{{ 'starmap.reward.' + s.key + '.title' | translate }}</em>
          @if (s.next) { <small>{{ 'starmap.series.from' | translate: { at: s.at } }}</small> }
          <span class="sr-only">{{ (s.on ? 'starmap.reward.unlocked' : 'starmap.reward.locked') | translate: { at: s.at } }}</span>
        </li>
      }
    </ol>
  `,
  styles: [
    `
      :host { display: flex; align-items: center; gap: 22px; min-width: 0; padding: 8px 16px; border-radius: 10px; box-sizing: border-box;
        background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent); border: 1px solid var(--sc-border); backdrop-filter: blur(6px);
        font-size: 0.75rem; color: var(--sc-fg-1); }
      .label { flex: none; display: inline-flex; align-items: center; gap: 10px; font: 400 0.66rem var(--sc-font-display); letter-spacing: 0.22em;
        text-transform: uppercase; color: var(--sc-fg-2); white-space: nowrap; }
      .label em { font: 600 0.82rem inherit; font-style: normal; letter-spacing: 0; text-transform: none; color: var(--sc-accent); }
      .info { width: 24px; height: 24px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); padding: 0;
        background: none; display: inline-grid; place-items: center; font: 700 0.7rem/1 inherit; color: var(--sc-fg-1); cursor: help; }
      .info:hover, .info:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); outline: none; }
      .road { flex: 1 1 auto; display: flex; align-items: center; justify-content: flex-end; min-width: 0; margin: 0; padding: 2px 0; list-style: none;
        overflow-x: auto; scrollbar-width: thin; }
      .rs { position: relative; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; border-radius: 6px; outline: none; cursor: help; }
      .rs:focus-visible em { color: var(--sc-fg-0); text-decoration: underline; text-underline-offset: 3px; }
      .rs + .rs::before { content: ''; width: 18px; height: 2px; margin: 0 7px 0 1px; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .rs.on + .rs::before { background: linear-gradient(90deg, var(--sc-accent), color-mix(in srgb, var(--sc-accent) 30%, transparent)); }
      .rs.on + .rs.on::before { background: var(--sc-accent); }
      .rs > i { width: 11px; height: 11px; flex: none; border-radius: 50%; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
      .rs.on > i { background: radial-gradient(circle, #fff 0 25%, var(--sc-accent) 60%); box-shadow: 0 0 8px var(--sc-accent); }
      .rs.next > i { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 85%, transparent), 0 0 6px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
      .rs > em { font-style: normal; font-size: 0.72rem; color: var(--sc-fg-2); }
      .rs.on > em, .rs.next > em { color: var(--sc-fg-1); }
      .rs > small { font-size: 0.66rem; color: var(--sc-accent); }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      @media (max-width: 760px) { :host { flex-direction: column; align-items: stretch; gap: 8px; } .road { justify-content: flex-start; } }
    `,
  ],
})
export class SeriesStripComponent {
  readonly state = input.required<VerseExplorerState>();
  readonly stops = computed(() => seriesStops(this.state().rewards));
  readonly helpText = computed(() => {
    const st = this.state().streak;
    if (st.reserveAvailable) return 'starmap.series.helpReserve';
    return 'starmap.series.help';
  });
}
