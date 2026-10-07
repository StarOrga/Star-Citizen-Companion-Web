import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  RANK_PROFILES,
  RankProfileId,
  RankAxisResult,
  RankResult,
  RankScope,
} from './codex-rank';
import { ScSegmentedComponent, ScSegmentOption } from '../shared/segmented-control.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

/**
 * "Einordnung" — the right half of the masthead (MASTER §3). Purely
 * presentational: every number comes in through `result`, computed by the
 * page from `rankShip()`. `result === null` (and `loading === false`) is the
 * honest gap state for when the cohort has not been fetched yet — never an
 * invented percentile.
 *
 * The cohort fetch (`CodexService.getRankCohort`, batched stock-loadout KPI
 * sheets for every buyable ship of the build, cached per build id) and the
 * `rankShip()` call both live in `codex-detail.component.ts` — this card
 * only renders whatever `RankResult` it is handed, `null` being the honest
 * gap state for "no cohort yet" (still loading, or the fetch failed).
 */
@Component({
  selector: 'sc-codex-rank-card',
  standalone: true,
  imports: [TranslatePipe, ScSegmentedComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.holo]': 'holo()' },
  template: `
    <section class="rank-card" [class.sc-card]="!holo()">
      <div class="rank-head">
        <h2>
          <span class="glyph" aria-hidden="true">◈</span>
          {{ 'codex.rank.header' | translate }}
        </h2>
        @if (result()) {
          <p class="cohort-line">
            @if (result()!.scope === 'sizeClass' && sizeClass() != null) {
              {{ 'codex.rank.nShipsOfSizeClass' | translate: { n: result()!.cohortSize, k: sizeClass() } }}
            } @else if (result()!.scope === 'career') {
              {{ 'codex.rank.nShipsOfCareer' | translate: { n: result()!.cohortSize } }}
            } @else if (result()!.scope === 'role') {
              {{ 'codex.rank.nShipsOfRole' | translate: { n: result()!.cohortSize } }}
            } @else {
              {{ 'codex.rank.nShips' | translate: { n: result()!.cohortSize } }}
            }
          </p>
        } @else {
          <p class="cohort-line gap">{{ 'codex.kpi.gap' | translate }}</p>
        }
      </div>


      @if (holo()) {
        <p class="rolenote">◈ {{ 'codex.holo.stage.profileNote' | translate: { profile: (activeProfileLabelKey() | translate) } }}</p>
      }

      @if (result()) {
        <!-- Comparison group as the panel's head line (concept round 3, L2):
             one segmented control, a group the ship has no data for stays
             visible but disabled and says why in its tooltip. -->
        <div class="compare-head">
          <span class="compare-label">{{ 'codex.rank.compare.label' | translate }}</span>
          <sc-segmented
            class="compact"
            [options]="scopeChoices()"
            [value]="activeScope()"
            [ariaLabel]="'codex.rank.scopeLabel' | translate"
            (valueChange)="pickScope($any($event))" />
          <button
            type="button"
            class="compare-info"
            [scTooltip]="'codex.rank.compare.info' | translate"
            [attr.aria-label]="'codex.rank.compare.info' | translate"
          >ⓘ</button>
        </div>
      }

      @if (ready()) {
        <div class="rank-col-radar">
          <svg class="radar" viewBox="0 0 200 200" [attr.aria-label]="'codex.rank.radarAria' | translate: { name: shipName(), n: result()!.cohortSize }" role="img">
            <g class="rings" aria-hidden="true">
              @for (ring of rings; track ring) {
                <polygon [attr.points]="ringPoints(ring, result()!.axes.length)" />
              }
              @for (spoke of spokePoints(result()!.axes.length); track spoke) {
                <line x1="100" y1="100" [attr.x2]="spoke.x" [attr.y2]="spoke.y" />
              }
            </g>
            @if (shipPolygonPoints(); as shipPts) {
              <polygon class="ship" [attr.points]="shipPts" />
            }
            @if (comparePolygonPoints(); as cmpPts) {
              <polygon class="compare" [attr.points]="cmpPts" />
            }
            @for (c of connectors(); track c.key) {
              <line class="connector" [class.up]="c.up" [class.down]="!c.up" [attr.x1]="c.x1" [attr.y1]="c.y1" [attr.x2]="c.x2" [attr.y2]="c.y2" />
            }
            @for (cap of axisCaptions(); track cap.key) {
              <text [attr.x]="cap.x" [attr.y]="cap.y" [attr.text-anchor]="'middle'" [class.gap]="cap.gap" [class.up]="cap.trend === 'up'" [class.down]="cap.trend === 'down'">{{ (holo() && cap.gap ? cap.axisLabelKey : cap.labelKey) | translate }}@if (holo() && cap.gap) { ·—}</text>
            }
          </svg>
          <dl class="sr-only axis-mirror">
            @for (a of result()!.axes; track a.key) {
              <dt>{{ a.labelKey | translate }}</dt>
              <dd>{{ a.delta != null ? ('codex.rank.compare.axisDelta' | translate: { d: (a.delta > 0 ? '+' : '') + a.delta }) : ('codex.rank.gapAxis' | translate) }}</dd>
            }
          </dl>
          <dl class="legend">
            <dt aria-hidden="true"><svg class="sw" viewBox="0 0 28 10"><rect x="1" y="2" width="26" height="6" rx="2" class="sw-ship-fill" /><line x1="1" y1="5" x2="27" y2="5" class="sw-ship" /></svg></dt>
            <dd>{{ 'codex.rank.legend.ship' | translate: { name: shipName() } }}</dd>
            <dt aria-hidden="true"><svg class="sw sw-s" viewBox="0 0 12 10"><line x1="2" y1="8" x2="10" y2="2" class="sw-up" /></svg></dt>
            <dd><b class="up">{{ 'codex.rank.legend.better' | translate }}</b></dd>
            <dt aria-hidden="true"><svg class="sw" viewBox="0 0 28 10"><line x1="1" y1="5" x2="27" y2="5" class="sw-compare" /></svg></dt>
            <dd>{{ 'codex.rank.legend.compare' | translate: { group: (activeScopeLabelKey() | translate), n: result()!.cohortSize } }}</dd>
            <dt aria-hidden="true"><svg class="sw sw-s" viewBox="0 0 12 10"><line x1="2" y1="2" x2="10" y2="8" class="sw-down" /></svg></dt>
            <dd><b class="down">{{ 'codex.rank.legend.worse' | translate }}</b></dd>
          </dl>
        </div>
      }

      <div class="rank-col-bars">
        @if (loading()) {
          <div class="rank-skel sc-skel-field" aria-hidden="true"></div>
        } @else if (!result()) {
          <p class="gap-note">{{ 'codex.rank.gapAxis' | translate }}</p>
        } @else if (result()!.overall != null && holo()) {
            <p class="verdict holo-verdict">
              <b>{{ result()!.overall }} %</b> · {{ result()!.bandKey! | translate }}
            </p>
        } @else if (result()!.overall != null) {
            <p class="verdict">
              {{ 'codex.rank.verdict' | translate: { pct: result()!.overall, band: (result()!.bandKey! | translate), n: result()!.cohortSize } }}
              <button
                type="button"
                class="tip"
                [attr.aria-describedby]="'rank-pct-tip'"
              >{{ 'codex.rank.percentile' | translate }} ⓘ</button>
              <span id="rank-pct-tip" class="pct-tip" role="tooltip">{{ 'codex.rank.percentileTooltip' | translate }}</span>
            </p>
        } @else {
          <p class="verdict gap">{{ 'codex.kpi.gap' | translate }}</p>
        }

      @if (!holo()) {
      <div class="profile-row" role="radiogroup" [attr.aria-label]="'codex.rank.profileLabel' | translate">
        @for (p of profiles; track p.id) {
          <span
            class="chip-wrap"
            [scTooltip]="disabledReason(p.id) ? (disabledReason(p.id)! | translate) : null"
            scTooltipTier="label"
          >
            <button
              type="button"
              role="radio"
              class="profile-chip"
              [class.active]="profile() === p.id"
              [disabled]="disabledReason(p.id)"
              [attr.aria-checked]="profile() === p.id"
              [attr.aria-describedby]="disabledReason(p.id) ? ('rank-reason-' + p.id) : null"
              (click)="profileChange.emit(p.id)"
            >
              <span aria-hidden="true">{{ profile() === p.id ? '◈' : '◇' }}</span>
              {{ p.labelKey | translate }}
            </button>
          </span>
          @if (disabledReason(p.id)) {
            <span [id]="'rank-reason-' + p.id" class="sr-only">{{ disabledReason(p.id)! | translate }}</span>
          }
        }
      </div>
      }
        @if (ready() && holo()) {
          <p class="sub-head"><span>{{ 'codex.holo.stage.strengthsWeaknesses' | translate }}</span><i></i></p>
        }
        @if (ready()) {
          <ul class="bar-list">
            @for (a of result()!.bars; track a.key) {
              <li class="bar-row">
                <span class="bar-label">{{ a.labelKey | translate }}</span>
                <span class="bar-track">
                  @if (a.percentile != null) {
                    <span class="bar-fill" [class.weak]="a.weak" [style.width.%]="a.percentile"></span>
                  }
                </span>
                <span class="bar-value">
                  @if (a.percentile != null) {
                    {{ a.percentile }}%
                  } @else {
                    <span class="gap-dash"
                          [attr.tabindex]="a.gapKey ? 0 : null"
                          [attr.role]="a.gapKey ? 'img' : null"
                          [scTooltip]="a.gapKey ? (a.gapKey | translate) : null"
                          scTooltipTier="label"
                          [attr.aria-label]="a.gapKey ? (a.gapKey | translate) : null">—</span>
                  }
                </span>
              </li>
            }
          </ul>
          @if (!holo()) {
            <p class="lens-note">{{ 'codex.rank.lensNote' | translate }}</p>
          }
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* container-type makes the card itself the yardstick for the bar list
       inside it. The card is NARROWEST when the viewport is widest — the
       masthead splits 50/50 from 1100px up, so the card is half the shell
       there and the full shell below it. A viewport breakpoint would
       therefore answer the question backwards; only the card's own inline
       size can say whether two bar columns still leave a readable track.
       Column gap is the concept's .8rem (10.4px at the mock's 13px root). */
    .rank-card { padding: 16px 18px; display: grid; grid-template-columns: 210px 1fr; gap: 10px;
      container-type: inline-size; container-name: rankcard; }
    .rank-head { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 2px; }
    .rank-col-radar { display: flex; flex-direction: column; gap: 8px; }
    .rank-col-bars { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    /* Loading and the no-cohort gap draw no radar, so the one remaining column
       takes the whole card instead of leaving a 210px hole beside itself. */
    .rank-card:not(:has(.rank-col-radar)) .rank-col-bars { grid-column: 1 / -1; }
    /* Below 560px the 210px radar column eats more than a third of the card,
       so radar and bars stack instead and each gets the full width. Kept as a
       viewport query: at these sizes the card IS the viewport minus the shell
       padding, so the two measure the same thing. */
    @media (max-width: 560px) {
      .rank-card { grid-template-columns: 1fr; }
    }
    /* Card head type comes straight off the concept's head rule: 10.5px,
       .14em tracking, weight 600 accent caps, with the cohort count beside
       it at 11px in the muted role and no caps of its own. */
    h2 { margin: 0; font-size: max(10.5px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.14em;
      font-weight: 600; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; }
    /* In the concept the diamond is just the first character of the head, so
       it takes the head size; only the tracking is reset so it does not sit
       8px + .14em away from the word. */
    .glyph { font-size: inherit; letter-spacing: normal; }
    .cohort-line { margin: 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .profile-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .profile-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 4px 10px;
      border-radius: 999px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); cursor: pointer; }
    .profile-chip.active { border-color: var(--sc-accent); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-2)); }
    .profile-chip:disabled { opacity: 0.45; cursor: not-allowed; }
    /* Wrapper carries the tooltip: a disabled button gets no pointer events,
       so the "why disabled" hover must land on the span around it. */
    .chip-wrap { display: inline-flex; }

    /* Comparison head (concept round 3, L2): "Verglichen mit" + one
       segmented control + ⓘ, ruled off from the radar below it. */
    .compare-head { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding-bottom: 10px; border-bottom: 1px solid var(--sc-border); }
    .compare-label { font-size: max(10.5px, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .compare-info:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .compare-info { display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border-radius: 50%;
      border: 1px solid var(--sc-border); background: none; color: var(--sc-fg-2); font: inherit; font-size: 12px; cursor: help; }
    @media (pointer: coarse) {
      .compare-info { width: var(--sc-tap-min); height: var(--sc-tap-min); }
    }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

    .rank-skel { height: 220px; border-radius: 8px; }
    .gap-note { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }

    .verdict { position: relative; margin: 0; font-size: max(12px, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    /* The concept sets the percentage itself in a 15px accent b, the rest of
       the line in 12px body text. The app's verdict is ONE translated string
       with the number interpolated into it, so there is no element to hit
       today — this is the rule that b lands on the moment the template (or
       the i18n string, rendered as markup) carries one. */
    .verdict b { font-size: 15px; color: var(--sc-accent); font-variant-numeric: tabular-nums; }
    .verdict.gap { color: var(--sc-fg-2); font-style: italic; }
    .cohort-line.gap { font-style: italic; }
    .tip { margin-left: 4px; cursor: help; color: var(--sc-fg-2); background: none; border: none; padding: 0;
      font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .tip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pct-tip { position: absolute; display: none; }
    .tip:focus + .pct-tip, .tip:hover + .pct-tip {
      display: block; position: absolute; z-index: 5; max-width: 260px; padding: 8px 10px;
      border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }

    .radar { width: 100%; max-width: 210px; }
    .radar .rings polygon { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke-width: 1; }
    .radar .rings line { stroke: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke-width: 1; }
    .radar text { font-size: 6px; fill: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.04em; }
    .radar .ship { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke: var(--sc-accent); stroke-width: 1.5; }
    /* The comparison group's median, on the same group scale as the ship
       (0 = centre, the group's best = rim). */
    .radar .compare { fill: none; stroke: color-mix(in srgb, var(--sc-fg-0) 75%, transparent); stroke-width: 1.2; stroke-dasharray: 2.5 2.5; }
    /* Ship vs. comparison per axis: accent where the ship is ahead,
       --sc-warning where it is behind — a weaker comparison value is not an
       error (CLAUDE.md), so never --sc-danger. */
    .radar .connector { stroke-width: 2; stroke-linecap: round; }
    .radar .connector.up { stroke: var(--sc-accent); }
    .radar .connector.down { stroke: var(--sc-warning); }
    .radar text.up { fill: var(--sc-accent); font-weight: 700; }
    .radar text.down { fill: var(--sc-warning); font-weight: 700; }
    .axis-mirror.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .legend { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 5px 8px; align-items: center; margin: 0;
      font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .legend dt, .legend dd { margin: 0; }
    .legend .sw { display: block; width: 28px; height: 10px; overflow: visible; }
    .legend .sw-s { width: 12px; }
    .legend .sw-ship-fill { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent); }
    .legend .sw-ship { stroke: var(--sc-accent); stroke-width: 2; }
    .legend .sw-compare { stroke: color-mix(in srgb, var(--sc-fg-0) 75%, transparent); stroke-width: 1.6; stroke-dasharray: 3 3; }
    .legend .sw-up { stroke: var(--sc-accent); stroke-width: 2.4; stroke-linecap: round; }
    .legend .sw-down { stroke: var(--sc-warning); stroke-width: 2.4; stroke-linecap: round; }
    .legend .up { color: var(--sc-accent); }
    .legend .down { color: var(--sc-warning); }

    /* ONE column by default. A row spends 74 + 34 + two 5px gaps = 118px on
       label, value and gutters and gives the rest to the track, so the track
       is only as wide as the column it sits in. On a full-HD desktop the
       card is 604px (1224px of page content halved with a 16px gap) = 566px
       of content, 346px of that in the bars column: one column leaves a
       228px track, two would leave 114px each — and every step narrower took
       the two-column track towards zero and then overflowed the row. Beyond
       1920px the page frame grows (styles.scss, "PAGE FRAME"), and the
       container query below decides again from the card's real width. */
    .bar-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr;
      gap: 4px 12px; align-content: start; }
    /* Two columns only once the CARD can pay for them: 708px of card content
       = 210 radar + 10 gap + 2x238 bar columns + 12 gap, and 238 - 118 leaves
       the ~120px track the concept draws (part-02 renders 121px). The card
       reaches that only where the masthead is a single column, i.e. below
       1100px viewport, where the card is the full shell minus its padding. */
    @container rankcard (min-width: 708px) {
      .bar-list { grid-template-columns: 1fr 1fr; }
    }
    /* Floor for the phone and for any engine without container queries — it
       follows the container block, so below 520px it wins outright. */
    @media (max-width: 520px) {
      .bar-list { grid-template-columns: 1fr; }
    }
    .bar-row { display: grid; grid-template-columns: 74px 1fr 34px; align-items: center; gap: 5px; }
    .bar-label { font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    /* The concept's track is a 4px hairline with a 2px radius on a faint
       muted ground (16% of the muted foreground) — not an 8px pill. The fill
       is square-ended; the track's own radius and overflow clip it. */
    .bar-track { height: 4px; border-radius: 2px; overflow: hidden;
      background: color-mix(in srgb, var(--sc-fg-2) 16%, transparent); }
    .bar-fill { display: block; height: 100%; background: var(--sc-accent);
      transition: width 500ms cubic-bezier(0.2, 0.7, 0.2, 1); animation: bar-grow 700ms cubic-bezier(0.2, 0.7, 0.2, 1) 180ms backwards; }
    .bar-fill.weak { background: var(--sc-warning); }
    /* The card fills in: the bars grow from zero, the ship's polygon opens
       out of the radar's centre. A later re-rank eases between values. */
    @keyframes bar-grow { from { width: 0; } }
    .radar .ship { transform-origin: 100px 100px; transform-box: view-box; animation: radar-open 720ms cubic-bezier(0.2, 0.7, 0.2, 1) 120ms backwards; }
    @keyframes radar-open { from { opacity: 0; transform: scale(0.15); } }
    @media (prefers-reduced-motion: reduce) {
      .bar-fill, .radar .ship { animation: none; transition: none; }
    }
    .bar-value { font-size: max(11px, var(--sc-fs-floor)); text-align: right; color: var(--sc-fg-0);
      font-variant-numeric: tabular-nums; }
    .gap-dash { color: var(--sc-fg-2); cursor: help; }
    /* The concept's own footnote under the bars: 10px, muted, upright — it is
       a caption, not an aside, so it carries no italic there. */
    .lens-note { margin: 0; font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    /* Touch: the radar labels are 6 user units in a 200-unit viewBox, i.e.
       6px at the desktop 210px column. On a coarse pointer the radar gets a
       320px column (the whole card once it stacks below 560px) and 7.6-unit
       labels — 1.6 × 7.6 ≈ 12px on screen, the readability floor — and the
       profile chips reach the touch minimum. Desktop density is untouched. */
    @media (pointer: coarse) {
      .rank-card { grid-template-columns: 320px 1fr; }
      .radar { max-width: 320px; overflow: visible; }
      .radar text { font-size: 7.6px; }
      .profile-chip { min-height: var(--sc-tap-min); }
    }
    @media (pointer: coarse) and (max-width: 560px) {
      .rank-card { grid-template-columns: 1fr; }
      .radar { margin-inline: auto; }
    }

    /* ── Holotable variant (concept round 4–6 "Einordnung" panel): one calm
       column inside the panel's own frame — no card chrome, no header, the
       profile as a note (never a second selector), the cohort as a link. ── */
    :host(.holo) .rank-card { grid-template-columns: 1fr; gap: 8px; padding: 0; background: none; border: 0; box-shadow: none; }
    :host(.holo) .rank-head { display: none; }
    :host(.holo) .rolenote { margin: 0; text-align: center; font-family: var(--sc-font-display); font-size: max(8.5px, var(--sc-fs-floor));
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-accent); }
    :host(.holo) .rank-col-radar { align-items: center; gap: 4px; }
    /* The axis captions sit on the rim and run past the 200-unit box on the
       flanks ("WENDIGKEIT" lost its W); the Holotable centres the radar in a
       wide column, so they may use the margin. */
    :host(.holo) .radar { max-width: 230px; overflow: visible; }
    :host(.holo) .radar text { font-size: 7px; }
    /* Touch: the holo radar is capped at 230px (scale 1.15), so 10.5-unit
       labels land on the 12px readability floor. */
    @media (pointer: coarse) { :host(.holo) .radar text { font-size: 10.5px; } }
    :host(.holo) .radar text.gap { fill: color-mix(in srgb, var(--sc-fg-2) 60%, transparent); }
    :host(.holo) .compare-head { justify-content: center; }
    :host(.holo) .legend { align-self: stretch; }
    :host(.holo) .rank-col-bars { gap: 8px; }
    :host(.holo) .holo-verdict { text-align: center; font-size: max(11.5px, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    :host(.holo) .holo-verdict b { font-family: var(--font-monospace, monospace); font-weight: 400; }
    :host(.holo) .sub-head { margin: 0; display: flex; align-items: center; gap: 8px; font-family: var(--sc-font-display); font-size: max(8.5px, var(--sc-fs-floor));
      letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
    :host(.holo) .sub-head i { flex: 1; height: 1px; background: var(--sc-border); }
    :host(.holo) .bar-list { grid-template-columns: 1fr !important; }
    :host(.holo) .bar-row { grid-template-columns: 82px 1fr 40px; }
    :host(.holo) .bar-label { font-family: var(--sc-font-display); font-size: max(8.5px, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; }
    :host(.holo) .bar-value { font-family: var(--font-monospace, monospace); }
    :host(.holo) .rank-skel { height: 180px; }
  `],
})
export class CodexRankCardComponent {
  readonly shipName = input.required<string>();
  readonly sizeClass = input<number | null>(null);
  readonly result = input<RankResult | null>(null);
  readonly loading = input(false);

