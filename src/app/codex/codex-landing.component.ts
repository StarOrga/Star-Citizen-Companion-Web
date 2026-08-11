import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexListRow, CodexKind, CodexService, pickLocalized, toLang } from './codex.service';
import { cleanLocaleValue, humanizeClassName } from './codex-format';
import { LocalizedText, Lang } from './codex.types';
import { PolySearchHit, polyHitLink } from './codex-poly-search';
import { ShipStatDelta } from './codex-build-diff';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';
import { UpcomingShipsService } from './upcoming-ships.service';
import { HangarService } from '../hangar/hangar.service';
import { AuthService } from '../auth/auth.service';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The Codex landing — "the composed depth-field landing".
 *
 * A single front door composed of three depth planes:
 *   TOP    — the "Archive Terminal": a poly-entity search that queries EVERY
 *            kind (ships, components, weapons, items, ammunition, manufacturers,
 *            blueprints), plus a patch/status pill.
 *   HERO   — two personal panels: ICH (the on-foot character, honest empty state
 *            because no personal armour data exists) and MEINE FLOTTE (the user's
 *            hangar ships as a fleet field, flagship larger, with inline
 *            build-scoped patch deltas — green better / red worse).
 *   WELT   — use-case lanes (Nachschlagen / Herstellen / News / Entdecken),
 *            every navigation a real anchor.
 *
 * Zero model calls: everything is server-ranked from our own catalog. The old
 * Bridge front door survives at /codex/bridge for comparison.
 */
