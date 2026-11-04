import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqLiveService } from '../now/hq-live.service';
import { StageHeroDirective } from '../../shell/fusion-bar/stage-hero.directive';
import { StageSearchDirective } from '../../shell/fusion-bar/stage-search.directive';
import { HqCueComponent } from '../hq-cue.component';
import { HqFirstVisitComponent } from './hq-first-visit.component';

/** One of the (at most two) patch lines under the Start title: "4.3.1 · S3-Repeater −8 %" / "betrifft Bounty v3 ›". */
export interface HqPatchLine {
  category: string;
  effect: string;
  /** Where "betrifft …" leads (optional); rendered as a real anchor. */
  link?: string[];
  queryParams?: Record<string, string>;
}

/** One "Jetzt wichtig" chip (input-driven; the page shows at most {@link HQ_CHIP_MAX}). */
export interface HqChip {
  id: string;
  label: string;
  link: string[];
  fragment?: string;
  queryParams?: Record<string, string>;
}

export const HQ_CHIP_MAX = 4;
export const HQ_PATCH_LINE_MAX = 2;
/** localStorage key of "Überspringen" on the first-visit block. */
export const HQ_FIRST_SKIPPED_KEY = 'sc.hq.first.skipped';

/**
 * The Start page of the HQ landing (concept D7–D10): the main page hero — kicker, title, two
 * patch-line slots — the bar's own search field standing in the scene (`[scStageSearch]`, the
 * same `fusion-search` that docks into the subheader on the follow pages), the "Jetzt wichtig"
 * chips and, for a first visit, the launch-step block. The zoomed hub planet behind it is the
 * shell scene (`hq` scene, always on the main pages). The page cue leads to Planen.
 *
 * Feeds (Wave 2+): `patchLines` (P8, only for the newest patch and only when it touches the
 * reader's ships/sets) and `chips` (P3: upcoming Einsätze …). Empty → nothing is rendered.
 */
