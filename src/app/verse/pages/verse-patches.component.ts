import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';
import { NewsService } from '../../news/news.service';
import { PatchBoardComponent } from '../../news/patch-board.component';
import { PatchStabilityService } from '../../news/patch-stability.service';
import { nextLineInTesting } from '../../news/patch-stats';
import { VerseApiService } from '../data/verse-api.service';
import { VerseBetaService } from '../data/verse-beta.service';
import { PredictionMedian } from '../data/verse.models';
import { StarTriggerService } from '../starmap/star-trigger.service';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { verseKpiTiles } from './verse-patch-kpis';

/** The pre-flight steps of the readiness checklist (keys of `patch_readiness.checklist`). */
export const READINESS_STEPS = ['notes', 'keybinds', 'loadout', 'shaders'] as const;
export type ReadinessStep = (typeof READINESS_STEPS)[number];

/** How long an opened dossier must stay open before it counts as "notes read". */
export const NOTES_READ_MS = 8000;

/** `/verse/patches/<line>` → `<line>`, else null. */
export function dossierLineOf(url: string): string | null {
  const m = /^\/verse\/patches\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * `/verse/patches` — Patch News. The patch board (monitor rail, time stack,
 * dossier overlay) under the Verse subheader, topped by five fact tiles,
 * the readiness checklist and the comet vote. β off: the bare legacy board.
 */
@Component({
  selector: 'sc-verse-patches',
  standalone: true,
  imports: [TranslatePipe, VerseHeaderComponent, PatchBoardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <sc-verse-header [title]="'verse.area.patches' | translate" [subtitle]="'verse.patches.sub' | translate" />

      @if (tiles().length) {
        <dl class="kpis">
          @for (k of tiles(); track k.key) {
            <div class="kpi">
              <dd><b>{{ k.of !== undefined ? (k.value + ' / ' + k.of) : ('verse.patches.kpi.' + k.key + '.value' | translate:{ n: k.value }) }}</b></dd>
              <dt>{{ ('verse.patches.kpi.' + k.key + '.label') | translate }}</dt>
              @if (k.spark.length) {
                <span class="spark" aria-hidden="true">
                  @for (s of k.spark; track $index) {
                    <i [style.height.%]="s.pct" [class.now]="s.now" [attr.data-tone]="s.tone ?? null"></i>
                  }
                </span>
              }
            </div>
          }
        </dl>
      }

      @if (targetLine(); as line) {
        <div class="preflight">
          <section class="panel" [attr.aria-labelledby]="'vp-ready-h'">
            <h2 id="vp-ready-h">{{ 'verse.patches.ready.title' | translate:{ line } }}</h2>
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
            <p class="meta">{{ 'verse.patches.ready.progress' | translate:{ done: doneCount(), total: steps.length } }}</p>
            @if (readyError(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }
          </section>

          <section class="panel comet" [attr.aria-labelledby]="'vp-comet-h'">
            <h2 id="vp-comet-h">{{ 'verse.patches.comet.title' | translate:{ line } }}</h2>
            @if (myVote(); as vote) {
              <p class="vote">{{ 'verse.patches.comet.yours' | translate:{ date: vote } }}</p>
              @if (median(); as m) {
                <p class="median">{{ 'verse.patches.comet.median' | translate:{ date: m.median, n: m.votes } }}</p>
              }
            } @else {
              <p class="meta">{{ 'verse.patches.comet.hint' | translate }}</p>
              <form class="vote-form" (submit)="$event.preventDefault(); vote()">
                <label for="vp-comet-date">{{ 'verse.patches.comet.label' | translate }}</label>
                <input id="vp-comet-date" type="date" class="date" [min]="today" [value]="draft()"
                       (input)="draft.set($any($event.target).value)" />
                <button type="submit" class="sc-btn sc-btn-primary" [disabled]="!draft() || voting()">
                  {{ 'verse.patches.comet.submit' | translate }}
                </button>
              </form>
            }
            @if (voteError(); as e) { <p class="err" role="alert">{{ e | translate }}</p> }
          </section>
        </div>
      }

      <sc-patch-board [embedded]="true" />
    } @else {
      <sc-patch-board />
    }
  `,
  styles: [`
    :host { display: block; }
    .kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin: 0 0 14px; }
    .kpi {
      position: relative; display: grid; gap: 2px; padding: 12px 12px 30px; border-radius: 12px; overflow: hidden;
      background: linear-gradient(160deg, color-mix(in srgb, var(--sc-accent) 12%, transparent), var(--sc-bg-1) 60%);
      border: 1px solid var(--sc-border);
    }
    .kpi dd { margin: 0; }
    .kpi b { font-family: var(--sc-font-display); font-size: 1.35rem; color: var(--sc-accent); }
    .kpi dt { font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .spark { position: absolute; left: 12px; right: 12px; bottom: 8px; height: 16px; display: flex; align-items: flex-end; gap: 3px; }
    .spark i { flex: 1; border-radius: 2px 2px 0 0; background: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .spark i.now { background: var(--sc-accent); }
    .spark i[data-tone='ok'] { background: var(--sc-success); }
    .spark i[data-tone='warn'] { background: var(--sc-warning); }
    .spark i[data-tone='bad'] { background: var(--sc-danger); }
    .preflight { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-bottom: 16px; }
    .panel { padding: 14px 16px; border-radius: 12px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .panel h2 { margin: 0 0 10px; font-size: 1rem; }
    .checks { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .check {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: var(--sc-tap-min);
      padding: 6px 10px; border-radius: 10px; border: 1px solid var(--sc-border); background: var(--sc-bg-2);
      color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    .check[aria-checked='true'] { border-color: var(--sc-accent); }
    .check:focus-visible, .date:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .box {
      display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px;
      border: 1px solid var(--sc-border); color: var(--sc-accent); font-weight: 700;
    }
    .meta { margin: 8px 0 0; color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor)); }
    .err { margin: 8px 0 0; color: var(--sc-danger); }
    .vote-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
    .vote-form label { width: 100%; font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .date {
      min-height: var(--sc-tap-min); padding: 0 10px; border-radius: 10px; color-scheme: dark;
      border: 1px solid var(--sc-border); background: var(--sc-bg-2); color: var(--sc-fg-0); font: inherit;
    }
    .vote b, .median { color: var(--sc-accent); }
    .vote, .median { margin: 4px 0 0; }
    @media (max-width: 900px) {
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .preflight { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 480px) { .checks { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class VersePatchesComponent {
  private readonly news = inject(NewsService);
  private readonly stability = inject(PatchStabilityService);
  private readonly api = inject(VerseApiService);
  private readonly stars = inject(StarTriggerService);
  private readonly router = inject(Router);
  readonly enabled = inject(VerseBetaService).isEnabled('patches');

  protected readonly steps = READINESS_STEPS;
  protected readonly today = todayIso();

  readonly tiles = computed(() => verseKpiTiles(this.news.patchLines(), this.stability.allTime()));
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
  readonly draft = signal('');
  readonly voting = signal(false);
  readonly voteError = signal<string | null>(null);

  private notesTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
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

  private async loadPreflight(line: string): Promise<void> {
    const [ready, vote] = await Promise.all([this.api.getReadiness(line), this.api.getMyPrediction(line)]);
    if (ready.ok) this.checklist.set({ ...(ready.data?.checklist ?? {}) });
    if (vote.ok) {
      this.myVote.set(vote.data?.predictedLiveDate ?? null);
      if (vote.data) await this.loadMedian(line);
    }
  }

  private async loadMedian(line: string): Promise<void> {
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

  async vote(): Promise<void> {
    const line = this.targetLine();
    const date = this.draft();
    if (!line || !date) return;
    this.voting.set(true);
    this.voteError.set(null);
    const res = await this.api.submitPrediction(line, date);
    this.voting.set(false);
    if (!res.ok) {
      this.voteError.set(res.errorKey);
      return;
    }
    this.myVote.set(date);
    await this.loadMedian(line);
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
