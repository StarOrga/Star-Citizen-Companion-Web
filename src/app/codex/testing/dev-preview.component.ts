// DEV-ONLY PREVIEW — NOT FOR COMMIT.
// The ship page lives behind the auth wall, so the mobile gate and every
// headless browser check only ever see the login redirect. This harness mounts
// the redesigned regions on a PUBLIC route with the Nomad fixture so they can
// be screenshotted and audited for real. Delete before shipping.
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CodexEnergyDockComponent } from '../codex-energy-dock.component';
import { CodexRankCardComponent } from '../codex-rank-card.component';
import { CodexKpiBandComponent } from '../codex-kpi-band.component';
import { NOMAD_SHIP_STATS, nomadOccupants } from './nomad-power.fixture';
import type { KpiStripCell } from '../codex-kpi-sets';
import type { RankResult } from '../codex-rank';

const KPIS: KpiStripCell[] = [
  { key: 'alpha', labelKey: 'codex.kpi.short.alpha', format: 'int', value: 131, delta: null, accent: true, gapKey: null, lowerIsBetter: false, tooltipKey: null, fromPower: false },
  { key: 'burstDps', labelKey: 'codex.kpi.short.burstDps', format: 'int', value: 1637, delta: null, accent: false, gapKey: null, lowerIsBetter: false, tooltipKey: 'codex.kpi.tooltipBurstDps', fromPower: false },
  { key: 'sustainedDps', labelKey: 'codex.kpi.short.sustainedDps', format: 'int', value: 837, delta: { direction: 'up', good: true, pctText: '+11%', raw: 81 }, accent: false, gapKey: null, lowerIsBetter: false, tooltipKey: 'codex.kpi.tooltipSustainedDps', fromPower: false },
  { key: 'missiles', labelKey: 'codex.kpi.short.missiles', format: 'int', value: 12800, delta: null, accent: false, gapKey: null, lowerIsBetter: false, tooltipKey: null, fromPower: false },
  { key: 'shieldHp', labelKey: 'codex.kpi.short.shieldHp', format: 'int', value: 6480, delta: null, accent: false, gapKey: null, lowerIsBetter: false, tooltipKey: null, fromPower: false },
  { key: 'hullHp', labelKey: 'codex.kpi.short.hullHp', format: 'int', value: null, delta: null, accent: false, gapKey: 'codex.summary.gap.noHullHp', lowerIsBetter: false, tooltipKey: null, fromPower: false },
] as unknown as KpiStripCell[];

const axis = (key: string, labelKey: string, value: number, percentile: number) => ({
  key, labelKey, lowerIsBetter: false, value, percentile,
  medianValue: value * 0.9, cohortCount: 111, weak: percentile < 45,
});

const RANK: RankResult = {
  profileId: 'combat', scope: 'all', scopeFallbackKey: null, cohortSize: 111,
  axes: [
    axis('missiles', 'codex.rank.axis.missiles', 12800, 76),
    axis('alpha', 'codex.rank.axis.alpha', 131, 50),
    axis('sustainedDps', 'codex.rank.axis.sustainedDps', 837, 44),
    axis('shieldHp', 'codex.rank.axis.shield', 6480, 41),
    axis('boost', 'codex.rank.axis.boost', 450, 31),
    axis('agility', 'codex.rank.axis.agility', 45, 21),
  ],
  overall: 45, band: 'mid', bandKey: 'codex.rank.band.mid',
  medianPolygon: [60, 55, 52, 50, 48, 45],
} as unknown as RankResult;

@Component({
  selector: 'sc-dev-preview',
  standalone: true,
  imports: [TranslateModule, CodexEnergyDockComponent, CodexRankCardComponent, CodexKpiBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <h1>Ship page regions — fixture preview</h1>

      <h2>KPI strip (6 cells, one gap, one delta)</h2>
      <sc-codex-kpi-band [cells]="kpis" />

      <h2>Einordnung (rank card)</h2>
      <div class="half"><sc-codex-rank-card [shipName]="'Nomad'" [result]="rank" [profile]="'combat'" [scope]="'all'" /></div>

      <h2>Einordnung — gap state</h2>
      <div class="half"><sc-codex-rank-card [shipName]="'Nomad'" [result]="null" [loading]="false" /></div>

      <h2>Energy dock — schema 3 (live data)</h2>
      <sc-codex-energy-dock [occupants]="occupants" [shipStats]="shipStats" [shipClassName]="'CNOU_Nomad'"
                            [schemaVersion]="3" [userId]="'dev'" [crossSection]="9712" />

      <h2>Energy dock — schema 2 (gap state, what production shows today)</h2>
      <sc-codex-energy-dock [occupants]="occupants" [shipStats]="shipStats" [shipClassName]="'CNOU_Nomad_v2'"
                            [schemaVersion]="2" [userId]="'dev'" [crossSection]="9712" />
      <div class="spacer"></div>
    </div>
  `,
  styles: [`
    .wrap { padding: 1rem; max-width: 1500px; margin: 0 auto; }
    h1 { font-size: 1.2rem; color: var(--sc-accent); }
    h2 { font-size: .85rem; text-transform: uppercase; letter-spacing: .12em; color: var(--sc-fg-2); margin: 2rem 0 .5rem; }
    .half { max-width: 50%; }
    @media (max-width: 1100px) { .half { max-width: 100%; } }
    .spacer { height: 40vh; }
  `],
})
export class DevPreviewComponent {
  readonly kpis = KPIS;
  readonly rank = RANK;
  readonly occupants = nomadOccupants();
  readonly shipStats = NOMAD_SHIP_STATS as unknown as Record<string, Record<string, string | number | boolean | null>>;
  readonly _unused = signal(0);
}
