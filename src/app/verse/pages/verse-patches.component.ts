import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { NewsService } from '../../news/news.service';
import { PatchBoardComponent } from '../../news/patch-board.component';
import { nextLineInTesting } from '../../news/patch-stats';
import { VerseApiService } from '../data/verse-api.service';
import { BetaService } from '../../core/beta.service';
import { LocaleService } from '../../core/locale/locale.service';
import { PredictionMedian } from '../data/verse.models';
import { StarTriggerService } from '../starmap/star-trigger.service';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { DOCK_HOST_CLASS, DOCK_WIDTH_STYLE } from '../shared/dock-width';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';

/** The pre-flight steps of the readiness checklist (keys of `patch_readiness.checklist`). */
export const READINESS_STEPS = ['notes', 'keybinds', 'loadout', 'shaders'] as const;
export type ReadinessStep = (typeof READINESS_STEPS)[number];

/** How long an opened dossier must stay open before it counts as "notes read". */
export const NOTES_READ_MS = 8000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `/verse/patches/<line>` → `<line>`, else null. */
export function dossierLineOf(url: string): string | null {
  const m = /^\/verse\/patches\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** `YYYY-MM-DD` → UTC ms, NaN when malformed. */
function dayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** The comet strip: a date axis with the community median and, once tipped, the reader's own tip. */
export interface CometStrip {
  medianPct: number;
  minePct: number | null;
  from: string;
  to: string;
}

/**
 * Positions of the median (and the own tip) on an axis that spans both plus
 * a margin — pure so the spec can pin it. Null without a parsable median.
 */
export function cometStrip(median: string | null, mine: string | null): CometStrip | null {
  const m = median ? dayMs(median) : NaN;
  if (!Number.isFinite(m)) return null;
  const t = mine ? dayMs(mine) : NaN;
  const own = Number.isFinite(t) ? t : null;
  const lo = Math.min(m, own ?? m) - 7 * DAY_MS;
  const hi = Math.max(m, own ?? m) + 7 * DAY_MS;
  const pct = (x: number) => Math.round(((x - lo) / (hi - lo)) * 1000) / 10;
  return {
    medianPct: pct(m),
    minePct: own === null ? null : pct(own),
    from: new Date(lo).toISOString().slice(0, 10),
    to: new Date(hi).toISOString().slice(0, 10),
  };
}

/**
 * `/verse/patches` — Patch News. Shared subpage head, then the patch board:
 * the next-patch card (monitor, pre-flight checklist, comet tip — projected
 * into the card), the time line of patch cards with nested sub-versions.
 * Search is the shell subheader's job; the board has no field of its own.
 * β off: the bare legacy board.
 */
@Component({
  selector: 'sc-verse-patches',
  // Subpages sit in the page frame; only the hub runs edge to edge (concept 2026-10-28).
  host: { class: DOCK_HOST_CLASS },
  standalone: true,
  imports: [TranslatePipe, RouterLink, VerseHeaderComponent, PatchBoardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <sc-verse-header planet="patches" [title]="'verse.area.patches' | translate" [subtitle]="'verse.patches.sub' | translate" />

      <sc-patch-board class="sc-enter" style="--sc-enter-i: 1" [embedded]="true" [barSearch]="shellOn()" [searchQuery]="barTerm()">
        @if (targetLine(); as line) {
          <div pbNext class="ng">
            <section class="col" aria-labelledby="vp-ready-h">
              <div class="ngh">
                <h3 id="vp-ready-h">{{ 'verse.patches.ready.title' | translate:{ line } }}</h3>
                <span>{{ 'verse.patches.ready.progress' | translate:{ done: doneCount(), total: steps.length } }}</span>
              </div>
              <ul class="checks">
                @for (step of steps; track step) {
                  <li>
                    <button type="button" role="switch" class="check"
                            [attr.aria-checked]="!!checklist()[step]"
                            [disabled]="savingReady()"
                            (click)="toggleStep(step)">
                      <span class="box" aria-hidden="true">{{ checklist()[step] ? '✓' : '' }}</span>
                      {{ ('verse.patches.ready.step.' + step) | translate }}
                    </button>
                  </li>
                }
              </ul>
              @if (readyError(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }
            </section>

            <section class="col" aria-labelledby="vp-comet-h">
              <div class="ngh">
                <h3 id="vp-comet-h">{{ 'verse.patches.comet.heading' | translate }}</h3>
                @if (myVote(); as vote) {
                  <span class="mine">{{ 'verse.patches.comet.mine' | translate:{ date: fmt(vote) } }}</span>
                  @if (median(); as m) { <span>· {{ 'verse.patches.comet.count' | translate:{ n: m.votes } }}</span> }
                } @else {
                  <span>{{ 'verse.patches.comet.crowd' | translate }}</span>
                  <a class="tip" routerLink="/verse/explorer">{{ 'verse.patches.comet.cta' | translate }} →</a>
                }
              </div>
              @if (releaseDate(); as d) {
                <p class="release">{{ 'verse.patches.comet.release' | translate:{ date: fmt(d) } }}</p>
              } @else if (strip(); as s) {
                <div class="strip" role="img"
                     [attr.aria-label]="'verse.patches.comet.stripAria' | translate:{ median: fmt(median()!.median), n: median()!.votes }">
                  <span class="axis"></span>
                  <span class="mark med" [style.left.%]="s.medianPct"></span>
                  @if (s.minePct !== null) {
                    <span class="mark you" [style.left.%]="s.minePct"></span>
                    <span class="lab you" [style.left.%]="s.minePct">{{ 'verse.patches.comet.you' | translate }}</span>
                  }
                </div>
                <div class="strip-l"><span>{{ fmt(s.from) }}</span><span>{{ fmt(s.to) }}</span></div>
                <p class="legend">
                  <span><i class="sw med"></i>{{ 'verse.patches.comet.medianShort' | translate:{ date: fmt(median()!.median) } }}</span>
                  @if (myVote(); as v) { <span><i class="sw you"></i>{{ 'verse.patches.comet.yourShort' | translate:{ date: fmt(v) } }}</span> }
                </p>
              } @else {
                <p class="meta">{{ 'verse.patches.comet.empty' | translate }}</p>
              }
            </section>
          </div>
        }
      </sc-patch-board>
    } @else {
      <sc-patch-board />
    }
  `,
  styles: [`
    :host { display: block; }
    /* Inside the next-patch card: two plain columns, no boxes of their own. */
    .ng {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 16px 30px;
      padding: 14px 16px 16px 150px; border-top: 1px solid color-mix(in srgb, var(--sc-accent) 12%, transparent);
    }
    .ngh { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 10px; }
    .ngh h3 {
      margin: 0; font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600;
      letter-spacing: 0.2em; text-transform: uppercase; color: var(--sc-accent); white-space: nowrap;
    }
    .ngh span { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .ngh .mine { color: var(--sc-fg-0); }
    .tip { margin-left: auto; color: var(--sc-accent); font-size: max(0.82rem, var(--sc-fs-floor)); font-weight: 600; text-decoration: none; white-space: nowrap; }
    .tip:hover { text-decoration: underline; }
    .tip:focus-visible, .check:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 6px; }
    .checks { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .check {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: var(--sc-tap-min);
      padding: 6px 10px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--sc-fg-2) 30%, transparent);
      background: transparent; color: var(--sc-fg-1); font: inherit; text-align: left; cursor: pointer;
      position: relative; z-index: 1;
    }
    .check:hover { border-color: var(--sc-accent); }
    .check[aria-checked='true'] { border-color: var(--sc-accent); color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .box {
      display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 6px;
      border: 1px solid var(--sc-border); color: var(--sc-accent); font-weight: 700;
    }
    .meta { margin: 0; color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor)); }
    .err { margin: 8px 0 0; color: var(--sc-danger); }
    .release { margin: 0; font-family: var(--sc-font-display); font-size: 1.4rem; font-weight: 600; color: var(--sc-fg-0); }

    /* The community's tip on a date axis: median marker, own tip once tipped. */
    .strip { position: relative; height: 38px; margin: 0 6px; }
    .axis { position: absolute; left: 0; right: 0; top: 22px; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--sc-fg-2) 24%, transparent); }
    .mark { position: absolute; top: 14px; width: 2px; height: 20px; transform: translateX(-50%); border-radius: 1px; }
    .mark.med { background: var(--sc-accent); box-shadow: 0 0 8px var(--sc-accent); }
    .mark.you { background: var(--sc-fg-0); box-shadow: 0 0 8px color-mix(in srgb, var(--sc-fg-0) 60%, transparent); }
    .lab { position: absolute; top: 0; transform: translateX(-50%); font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-0); white-space: nowrap; }
    .strip-l { display: flex; justify-content: space-between; margin: 2px 6px 0; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 8px 0 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 10px; height: 4px; border-radius: 2px; }
    .sw.med { background: var(--sc-accent); }
    .sw.you { background: var(--sc-fg-0); }

    @media (max-width: 900px) { .ng { grid-template-columns: minmax(0, 1fr); padding-left: 12px; padding-right: 12px; } }
    @media (max-width: 760px) { .ng { padding-left: 12px; } }
    @media (max-width: 480px) { .checks { grid-template-columns: minmax(0, 1fr); } }
  `, DOCK_WIDTH_STYLE],
})
export class VersePatchesComponent {
  private readonly news = inject(NewsService);
  private readonly api = inject(VerseApiService);
  private readonly stars = inject(StarTriggerService);
  private readonly router = inject(Router);
  private readonly locale = inject(LocaleService);
  readonly enabled = inject(BetaService).isEnabled('verse');
  /** Without the shell β there is no subheader search; the board keeps its own field. */
  protected readonly shellOn = inject(BetaService).isEnabled('shell');

  protected readonly steps = READINESS_STEPS;

  /** The line the pre-flight is about: the one in a test ring, else the digest's. */
  readonly targetLine = computed<string | null>(() => {
    const testing = nextLineInTesting(this.news.patchLines());
    if (testing?.line) return testing.line;
    const p = this.api.digest()?.patch;
    return p?.status === 'ptu' ? (p.channels['ptu']?.split('.').slice(0, 2).join('.') ?? null) : null;
  });

  readonly checklist = signal<Record<string, boolean>>({});
  readonly doneCount = computed(() => READINESS_STEPS.filter((s) => this.checklist()[s]).length);
  readonly savingReady = signal(false);
  readonly readyError = signal<string | null>(null);

  readonly myVote = signal<string | null>(null);
  readonly median = signal<PredictionMedian | null>(null);
  readonly strip = computed(() => cometStrip(this.median()?.median ?? null, this.myVote()));
  /** An announced LIVE date of the target line, when the digest carries one. */
  readonly releaseDate = computed<string | null>(() => {
    const p = this.api.digest()?.patch;
    return p?.liveAt && p.line === this.targetLine() ? p.liveAt.slice(0, 10) : null;
  });

  private notesTimer: ReturnType<typeof setTimeout> | null = null;

  /** What the user types into the subheader search; the board filters its timeline by it. */
  protected readonly barTerm = signal('');

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(inject(ShellChromeService).registerPageSearch(this, (term) => this.barTerm.set(term)));
    effect(() => {
      const line = this.targetLine();
      if (line && this.enabled()) void this.loadPreflight(line);
    });
    this.watchDossier(this.router.url);
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(destroyRef))
      .subscribe((e) => this.watchDossier((e as NavigationEnd).urlAfterRedirects));
    destroyRef.onDestroy(() => this.clearNotesTimer());
  }

  /** `YYYY-MM-DD` as a short local date ("6. Nov."). */
  fmt(iso: string): string {
    const t = dayMs(iso);
    if (!Number.isFinite(t)) return iso;
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(t);
    } catch {
      return iso;
    }
  }

  private async loadPreflight(line: string): Promise<void> {
    const [ready, vote] = await Promise.all([this.api.getReadiness(line), this.api.getMyPrediction(line)]);
    if (ready.ok) this.checklist.set({ ...(ready.data?.checklist ?? {}) });
    if (vote.ok) this.myVote.set(vote.data?.predictedLiveDate ?? null);
    // The distribution is shown to everyone; a refused read just leaves it empty.
    const res = await this.api.predictionMedian(line);
    this.median.set(res.ok ? res.data : null);
  }

  async toggleStep(step: ReadinessStep): Promise<void> {
    const line = this.targetLine();
    if (!line) return;
    const before = this.checklist();
    const next = { ...before, [step]: !before[step] };
    this.checklist.set(next);
    this.savingReady.set(true);
    this.readyError.set(null);
    const res = await this.api.saveReadiness(line, next);
    this.savingReady.set(false);
    if (!res.ok) {
      this.checklist.set(before);
      this.readyError.set(res.errorKey);
    }
  }

  /** An opened dossier that stays open earns the "notes" star. */
  private watchDossier(url: string): void {
    this.clearNotesTimer();
    if (!dossierLineOf(url)) return;
    this.notesTimer = setTimeout(() => void this.stars.earn('notes'), NOTES_READ_MS);
  }

  private clearNotesTimer(): void {
    if (this.notesTimer) clearTimeout(this.notesTimer);
    this.notesTimer = null;
  }
}