  /** The card has a cohort to draw: radar, bars and the lens note all render. */
  readonly ready = computed(() => !this.loading() && this.result() != null);
  readonly profile = input<RankProfileId>('combat');
  readonly scope = input<RankScope>('sizeClass');
  readonly disabledReasons = input<Partial<Record<RankProfileId, string | null>>>({});

  readonly profileChange = output<RankProfileId>();
  readonly scopeChange = output<RankScope>();

  /** Holotable "Einordnung" variant — see the `:host(.holo)` rules. */
  readonly holo = input(false);

  readonly profiles = RANK_PROFILES;

  readonly activeProfileLabelKey = computed<string>(
    () => RANK_PROFILES.find((p) => p.id === this.profile())?.labelKey ?? RANK_PROFILES[0].labelKey,
  );

  /** The groups the head toggle offers, in this order. Size class stays out
   * until the schema carries it (#523). */
  private static readonly SCOPES: readonly { id: RankScope; labelKey: string; reasonKey: string }[] = [
    { id: 'all', labelKey: 'codex.rank.scope.all', reasonKey: '' },
    { id: 'career', labelKey: 'codex.rank.scope.career', reasonKey: 'codex.rank.disabled.noCareer' },
    { id: 'role', labelKey: 'codex.rank.scope.role', reasonKey: 'codex.rank.disabled.noRole' },
  ];

