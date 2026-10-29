import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { logWarn } from '../core/log';
import { cleanLocaleValue, formatNumber, humanizeClassName } from '../codex/codex-format';
import {
  CodexListRow,
  CodexService,
  manufacturerLabel,
  pickLocalized,
  toLang,
} from '../codex/codex.service';
import { Lang, LocalizedText } from '../codex/codex.types';
import { armorSlotsFromLoadout } from '../codex/codex-landing-kpi';
import { CodexBoardFigureComponent } from '../codex/codex-board-figure.component';
import { StageArt, UpcomingShipsService } from '../codex/upcoming-ships.service';
import { CodexStageComponent } from '../codex/stage/codex-stage.component';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout } from '../hangar/hangar.types';
import { hqHangar, hqLocker, hqSet } from './hq-routes';

/**
 * The "Spot" stage on the HQ overview (moved 1:1 from the Codex landing,
 * concept 2026-10-29): ship ⅔ · person ⅓, each half an `sc-codex-stage` with
 * its hangar picker and archive quick-access line. Owns its own data loading
 * (current build, owned hulls, role label of the flagship), so the host page
 * only places `<sc-hq-spot-stage />`.
 *
 * Difference to the Codex landing: there is no Codex search bar on this page,
 * so the empty-hangar "search a ship" CTA is a real link into the Codex.
 */
