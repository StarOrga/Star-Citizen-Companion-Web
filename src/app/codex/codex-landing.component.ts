import { logWarn } from '../core/log';
import { toErrorKey } from '../core/describe-error';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { reloadOnBuildRefresh } from './build-refresh.util';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
  CodexListRow,
  CodexService,
  manufacturerLabel,
  pickLocalized,
  toLang,
} from './codex.service';
import { cleanLocaleValue, formatNumber, humanizeClassName } from './codex-format';
import { LocalizedText, Lang } from './codex.types';
import { CodexPatchHeadlineComponent } from './codex-patch-headline.component';
import { CodexStageComponent } from './stage/codex-stage.component';
import { HangarPickerItem } from './stage/hangar-picker.component';
import { CodexBoardFigureComponent } from './codex-board-figure.component';
import { totalRecordCount } from './codex-patch-timeline';
import { ShipStatDelta } from './codex-build-diff';
import {
  ArmorSlotState,
  armorSlotsFromLoadout,
  sortByRecency,
  withSelectedFirst,
} from './codex-landing-kpi';

import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { StageArt, UpcomingShipsService } from './upcoming-ships.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout } from '../hangar/hangar.types';
import { AuthService } from '../auth/auth.service';
import { AppDownloadMenuComponent } from '../desktop/app-download-menu.component';
import { formatScDate } from '../core/locale/date-format';
import { LocaleService } from '../core/locale/locale.service';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { CodexSearchBarComponent } from './search/codex-search-bar.component';

/**
 * The Codex landing — the "Spot" stage (concept 2026-09-20, rounds 14-17,
 * N6 scope). Replaces the old AN BORD ⇄ IM HANGAR switcher (feedback
 * e80cc831/77668f11) with a fixed-height split stage that shows BOTH planes
 * at once, ship ⅔ left / person ⅓ right:
 *   ship stage    — the flagship's (or picker-selected) RSI render, bbox-fit
 *                   and masked (`sc-codex-stage`), manufacturer/role/name
 *                   bottom-left, the whole picture a routerLink into the
 *                   ship page.
 *   person stage  — the shared field/key-light construction with the 3D
 *                   hard-suit figure (`sc-codex-board-figure`), the active
 *                   role-loadout's name + equipped fraction.
 * Each stage carries its own `sc-hangar-picker` (top-left, in-picture) that
 * switches the stage's subject among the 3 most recently chosen ships/sets
 * without navigating, and its own archive quick-access line along the
 * bottom. See `stage/codex-stage.component.ts` and
 * `stage/hangar-picker.component.ts`.
 *
 * The six-slot paperdoll is superseded here; the set page (`/codex/set/:id`,
 * T1) configures the person — its masthead stage (`sc-codex-set-stage`) puts
 * the six armour slots around the one figure (AUD-065 retired the old
 * `sc-codex-board-panel`).
 */