  /** The scope the result was ACTUALLY built with — a remembered group the
   * ship has no data for shows as "Alle" here, never as a fake filter. */
  readonly activeScope = computed<RankScope>(() => this.result()?.scope ?? this.scope());

  readonly scopeChoices = computed<ScSegmentOption[]>(() => {
    const available = this.result()?.scopeAvailable;
    return CodexRankCardComponent.SCOPES.map((s) => {
      const off = !!available && !available[s.id];
      return { value: s.id, labelKey: s.labelKey, titleKey: off ? s.reasonKey : undefined, disabled: off };
    });
  });

  readonly activeScopeLabelKey = computed<string>(
    () => CodexRankCardComponent.SCOPES.find((s) => s.id === this.activeScope())?.labelKey ?? 'codex.rank.scope.all',
  );

  pickScope(scope: RankScope): void {
    if (scope !== this.activeScope()) this.scopeChange.emit(scope);
  }

  readonly rings = [1, 2, 3];

  /**
   * Vertices of the ship's line on the group scale — ONLY the axes that
   * carry a value. An axis without one contributes no vertex at all: the line
   * cuts straight across it and the caption on that spoke says
   * `codex.rank.gapAxis`. Substituting a value (let alone a flat 50) would
   * draw a number the data does not have, which is the one thing this page
   * must never do (MASTER §11, R-A29). Below three known axes there is no
   * honest shape left, so the line is dropped and only the bars speak.
   */
  readonly shipPolygonPoints = computed<string>(() => this.polygonOf((a) => a.norm));

