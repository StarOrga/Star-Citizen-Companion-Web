import { ChangeDetectionStrategy, Component, effect, input, untracked, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { formatNumber } from './codex-format';
import { DefensivePanel, OffensivePanel } from './codex-loadout-stats';

/** Panel-local collapse: opens by default, resets whenever the mission asks it to fold. */
function useCollapse(startCollapsed: () => boolean) {
  const open = signal(true);
  effect(() => {
    const collapsed = startCollapsed();
    untracked(() => open.set(!collapsed));
  });
  return open;
}

const DAMAGE_CHANNEL_COLORS: Readonly<Record<string, string>> = {
  physical: '#c9a15a',
  energy: '#4fb3e0',
  distortion: '#a76ee0',
  thermal: '#e0654f',
  biochemical: '#5fbf6a',
  stun: '#e0d24f',
};

const PANEL_STYLES = `
  :host { display: block; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; margin: 0;
    font-size: 15px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--sc-accent); list-style: none; }
  .panel-head::-webkit-details-marker { display: none; }
  .fold-hint { margin-left: auto; font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: none; letter-spacing: normal;
    color: var(--sc-fg-2); font-style: italic; }
  .panel-hint { margin: 2px 0 12px; font-size: 13px; color: var(--sc-fg-2); }
  .chev { transition: transform 0.15s ease; }
  .chev.open { transform: rotate(90deg); }
  .gap-row { font-size: 13px; color: var(--sc-fg-2); }
  /* A weapon table is the widest thing on the page: five columns plus class
     names like APAR_BallisticGatling_S4, which have no break opportunity. Its
     min-content width used to become the floor for the whole detail page and
     scrolled it sideways on a phone (feedback 2c7ed0d0). The names may now
     break, and whatever is still too wide scrolls inside its own wrapper
     instead of taking the page with it. */
  .table-wrap { overflow-x: auto; }
  table.analysis-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; }
  table.analysis-table th, table.analysis-table td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--sc-border); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  table.analysis-table tfoot td { font-weight: 600; color: var(--sc-fg-0); }
  .dmg-bars { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
  .dmg-bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .dmg-bar-track { flex: 1; height: 8px; border-radius: 4px; background: var(--sc-bg-2); overflow: hidden; }
  .dmg-bar-fill { height: 100%; border-radius: 4px; }
  .warn-note { color: var(--sc-warn, #e8a33d); font-size: 12px; margin: 4px 0; }
  h3.section-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--sc-fg-1); margin: 14px 0 6px; }
  dl.fact-grid { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 4px 0; }
  dl.fact-grid dt { color: var(--sc-fg-2); font-size: 12px; }
  dl.fact-grid dd { margin: 0; font-variant-numeric: tabular-nums; }
  .note { font-size: 12px; color: var(--sc-fg-2); margin: 4px 0; }
`;

/** Waffen / Raketen — offensive read-out for the active loadout (PR C). */
@Component({
  selector: 'sc-codex-offensive-panel',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="sc-card block" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary class="panel-head">
        {{ 'codex.analysis.offensive.title' | translate }}
        <span class="fold-hint">{{ 'codex.analysis.readHint' | translate }}</span>
        <span class="chev" [class.open]="open()" aria-hidden="true">›</span>
      </summary>
      @if (hint(); as h) { <p class="panel-hint">{{ h }}</p> }
      @if (open()) {
        @if (panel(); as p) {
          @if (p.gapKeys.includes('codex.summary.gap.noStockGuns')) {
            <p class="gap-row">{{ 'codex.summary.gap.noStockGuns' | translate }}</p>
          } @else {
            <h3 class="section-title">{{ 'codex.analysis.offensive.weapons' | translate: { count: p.weaponCount } }}</h3>
            <div class="table-wrap">
            <table class="analysis-table">
              <thead>
                <tr>
                  <th>{{ 'codex.analysis.offensive.colWeapon' | translate }}</th>
                  <th>{{ 'codex.analysis.offensive.colSize' | translate }}</th>
                  @if (p.hasAlphaColumn) { <th>{{ 'codex.analysis.offensive.colAlpha' | translate }}</th> }
                  @if (p.hasDpsColumn) { <th>{{ 'codex.analysis.offensive.colSustained' | translate }}</th> }
                  @if (p.hasDpsColumn) { <th>{{ 'codex.analysis.offensive.colBurst' | translate }}</th> }
                </tr>
              </thead>
              <tbody>
                @for (r of p.weaponRows; track $index) {
                  <tr>
                    <td>{{ r.className }}</td>
                    <td>{{ r.size != null ? 'S' + r.size : '—' }}</td>
                    @if (p.hasAlphaColumn) { <td>{{ r.alpha != null ? num(r.alpha) : '—' }}</td> }
                    @if (p.hasDpsColumn) { <td>{{ r.sustainedDps != null ? num(r.sustainedDps) : '—' }}</td> }
                    @if (p.hasDpsColumn) { <td>{{ r.burstDps != null ? num(r.burstDps) : '—' }}</td> }
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>{{ 'codex.analysis.offensive.total' | translate }}</td>
                  <td></td>
                  @if (p.hasAlphaColumn) { <td>{{ p.footerAlpha != null ? num(p.footerAlpha) : '—' }}</td> }
                  @if (p.hasDpsColumn) { <td>{{ p.footerDps != null ? num(p.footerDps) : '—' }}</td> }
                  @if (p.hasDpsColumn) { <td>{{ p.footerDps != null ? num(p.footerDps) : '—' }}</td> }
                </tr>
              </tfoot>
            </table>
            </div>

            @if (p.damageChannelTotals.length > 0) {
              <div class="dmg-bars">
                @for (c of p.damageChannelTotals; track c.channel) {
                  <div class="dmg-bar-row">
                    <span>{{ ('codex.damageChannel.' + c.channel) | translate }}</span>
                    <span class="dmg-bar-track">
                      <span class="dmg-bar-fill" [style.width.%]="pctOf(c.value, p.damageChannelTotals)" [style.background]="colorOf(c.channel)"></span>
                    </span>
                    <span>{{ num(c.value) }}</span>
                  </div>
                }
              </div>
            }

            <dl class="fact-grid">
              @if (p.effectiveRange != null) {
                <dt>{{ 'codex.analysis.offensive.effectiveRange' | translate }}</dt>
                <dd>{{ num(p.effectiveRange) }} m</dd>
              }
              @if (p.projectileSpeed != null) {
                <dt>{{ 'codex.analysis.offensive.projectileSpeed' | translate }}</dt>
                <dd>{{ num(p.projectileSpeed) }} m/s</dd>
              }
            </dl>
            @if (p.longestRangeGun) {
              <p class="note">{{ 'codex.analysis.offensive.longestGunNote' | translate: { name: p.longestRangeGun } }}</p>
            }
            @if (p.mixedRangeWarning) {
              <p class="warn-note">{{ 'codex.analysis.offensive.mixedRangeWarning' | translate }}</p>
            }
          }

          @if (p.missileCount > 0) {
            <h3 class="section-title">{{ 'codex.analysis.offensive.missiles' | translate: { count: p.missileCount } }}</h3>
            <dl class="fact-grid">
              @if (p.missileSalvoDamage != null) {
                <dt>{{ 'codex.analysis.offensive.salvoDamage' | translate }}</dt>
                <dd>{{ num(p.missileSalvoDamage) }}</dd>
              }
              @if (p.missileLockTime != null) {
                <dt>{{ 'codex.analysis.offensive.lockTime' | translate }}</dt>
                <dd>{{ num(p.missileLockTime) }} s</dd>
              }
              @if (p.missileRange != null) {
                <dt>{{ 'codex.analysis.offensive.range' | translate }}</dt>
                <dd>{{ num(p.missileRange) }} m</dd>
              }
              @if (p.missileSignalTypes.length > 0) {
                <dt>{{ 'codex.analysis.offensive.targeting' | translate }}</dt>
                <dd>{{ p.missileSignalTypes.join(', ') }}</dd>
              }
            </dl>
            @if (p.missileLockNoteSlowest) {
              <p class="note">{{ 'codex.analysis.offensive.slowestMissileNote' | translate }}</p>
            }
          }
        }
      }
    </details>
  `,
  styles: [PANEL_STYLES],
})
export class CodexOffensivePanelComponent {
  readonly panel = input.required<OffensivePanel | null>();
  readonly startCollapsed = input<boolean>(false);
  readonly open = useCollapse(() => this.startCollapsed());

  hint(): string | null {
    const p = this.panel();
    if (!p || (p.footerDps == null && p.missileSalvoDamage == null)) return null;
    const parts: string[] = [];
    if (p.footerDps != null) parts.push(`${this.num(p.footerDps)} DPS`);
    if (p.footerAlpha != null) parts.push(`${this.num(p.footerAlpha)} Alpha`);
    return parts.join(' · ') || null;
  }

  num(v: number): string {
    return formatNumber(v);
  }

  colorOf(channel: string): string {
    return DAMAGE_CHANNEL_COLORS[channel] ?? 'var(--sc-accent)';
  }

  pctOf(v: number, all: { channel: string; value: number }[]): number {
    const total = all.reduce((s, c) => s + c.value, 0);
    return total > 0 ? (v / total) * 100 : 0;
  }
}

/** Schild / Rumpf & Panzerung — survivability read-out (PR C). */
@Component({
  selector: 'sc-codex-defensive-panel',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="sc-card block" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary class="panel-head">
        {{ 'codex.analysis.defensive.title' | translate }}
        <span class="fold-hint">{{ 'codex.analysis.readHint' | translate }}</span>
        <span class="chev" [class.open]="open()" aria-hidden="true">›</span>
      </summary>
      @if (open() && panel(); as p) {
        <h3 class="section-title">{{ 'codex.analysis.defensive.shield' | translate }}</h3>
        @if (p.shieldGeneratorCount === 0) {
          <p class="gap-row">{{ 'codex.summary.gap.noShields' | translate }}</p>
        } @else {
          <dl class="fact-grid">
            @if (p.shieldHp != null) { <dt>{{ 'codex.analysis.defensive.hp' | translate }}</dt><dd>{{ num(p.shieldHp) }}</dd> }
            @if (p.shieldRegen != null) { <dt>{{ 'codex.analysis.defensive.regen' | translate }}</dt><dd>{{ num(p.shieldRegen) }}/s</dd> }
            @if (p.fullInSeconds != null) { <dt>{{ 'codex.analysis.defensive.fullIn' | translate }}</dt><dd>{{ num(p.fullInSeconds) }} s</dd> }
            @if (p.regenDelay != null) { <dt>{{ 'codex.analysis.defensive.regenDelay' | translate }}</dt><dd>{{ num(p.regenDelay) }} s</dd> }
            @if (p.downedDelay != null) { <dt>{{ 'codex.analysis.defensive.downedDelay' | translate }}</dt><dd>{{ num(p.downedDelay) }} s</dd> }
          </dl>
          @if (p.mixedGeneratorNote) { <p class="warn-note">{{ 'codex.analysis.defensive.mixedGeneratorNote' | translate }}</p> }
          <h3 class="section-title">{{ 'codex.analysis.defensive.resistance' | translate }}</h3>
          @if (p.resistances.length > 0) {
            <div class="dmg-bars">
              @for (r of p.resistances; track r.channel) {
                <div class="dmg-bar-row">
                  <span>{{ ('codex.damageChannel.' + r.channel) | translate }}</span>
                  <span class="dmg-bar-track"><span class="dmg-bar-fill" [style.width.%]="r.pct" style="background: var(--sc-accent)"></span></span>
                  <span>{{ num(r.pct) }} %</span>
                </div>
              }
            </div>
          } @else {
            <p class="gap-row">{{ 'codex.summary.gap.noResistances' | translate }}</p>
          }
        }

        <h3 class="section-title">{{ 'codex.analysis.defensive.hull' | translate }}</h3>
        <p class="gap-row">{{ 'codex.summary.gap.noHullMass' | translate }}</p>
        @if (p.armor; as a) {
          <dl class="fact-grid">
            @if (a.reductionPhysicalPct != null) { <dt>{{ 'codex.analysis.defensive.armorPhysical' | translate }}</dt><dd>{{ num(a.reductionPhysicalPct) }} %</dd> }
            @if (a.reductionEnergyPct != null) { <dt>{{ 'codex.analysis.defensive.armorEnergy' | translate }}</dt><dd>{{ num(a.reductionEnergyPct) }} %</dd> }
            @if (a.reductionDistortionPct != null) { <dt>{{ 'codex.analysis.defensive.armorDistortion' | translate }}</dt><dd>{{ num(a.reductionDistortionPct) }} %</dd> }
            <!-- absolute values, NOT multipliers — no % suffix, no reduction math -->
            @if (a.penetrationReduction != null) { <dt>{{ 'codex.analysis.defensive.armorPenetration' | translate }}</dt><dd>{{ num(a.penetrationReduction) }}</dd> }
            @if (a.deflectionPhysical != null) { <dt>{{ 'codex.analysis.defensive.armorDeflectionPhysical' | translate }}</dt><dd>{{ num(a.deflectionPhysical) }}</dd> }
            @if (a.deflectionEnergy != null) { <dt>{{ 'codex.analysis.defensive.armorDeflectionEnergy' | translate }}</dt><dd>{{ num(a.deflectionEnergy) }}</dd> }
          </dl>
        } @else {
          <p class="note">{{ 'codex.analysis.defensive.noArmorData' | translate }}</p>
        }

        @if (p.effectiveHp == null) {
          <h3 class="section-title">{{ 'codex.analysis.defensive.effectiveHp' | translate }}</h3>
          <p class="gap-row">{{ 'codex.analysis.defensive.effectiveHpGap' | translate }}</p>
        }
      }
    </details>
  `,
  styles: [PANEL_STYLES],
})
export class CodexDefensivePanelComponent {
  readonly panel = input.required<DefensivePanel | null>();
  readonly startCollapsed = input<boolean>(false);
  readonly open = useCollapse(() => this.startCollapsed());

  num(v: number): string {
    return formatNumber(v);
  }
}

/** Flugleistung / Masse / Systeme / Signatur / Rumpf — the ship-level facts panel. */
export interface ShipFactRow {
  labelKey: string;
  value: string | null;
  gapKey?: string | null;
}

export interface ShipFactGroup {
  titleKey: string;
  rows: ShipFactRow[];
  note?: string | null;
}

@Component({
  selector: 'sc-codex-ship-panel',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="sc-card block" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary class="panel-head">
        {{ 'codex.analysis.ship.title' | translate }}
        <span class="fold-hint">{{ 'codex.analysis.readHint' | translate }}</span>
        <span class="chev" [class.open]="open()" aria-hidden="true">›</span>
      </summary>
      @if (open()) {
        @for (g of groups(); track g.titleKey) {
          <h3 class="section-title">{{ g.titleKey | translate }}</h3>
          <dl class="fact-grid">
            @for (r of g.rows; track r.labelKey) {
              <dt>{{ r.labelKey | translate }}</dt>
              <dd [attr.title]="r.value == null && r.gapKey ? (r.gapKey | translate) : null">{{ r.value ?? '—' }}</dd>
            }
          </dl>
          @if (g.note) { <p class="note">{{ g.note }}</p> }
        }
      }
    </details>
  `,
  styles: [PANEL_STYLES],
})
export class CodexShipPanelComponent {
  readonly groups = input.required<readonly ShipFactGroup[]>();
  readonly startCollapsed = input<boolean>(false);
  readonly open = useCollapse(() => this.startCollapsed());
}
