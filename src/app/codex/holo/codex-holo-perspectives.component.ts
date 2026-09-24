import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  CodexDefensivePanelComponent,
  CodexOffensivePanelComponent,
  CodexShipPanelComponent,
  ShipFactGroup,
} from '../codex-analysis-panels.component';
import { DefensivePanel, OffensivePanel } from '../codex-loadout-stats';
import { Perspective } from '../codex-build-compare';

/** A patch-Δ ghost beside a number: the other build's value and its tone. */
export interface HoloGhost {
  patch: string;
  text: string;
  tone: 'up' | 'down' | null;
}

/** One perspective tile, fully resolved by the stage (strings, not cells). */
export interface HoloPerspectiveView {
  id: Perspective;
  titleKey: string;
  /** Mean percentile of the ranked axes inside this perspective, null = gap. */
  pct: number | null;
  leadText: string | null;
  leadLabelKey: string | null;
  leadShortKey: string | null;
  deltaText: string | null;
  deltaTone: 'up' | 'down' | null;
  ghost: HoloGhost | null;
  /** The one-line reading under the big number, already translated. */
  say: string;
  subs: readonly { key: string; shortKey: string; text: string; ghost: HoloGhost | null }[];
}

/**
 * The four perspective tiles under the Holotable (concept round 10 "Weg B",
 * hv6-s4): title + `P<n>` + Einsatz, the headline number with its reading,
 * a ring gauge, three sub-values, and "Alle Werte" = today's analysis panel.
 * Purely presentational — the stage resolves every string.
 */