@Component({
  selector: 'sc-hq-spot-stage',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CodexStageComponent, CodexBoardFigureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage-split">
      <sc-codex-stage
        kind="ship"
        class="stage-ship"
        [art]="stageShipArt()"
        [eyebrow]="stageShipRow() ? rowMfr(stageShipRow()!) : null"
        [eyebrowSuffix]="stageShipRoleSuffix()"
        [stageTitle]="stageShipTitle()"
        [routerLinkTo]="stageShipRow() ? ['/codex', 'ship', stageShipRow()!.classNameSlug] : (emptyHangar() ? [hangarLink] : null)"
        pickerKind="ship"
      >
        <nav stageArchive class="archive-line" [attr.aria-label]="'codex.landing.archive.label' | translate">
          @if (emptyHangar()) {
            <a class="archive-line__link stage-cta" [routerLink]="hangarLink">{{ 'codex.landing.cta.setupHangar' | translate }}</a>
            <a class="archive-line__link stage-cta stage-cta--ghost" routerLink="/codex">
              {{ 'codex.landing.cta.searchShip' | translate }}
            </a>
          }
          <span class="archive-line__eyebrow">{{ 'codex.landing.archive.label' | translate }}</span>
          <a class="archive-line__link" routerLink="/codex/index" [queryParams]="{ kind: 'ship' }">
            {{ 'codex.landing.archive.ships' | translate }}
            @if (archiveShipCount(); as ct) {
              <b class="mono">{{ formatNum(ct) }}</b>
            }
          </a>
          <a class="archive-line__link" routerLink="/codex/index" [queryParams]="{ kind: 'component' }">
            {{ 'codex.landing.archive.components' | translate }}
            @if (archiveComponentCount(); as ct) {
              <b class="mono">{{ formatNum(ct) }}</b>
            }
          </a>
          <a class="archive-line__link" routerLink="/codex/index"
             [queryParams]="{ kind: 'weapon', weaponClass: 'Ship' }">
            {{ 'codex.landing.archive.weapons' | translate }}
          </a>
        </nav>
      </sc-codex-stage>

      <sc-codex-stage
        kind="person"
        class="stage-person"
        [eyebrow]="stagePersonRoleLabel()"
        [eyebrowSuffix]="stagePersonEquipSuffix()"
        [stageTitle]="stagePersonTitle()"
        [routerLinkTo]="activeLoadout() ? setRoute(activeLoadout()!.id) : (loading() ? null : [lockerLink])"
        pickerKind="set"
      >
        <sc-codex-board-figure stageFigure [filled]="boardHero()" [decorative]="true" />
        <nav stageArchive class="archive-line amber" [attr.aria-label]="'codex.landing.archive.label' | translate">
          @if (!loading() && !activeLoadout()) {
            <a class="archive-line__link stage-cta" [routerLink]="lockerLink">{{ 'codex.landing.cta.createSet' | translate }}</a>
          }
          <span class="archive-line__eyebrow">{{ 'codex.landing.archive.label' | translate }}</span>
          <a class="archive-line__link" routerLink="/codex/index" [queryParams]="{ kind: 'armor' }">
            {{ 'codex.landing.archive.armor' | translate }}
          </a>
          <a class="archive-line__link" routerLink="/codex/fps" [queryParams]="{ cat: 'weapon' }">
            {{ 'codex.landing.archive.weapons' | translate }}
          </a>
        </nav>
      </sc-codex-stage>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .mono { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-variant-numeric: tabular-nums; }
      .stage-split {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 0;
        height: 400px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--sc-border);
      }
      .stage-ship, .stage-person { min-width: 0; min-height: 0; }
      .archive-line { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; }
      .archive-line__eyebrow {
        font-family: var(--sc-font-display);
        font-size: max(9px, var(--sc-fs-floor));
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(242, 247, 251, 0.32);
      }
      .archive-line__link {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        font-family: var(--sc-font-display);
        font-size: max(9px, var(--sc-fs-floor));
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(242, 247, 251, 0.45);
        text-decoration: none;
      }
      .archive-line__link:hover, .archive-line__link:focus-visible { color: #f2f7fb; outline: none; }
      .archive-line.amber .archive-line__link:hover,
      .archive-line.amber .archive-line__link:focus-visible { color: var(--amber, #f0c27b); }
      .archive-line__link b {
        font-family: var(--font-monospace, 'Share Tech Mono', monospace);
        font-weight: 400;
        color: var(--sc-accent);
      }
      .archive-line.amber .archive-line__link b { color: var(--amber, #f0c27b); }
      .archive-line__link.stage-cta {
        align-self: center;
        padding: 6px 10px;
        border: 1px solid var(--sc-accent);
        border-radius: var(--sc-radius-sm, 4px);
        background: color-mix(in srgb, var(--sc-accent) 14%, transparent);
        color: #f2f7fb;
        cursor: pointer;
      }
      .archive-line__link.stage-cta--ghost { background: transparent; border-color: var(--sc-border); }
      .archive-line.amber .archive-line__link.stage-cta { border-color: var(--amber, #f0c27b); background: color-mix(in srgb, var(--amber, #f0c27b) 14%, transparent); }
      .archive-line__link.stage-cta:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      @media (pointer: coarse) { .archive-line__link.stage-cta { min-height: 48px; align-items: center; } }
      @media (max-width: 520px) {
        .stage-split { grid-template-columns: 1fr; grid-template-rows: 300px 300px; height: auto; }
      }
    `,
  ],
})
export class HqSpotStageComponent implements OnInit {
  private readonly svc = inject(CodexService);
  private readonly hangar = inject(HangarService);
  private readonly auth = inject(AuthService);
  private readonly rsi = inject(UpcomingShipsService);
  private readonly t = inject(TranslateService);

  readonly hangarLink = hqHangar;
  readonly lockerLink = hqLocker;
  setRoute(id: string): string[] {
    return hqSet(id);
  }

  readonly loading = signal(true);
  readonly fleetRows = signal<CodexListRow[]>([]);
  readonly shipRoleResolved = signal<string | null>(null);

  readonly emptyHangar = computed(() => !this.loading() && this.fleetRows().length === 0);

  private readonly ownedClassNames = computed(() =>
    this.hangar
      .ships()
      .filter((s) => s.status === 'owned')
      .map((s) => s.shipClassName),
  );

  readonly flagshipRow = computed<CodexListRow | null>(() => {
    const rows = this.fleetRows();
    const flagship = this.hangar.flagshipClassName();
    if (flagship) {
      const match = rows.find((r) => r.classNameSlug === flagship);
      if (match) return match;
    }
    return rows[0] ?? null;
  });

  readonly stageShipRow = computed<CodexListRow | null>(() => this.flagshipRow());

  readonly stageShipTitle = computed(() => {
    const row = this.stageShipRow();
    if (row) return this.rowName(row);
    return this.loading() ? '' : this.t.instant('codex.landing.fleet.empty');
  });

  readonly stageShipArt = computed<StageArt | null>(() => {
    const row = this.stageShipRow();
    if (!row) return null;
    const art = this.rsi.stageArtFor(row.nameLocalized ?? this.rowName(row));
    const p = row.payload as { previewImage?: string | null } | null;
    const local = this.svc.previewUrl(p?.previewImage);
    if (!art.src) return local ? { src: local, fallbacks: [] } : null;
    return local ? { src: art.src, fallbacks: [...art.fallbacks, local] } : art;
  });

  readonly stageShipRoleSuffix = computed<string | null>(() => {
    const role = this.shipRoleResolved();
    return this.stageShipRow() && role ? `· ${role}` : null;
  });

  readonly activeLoadout = computed<HangarRoleLoadout | null>(() => this.hangar.recentSets()[0] ?? null);

  readonly boardHero = computed<ReadonlySet<string>>(
    () =>
      new Set(
        armorSlotsFromLoadout(this.activeLoadout()?.items ?? [])
          .filter((s) => s.className)
          .map((s) => s.roleSlot),
      ),
  );

  readonly stagePersonTitle = computed(
    () => this.activeLoadout()?.name ?? this.t.instant('codex.landing.me.uncommissioned'),
  );

  readonly stagePersonRoleLabel = computed(() => {
    const loadout = this.activeLoadout();
    return loadout
      ? this.t.instant('hangar.roles.' + loadout.role)
      : this.t.instant('codex.landing.me.eyebrow');
  });

  readonly stagePersonEquipSuffix = computed(
    () => '· ' + this.t.instant('codex.stage.armorEquipped', { filled: this.boardHero().size, total: 6 }),
  );

  private archiveCount(plural: 'ships' | 'components'): number | null {
    const counts = this.svc.build()?.entityCounts as
      | (Record<string, number> & { seeded?: Record<string, number> })
      | undefined;
    if (!counts) return null;
    const v = counts.seeded?.[plural] ?? counts[plural];
    return typeof v === 'number' ? v : null;
  }

  readonly archiveShipCount = computed(() => this.archiveCount('ships'));
  readonly archiveComponentCount = computed(() => this.archiveCount('components'));

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      await this.svc.loadCurrentBuild();
      void this.rsi.ensureLoaded();
      if (this.auth.user() && this.hangar.ships().length === 0) await this.hangar.loadAll();
      await this.resolveFleet();
    } catch (error) {
      // Decorative on this page; the overview's own error card covers hangar failures.
      logWarn('hq', 'spot stage failed', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async resolveFleet(): Promise<void> {
    const names = this.ownedClassNames();
    if (names.length === 0) {
      this.fleetRows.set([]);
      this.shipRoleResolved.set(null);
      return;
    }
    const byName = await this.svc.getShipsByClassNames(names);
    this.fleetRows.set(names.map((n) => byName.get(n)).filter((r): r is CodexListRow => !!r));
    const ship = this.flagshipRow();
    if (!ship) return;
    if (ship.role?.startsWith('@')) {
      try {
        const m = await this.svc.resolveLocaleKeys([ship.role], this.lang());
        this.shipRoleResolved.set(cleanLocaleValue(m.get(ship.role)) || null);
      } catch (error) {
        logWarn('hq', 'ship role label failed', error);
        this.shipRoleResolved.set(null);
      }
    } else {
      this.shipRoleResolved.set(cleanLocaleValue(ship.role) || null);
    }
  }

  rowName(r: CodexListRow): string {
    const p = r.payload as { name?: LocalizedText } | null;
    const localized = p?.name ? pickLocalized(p.name, this.lang()) : '';
    return localized || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  rowMfr(r: CodexListRow): string | null {
    return manufacturerLabel(r, this.lang());
  }

  formatNum(v: number): string {
    return formatNumber(v);
  }

  private lang(): Lang {
    return toLang(this.t.getCurrentLang() ?? this.t.getFallbackLang());
  }
}