@Component({
  selector: 'sc-codex-landing',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslateModule,
    CodexCompareTrayComponent,
    CodexCategoryIconComponent,
    FallbackImageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="landing">
      <!-- ── TOP: Archive Terminal + status pill ───────────────────────────── -->
      <header class="terminal">
        <div class="terminal-bar">
          <span class="terminal-icon" aria-hidden="true">⌕</span>
          <input
            class="terminal-input"
            type="search"
            [ngModel]="searchInput()"
            (ngModelChange)="onSearchInput($event)"
            [attr.aria-label]="'codex.landing.terminal.label' | translate"
            [attr.placeholder]="'codex.landing.terminal.placeholder' | translate"
          />
          @if (searchInput()) {
            <button
              class="terminal-clear"
              type="button"
              (click)="clearSearch()"
              [attr.aria-label]="'codex.landing.terminal.clear' | translate"
            >
              ×
            </button>
          }
        </div>

        <div class="status-pill" [class.stale]="svc.stale()">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="status-online">{{ 'codex.landing.status.online' | translate }}</span>
          @if (svc.build(); as b) {
            <span class="status-sep" aria-hidden="true">·</span>
            <span class="status-patch">{{
              'codex.landing.status.patch' | translate: { patch: b.patchVersion }
            }}</span>
            <span class="status-build">{{
              'codex.landing.status.build' | translate: { build: b.buildNumber }
            }}</span>
          }
          @if (svc.stale()) {
            <a class="status-stale" routerLink="/uploader">{{
              'codex.landing.status.stale' | translate
            }}</a>
          }
        </div>
      </header>

      <!-- Quiet Zyklus-Report line — only when the build-diff found real change. -->
      @if (patchDay()) {
        <p class="cycle-report">
          {{
            (patchDayCount() === 1 ? 'codex.landing.cycle.reportOne' : 'codex.landing.cycle.report')
              | translate: { count: patchDayCount() }
          }}
        </p>
      }

      @if (error(); as err) {
        <div class="sc-card err">
          <p>{{ 'codex.error.title' | translate }}</p>
          <button type="button" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      }

      <!-- ── SEARCH-ACTIVE: cross-entity results staged in the field ────────── -->
      @if (searchActive()) {
        <section class="results" aria-live="polite">
          <header class="results-head">
            <h2>{{ 'codex.landing.results.title' | translate }}</h2>
            <span class="results-term">"{{ searchTerm() }}"</span>
          </header>
          @if (searching()) {
            <p class="results-note">{{ 'codex.landing.results.searching' | translate }}</p>
          } @else if (searchResults().length === 0) {
            <p class="results-note">{{
              'codex.landing.results.empty' | translate: { term: searchTerm() }
            }}</p>
          } @else {
            <div class="hit-grid">
              @for (hit of searchResults(); track hit.kind + ':' + hit.classNameSlug) {
                <a class="hit" [class.meta]="hit.scope === 'meta'" [routerLink]="hitLink(hit)">
                  <span class="hit-icon" aria-hidden="true">
                    <sc-codex-icon [kind]="hit.kind" />
                  </span>
                  <span class="hit-body">
                    <span class="hit-name">{{ hitName(hit) }}</span>
                    <span class="hit-meta">
                      <span class="hit-kind">{{
                        'codex.kindSingular.' + hit.kind | translate
                      }}</span>
                      @if (hit.manufacturerCode) {
                        <span class="hit-mfr">{{ hit.manufacturerCode }}</span>
                      }
                      @if (hit.size != null) {
                        <span class="hit-badge">{{
                          'codex.card.size' | translate: { size: hit.size }
                        }}</span>
                      }
                    </span>
                  </span>
                  <button
                    type="button"
                    class="pin"
                    [class.pinned]="svc.isPinned(hit.kind, hit.classNameSlug)"
                    (click)="togglePin($event, hit.kind, hit.classNameSlug)"
                    [attr.aria-label]="
                      (svc.isPinned(hit.kind, hit.classNameSlug)
                        ? 'codex.compare.pinned'
                        : 'codex.compare.pin'
                      ) | translate
                    "
                  >
                    {{ svc.isPinned(hit.kind, hit.classNameSlug) ? '★' : '☆' }}
                  </button>
                </a>
              }
            </div>
          }
        </section>
      }

      <!-- ── HERO: ICH + MEINE FLOTTE ──────────────────────────────────────── -->
      <div class="hero-row" [class.dimmed]="searchActive()">
        <!-- ICH — amber, on-foot character -->
        <article class="panel me" aria-labelledby="me-title">
          <header class="panel-head">
            <span class="panel-eyebrow">{{ 'codex.landing.me.eyebrow' | translate }}</span>
            <h2 id="me-title">{{ 'codex.landing.me.title' | translate }}</h2>
          </header>
          <div class="avatar" aria-hidden="true">
            <svg viewBox="0 0 64 80" role="img" focusable="false">
              <path
                class="avatar-helmet"
                d="M32 6c-11 0-19 8-19 19v10c0 4 2 7 5 9l2 14h24l2-14c3-2 5-5 5-9V25C51 14 43 6 32 6z"
              />
              <path class="avatar-visor" d="M20 24c0-4 5-7 12-7s12 3 12 7v9c0 3-5 5-12 5s-12-2-12-5z" />
              <line class="avatar-line" x1="32" y1="17" x2="32" y2="38" />
            </svg>
          </div>
          @if (hasFpsSet()) {
            <div class="me-ready">
              <span class="ready-chip">{{ 'codex.landing.me.ready' | translate }}</span>
              <p class="me-set-name">{{ fpsSet()!.name }}</p>
              <a class="btn tint" [routerLink]="['/hangar', 'loadout', fpsSet()!.id]">{{
                'codex.landing.me.openSet' | translate
              }}</a>
            </div>
          } @else {
            <div class="me-empty">
              <span class="empty-chip">{{ 'codex.landing.me.uncommissioned' | translate }}</span>
              <p class="me-lead">{{ 'codex.landing.me.emptyLead' | translate }}</p>
              <a class="btn tint" routerLink="/codex/fps">
                {{ 'codex.landing.me.cta' | translate }}
                <span class="btn-goal">{{ 'codex.landing.me.ctaGoal' | translate }}</span>
              </a>
            </div>
          }
        </article>

        <!-- MEINE FLOTTE — cyan, hangar fleet field -->
        <article class="panel fleet" aria-labelledby="fleet-title">
          <header class="panel-head">
            <span class="panel-eyebrow">{{ 'codex.landing.fleet.eyebrow' | translate }}</span>
            <h2 id="fleet-title">{{ 'codex.landing.fleet.title' | translate }}</h2>
          </header>

          @if (loading()) {
            <div class="fleet-flagship skel"></div>
          } @else if (emptyHangar()) {
            <div class="fleet-empty">
              <span class="empty-chip">{{ 'codex.landing.fleet.empty' | translate }}</span>
              <a class="btn tint" routerLink="/codex/index">
                {{ 'codex.landing.fleet.cta' | translate }}
                <span class="btn-goal">{{ 'codex.landing.fleet.ctaGoal' | translate }}</span>
              </a>
            </div>
          } @else {
            @if (flagshipRow(); as f) {
              <a
                class="fleet-flagship"
                [routerLink]="['/codex', 'ship', f.classNameSlug]"
                [attr.aria-label]="
                  'codex.landing.fleet.open' | translate: { ship: rowName(f) }
                "
              >
                <span class="flag-thumb" [class.icon-only]="thumbs(f).length === 0">
                  <sc-fallback-image [candidates]="thumbs(f)" [alt]="rowName(f)" [eager]="true">
                    <sc-codex-icon kind="ship" />
                  </sc-fallback-image>
                </span>
                <span class="flag-body">
                  <span class="flag-eyebrow">{{ 'codex.landing.fleet.flagship' | translate }}</span>
                  <span class="flag-name">{{ rowName(f) }}</span>
                  @if (f.manufacturerCode) {
                    <span class="flag-mfr">{{ f.manufacturerCode }}</span>
                  }
                  @if (deltasFor(f.classNameSlug).length) {
                    <span class="delta-row">
                      @for (d of deltasFor(f.classNameSlug); track d.labelKey) {
                        <span class="delta" [class]="'dir-' + d.direction">
                          <span class="delta-label">{{ d.labelKey | translate }}</span>
                          <span class="delta-val"
                            >{{ d.delta > 0 ? '+' : '' }}{{ d.delta
                            }}{{ d.unit ? ' ' + d.unit : '' }}</span
                          >
                        </span>
                      }
                    </span>
                  }
                </span>
                <button
                  type="button"
                  class="pin flag-pin"
                  [class.pinned]="svc.isPinned('ship', f.classNameSlug)"
                  (click)="togglePin($event, 'ship', f.classNameSlug)"
                  [attr.aria-label]="
                    (svc.isPinned('ship', f.classNameSlug)
                      ? 'codex.compare.pinned'
                      : 'codex.compare.pin'
                    ) | translate
                  "
                >
                  {{ svc.isPinned('ship', f.classNameSlug) ? '★' : '☆' }}
                </button>
              </a>
            }

            @if (fleetOthers().length) {
              <div class="fleet-others">
                @for (r of fleetOthers(); track r.classNameSlug) {
                  <a
                    class="fleet-thumb"
                    [class.icon-only]="thumbs(r).length === 0"
                    [routerLink]="['/codex', 'ship', r.classNameSlug]"
                    [attr.aria-label]="'codex.landing.fleet.open' | translate: { ship: rowName(r) }"
                  >
                    <sc-fallback-image [candidates]="thumbs(r)" [alt]="rowName(r)">
                      <sc-codex-icon kind="ship" />
                    </sc-fallback-image>
                    <span class="thumb-name">{{ rowName(r) }}</span>
                    @if (deltasFor(r.classNameSlug).length) {
                      <span
                        class="thumb-delta"
                        [class]="'dir-' + deltasFor(r.classNameSlug)[0].direction"
                        aria-hidden="true"
                        >Δ</span
                      >
                    }
                  </a>
                }
              </div>
            }

            @if (comparableFleet()) {
              <p class="compare-hint">{{ 'codex.landing.fleet.compareHint' | translate }}</p>
            }
          }
        </article>
      </div>

      <!-- ── WELT: use-case lanes ──────────────────────────────────────────── -->
      <section class="world" [class.dimmed]="searchActive()">
        <header class="world-head">
          <h2>{{ 'codex.landing.world.title' | translate }}</h2>
          <span class="world-sub">{{ 'codex.landing.world.subtitle' | translate }}</span>
        </header>
        <div class="world-grid">
          <article class="lane">
            <a class="lane-title" routerLink="/codex/index">{{
              'codex.landing.world.lookup.title' | translate
            }}</a>
            <p class="lane-sub">{{ 'codex.landing.world.lookup.sub' | translate }}</p>
            <a class="lane-chip" routerLink="/codex/keybinds">{{
              'codex.landing.world.lookup.keybinds' | translate
            }}</a>
          </article>

          <article class="lane">
            <a class="lane-title" routerLink="/codex/blueprint">{{
              'codex.landing.world.craft.title' | translate
            }}</a>
            <p class="lane-sub">{{ 'codex.landing.world.craft.sub' | translate }}</p>
          </article>

          <article class="lane">
            <a class="lane-title" routerLink="/news">{{
              'codex.landing.world.news.title' | translate
            }}</a>
            <p class="lane-sub">{{ 'codex.landing.world.news.sub' | translate }}</p>
          </article>

          <article class="lane">
            <a class="lane-title" routerLink="/codex/upcoming">{{
              'codex.landing.world.discover.title' | translate
            }}</a>
            <p class="lane-sub">{{ 'codex.landing.world.discover.sub' | translate }}</p>
            <a class="lane-chip" routerLink="/codex/showroom">{{
              'codex.landing.world.discover.showroom' | translate
            }}</a>
          </article>
        </div>
      </section>

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [
    `
      .landing {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 1180px;
        margin: 0 auto;
        padding: 16px 16px 96px;
      }

      /* ── Archive Terminal ─────────────────────────────────────────────── */
      .terminal {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }
      .terminal-bar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1 1 340px;
        padding: 0 12px;
        min-height: var(--sc-tap-min, 44px);
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border));
        background:
          radial-gradient(140% 160% at 0% 0%, color-mix(in srgb, var(--sc-accent) 10%, transparent), transparent 60%),
          var(--sc-bg-1);
      }
      .terminal-icon {
        font-size: 1.05rem;
        color: var(--sc-accent);
      }
      .terminal-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--sc-fg-0);
        font-size: max(0.95rem, var(--sc-fs-floor, 0.9rem));
        padding: 10px 0;
      }
      .terminal-bar:focus-within {
        border-color: var(--sc-accent);
        box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.22);
      }
      .terminal-clear {
        background: none;
        border: none;
        color: var(--sc-fg-2);
        font-size: 1.3rem;
        line-height: 1;
        cursor: pointer;
      }

      /* ── status pill ──────────────────────────────────────────────────── */
      .status-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 999px;
        font-family: var(--sc-font-display);
        font-size: max(0.7rem, var(--sc-fs-floor, 0.68rem));
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--sc-fg-1);
        border: 1px solid color-mix(in srgb, var(--sc-success, #5fd698) 30%, transparent);
        background: color-mix(in srgb, var(--sc-success, #5fd698) 10%, transparent);
      }
      .status-pill.stale {
        border-color: color-mix(in srgb, var(--sc-warning, #ffc14d) 40%, transparent);
        background: color-mix(in srgb, var(--sc-warning, #ffc14d) 10%, transparent);
      }
      .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--sc-success, #5fd698);
        box-shadow: 0 0 8px var(--sc-success, #5fd698);
        animation: pulse 2.4s ease-in-out infinite;
      }
      .status-pill.stale .live-dot {
        background: var(--sc-warning, #ffc14d);
        box-shadow: 0 0 8px var(--sc-warning, #ffc14d);
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }
      .status-sep,
      .status-build {
        color: var(--sc-fg-2);
      }
      .status-stale {
        color: var(--sc-warning, #ffc14d);
        text-decoration: underline;
      }

      .cycle-report {
        margin: -8px 0 0;
        font-size: max(0.8rem, var(--sc-fs-floor, 0.78rem));
        color: var(--sc-fg-2);
      }

      .sc-card.err {
        border: 1px solid var(--sc-danger);
        border-radius: 12px;
        padding: 14px;
        background: color-mix(in srgb, var(--sc-danger) 8%, var(--sc-bg-1));
      }
      .sc-card.err button {
        margin-top: 8px;
      }

      /* ── search results ───────────────────────────────────────────────── */
      .results-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 10px;
      }
      .results-head h2 {
        margin: 0;
        font-size: 1.05rem;
      }
      .results-term {
        color: var(--sc-accent);
        font-family: var(--sc-font-display);
      }
      .results-note {
        color: var(--sc-fg-2);
      }
      .hit-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 10px;
      }
      .hit {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 10px;
        text-decoration: none;
        color: inherit;
        /* cyan (equipment) scope by default */
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border));
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 10%, transparent), transparent 70%),
          var(--sc-bg-1);
        transition: transform 0.16s, border-color 0.16s, box-shadow 0.16s;
      }
      .hit.meta {
        /* violet scope for manufacturers + blueprints */
        --meta: #b98bff;
        border-color: color-mix(in srgb, var(--meta) 32%, var(--sc-border));
        background: linear-gradient(90deg, color-mix(in srgb, var(--meta) 12%, transparent), transparent 70%),
          var(--sc-bg-1);
      }
      .hit:hover {
        transform: translateY(-2px);
        border-color: var(--sc-accent);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
      }
      .hit.meta:hover {
        border-color: var(--meta);
      }
      .hit-icon {
        display: inline-flex;
        width: 34px;
        height: 34px;
        align-items: center;
        justify-content: center;
        color: var(--sc-accent);
      }
      .hit.meta .hit-icon {
        color: var(--meta);
      }
      .hit-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .hit-name {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hit-meta {
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 0.72rem;
        color: var(--sc-fg-2);
      }
      .hit-kind {
        font-family: var(--sc-font-display);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--sc-accent);
      }
      .hit.meta .hit-kind {
        color: var(--meta);
      }

      /* ── hero panels ──────────────────────────────────────────────────── */
      .hero-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
        gap: 14px;
        transition: opacity 0.2s;
      }
      .dimmed {
        opacity: 0.55;
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        border-radius: 16px;
        padding: 16px;
        min-height: 260px;
        border: 1px solid var(--sc-border);
        background:
          radial-gradient(120% 90% at 80% 10%, color-mix(in srgb, var(--tint) 14%, transparent), transparent 60%),
          var(--sc-bg-1);
      }
      .panel.me {
        --tint: var(--sc-warning, #ffc14d);
      }
      .panel.fleet {
        --tint: var(--sc-accent);
      }
      .panel-head {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .panel-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--tint);
      }
      .panel-head h2 {
        margin: 0;
        font-size: 1.15rem;
      }

      /* ICH avatar */
      .avatar {
        display: flex;
        justify-content: center;
        padding: 6px 0;
      }
      .avatar svg {
        width: 76px;
        height: 96px;
      }
      .avatar-helmet {
        fill: color-mix(in srgb, var(--tint) 14%, var(--sc-bg-2));
        stroke: color-mix(in srgb, var(--tint) 55%, transparent);
        stroke-width: 1.4;
      }
      .avatar-visor {
        fill: color-mix(in srgb, var(--tint) 26%, transparent);
        stroke: color-mix(in srgb, var(--tint) 60%, transparent);
        stroke-width: 1;
      }
      .avatar-line {
        stroke: color-mix(in srgb, var(--tint) 45%, transparent);
        stroke-width: 1;
      }
      .me-empty,
      .me-ready,
      .fleet-empty {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        margin-top: auto;
      }
      .empty-chip {
        font-family: var(--sc-font-display);
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 3px 9px;
        border-radius: 999px;
        color: var(--sc-fg-2);
        border: 1px dashed color-mix(in srgb, var(--tint) 45%, var(--sc-border));
      }
      .ready-chip {
        font-family: var(--sc-font-display);
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 3px 9px;
        border-radius: 999px;
        color: var(--sc-bg-0);
        background: var(--tint);
      }
      .me-lead,
      .me-set-name {
        margin: 0;
        color: var(--sc-fg-1);
        font-size: 0.9rem;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 14px;
        border-radius: 10px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.88rem;
        min-height: var(--sc-tap-min, 44px);
        box-sizing: border-box;
      }
      .btn.tint {
        color: var(--sc-bg-0);
        background: var(--tint);
        border: 1px solid var(--tint);
      }
      .btn.tint:hover {
        box-shadow: 0 0 18px color-mix(in srgb, var(--tint) 40%, transparent);
      }
      .btn-goal {
        font-weight: 400;
        opacity: 0.8;
      }

      /* FLEET field */
      .fleet-flagship {
        display: flex;
        gap: 12px;
        align-items: stretch;
        padding: 12px;
        border-radius: 12px;
        text-decoration: none;
        color: inherit;
        position: relative;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border));
        background: var(--sc-bg-2);
        transition: border-color 0.16s, box-shadow 0.16s;
      }
      .fleet-flagship:hover {
        border-color: var(--sc-accent);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4),
          0 0 16px color-mix(in srgb, var(--sc-accent) 22%, transparent);
      }
      .fleet-flagship.skel {
        min-height: 140px;
        background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%);
        background-size: 200% 100%;
        animation: skel 1.4s linear infinite;
      }
      @keyframes skel {
        to {
          background-position: -200% 0;
        }
      }
      .flag-thumb {
        --sc-img-max-h: 128px;
        flex: 0 0 44%;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        overflow: hidden;
        background: radial-gradient(circle at 50% 45%, var(--sc-bg-1), var(--sc-bg-0));
      }
      .flag-thumb.icon-only {
        color: var(--sc-accent);
      }
      .flag-body {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1;
      }
      .flag-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.66rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--sc-accent);
      }
      .flag-name {
        font-size: 1.05rem;
        font-weight: 700;
      }
      .flag-mfr {
        font-size: 0.78rem;
        color: var(--sc-fg-2);
      }
      .delta-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      .delta {
        display: inline-flex;
        gap: 5px;
        align-items: baseline;
        padding: 2px 7px;
        border-radius: 6px;
        font-size: 0.72rem;
        background: var(--sc-bg-1);
      }
      .delta-label {
        color: var(--sc-fg-2);
      }
      .delta-val {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .dir-up .delta-val {
        color: var(--sc-success, #5fd698);
      }
      .dir-down .delta-val {
        color: var(--sc-danger, #ff6b6b);
      }
      .dir-neutral .delta-val {
        color: var(--sc-fg-1);
      }
      .fleet-others {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 8px;
      }
      .fleet-thumb {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border-radius: 10px;
        text-decoration: none;
        color: inherit;
        border: 1px solid var(--sc-border);
        background: var(--sc-bg-2);
        --sc-img-max-h: 56px;
        transition: border-color 0.16s;
      }
      .fleet-thumb:hover {
        border-color: var(--sc-accent);
      }
      .fleet-thumb.icon-only {
        color: var(--sc-accent);
      }
      .thumb-name {
        font-size: 0.72rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .thumb-delta {
        position: absolute;
        top: 6px;
        right: 6px;
        font-size: 0.72rem;
        font-weight: 700;
      }
      .thumb-delta.dir-up {
        color: var(--sc-success, #5fd698);
      }
      .thumb-delta.dir-down {
        color: var(--sc-danger, #ff6b6b);
      }
      .thumb-delta.dir-neutral {
        color: var(--sc-fg-2);
      }
      .compare-hint {
        margin: 2px 0 0;
        font-size: 0.74rem;
        color: var(--sc-fg-2);
      }

      /* shared pin button */
      .pin {
        align-self: flex-start;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--sc-fg-2);
        font-size: 1.05rem;
        line-height: 1;
        padding: 4px;
      }
      .pin.pinned {
        color: var(--sc-accent);
      }
      .flag-pin {
        position: absolute;
        top: 8px;
        right: 8px;
      }

      /* ── WELT lanes ───────────────────────────────────────────────────── */
      .world-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
      }
      .world-head h2 {
        margin: 0;
        font-size: 1.15rem;
      }
      .world-sub {
        color: var(--sc-fg-2);
        font-size: 0.85rem;
      }
      .world-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        margin-top: 12px;
      }
      .lane {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        border-radius: 12px;
        border: 1px solid var(--sc-border);
        background:
          radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--sc-accent) 8%, transparent), transparent 55%),
          var(--sc-bg-1);
        transition: border-color 0.16s, box-shadow 0.16s;
      }
      .lane:hover {
        border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border));
      }
      .lane-title {
        font-family: var(--sc-font-display);
        font-size: 1rem;
        font-weight: 700;
        text-decoration: none;
        color: var(--sc-fg-0);
      }
      .lane-title:hover {
        color: var(--sc-accent);
      }
      .lane-sub {
        margin: 0;
        font-size: 0.8rem;
        color: var(--sc-fg-2);
        flex: 1;
      }
      .lane-chip {
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: 8px;
        font-size: 0.72rem;
        text-decoration: none;
        color: var(--sc-accent);
        background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent);
      }
      .lane-chip:hover {
        border-color: var(--sc-accent);
      }

      /* ── responsive ───────────────────────────────────────────────────── */
      @media (max-width: 760px) {
        .hero-row {
          grid-template-columns: 1fr;
        }
        .flag-thumb {
          flex-basis: 40%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .hit,
        .fleet-flagship,
        .fleet-thumb,
        .lane,
        .hero-row {
          transition: none;
        }
        .live-dot,
        .fleet-flagship.skel {
          animation: none;
        }
      }
    `,
  ],
})
export class CodexLandingComponent implements OnInit {
  readonly svc = inject(CodexService);
  readonly hangar = inject(HangarService);
  readonly auth = inject(AuthService);
  private readonly t = inject(TranslateService);
  private readonly rsi = inject(UpcomingShipsService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Archive Terminal (poly-search)
  readonly searchInput = signal('');
  readonly searchTerm = signal('');
  readonly searching = signal(false);
  readonly searchResults = signal<PolySearchHit[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  // Fleet
  private readonly fleetRows = signal<CodexListRow[]>([]);
  private readonly fleetDeltas = signal<Map<string, ShipStatDelta[]>>(new Map());

  readonly searchActive = computed(() => this.searchTerm().trim().length > 0);

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

  readonly patchDayCount = computed(() => this.fleetDeltas().size);
  readonly patchDay = computed(() => this.patchDayCount() > 0);

  readonly fpsSet = computed(() => this.hangar.roleLoadouts().find((l) => l.role === 'fps') ?? null);
  readonly hasFpsSet = computed(() => this.fpsSet() !== null);

  constructor() {
    effect(() => {
      const term = this.searchTerm().trim();
      if (!term) {
        this.searchResults.set([]);
        this.searching.set(false);
        return;
      }
      void this.runSearch(term);
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
      await this.resolveFleet();
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
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
      return;
    }
    const byName = await this.svc.getShipsByClassNames(names);
    // Preserve hangar order, drop names absent from the current build.
    const rows = names.map((n) => byName.get(n)).filter((r): r is CodexListRow => !!r);
    this.fleetRows.set(rows);
    // Best-effort inline patch-diff — degrades to an empty map (no error).
    this.fleetDeltas.set(await this.svc.ownedFleetDeltas(rows.map((r) => r.classNameSlug)));
  }

  // ── Archive Terminal ──────────────────────────────────────────────────────
  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.searchTerm.set(value), SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchInput.set('');
    this.searchTerm.set('');
  }

  private async runSearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.searching.set(true);
    try {
      const hits = await this.svc.searchAll(term, 6);
      if (seq !== this.searchSeq) return; // a newer search superseded this one
      this.searchResults.set(hits);
    } catch {
      if (seq === this.searchSeq) this.searchResults.set([]);
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  hitLink(hit: PolySearchHit): string[] {
    return polyHitLink(hit);
  }

  hitName(hit: PolySearchHit): string {
    return cleanLocaleValue(hit.nameLocalized) || humanizeClassName(hit.classNameSlug);
  }

  // ── compare tray ──────────────────────────────────────────────────────────
  togglePin(ev: Event, kind: CodexKind, className: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.svc.togglePin(kind, className);
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

  thumbs(r: CodexListRow): string[] {
    const out: string[] = [...this.rsi.artFor(r.nameLocalized ?? this.rowName(r))];
    const p = r.payload as { previewImage?: string | null } | null;
    const local = this.svc.previewUrl(p?.previewImage);
    if (local) out.push(local);
    return out;
  }

  private lang(): Lang {
    return toLang(this.t.currentLang ?? this.t.getDefaultLang());
  }
}