  /** The comparison group's median line — same rule, same scale. */
  readonly comparePolygonPoints = computed<string>(() => this.polygonOf((a) => a.compareNorm));

  /** Ship vs. comparison per axis: a short stroke from the group's vertex to
   * the ship's, coloured by which side is ahead. Axes within one point of
   * each other draw none. */
  readonly connectors = computed<{ key: string; up: boolean; x1: number; y1: number; x2: number; y2: number }[]>(() => {
    const r = this.result();
    if (!r || !this.shipPolygonPoints() || !this.comparePolygonPoints()) return [];
    const n = r.axes.length;
    return r.axes.flatMap((a, i) => {
      if (a.norm == null || a.compareNorm == null || a.delta == null || Math.abs(a.delta) < 1) return [];
      const [x1, y1] = this.vertexAt(a.compareNorm, i, n).split(',').map(Number);
      const [x2, y2] = this.vertexAt(a.norm, i, n).split(',').map(Number);
      return [{ key: a.key, up: a.delta > 0, x1, y1, x2, y2 }];
    });
  });

  /** How many axes the ship's line actually rests on (specs + a11y text). */
  readonly rankedAxisCount = computed<number>(
    () => this.result()?.axes.filter((a) => a.norm != null).length ?? 0,
  );

  readonly axisCaptions = computed<{ key: string; labelKey: string; axisLabelKey: string; x: number; y: number; gap: boolean; trend: 'up' | 'down' | null }[]>(() => {
    const r = this.result();
    if (!r) return [];
    const n = r.axes.length;
    const cx = 100, cy = 100, r2 = 92;
    return r.axes.map((a, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return {
        key: a.key,
        axisLabelKey: a.labelKey,
        labelKey: a.norm == null ? 'codex.rank.gapAxis' : a.labelKey,
        x: cx + r2 * Math.cos(angle),
        y: cy + r2 * Math.sin(angle),
        gap: a.norm == null,
        trend: a.delta == null || Math.abs(a.delta) < 1 ? null : a.delta > 0 ? 'up' : 'down',
      };
    });
  });

  private polygonOf(pick: (a: RankAxisResult) => number | null): string {
    const r = this.result();
    if (!r) return '';
    const n = r.axes.length;
    const known = r.axes
      .map((a, i) => ({ v: pick(a), i }))
      .filter((p): p is { v: number; i: number } => p.v != null);
    if (known.length < 3) return '';
    return known.map((p) => this.vertexAt(p.v, p.i, n)).join(' ');
  }

  disabledReason(id: RankProfileId): string | null {
    return this.disabledReasons()[id] ?? null;
  }

  ringPoints(ring: number, n: number): string {
    if (n === 0) return '';
    const cx = 100, cy = 100, r = 80 * (ring / 3);
    return Array.from({ length: n }, (_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');
  }

  spokePoints(n: number): { x: number; y: number }[] {
    if (n === 0) return [];
    const cx = 100, cy = 100, r = 80;
    return Array.from({ length: n }, (_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }

  /** One `x,y` vertex for axis `i` of `n` at `percentile` (0-100). */
  vertexAt(percentile: number, i: number, n: number): string {
    const cx = 100, cy = 100, r = 80;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const radius = (Math.max(0, Math.min(100, percentile)) / 100) * r;
    return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  }
}
