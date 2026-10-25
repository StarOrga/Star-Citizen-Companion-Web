import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ReleaseNotesService } from './release-notes.service';
import { ScDatePipe } from '../core/locale/sc-date.pipe';

/** Releases rendered per batch; the next batch loads when the end scrolls near. */
const BATCH = 5;
/** The newest releases open by default; older ones start folded to their headlines. */
const OPEN_BY_DEFAULT = 3;

/** Keep-a-Changelog standard categories that get a localized, colored tag. */
const KNOWN_CATEGORIES = ['added', 'changed', 'fixed', 'removed', 'deprecated', 'security'] as const;
type KnownCategory = (typeof KNOWN_CATEGORIES)[number];

/**
 * "What's New" — the in-app release notes, rendered from the build-time
 * `/release-notes.json` (generated from CHANGELOG.md). Viewer-accessible.
 *
 * Long history, short attention span: five releases render first, an end
 * sentinel loads the next five as the reader nears the bottom, the newest
 * three are open and older ones fold to their section headlines.
 */
@Component({
  selector: 'sc-release-notes',
  standalone: true,
  imports: [ScDatePipe, TranslatePipe],
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
        <ol class="timeline">
          @for (r of visibleReleases(); track r.version; let i = $index) {
            <li class="release" [id]="'v' + r.version">
              <div class="rel-head">
                <span class="ver mono">v{{ r.version }}</span>
                @if (r.date) { <time class="date">{{ toDate(r.date) | scDate }}</time> }
                <button type="button" class="expander"
                        [attr.aria-expanded]="isOpen(r.version, i)"
                        [attr.aria-controls]="isOpen(r.version, i) ? 'rel-' + r.version : null"
                        (click)="toggle(r.version, i)">
                  {{ (isOpen(r.version, i) ? 'releaseNotes.collapse' : 'releaseNotes.expand') | translate }}
                </button>
              </div>
              @if (isOpen(r.version, i)) {
                <div class="rel-body" [id]="'rel-' + r.version">
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
                </div>
              } @else {
                <div class="rel-folded" [id]="'rel-' + r.version">
                  @for (s of r.sections; track $index) {
                    <span class="sec-head">
                      @if (kind(s.category); as k) {
                        <span class="tag tag-{{ k }}">{{ 'releaseNotes.cat.' + k | translate }}</span>
                      } @else {
                        <span class="tag tag-other">{{ s.category }}</span>
                      }
                      @if (s.label) { <span class="sec-label">{{ s.label }}</span> }
                    </span>
                  }
                </div>
              }
            </li>
          }
        </ol>
        @if (hiddenCount() > 0) {
          <div #sentinel class="sentinel" aria-hidden="true"></div>
          <button type="button" class="load-more" (click)="loadMore()">
            {{ 'releaseNotes.loadMore' | translate: { count: hiddenCount() } }}
          </button>
        }
      } @else {
        <div class="sc-card empty">{{ 'releaseNotes.empty' | translate }}</div>
      }
    </section>
  `,
  styles: [`
    /* No .page sizing: the page runs the full frame like every other page
       (styles.scss, "PAGE FRAME"). */
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
    .sentinel { height: 1px; }
    .load-more {
      display: block; margin: 0.5rem auto 0; padding: 8px 18px;
      border-radius: 999px; cursor: pointer;
      font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.05em;
      border: 1px solid var(--sc-accent); color: var(--sc-accent);
      background: rgba(0, 212, 255, 0.06);
    }
    .load-more:hover { background: rgba(0, 212, 255, 0.14); }
    .load-more:focus-visible, .expander:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    @media (pointer: coarse) {
      .load-more, .expander { min-height: 48px; min-width: 48px; }
    }

    .timeline { list-style: none; margin: 0; padding: 0; position: relative; }
    .timeline::before {
      content: ''; position: absolute; left: 7px; top: 6px; bottom: 6px;
      width: 2px; background: linear-gradient(var(--sc-accent), transparent);
      opacity: 0.4;
    }
    .release { position: relative; padding: 0 0 1.6rem 30px; scroll-margin-top: calc(var(--sc-topbar-h, 72px) + 12px); }
    .release::before {
      content: ''; position: absolute; left: 0; top: 6px;
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--sc-bg-1); border: 2px solid var(--sc-accent);
      box-shadow: 0 0 8px rgba(0, 212, 255, 0.4);
    }
    .rel-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 0.7rem; flex-wrap: wrap; }
    .ver { font-family: var(--sc-font-display); font-size: 1.05rem; color: var(--sc-fg-1); letter-spacing: 0.04em; }
    .date { color: var(--sc-fg-2); font-size: 0.8rem; }
    .expander {
      margin-left: auto; background: none; border: 0; padding: 4px 8px; cursor: pointer;
      color: var(--sc-accent); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); border-radius: 4px;
      min-height: var(--sc-tap-min, 0);
    }
    .expander:hover { color: var(--sc-fg-1); }
    .rel-folded { display: flex; flex-wrap: wrap; gap: 6px 18px; }
    .rel-folded .sec-head { margin: 0; }

    /* The entries are paragraphs (often 300-800 characters), not one-liners, so
       across the full frame a release flows through newspaper columns instead
       of running 170-character lines: one column on a phone, two on a laptop,
       three on a wide screen, each line near a comfortable reading measure.
       A section never splits across columns, so every bullet sits under its
       own category tag (a balanced split left bullets in column 2 unlabelled). */
    .rel-body { columns: 26rem; column-gap: 32px; }
    .section { margin: 0 0 0.9rem; break-inside: avoid; }
    .sec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 0.35rem; flex-wrap: wrap; break-after: avoid; }
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

    /* Block flow, not a grid: plain blocks fragment across columns in every
       engine, grid rows do not everywhere. */
    .items { margin: 0; padding-left: 1.1rem; }
    /* overflow-wrap: a code token in an entry ("ship/weapon/component/item/…",
       a SQL expression) is wider than a phone column and pushed the page wider
       than the screen. */
    .items li { color: var(--sc-fg-2); line-height: 1.5; font-size: 0.9rem; break-inside: avoid; overflow-wrap: anywhere; }
    .items li + li { margin-top: 0.4rem; }
    .items li strong { color: var(--sc-fg-1); font-weight: 600; }
    .mono { font-family: ui-monospace, monospace; }

    @media (max-width: 560px) {
      .release { padding-left: 24px; }
    }
  `],
})
export class ReleaseNotesComponent implements OnInit {
  private readonly svc = inject(ReleaseNotesService);
  private readonly route = inject(ActivatedRoute);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  readonly loading = signal(true);
  readonly releases = signal(this.svc.notes()?.releases ?? []);
  readonly current = signal<string | null>(this.svc.notes()?.current ?? null);

  /** How many releases are rendered; grows by BATCH. */
  readonly shown = signal(BATCH);
  /** Manual open/fold choices per version; absent = the default for its rank. */
  private readonly toggled = signal<Readonly<Record<string, boolean>>>({});

  readonly visibleReleases = computed(() => this.releases().slice(0, this.shown()));
  readonly hiddenCount = computed(() => Math.max(0, this.releases().length - this.shown()));

  constructor() {
    // Infinite scroll: while the end sentinel is (or comes) near the viewport,
    // the next batch loads. Re-armed after every batch so a tall screen keeps
    // filling; the "load more" button stays as the keyboard / no-IO fallback.
    effect((onCleanup) => {
      this.shown();
      const el = this.sentinel()?.nativeElement;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) this.loadMore();
        },
        { rootMargin: '0px 0px 400px 0px' },
      );
      io.observe(el);
      onCleanup(() => io.disconnect());
    });
  }

  async ngOnInit(): Promise<void> {
    const notes = await this.svc.load();
    if (notes) {
      this.releases.set(notes.releases);
      this.current.set(notes.current);
      this.revealFragment();
    }
    this.loading.set(false);
  }

  loadMore(): void {
    this.shown.update((n) => Math.min(n + BATCH, this.releases().length));
  }

  isOpen(version: string, index: number): boolean {
    return this.toggled()[version] ?? index < OPEN_BY_DEFAULT;
  }

  toggle(version: string, index: number): void {
    const open = this.isOpen(version, index);
    this.toggled.update((t) => ({ ...t, [version]: !open }));
  }

  /** `#v<version>`: load enough batches to reach it, open it and scroll to it. */
  private revealFragment(): void {
    const frag = this.route.snapshot.fragment;
    if (!frag || !frag.startsWith('v')) return;
    const version = frag.slice(1);
    const idx = this.releases().findIndex((r) => r.version === version);
    if (idx < 0) return;
    this.shown.set(Math.max(BATCH, Math.ceil((idx + 1) / BATCH) * BATCH));
    this.toggled.update((t) => ({ ...t, [version]: true }));
    if (typeof document === 'undefined') return;
    setTimeout(() => document.getElementById(frag)?.scrollIntoView({ block: 'start' }), 50);
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
