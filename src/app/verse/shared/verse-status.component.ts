import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { NewsService } from '../../news/news.service';
import { PatchLineGroup } from '../../news/patch-notes';
import {
  computeNextPatch,
  daysUntilNextPatch,
  liveReleaseAt,
  nextLineInTesting,
} from '../../news/patch-stats';
import { VerseApiService } from '../data/verse-api.service';
import { VersePatchStatus } from '../data/verse.models';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VerseStatusView {
  /** Current LIVE line, e.g. `4.3`. */
  line: string;
  /** The line in a test ring, when there is one. */
  ptuLine: string | null;
  state: 'live' | 'ptu';
  /** Whole days since the LIVE release, null when unknown. */
  sinceDays: number | null;
  /** Days until the median estimate (negative = overdue), null without one. */
  nextDays: number | null;
  /** 0..100 — how far the current run is through its usual length. */
  progress: number | null;
}

/**
 * The slim header instrument: newest LIVE line, whether a PTU is running, days
 * since LIVE and the median estimate for the next one. Prefers the patch-note
 * feed (same math as the patch monitor); falls back to the digest's
 * `patch` block while the feed is still loading.
 */
export function verseStatusView(
  groups: readonly PatchLineGroup[],
  digest: VersePatchStatus | null,
  now: number,
): VerseStatusView | null {
  const live = groups.find((g) => g.line && g.isCurrentLive) ?? null;
  if (live) {
    const liveAt = liveReleaseAt(live);
    const testing = nextLineInTesting(groups);
    const est = computeNextPatch(groups);
    const nextDays = est ? daysUntilNextPatch(est, now) : null;
    const span = est ? est.at - est.anchorAt : 0;
    const progress = est && span > 0 ? clamp(((now - est.anchorAt) / span) * 100) : null;
    return {
      line: live.line,
      ptuLine: testing?.line ?? null,
      state: testing ? 'ptu' : 'live',
      sinceDays: liveAt !== null ? Math.max(0, Math.floor((now - liveAt) / DAY_MS)) : null,
      nextDays,
      progress,
    };
  }
  if (!digest) return null;
  const liveAt = digest.liveAt ? Date.parse(digest.liveAt) : NaN;
  return {
    line: digest.line,
    ptuLine: digest.status === 'ptu' ? (digest.channels['ptu'] ?? null) : null,
    state: digest.status,
    sinceDays: Number.isFinite(liveAt) ? Math.max(0, Math.floor((now - liveAt) / DAY_MS)) : null,
    nextDays: null,
    progress: null,
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

@Component({
  selector: 'sc-verse-status',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <div class="vs" [attr.data-state]="v.state" role="status"
           [attr.aria-label]="'verse.status.aria' | translate:{ line: v.line }">
        <span class="beacon" aria-hidden="true"></span>
        <span class="ln"><b>{{ v.line }}</b>
          <span class="tag">{{ 'verse.status.live' | translate }}</span>
          @if (v.ptuLine) { <span class="tag ptu">{{ 'verse.status.ptu' | translate:{ line: v.ptuLine } }}</span> }
        </span>
        @if (v.sinceDays !== null) {
          <span class="fact">{{ 'verse.status.since' | translate:{ n: v.sinceDays } }}</span>
        }
        @if (v.nextDays !== null) {
          <span class="fact next" [class.over]="v.nextDays < 0">
            {{ (v.nextDays < 0 ? 'verse.status.overdue' : 'verse.status.next') | translate:{ n: abs(v.nextDays) } }}
          </span>
        }
        @if (v.progress !== null) {
          <span class="rail" aria-hidden="true"><i [style.width.%]="v.progress"></i></span>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .vs {
      display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px;
      font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .beacon {
      width: 8px; height: 8px; border-radius: 50%; background: var(--sc-success);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-success) 25%, transparent);
    }
    .vs[data-state='ptu'] .beacon {
      background: var(--sc-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 25%, transparent);
    }
    .ln { display: inline-flex; align-items: baseline; gap: 6px; }
    .ln b { font-family: var(--sc-font-display); color: var(--sc-fg-0); font-size: 1rem; letter-spacing: 0.04em; }
    .tag {
      font-family: var(--sc-font-display); font-size: max(0.66rem, var(--sc-fs-floor));
      letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-success);
    }
    .tag.ptu { color: var(--sc-accent); }
    .fact.next.over { color: var(--sc-warning); }
    .rail {
      position: relative; width: 72px; height: 4px; border-radius: 2px; background: var(--sc-bg-3); overflow: hidden;
    }
    .rail i { position: absolute; inset: 0 auto 0 0; background: var(--sc-accent); border-radius: 2px; }
    @media (max-width: 480px) { .rail { display: none; } }
  `],
})
export class VerseStatusComponent {
  private readonly news = inject(NewsService);
  private readonly api = inject(VerseApiService);

  readonly view = computed(() =>
    verseStatusView(this.news.patchLines(), this.api.digest()?.patch ?? null, Date.now()),
  );

  constructor() {
    if (!this.news.feed() && !this.news.loading()) void this.news.refresh(true);
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }
}
