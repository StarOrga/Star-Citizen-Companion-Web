import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import { InfoNoteComponent } from '../shared/info-note.component';
import type { ScheduledDeployment } from './news.service';
import type { PatchLineGroup } from './patch-notes';
import { computeTestBuildRelease, nextPatchDistance, testBuildNote, type TestBuildNote } from './patch-stats';

const DAY_MS = 24 * 60 * 60 * 1000;

/** RSI's status site — where a LIVE deployment is announced, and the fallback link. */
export const RSI_STATUS_URL = 'https://status.robertsspaceindustries.com/';

interface PtuReleaseView {
  version: string;
  state: 'ontrack' | 'over';
  estimate: { date: string; when: string; inTestDays: number; medianDays: number; samples: number } | null;
  official: { date: string; when: string; title: string; url: string } | null;
  /** Main line + newest note of the build — the way into its changes (feedback #317, round 2). */
  note: TestBuildNote | null;
}

/**
 * "Wann kommt dieser Patch?" for the build in the PTU right now (feedback #317).
 *
 * The monitor answers the next MAIN patch (5.0); a point release in the test
 * ring (4.10.3 while 4.10.2 is live) had no date anywhere. This panel names the
 * newest test build — whatever it is at the time, nothing is hard-coded — and
 * puts two answers side by side, never blended:
 *
 *   · our estimate — first test build plus the median PTU → LIVE time of a
 *     version (`computeTestBuildRelease`, the monitor's model at version level);
 *   · the official date — the LIVE deployment RSI schedules on its status site,
 *     read server-side by `fetch-verse-news` (`deployment`), with its source
 *     link; "noch kein offizielles Datum" while RSI has announced none.
 */
