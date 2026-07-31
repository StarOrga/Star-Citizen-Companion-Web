import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ReleaseNotesService } from './release-notes.service';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

/** Keep-a-Changelog standard categories that get a localized, colored tag. */
const KNOWN_CATEGORIES = ['added', 'changed', 'fixed', 'removed', 'deprecated', 'security'] as const;
type KnownCategory = (typeof KNOWN_CATEGORIES)[number];

/**
 * "What's New" — the in-app release notes, rendered from the build-time
 * `/release-notes.json` (generated from CHANGELOG.md). Viewer-accessible.
 */
@Component({
  selector: 'sc-release-notes',
  standalone: true,
  imports: [ScDatePipe, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="head">
        <h1>{{ 'releaseNotes.title' | translate }}</h1>
        <p class="hint">{{ 'releaseNotes.subtitle' | translate }}</p>
        @if (current(); as v) {
          <span class="sc-pill current">{{ 'releaseNotes.current' | translate }} · v{{ v }}</span>
        }
      </header>

      @if (loading()) {
        <div class="sc-card empty">{{ 'releaseNotes.loading' | translate }}</div>
      } @else if (releases().length) {
        @if (!showAll() && hiddenCount() > 0) {
          <p class="recent-hint">{{ 'releaseNotes.recentHint' | translate }}</p>
        }
        <ol class="timeline">
          @for (r of visibleReleases(); track r.version) {
            <li class="release">
              <div class="rel-head">
                <span class="ver mono">v{{ r.version }}</span>
                @if (r.date) { <time class="date">{{ toDate(r.date) | scDate }}</time> }
              </div>
              @for (s of r.sections; track $index) {
                <div class="section">
                  <div class="sec-head">
                    @if (kind(s.category); as k) {
                      <span class="tag tag-{{ k }}">{{ 'releaseNotes.cat.' + k | translate }}</span>
                    } @else {
                      <span class="tag tag-other">{{ s.category }}</span>
                    }
                    @if (s.label) { <span class="sec-label">{{ s.label }}</span> }
                  </div>
                  <ul class="items">
                    @for (it of s.items; track $index) {
                      <li>
                        @if (it.title) { <strong>{{ it.title }}</strong> }
                        {{ it.text }}
                      </li>
                    }
                  </ul>
                </div>
              }
            </li>
          }
        </ol>
        @if (hiddenCount() > 0) {
          <button type="button" class="load-more" (click)="showAll.set(true)">
            {{ 'releaseNotes.loadMore' | translate: { count: hiddenCount() } }}
          </button>
        } @else if (showAll() && releases().length > visibleRecentCount()) {
          <button type="button" class="load-more ghost" (click)="showAll.set(false)">
            {{ 'releaseNotes.showLess' | translate }}
          </button>
        }
      } @else {
        <div class="sc-card empty">{{ 'releaseNotes.empty' | translate }}</div>
      }
    </section>
  `,
  styles: [`
    .page { padding: 0.5rem 0; max-width: 820px; margin: 0 auto; }
    .head { margin-bottom: 1.5rem; }
    .head h1 {
      font-family: var(--sc-font-display); letter-spacing: 0.06em;
      text-transform: uppercase; margin: 0 0 0.35rem;
    }
    .hint { color: var(--sc-fg-2); margin: 0 0 0.6rem; }
    .sc-pill.current {
      display: inline-block; font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.05em;
      padding: 3px 10px; border-radius: 999px;
      border: 1px solid var(--sc-accent); color: var(--sc-accent);
      background: rgba(0, 212, 255, 0.08); font-family: var(--sc-font-display);
    }
    .empty { text-align: center; color: var(--sc-fg-2); padding: 1.5rem; }
    .recent-hint { color: var(--sc-fg-2); font-size: 0.8rem; margin: 0 0 1rem; }
    .load-more {
      display: block; margin: 0.5rem auto 0; padding: 8px 18px;
      border-radius: 999px; cursor: pointer;
      font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.05em;
      border: 1px solid var(--sc-accent); color: var(--sc-accent);
      background: rgba(0, 212, 255, 0.06);
    }
    .load-more:hover { background: rgba(0, 212, 255, 0.14); }
    .load-more.ghost { border-color: var(--sc-border); color: var(--sc-fg-2); background: transparent; }
    .load-more.ghost:hover { border-color: var(--sc-fg-2); }

    .timeline { list-style: none; margin: 0; padding: 0; position: relative; }
    .timeline::before {
      content: ''; position: absolute; left: 7px; top: 6px; bottom: 6px;
      width: 2px; background: linear-gradient(var(--sc-accent), transparent);
      opacity: 0.4;
    }
    .release { position: relative; padding: 0 0 1.6rem 30px; }
    .release::before {
      content: ''; position: absolute; left: 0; top: 6px;
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--sc-bg-1); border: 2px solid var(--sc-accent);
      box-shadow: 0 0 8px rgba(0, 212, 255, 0.4);
    }
    .rel-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 0.7rem; flex-wrap: wrap; }
    .ver { font-family: var(--sc-font-display); font-size: 1.05rem; color: var(--sc-fg-1); letter-spacing: 0.04em; }
    .date { color: var(--sc-fg-2); font-size: 0.8rem; }

    .section { margin: 0 0 0.9rem; }
    .sec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 0.35rem; flex-wrap: wrap; }
    .tag {
      font-size: max(0.62rem, var(--sc-fs-floor)); letter-spacing: 0.09em; text-transform: uppercase;
      font-family: var(--sc-font-display); padding: 2px 8px; border-radius: 4px;
      border: 1px solid currentColor;
    }
    .tag-added { color: #3fb950; }
    .tag-changed { color: var(--sc-accent, #52c1e6); }
    .tag-fixed { color: #d29922; }
    .tag-removed { color: #f85149; }
    .tag-deprecated { color: #db6d28; }
    .tag-security { color: #a371f7; }
    .tag-other { color: var(--sc-fg-2); }
    .sec-label { color: var(--sc-fg-1); font-size: 0.9rem; font-weight: 600; }

    .items { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.4rem; }
    .items li { color: var(--sc-fg-2); line-height: 1.5; font-size: 0.9rem; }
    .items li strong { color: var(--sc-fg-1); font-weight: 600; }
    .mono { font-family: ui-monospace, monospace; }

    @media (max-width: 560px) {
      .release { padding-left: 24px; }
    }
  `],
})
export class ReleaseNotesComponent implements OnInit {
  private readonly svc = inject(ReleaseNotesService);

  readonly loading = signal(true);
  readonly releases = signal(this.svc.notes()?.releases ?? []);
  readonly current = signal<string | null>(this.svc.notes()?.current ?? null);

  /** Collapse older releases by default; "load more" reveals the full history. */
  readonly showAll = signal(false);

  // Releases within the last 3 months. Undated entries count as recent (they're
  // typically the newest/unreleased). If nothing falls inside the window (e.g.
  // no release in 3 months), keep the single most-recent one so the page is
  // never empty.
  private readonly recentReleases = computed(() => {
    const all = this.releases();
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    const cutoffMs = cutoff.getTime();
    const recent = all.filter((r) => {
      const t = new Date(r.date).getTime();
      return Number.isNaN(t) || t >= cutoffMs;
    });
    return recent.length > 0 ? recent : all.slice(0, 1);
  });

  readonly visibleReleases = computed(() =>
    this.showAll() ? this.releases() : this.recentReleases(),
  );
  readonly visibleRecentCount = computed(() => this.recentReleases().length);
  readonly hiddenCount = computed(() => this.releases().length - this.visibleReleases().length);

  async ngOnInit(): Promise<void> {
    const notes = await this.svc.load();
    if (notes) {
      this.releases.set(notes.releases);
      this.current.set(notes.current);
    }
    this.loading.set(false);
  }

  /** Returns the standard-category kind (for tag color + i18n key), or null. */
  kind(category: string): KnownCategory | null {
    const first = category.trim().split(/[\s/]+/)[0]?.toLowerCase() ?? '';
    return (KNOWN_CATEGORIES as readonly string[]).includes(first) ? (first as KnownCategory) : null;
  }

  /** CHANGELOG dates are ISO (YYYY-MM-DD); parse for the ScDatePipe. */
  toDate(iso: string): Date | string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d;
  }
}