@Component({
  selector: 'sc-codex-landing',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    CodexCompareTrayComponent,
    AppDownloadMenuComponent,
    CodexPatchHeadlineComponent,
    CodexStageComponent,
    CodexBoardFigureComponent,
    ScTooltipDirective,
    CodexSearchBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="landing">
      <h1 class="sc-sr-only">{{ 'codex.title' | translate }}</h1>
      <!-- ── TOP: Archive Terminal + patch headline + app menu ──────────────── -->
      <header class="terminal">
        <!-- The ONE Codex search (also behind Ctrl+K and above every other
             Codex page). Activated, it spans this whole row and leads the page. -->
        <sc-codex-search-bar #searchBar class="terminal-search" variant="terminal" [query]="routeQuery()" />

        <!-- ONE headline (admin feedback 463872dd): the patch that produced
             everything below it. Round two of that feedback dropped the
             playable state from this line — the header chip already reports
             "Spielbar" on every page, so saying it twice cost the headline its
             own subject. The patch doubles as the page's quiet time machine
             (last 5 patches, five more per page, data-less ones marked). -->
        <sc-codex-patch-headline (patchChange)="reload()" />

        <ng-template #codexProvenance>
          @if (svc.build(); as b) {
            @if (archiveRecordCount(); as count) {
              <span>{{ 'codex.landing.patch.archive' | translate: { count: formatNum(count) } }}</span>
            }
            @if (extractedAtLabel(); as date) {
              <span>{{ 'codex.landing.patch.extracted' | translate: { date } }}</span>
            }
            <span>{{ 'codex.landing.patch.build' | translate: { build: b.buildNumber } }}</span>
          }
        </ng-template>

        <!-- Keybindings — moved off the retired "Im Versum" band onto the
             terminal row (prio 2): the terminal is where a returning player
             already looks for a tool, and it survives the band's removal
             untouched. -->
        <a
          class="terminal-tool"
          routerLink="/codex/keybinds"
          [attr.aria-label]="'codex.landing.terminal.keybinds' | translate"
          [scTooltip]="'codex.landing.terminal.keybinds' | translate"
          scTooltipTier="label"
        >
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 3a5 5 0 0 0-4.9 6.1L3 15.2V19h3.8l1-1h2v-2h2l1.1-1.1A5 5 0 1 0 14 3z" />
            <circle cx="16.6" cy="7.4" r="1.1" />
          </svg>
        </a>

        <!-- Far right of the terminal row: the Data-Uploader download control.
             Collaborator+ only, so a viewer sees nothing here and the
             Verse-online pill ends the row. Same component as the Starscape one
             in /starscape, on purpose — one control, two homes. -->
        <sc-app-download-menu
          class="terminal-menu"
          [product]="'uploader'"
          [extra]="codexProvenance" />
      </header>

      @if (error(); as err) {
        <div class="sc-card err" role="alert">
          <p>{{ 'codex.error.title' | translate }} — {{ err | translate }}</p>
          <button type="button" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      }

      <!-- ── STAGE: ship ⅔ · person ⅓ — the Codex "Spot" stage ────────────────
           Concept 2026-09-20, rounds 14-17 (N6 scope). Replaces the old AN
           BORD ⇄ IM HANGAR switcher (feedback e80cc831/77668f11 are now moot:
           there is no toggle, both stages render at once, fixed height).
           Each half is <sc-codex-stage>: the RSI render (ship) or the shared
           field + figure (person) bbox-fit and masked so the source's own
           nebula frames it — see codex-stage.component.ts. The HangarPicker
           ("⌂ Hangar" / "⛨ Sets") lives INSIDE the picture, top-left, and
           switches the stage's subject without navigating (M1-M6, N1-N3). -->
      <div class="stage-split">
        <sc-codex-stage
          kind="ship"
          class="stage-ship"
          [art]="stageShipArt()"
          [eyebrow]="stageShipRow() ? rowMfr(stageShipRow()!) : null"
          [eyebrowSuffix]="stageShipRoleSuffix()"
          [stageTitle]="stageShipTitle()"
          [routerLinkTo]="stageShipRow() ? ['/codex', 'ship', stageShipRow()!.classNameSlug] : (emptyHangar() ? ['/hangar'] : null)"
          pickerKind="ship"
          [pickerItems]="shipPickerItems()"
          (pick)="onShipPick($event)"
          (open)="onHangarOpen()"
        >
          <nav stageArchive class="archive-line" [attr.aria-label]="'codex.landing.archive.label' | translate">
            <!-- Empty hangar (new or signed-out user, audit L24): the panel says
                 where to go instead of leaving a dead dark area. -->
            @if (emptyHangar()) {
              <a class="archive-line__link stage-cta" routerLink="/hangar">{{ 'codex.landing.cta.setupHangar' | translate }}</a>
              <button type="button" class="archive-line__link stage-cta stage-cta--ghost" (click)="focusTerminal()">
                {{ 'codex.landing.cta.searchShip' | translate }}
              </button>
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
          [routerLinkTo]="activeLoadout() ? ['/codex', 'set', activeLoadout()!.id] : (loading() ? null : ['/hangar'])"
          pickerKind="set"
          [pickerItems]="setPickerItems()"
          (pick)="onSetPick($event)"
          (open)="onHangarOpen()"
        >
          <sc-codex-board-figure stageFigure [filled]="boardHero()" [decorative]="true" />
          <nav stageArchive class="archive-line amber" [attr.aria-label]="'codex.landing.archive.label' | translate">
            <!-- "Unkommissioniert" = no FPS set yet; sets are created on the hangar page. -->
            @if (!loading() && !activeLoadout()) {
              <a class="archive-line__link stage-cta" routerLink="/hangar">{{ 'codex.landing.cta.createSet' | translate }}</a>
            }
            <span class="archive-line__eyebrow">{{ 'codex.landing.archive.label' | translate }}</span>
            <a class="archive-line__link" routerLink="/codex/fps" [queryParams]="{ cat: 'armor' }">
              {{ 'codex.landing.archive.armor' | translate }}
            </a>
            <a class="archive-line__link" routerLink="/codex/fps" [queryParams]="{ cat: 'weapon' }">
              {{ 'codex.landing.archive.weapons' | translate }}
            </a>
          </nav>
        </sc-codex-stage>
      </div>

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [
    `
      /* The full page frame, like every other page (styles.scss, "PAGE FRAME").
         The landing opens on the terminal's hard edge rather than a heading, so
         it takes the shared --sc-page-lead; the 96px at the bottom keep the
         last row clear of the fixed compare tray. */
      .landing {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: var(--sc-page-lead) 0 96px;
      }
      .icon { width: 100%; height: 100%; display: block; }
      .mono { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-variant-numeric: tabular-nums; }

      /* ── Archive Terminal ─────────────────────────────────────────────── */
      .terminal {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }
      /* The search bar takes the row's free width; activated, it positions
         itself against the whole row (position: relative here). */
      .terminal { position: relative; }
      .terminal-search { flex: 1 1 340px; min-width: 0; }

      /* The patch headline is its own component (sc-codex-patch-headline) — it
         owns the pill chrome and the patch-switch overlay. Only its slot in the
         row is ours. */
      sc-codex-patch-headline { flex: 0 0 auto; }

      /* Far-right slot: never stretch, never wrap mid-control. The menu owns
         its own overlay positioning (sc-app-download-menu). */
      .terminal-menu { flex: 0 0 auto; }

      /* Keybindings entry, formerly the "Im Versum" band's rail-icon — same
         glyph, same 44px target, now a row-mate of the download menu. */
      .terminal-tool {
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        min-height: var(--sc-tap-min, 44px);
        min-width: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--sc-fg-2);
      }
      .terminal-tool:hover { color: var(--sc-accent); }

      .sc-card.err {
        border: 1px solid var(--sc-danger);
        border-radius: 3px;
        padding: 14px;
        background: color-mix(in srgb, var(--sc-danger) 8%, var(--sc-bg-1));
      }
      .sc-card.err button { margin-top: 8px; }

      /* ── STAGE SPLIT: ship ⅔ · person ⅓ (concept 2026-09-20, rounds 14-17) ──
         Replaces the old AN BORD ⇄ IM HANGAR switcher and its --surface-h
         viewport maths (S1) — the final design fixes the height outright
         (400px desktop, 300px phone stacked), so there is nothing left to
         derive from the viewport. */
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

      /* ── Archive line, drawn INSIDE the picture (Q3: nothing left to pin
           out of a scroll container — the stage itself never scrolls) ────── */
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
      /* The empty-state CTA: a real, bordered target, not one more quiet link. */
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

      /* ── responsive: stacked stages, 300px each (final design) ──────────── */
      @media (max-width: 520px) {
        .stage-split { grid-template-columns: 1fr; grid-template-rows: 300px 300px; height: auto; }
      }
    `,
  ],
})
export class CodexLandingComponent implements OnInit {
  readonly svc = inject(CodexService);
  readonly hangar = inject(HangarService);
  readonly auth = inject(AuthService);
  private readonly t = inject(TranslateService);
  readonly rsi = inject(UpcomingShipsService);
  private readonly locale = inject(LocaleService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  /** i18n key, never raw text. */
  readonly error = signal<string | null>(null);

  /** `?q=` — a term handed to the Codex search (did-you-mean links, recent searches, old Holotable links). */
  readonly routeQuery = signal<string | null>(null);
  private readonly searchBar = viewChild<CodexSearchBarComponent>('searchBar');

  // Fleet — public: the template's fleet lane reads the raw row list for its
  // count and its "is the fleet empty" guard.
  readonly fleetRows = signal<CodexListRow[]>([]);
  private readonly fleetDeltas = signal<Map<string, ShipStatDelta[]>>(new Map());

  // IM HANGAR extras (flagship-scoped, best-effort)
  readonly shipRoleResolved = signal<string | null>(null);
  readonly selectedHangarShipId = signal<string | null>(null);

  /**
   * classNameSlug → resolved role label for EVERY owned hull, not just the
   * flagship: the fleet strip groups by role, so a `@`-locale key that was
   * never resolved would render as its raw token in a group heading.
   */
  readonly fleetRoleLabels = signal<Map<string, string>>(new Map());

  /**
   * `?set=<hangar_role_loadouts.id>` — which personal set the person stage
   * shows. Null means "the most recently touched one", which is the ordinary
   * visit. Still URL-driven (unlike the ship picker below, which is
   * session-local) — the retired `/hangar/loadout/:id` editor route (admin
   * feedback 34505d70, decision 2A) redirects here with the id it was given.
   */
  readonly selectedSetId = signal<string | null>(null);

  /**
   * Session-local, unlike `selectedSetId` — the ship stage's picker has no
   * URL contract to keep (there never was a `?ship=` param). Null defers to
   * the flagship, exactly like the old collapsed-rail default.
   */
  readonly selectedShipSlug = signal<string | null>(null);

  // AN BORD: the sets, most recently touched (or URL-named) first.
  readonly personalLoadouts = signal<HangarRoleLoadout[]>([]);


  private readonly ownedClassNames = computed(() =>
    this.hangar
      .ships()
      .filter((s) => s.status === 'owned')
      .map((s) => s.shipClassName),
  );

  readonly emptyHangar = computed(() => !this.loading() && this.fleetRows().length === 0);

  readonly flagshipRow = computed<CodexListRow | null>(() => {
    const rows = this.fleetRows();
    const flagship = this.hangar.flagshipClassName();
    if (flagship) {
      const match = rows.find((r) => r.classNameSlug === flagship);
      if (match) return match;
    }
    return rows[0] ?? null;
  });

  readonly fleetOthers = computed(() => {
    const flag = this.flagshipRow();
    return this.fleetRows().filter((r) => r.classNameSlug !== flag?.classNameSlug);
  });

  readonly comparableFleet = computed(() => this.fleetRows().length >= 2);

  /** The ship the ship stage currently shows: the picker's choice, or the flagship. */
  readonly stageShipRow = computed<CodexListRow | null>(() => {
    const id = this.selectedShipSlug();
    if (id) {
      const match = this.fleetRows().find((r) => r.classNameSlug === id);
      if (match) return match;
    }
    return this.flagshipRow();
  });

  readonly stageShipTitle = computed(() => {
    const row = this.stageShipRow();
    if (row) return this.rowName(row);
    return this.loading() ? '' : this.t.instant('codex.landing.fleet.empty');
  });

  /**
   * `stageArtFor()` (K1) reordered for the Spot stage — uncropped derivatives
   * first, `store_large` last — plus this row's local uploader preview
   * appended as a final fallback, same as the old `thumbs()` did.
   */
  readonly stageShipArt = computed<StageArt | null>(() => {
    const row = this.stageShipRow();
    if (!row) return null;
    const art = this.rsi.stageArtFor(row.nameLocalized ?? this.rowName(row));
    const p = row.payload as { previewImage?: string | null } | null;
    const local = this.svc.previewUrl(p?.previewImage);
    if (!art.src) return local ? { src: local, fallbacks: [] } : null;
    return local ? { src: art.src, fallbacks: [...art.fallbacks, local] } : art;
  });

  /**
   * The resolved role label is only fetched (`resolveShipExtras`) for the
   * FLAGSHIP — switching the stage to a different owned hull through the
   * picker shows its manufacturer but not (yet) its role suffix. A known,
   * narrow gap rather than a second network round-trip per pick.
   */
  readonly stageShipRoleSuffix = computed<string | null>(() => {
    const row = this.stageShipRow();
    if (!row) return null;
    const role = row.classNameSlug === this.flagshipRow()?.classNameSlug ? this.shipRoleResolved() : null;
    return role ? `· ${role}` : null;
  });

  /**
   * HangarPicker chain for the ship stage: `HangarService.recentShips()` (M1
   * — top 3 recently chosen, persisted, falls back to the first 3 owned hulls
   * when nothing was picked yet). Only rows the current build can also name
   * make it into the chain — a recently-picked hull the build dropped is not
   * worth showing as a dead entry.
   */
  readonly shipPickerItems = computed<HangarPickerItem[]>(() => {
    const current = this.stageShipRow()?.classNameSlug ?? null;
    const rowByClass = new Map(this.fleetRows().map((r) => [r.classNameSlug, r]));
    const items: HangarPickerItem[] = [];
    for (const s of this.hangar.recentShips()) {
      const row = rowByClass.get(s.shipClassName);
      if (!row) continue;
      items.push({ id: row.classNameSlug, label: this.rowName(row), active: row.classNameSlug === current });
    }
    return items;
  });

  // AN BORD: the "active" personal loadout is the most recently touched one
  // (see sortByRecency — no last_opened_at yet, sorts by updatedAt), or the
  // one `selectedSetId`/the picker named — `withSelectedFirst` puts it at [0].
  readonly activeLoadout = computed<HangarRoleLoadout | null>(() => this.personalLoadouts()[0] ?? null);

  readonly paperdollSlots = computed<ArmorSlotState[]>(() =>
    armorSlotsFromLoadout(this.activeLoadout()?.items ?? []),
  );

  /**
   * Which positions the active set has equipped — the only state the person
   * stage's figure carries. ALWAYS a set, never null: an unequipped suit is
   * the CHARACTER (feedback 77668f11 round three), not an absence.
   */
  readonly boardHero = computed<ReadonlySet<string>>(
    () => new Set(this.paperdollSlots().filter((s) => s.className).map((s) => s.roleSlot)),
  );

  readonly stagePersonTitle = computed(
    () => this.activeLoadout()?.name ?? this.t.instant('codex.landing.me.uncommissioned'),
  );

  /** "Technik" etc. — the active set's role, spelled out; falls back to the generic AN BORD eyebrow. */
  readonly stagePersonRoleLabel = computed(() => {
    const loadout = this.activeLoadout();
    return loadout
      ? this.t.instant('hangar.roles.' + loadout.role)
      : this.t.instant('codex.landing.me.eyebrow');
  });

  /** "· 5 / 6 ausgerüstet" — U1's honest count, never a bare percentage. */
  readonly stagePersonEquipSuffix = computed(
    () => '· ' + this.t.instant('codex.stage.armorEquipped', { filled: this.boardHero().size, total: 6 }),
  );

  /** HangarPicker chain for the person stage: `HangarService.recentSets()` (M1), active = the one on stage. */
  readonly setPickerItems = computed<HangarPickerItem[]>(() => {
    const current = this.activeLoadout()?.id ?? null;
    return this.hangar
      .recentSets()
      .map((l) => ({ id: l.id, label: l.name, active: l.id === current }));
  });

  readonly archiveRecordCount = computed<number | null>(() =>
    totalRecordCount(this.svc.build()?.entityCounts as Record<string, unknown> | undefined),
  );

  readonly extractedAtLabel = computed<string | null>(() => {
    const at = this.svc.build()?.extractedAt;
    if (!at) return null;
    return formatScDate(at, { language: this.locale.language(), region: this.locale.region() }) || at;
  });

  /**
   * Honest counts for the IM HANGAR archive quick-access line (prio 3) —
   * `seeded` preferred over the full extractor total, the same rule the old
   * "Im Versum" domain chips used. `null` while the build hasn't loaded (or
   * the build carries no count for the kind), which the template reads as
   * "show no count" rather than a placeholder.
   */
  private archiveCount(plural: 'ships' | 'components'): number | null {
    const counts = this.svc.build()?.entityCounts as
      | (Record<string, number> & { seeded?: Record<string, number> })
      | undefined;
    if (!counts) return null;
    const total = counts[plural];
    const seeded = counts.seeded?.[plural];
    const v = seeded ?? total;
    return typeof v === 'number' ? v : null;
  }

  readonly archiveShipCount = computed(() => this.archiveCount('ships'));
  readonly archiveComponentCount = computed(() => this.archiveCount('components'));

  constructor() {
    // A new LIVE build replaced the one on screen (tab came back): reload.
    reloadOnBuildRefresh(this.svc, () => this.reload());

    // `?set=` comes from the URL, and it keeps coming: a bookmarked or
    // middle-clicked link into a specific set has to keep applying, not just
    // on the first load — a snapshot read would only ever catch that one.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      // `?q=` seeds the Codex search bar in the terminal row.
      this.routeQuery.set(q.get('q'));
      const set = q.get('set');
      if (set !== this.selectedSetId()) {
        this.selectedSetId.set(set);
        // Only re-resolve once the first load has populated the service; the
        // initial pass is driven by ngOnInit.
        if (this.hangar.roleLoadouts().length > 0) this.resolvePersonal();
      }
    });

  }

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.svc.loadCurrentBuild();
      void this.rsi.ensureLoaded();
      if (this.auth.user() && this.hangar.ships().length === 0) {
        await this.hangar.loadAll();
      }
      this.resolvePersonal();
      await this.resolveFleet();
    } catch (err) {
      this.error.set(toErrorKey('codex', 'landing', err));
    } finally {
      this.loading.set(false);
    }
  }

  reload(): void {
    void this.ngOnInit();
  }

  private async resolveFleet(): Promise<void> {
    const names = this.ownedClassNames();
    if (names.length === 0) {
      this.fleetRows.set([]);
      this.fleetDeltas.set(new Map());
      this.shipRoleResolved.set(null);
      this.fleetRoleLabels.set(new Map());
      return;
    }
    const byName = await this.svc.getShipsByClassNames(names);
    // Preserve hangar order, drop names absent from the current build.
    const rows = names.map((n) => byName.get(n)).filter((r): r is CodexListRow => !!r);
    this.fleetRows.set(rows);
    void this.resolveFleetRoles(rows);
    // Best-effort inline patch-diff — degrades to an empty map (no error).
    this.fleetDeltas.set(await this.svc.ownedFleetDeltas(rows.map((r) => r.classNameSlug)));
    await this.resolveShipExtras();
  }

  /**
   * Resolve the role label of every owned hull in ONE batch so the fleet strip
   * can group by it. Best-effort: a failure leaves the map as-is and the
   * grouping falls back to the "unknown" bucket rather than showing raw
   * `@`-locale tokens as headings.
   */
  private async resolveFleetRoles(rows: readonly CodexListRow[]): Promise<void> {
    const labels = new Map<string, string>();
    const pending: string[] = [];
    for (const r of rows) {
      if (!r.role) continue;
      if (r.role.startsWith('@')) pending.push(r.role);
      else {
        const clean = cleanLocaleValue(r.role);
        if (clean) labels.set(r.classNameSlug, clean);
      }
    }
    if (pending.length) {
      try {
        const resolved = await this.svc.resolveLocaleKeys([...new Set(pending)], this.lang());
        for (const r of rows) {
          if (!r.role?.startsWith('@')) continue;
          const clean = cleanLocaleValue(resolved.get(r.role));
          if (clean) labels.set(r.classNameSlug, clean);
        }
      } catch (error) {
        logWarn('codex', 'role labels failed', error);
        /* leave the unresolved hulls in the "unknown" bucket */
      }
    }
    this.fleetRoleLabels.set(labels);
  }

  /** IM HANGAR extras for the selected (flagship) ship — best-effort, non-blocking. */
  private async resolveShipExtras(): Promise<void> {
    const ship = this.flagshipRow();
    if (!ship) {
      this.shipRoleResolved.set(null);
      this.selectedHangarShipId.set(null);
      return;
    }
    // The flagship's component payloads used to be fetched here as well —
    // for KPI rows the landing no longer renders (harden scan 2026-09-25).
    let roleTask: Promise<void> | null = null;
    if (ship.role?.startsWith('@')) {
      roleTask = this.svc
        .resolveLocaleKeys([ship.role], this.lang())
        .then((m) => this.shipRoleResolved.set(cleanLocaleValue(m.get(ship.role!)) || null))
        .catch((error) => {
          logWarn('codex', 'ship role label failed', error);
          this.shipRoleResolved.set(null);
        });
    } else {
      this.shipRoleResolved.set(cleanLocaleValue(ship.role) || null);
    }

    // The saved per-ship configurations no longer render here (feedback
    // 2026-08-23: "Konfigurationen brauchen wir nicht direkt zugreifbar,
    // einfach direkt die Flotte") — the id stays because the hangar deep
    // link still uses it.
    this.selectedHangarShipId.set(this.hangar.shipByClassName(ship.classNameSlug)?.id ?? null);

    await roleTask;
  }

  /**
   * AN BORD — the person stage's sets. Most recently touched first, unless the
   * URL names a set, which then leads: everything downstream (`activeLoadout`,
   * the paperdoll, the panel's switcher) reads position 0, so ordering IS the
   * selection. The names, payloads and archive counts of the active set's
   * pieces used to be fetched here too — one to eight queries per visit for
   * KPI rows the landing no longer renders (harden scan 2026-09-25).
   */
  private resolvePersonal(): void {
    this.personalLoadouts.set(withSelectedFirst(sortByRecency(this.hangar.roleLoadouts()), this.selectedSetId()));
  }

  /** Move focus to the Codex search (empty-hangar CTA "search a ship"). */
  focusTerminal(): void {
    this.searchBar()?.activate(undefined, true);
  }

  // ── fleet rendering helpers ────────────────────────────────────────────────
  deltasFor(className: string): ShipStatDelta[] {
    return this.fleetDeltas().get(className) ?? [];
  }

  rowName(r: CodexListRow): string {
    const p = r.payload as { name?: LocalizedText } | null;
    const localized = p?.name ? pickLocalized(p.name, this.lang()) : '';
    return localized || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  /**
   * Manufacturer of a hull, spelled out ("Aegis Dynamics", not "AEG"). The name
   * is extracted game data carried on the row payload — see `manufacturerLabel`.
   */
  rowMfr(r: CodexListRow): string | null {
    return manufacturerLabel(r, this.lang());
  }

  formatNum(v: number): string {
    return formatNumber(v);
  }

  // ── stage picker handlers (M6: switch the subject, move it to the front) ──
  onShipPick(id: string): void {
    this.selectedShipSlug.set(id);
    this.hangar.markShipPicked(id);
  }

  onSetPick(id: string): void {
    this.hangar.markSetPicked(id);
    if (id === this.selectedSetId()) return;
    this.selectedSetId.set(id);
    this.resolvePersonal();
  }

  /** Neither stage has an overlay yet (M3/M4 are out of this round's scope) — both open the hangar page. */
  onHangarOpen(): void {
    void this.router.navigateByUrl('/hangar');
  }

  private lang(): Lang {
    return toLang(this.t.getCurrentLang() ?? this.t.getFallbackLang());
  }
}