@Component({
  selector: 'sc-hq-start',
  standalone: true,
  imports: [RouterLink, TranslatePipe, StageHeroDirective, StageSearchDirective, HqCueComponent, HqFirstVisitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sc-stage-hero hero" scStageHero>
      <p class="kicker">{{ 'hq.start.kicker' | translate }}</p>
      <h1 class="title">{{ 'hq.start.title' | translate }}</h1>
      @if (lines().length) {
        <ul class="patch">
          @for (l of lines(); track l.category) {
            <li>
              <span class="cat">{{ l.category }}</span>
              @if (l.link) {
                <a class="effect" [routerLink]="l.link" [queryParams]="l.queryParams">{{ l.effect }} <span aria-hidden="true">›</span></a>
              } @else {
                <span class="effect">{{ l.effect }}</span>
              }
            </li>
          }
        </ul>
      }
      <div scStageSearch></div>
    </div>

    <div class="below">
      @if (showFirst()) {
        <sc-hq-first-visit [hangarDone]="hasShips()" [appDone]="hasApp()" [einsatzDone]="hasEinsatz()" (skipped)="skip()" />
      } @else if (shownChips().length) {
        <nav class="chips" [attr.aria-label]="'hq.start.important' | translate">
          <span class="chips-label">{{ 'hq.start.important' | translate }}</span>
          @for (c of shownChips(); track c.id) {
            <a class="chip" [routerLink]="c.link" [fragment]="c.fragment" [queryParams]="c.queryParams">{{ c.label }}</a>
          }
        </nav>
      }
    </div>

    <sc-hq-cue class="cue" target="planen" />
  `,
  styles: [
    `
      :host {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
        /* The page stage starts under the shell header: fill the rest of the viewport (D5). */
        min-height: calc(100svh - var(--hq-start-top, 0px));
        padding-bottom: calc(var(--sc-space-8, 64px) + var(--sc-space-3, 12px));
      }
      .hero { padding-top: var(--sc-space-8, 64px); }
      .kicker { margin: 0; font: var(--sc-hero-eyebrow); letter-spacing: 0.24em; text-transform: uppercase; color: var(--sc-accent); }
      .title { margin: max(6px, 0.6vw) 0 0; font: 500 var(--sc-hero-title-size) / 1.1 var(--sc-font-display); letter-spacing: 0.02em; }
      .patch { display: flex; flex-direction: column; gap: 2px; margin: var(--sc-space-3, 12px) 0 0; padding: 0; list-style: none; color: var(--sc-fg-1); }
      .cat { margin-inline-end: var(--sc-space-2, 8px); color: var(--sc-fg-2); }
      .effect { color: var(--sc-fg); text-decoration: none; }
      a.effect:hover { color: var(--sc-accent); }
      a.effect:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .below { display: flex; justify-content: center; width: min(100%, 720px); margin-top: var(--sc-space-4, 16px); }
      .chips { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--sc-space-2, 8px); }
      .chips-label { font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); }
      .chip {
        display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px;
        border: 1px solid var(--sc-border); border-radius: 999px;
        background: color-mix(in srgb, var(--sc-bg-1) 70%, transparent);
        color: var(--sc-fg); text-decoration: none;
      }
      .chip:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
      .chip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .cue { position: absolute; inset-inline: 0; bottom: max(12px, 1.4vw); }
      /* Phones: the bottom bar is the way on; the cue would sit under it. */
      @media (max-width: 1023px) { .cue { display: none; } :host { padding-bottom: var(--sc-space-6, 32px); } }
      @media (pointer: coarse) { .chip { min-height: 48px; } }
    `,
  ],
})
export class HqStartComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly hangar = inject(HangarService);
  private readonly live = inject(HqLiveService);
  private readonly einsatz = inject(HqEinsatzService);

  readonly patchLines = input<readonly HqPatchLine[]>([]);
  readonly chips = input<readonly HqChip[]>([]);

  readonly lines = computed(() => this.patchLines().slice(0, HQ_PATCH_LINE_MAX));
  readonly shownChips = computed(() => this.chips().slice(0, HQ_CHIP_MAX));

  readonly hasShips = computed(() => this.hangar.ships().length > 0);
  /**
   * "SCC-App starten" is done once the SCC app itself reported game data (a live state or any
   * live event) - an uploader or Starscape check-in does not count.
   */
  readonly hasApp = computed(() => this.live.state() !== null || this.live.events().length > 0);
  readonly hasEinsatz = computed(() => this.einsatz.items().length > 0);

  private readonly skippedState = signal(readSkipped());
  /** The hangar is in (set by {@link load}). */
  private readonly loaded = signal(false);
  /**
   * The launch steps stay until all three are done (feedback 2026-11-02: the block vanished as
   * soon as ONE step was done). Decided once the data is in - hangar, the SCC app's live feed and
   * the first Einsatz pull - and latched, so a step turning done while the block is open plays its
   * tick instead of the block vanishing under it.
   */
  private readonly latched = signal(false);
  private decided = false;
  readonly showFirst = computed(() => !this.skippedState() && this.latched());

  constructor() {
    effect(() => {
      if (this.decided || !this.loaded()) return;
      if (!this.einsatz.ready() && !this.einsatz.syncError()) return;
      if (!this.live.loaded()) return;
      this.decided = true;
      this.latched.set(!this.hasShips() || !this.hasApp() || !this.hasEinsatz());
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    if (!this.auth.user()) return;
    if (this.hangar.ships().length === 0 && this.hangar.roleLoadouts().length === 0) await this.hangar.loadAll();
    this.loaded.set(true);
  }

  skip(): void {
    this.skippedState.set(true);
    try {
      localStorage.setItem(HQ_FIRST_SKIPPED_KEY, '1');
    } catch {
      // private mode: the skip lasts for this page view only
    }
  }
}

function readSkipped(): boolean {
  try {
    return localStorage.getItem(HQ_FIRST_SKIPPED_KEY) === '1';
  } catch {
    return false;
  }
}