@Component({
  selector: 'sc-ptu-release',
  standalone: true,
  imports: [TranslatePipe, RouterLink, InfoNoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <section class="pr" [attr.data-state]="v.state" [attr.aria-label]="'news.patch.ptuRelease.title' | translate:{ version: v.version }">
        <header class="mh">
          <span class="beacon" aria-hidden="true"></span>
          <h2>{{ 'news.patch.ptuRelease.title' | translate:{ version: v.version } }}</h2>
          <sc-info-note [label]="'news.patch.ptuRelease.infoLabel' | translate">
            <p>{{ 'news.patch.ptuRelease.infoEstimate' | translate }}</p>
            <p>{{ 'news.patch.ptuRelease.infoOfficial' | translate }}</p>
          </sc-info-note>
        </header>

        @if (v.note; as n) {
          <!-- The build's own changes, framed by the main patch it belongs to. -->
          <p class="notes">
            <a [routerLink]="['/verse/patches', n.line]" [queryParams]="{ note: n.noteId }">{{ 'news.patch.ptuRelease.openNotes' | translate:{ version: v.version } }} →</a>
            <a class="line" [routerLink]="['/verse/patches', n.line]">{{ 'news.patch.ptuRelease.partOf' | translate:{ line: n.line } }}</a>
          </p>
        }

        <dl class="tiles">
          <div class="tile est" [attr.data-state]="v.state">
            <dt>{{ 'news.patch.ptuRelease.estimate' | translate }}</dt>
            @if (v.estimate; as e) {
              <dd>{{ e.date }}
                <small>{{ e.when }}</small>
                <small>{{ 'news.patch.ptuRelease.estimateBasis' | translate:{ days: e.inTestDays, median: num(e.medianDays), n: e.samples } }}</small>
              </dd>
            } @else {
              <dd class="none">{{ 'news.patch.ptuRelease.noEstimate' | translate }}</dd>
            }
          </div>
          <div class="tile off" [class.has]="!!v.official">
            <dt>{{ 'news.patch.ptuRelease.official' | translate }}</dt>
            @if (v.official; as o) {
              <dd>{{ o.date }}
                <small>{{ o.when }}</small>
                <small><a [href]="o.url" target="_blank" rel="noopener noreferrer">{{ 'news.patch.ptuRelease.source' | translate:{ title: o.title } }} ↗</a></small>
              </dd>
            } @else {
              <dd class="none">{{ 'news.patch.ptuRelease.noOfficial' | translate }}
                <small><a [href]="statusUrl" target="_blank" rel="noopener noreferrer">{{ 'news.patch.ptuRelease.statusLink' | translate }} ↗</a></small>
              </dd>
            }
          </div>
        </dl>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pr {
      display: flex; flex-direction: column; gap: 10px;
      margin-bottom: 16px; padding: 14px 16px 16px; border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--sc-success) 40%, var(--sc-border));
      background: linear-gradient(135deg, color-mix(in srgb, var(--sc-success) 8%, var(--sc-bg-1)), var(--sc-bg-1) 65%);
    }
    .pr[data-state='over'] { border-color: color-mix(in srgb, var(--sc-warning) 45%, var(--sc-border)); background: linear-gradient(135deg, color-mix(in srgb, var(--sc-warning) 8%, var(--sc-bg-1)), var(--sc-bg-1) 65%); }
    .mh { display: flex; align-items: center; gap: 8px; }
    h2 {
      flex: 1 1 auto; margin: 0; font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2);
    }
    .beacon { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--sc-success); box-shadow: 0 0 10px var(--sc-success); }
    .pr[data-state='over'] .beacon { background: var(--sc-warning); box-shadow: 0 0 10px var(--sc-warning); }
    .notes { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin: 0; font-size: max(0.86rem, var(--sc-fs-floor)); }
    .notes a { display: inline-flex; align-items: center; min-height: var(--sc-tap-min); font-weight: 600; }
    .notes .line { color: var(--sc-fg-1); font-weight: 400; }
    .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; margin: 0; background: var(--sc-border); border: 1px solid var(--sc-border); border-radius: 8px; overflow: hidden; }
    .tile { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; background: var(--sc-bg-0); min-width: 0; }
    dt { font-family: var(--sc-font-display); font-size: max(0.6rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); }
    dd { display: flex; flex-direction: column; gap: 2px; margin: 0; font-family: var(--sc-font-display); font-size: 1.4rem; font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    dd.none { font-size: 1.05rem; color: var(--sc-fg-1); }
    .tile.est[data-state='over'] dd { color: var(--sc-warning); }
    .tile.off.has dd { color: var(--sc-accent); }
    small { font-family: var(--sc-font-body); font-size: max(0.7rem, var(--sc-fs-floor)); font-weight: 400; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    a { color: var(--sc-accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    a:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    p { margin: 0 0 8px; }
    p:last-child { margin-bottom: 0; }
    @media (max-width: 640px) {
      .tiles { grid-template-columns: minmax(0, 1fr); }
      dd { font-size: 1.2rem; }
    }
  `],
})
export class PtuReleaseComponent {
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);

  readonly groups = input.required<readonly PatchLineGroup[]>();
  readonly deployment = input<ScheduledDeployment | null>(null);
  readonly now = input<number>(Date.now());

  protected readonly statusUrl = RSI_STATUS_URL;

  private readonly release = computed(() => computeTestBuildRelease(this.groups()));

  readonly view = computed<PtuReleaseView | null>(() => {
    const r = this.release();
    if (!r) return null;
    const now = this.now();
    const days = Math.round((r.at - now) / DAY_MS);
    const d = this.deployment();
    const officialAt = d ? Date.parse(d.at) : NaN;
    return {
      version: r.version,
      state: days < 0 ? 'over' : 'ontrack',
      estimate: {
        date: this.date(r.at),
        when: this.distance(days),
        inTestDays: Math.max(0, Math.floor((now - r.firstTestAt) / DAY_MS)),
        medianDays: r.medianDays,
        samples: r.samples,
      },
      official: d && Number.isFinite(officialAt)
        ? { date: this.dateTime(officialAt), when: this.distance(Math.round((officialAt - now) / DAY_MS)), title: d.title, url: d.url }
        : null,
      note: testBuildNote(this.groups(), r.version),
    };
  });

  num(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  /** Same grammar as the monitor: day-exact inside a fortnight, weeks beyond. */
  private distance(days: number): string {
    const b = nextPatchDistance(days);
    if (b.unit === 'today') return this.t.instant('news.patch.forecast.today');
    const key = b.unit === 'days'
      ? (b.overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays')
      : (b.overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks');
    return this.t.instant(key, { n: b.n });
  }

  private date(ms: number): string {
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  /** The announced window has a start time — that is worth showing. */
  private dateTime(ms: number): string {
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
    }
  }
}