@Component({
  selector: 'sc-codex-holo-perspectives',
  standalone: true,
  imports: [TranslatePipe, CodexOffensivePanelComponent, CodexDefensivePanelComponent, CodexShipPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sh">
      <span class="t">{{ 'codex.holo.stage.perspectives' | translate }} <span class="n">{{ tiles().length }}</span></span>
      <span class="rule"></span>
      <span class="ctx">{{ missionLabelKey() | translate }}@if (cohortSize(); as n) { · {{ 'codex.holo.strip.shipCount' | translate: { n: n } }} }</span>
    </div>
    @for (tile of tiles(); track tile.id) {
      <article class="ptile" [attr.data-p]="tile.id" [class.pulse]="pulse() === tile.id">
        <div class="pt-head">
          <span class="t">{{ tile.titleKey | translate }}</span>
          @if (tile.pct != null) { <span class="pp">P{{ tile.pct }}</span> }
          <span class="prof">{{ missionLabelKey() | translate }}</span>
        </div>
        <div class="pt-main" [class.no-gauge]="tile.pct == null">
          <div class="pt-lead">
            @if (tile.leadText != null) {
              <div class="big">
                <span class="num">{{ tile.leadText }}</span>
                <small>{{ tile.leadLabelKey! | translate }}</small>
                @if (tile.deltaText; as d) { <span class="d" [class.up]="tile.deltaTone === 'up'" [class.down]="tile.deltaTone === 'down'">{{ d }}</span> }
                @if (tile.ghost; as g) {
                  <span class="ghost" [class.up]="g.tone === 'up'" [class.down]="g.tone === 'down'"
                        [attr.title]="'codex.holo.stage.ghostTitle' | translate: { patch: g.patch }">{{ g.patch }} · {{ g.text }}</span>
                }
              </div>
            } @else {
              <div class="big gap"><span class="num">—</span><small>{{ 'codex.kpi.gapHint' | translate }}</small></div>
            }
            <p class="say">{{ tile.say }}</p>
          </div>
          <!-- No rank for this perspective = no ring: an empty gauge is a hole,
               the reading line above already says why. -->
          @if (tile.pct != null) {
            <div class="gauge" role="img" [attr.aria-label]="'codex.holo.stage.percentileAria' | translate: { p: tile.pct }">
              <svg viewBox="0 0 84 84" aria-hidden="true">
                <circle class="tr" cx="42" cy="42" r="36" />
                <circle class="va" cx="42" cy="42" r="36" [attr.stroke-dasharray]="ringDash(tile.pct)" />
                <text class="p" x="42" y="40">P{{ tile.pct }}</text>
                <text class="l" x="42" y="54">{{ tile.leadShortKey ? (tile.leadShortKey | translate) : '' }}</text>
              </svg>
            </div>
          }
        </div>
        @if (tile.subs.length > 0) {
          <div class="subs">
            @for (c of tile.subs; track c.key) {
              <div class="sv" [class.ghosted]="!!c.ghost">
                <span class="k">{{ c.shortKey | translate }}</span>
                <span class="v">{{ c.text }}</span>
                @if (c.ghost; as g) {
                  <span class="gv" [class.up]="g.tone === 'up'" [class.down]="g.tone === 'down'" [attr.title]="'codex.holo.stage.ghostTitle' | translate: { patch: g.patch }">{{ g.text }}</span>
                }
              </div>
            }
          </div>
        }
        <button type="button" class="tile-expand" (click)="toggleOpen(tile.id)" [attr.aria-expanded]="isOpen(tile.id)">
          {{ (isOpen(tile.id) ? 'codex.holo.stage.allValuesHide' : 'codex.holo.stage.allValues') | translate }}
        </button>
        @if (isOpen(tile.id)) {
          <div class="tile-full">
            @if (tile.id === 'offensive') {
              <sc-codex-offensive-panel [panel]="offensivePanel()" [startCollapsed]="false" />
            } @else if (tile.id === 'defensive') {
              <sc-codex-defensive-panel [panel]="defensivePanel()" />
            } @else {
              <sc-codex-ship-panel [groups]="shipFactGroups()" [startCollapsed]="false" />
            }
          </div>
        }
      </article>
    }
  `,
  styles: [`
    :host { display: grid; gap: 10px; align-content: start; min-width: 0;
      --f: var(--sc-fs-floor); --d: var(--sc-font-display); --m: var(--font-monospace, 'Share Tech Mono', monospace);
      --l1: var(--sc-border); --l2: var(--border-default, color-mix(in srgb, var(--sc-accent) 30%, transparent));
      --p-offensive: var(--sc-accent); --p-defensive: var(--cat-game, #c07888); --p-movement: var(--sc-success); --p-signature: var(--accent-gold, #c8a84b); }
    .sh, .pt-head, .big small, .gauge text.l, .sv .k, .tile-expand { font-family: var(--d); text-transform: uppercase; }
    .sh { display: flex; align-items: center; gap: 10px; font-size: max(9.5px, var(--f)); letter-spacing: 0.16em; color: var(--sc-accent); min-height: 28px; }
    .sh .t { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
    .sh .n { font-family: var(--m); font-size: max(10px, var(--f)); color: var(--sc-fg-1); background: var(--sc-bg-2); padding: 0 6px; border-radius: 2px; letter-spacing: 0; }
    .sh .ctx { font-family: var(--m); font-size: max(10px, var(--f)); letter-spacing: 0; text-transform: none; color: var(--sc-fg-1); }
    .rule { flex: 1; height: 1px; background: var(--l1); }
    .ptile { position: relative; display: grid; gap: 10px; padding: 12px 14px 10px 16px; border: 1px solid var(--l2); border-radius: 4px; overflow: hidden;
      background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-1) 70%, transparent), color-mix(in srgb, var(--sc-bg-0) 60%, transparent));
      transition: border-color 200ms ease; }
    .ptile:hover { border-color: color-mix(in srgb, var(--p) 55%, var(--l2)); }
    .ptile::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--p); box-shadow: 0 0 10px color-mix(in srgb, var(--p) 45%, transparent); }
    .ptile[data-p="offensive"] { --p: var(--p-offensive); }
    .ptile[data-p="defensive"] { --p: var(--p-defensive); }
    .ptile[data-p="movement"] { --p: var(--p-movement); }
    .ptile[data-p="signature"] { --p: var(--p-signature); }
    .ptile.pulse { animation: holo-pulse 900ms ease-out; }
    @keyframes holo-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--p) 55%, transparent); } 100% { box-shadow: 0 0 0 12px transparent; } }
    .pt-head { display: flex; align-items: baseline; gap: 10px; font-size: max(9.5px, var(--f)); letter-spacing: 0.16em; color: var(--sc-fg-0); }
    .pt-head .pp { font-family: var(--m); letter-spacing: 0; color: var(--p); font-size: max(10px, var(--f)); }
    .pt-head .prof { font-size: max(8.5px, var(--f)); color: var(--sc-fg-2); }
    .pt-main { display: grid; grid-template-columns: 1fr 84px; gap: 12px; align-items: center; }
    .pt-main.no-gauge { grid-template-columns: 1fr; }
    .pt-lead { display: grid; gap: 6px; min-width: 0; }
    .big { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .big .num { font-family: var(--m); font-size: 28px; line-height: 1; color: var(--sc-fg-0); }
    .big small { font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2); }
    .big .d { font-family: var(--m); font-size: 11px; padding: 1px 6px; border-radius: 2px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-1); }
    .big .d.up { color: var(--sc-success); background: color-mix(in srgb, var(--sc-success) 18%, transparent); }
    .big .d.down { color: var(--sc-danger); background: color-mix(in srgb, var(--sc-danger) 18%, transparent); }
    .big.gap .num { color: var(--sc-fg-2); }
    .ghost { font-family: var(--m); font-size: 11px; padding: 1px 6px; border-radius: 2px; border: 1px dashed var(--l2); color: var(--sc-fg-1); }
    .ghost.up { color: var(--sc-success); border-color: color-mix(in srgb, var(--sc-success) 55%, transparent); }
    .ghost.down { color: var(--sc-danger); border-color: color-mix(in srgb, var(--sc-danger) 55%, transparent); }
    .say { margin: 0; font-size: max(11.5px, var(--f)); line-height: 1.45; color: var(--sc-fg-1); }
    .gauge svg { width: 84px; height: 84px; display: block; }
    .gauge .tr { fill: none; stroke: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); stroke-width: 6; }
    .gauge .va { fill: none; stroke: var(--p); stroke-width: 6; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%;
      filter: drop-shadow(0 0 4px color-mix(in srgb, var(--p) 55%, transparent));
      transition: stroke-dasharray 600ms cubic-bezier(0.2, 0.7, 0.2, 1); animation: gauge-draw 900ms cubic-bezier(0.2, 0.7, 0.2, 1) 200ms backwards; }
    @keyframes gauge-draw { from { stroke-dasharray: 0 227; } }
    .gauge text.p { animation: gauge-num 500ms ease-out 400ms backwards; }
    @keyframes gauge-num { from { opacity: 0; } }
    .gauge text { text-anchor: middle; fill: var(--sc-fg-0); font-family: var(--m); font-size: 15px; }
    .gauge text.l { font-size: 6px; letter-spacing: 0.12em; fill: var(--sc-fg-2); }
    /* auto-fit: two sub-values share the row instead of leaving a hole. */
    .subs { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; }
    .sv { display: grid; gap: 2px; padding: 6px 8px; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); border-radius: 3px; min-width: 0; }
    .sv .k { font-size: max(8px, var(--f)); letter-spacing: 0.12em; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sv .v { font-family: var(--m); font-size: 14px; color: var(--sc-fg-0); white-space: nowrap; }
    .sv .gv { font-family: var(--m); font-size: 10.5px; color: var(--sc-fg-2); }
    .sv .gv.up { color: var(--sc-success); }
    .sv .gv.down { color: var(--sc-danger); }
    .sv.ghosted { border: 1px dashed var(--l2); }
    .tile-expand { justify-self: start; background: none; border: none; padding: 0; cursor: pointer; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2); min-height: var(--sc-tap-min, 24px); }
    .tile-expand:hover, .tile-expand[aria-expanded="true"] { color: var(--sc-accent); }
    .tile-full { border-top: 1px solid var(--l1); padding-top: 10px; animation: tile-open 280ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards; }
    @keyframes tile-open { from { opacity: 0; transform: translateY(-4px); } }
    @media (max-width: 640px) { .big .num { font-size: 22px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  `],
})
export class CodexHoloPerspectivesComponent {
  readonly tiles = input.required<readonly HoloPerspectiveView[]>();
  readonly missionLabelKey = input.required<string>();
  readonly cohortSize = input<number | null>(null);
  /** The tile that pulses after a port selection (concept pe4-pulse). */
  readonly pulse = input<Perspective | null>(null);
  readonly offensivePanel = input<OffensivePanel | null>(null);
  readonly defensivePanel = input<DefensivePanel | null>(null);
  readonly shipFactGroups = input<readonly ShipFactGroup[]>([]);

  private readonly openTiles = signal<ReadonlySet<Perspective>>(new Set());

  isOpen(id: Perspective): boolean {
    return this.openTiles().has(id);
  }
  toggleOpen(id: Perspective): void {
    const next = new Set(this.openTiles());
    next.has(id) ? next.delete(id) : next.add(id);
    this.openTiles.set(next);
  }

  /** stroke-dasharray for the r=36 ring: filled arc then the rest. */
  ringDash(pct: number): string {
    const c = 2 * Math.PI * 36;
    const on = (Math.max(0, Math.min(100, pct)) / 100) * c;
    return `${on.toFixed(1)} ${(c - on).toFixed(1)}`;
  }
}
