import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { Release, ReleaseNotesService } from '../release-notes/release-notes.service';
import { ReleaseSeenService } from '../release-notes/release-seen.service';

/** One highlight row of the feature card. */
interface Highlight { title: string; text: string; }

/** How much of the feature card must be visible, and for how long, to count as seen. */
const SEEN_RATIO = 0.5;
const SEEN_MS = 1000;
const HIGHLIGHTS = 4;

/**
 * /about — public "who runs this and what is it" page.
 *
 * Trust/legitimacy surface for both humans and URL-reputation scanners:
 * a login-capable site with no self-description matches phishing heuristics,
 * so this page states purpose, operator, source code and non-affiliation
 * in plain, crawlable text (linked from the footer and the login page).
 */
@Component({
  selector: 'sc-about',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page sc-card-page">
      <h1>{{ 'legal.about.title' | translate }}</h1>
      <p class="subtitle">{{ 'legal.about.subtitle' | translate }}</p>

      @if (latest(); as rel) {
        <article #feature class="sc-card wide feature" [attr.aria-label]="'legal.about.new.eyebrow' | translate">
          <div class="feature-top">
            <span class="eyebrow">{{ 'legal.about.new.eyebrow' | translate }}</span>
            <span class="badge mono">v{{ rel.version }}</span>
            @if (rel.date) { <time class="date">{{ toDate(rel.date) | scDate }}</time> }
          </div>
          @if (headline(); as h) { <h2 class="headline">{{ h }}</h2> }
          <ul class="highlights">
            @for (h of highlights(); track $index) {
              <li><strong>{{ h.title }}</strong>@if (h.text) { <span>{{ h.text }}</span> }</li>
            }
          </ul>
          <a class="cta" routerLink="/release-notes">{{ 'legal.about.new.cta' | translate }}</a>
        </article>
        @if (earlier().length) {
          <div class="earlier wide">
            <h2 class="earlier-title">{{ 'legal.about.new.earlier' | translate }}</h2>
            <div class="earlier-grid">
              @for (r of earlier(); track r.version) {
                <a class="sc-card mini" routerLink="/release-notes" [fragment]="'v' + r.version">
                  <span class="mini-top"><span class="mono">v{{ r.version }}</span>@if (r.date) { <time class="date">{{ toDate(r.date) | scDate }}</time> }</span>
                  <span class="mini-text">{{ miniTitles(r) }}</span>
                </a>
              }
            </div>
          </div>
        }
      }

      <div class="sc-card wide">
        <h2>{{ 'legal.about.what.title' | translate }}</h2>
        <p>{{ 'legal.about.what.p1' | translate }}</p>
        <p>{{ 'legal.about.what.p2' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.about.openSource.title' | translate }}</h2>
        <p>{{ 'legal.about.openSource.p1' | translate }}</p>
        <ul class="link-list">
          <li>
            <a href="https://github.com/StarOrga/Star-Citizen-Companion-Web"
               target="_blank" rel="noopener noreferrer">
              {{ 'legal.about.openSource.repoLink' | translate }}
            </a>
          </li>
        </ul>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.about.data.title' | translate }}</h2>
        <p>{{ 'legal.about.data.p1' | translate }}</p>
        <a routerLink="/legal/privacy">{{ 'legal.about.data.privacyLink' | translate }}</a>
      </div>

      <div class="sc-card affiliation">
        <h2>{{ 'legal.about.affiliation.title' | translate }}</h2>
        <p>{{ 'legal.about.affiliation.p1' | translate }}</p>
        <p class="disclaimer">{{ 'footer.trademarks' | translate }}</p>
      </div>

      <div class="sc-card">
        <h2>{{ 'legal.about.contact.title' | translate }}</h2>
        <p>{{ 'legal.about.contact.p1' | translate }}</p>
        <ul class="link-list">
          <li>
            <a href="https://github.com/StarOrga/Star-Citizen-Companion-Web/issues"
               target="_blank" rel="noopener noreferrer">
              {{ 'legal.about.contact.issuesLink' | translate }}
            </a>
          </li>
          <li>
            <a href="/.well-known/security.txt" target="_blank" rel="noopener noreferrer">
              {{ 'legal.about.contact.securityLink' | translate }}
            </a>
          </li>
        </ul>
      </div>
    </section>
  `,
  styles: [`
    /* Layout: the shared .sc-card-page (styles.scss) — full page frame, "what
       is this" across both columns, the other four sections paired. */
    h1 { margin: 0; }
    .subtitle { color: var(--sc-fg-2); margin: -8px 0 0; }
    h2 {
      margin: 0 0 10px;
      font-size: 1rem;
      font-family: var(--sc-font-display);
      letter-spacing: 0.04em;
    }
    p { line-height: 1.55; margin: 0 0 10px; }
    p:last-child { margin-bottom: 0; }
    a { color: var(--sc-accent); }
    a:hover { color: var(--sc-fg-0); }
    .link-list { margin: 0; padding-left: 20px; }
    .link-list li { margin: 4px 0; }
    /* A list entry that is nothing but a link is a control, not prose — on touch
       it gets the full hit area instead of the ~19px inline text box. */
    @media (pointer: coarse) {
      .link-list li > a { display: flex; align-items: center; min-height: var(--sc-tap-min); }
    }
    .mono { font-family: ui-monospace, monospace; }
    .date { color: var(--sc-fg-2); font-size: 0.8rem; }
    .feature {
      position: relative; padding: 24px 28px;
      border-color: var(--sc-accent);
      background:
        radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--sc-accent) 16%, transparent), transparent 60%),
        var(--sc-bg-1);
    }
    .feature-top { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 8px; }
    .eyebrow {
      font-family: var(--sc-font-display); letter-spacing: 0.14em; text-transform: uppercase;
      font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-accent);
    }
    .badge {
      font-size: clamp(1.6rem, 4vw, 2.4rem); line-height: 1; color: var(--sc-fg-0);
      letter-spacing: 0.02em; text-shadow: 0 0 18px color-mix(in srgb, var(--sc-accent) 55%, transparent);
    }
    .headline { font-size: 1.25rem; margin: 0 0 12px; overflow-wrap: anywhere; }
    .highlights { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 10px; max-width: var(--sc-measure, 70ch); }
    .highlights li { display: flex; flex-direction: column; gap: 2px; padding-left: 14px; border-left: 2px solid var(--sc-accent); }
    .highlights strong { color: var(--sc-fg-1); overflow-wrap: anywhere; }
    .highlights span {
      color: var(--sc-fg-2); font-size: 0.9rem; overflow-wrap: anywhere;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .cta {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 40px); padding: 0 18px;
      border: 1px solid var(--sc-accent); border-radius: 999px; text-decoration: none;
      font-family: var(--sc-font-display); letter-spacing: 0.05em;
      background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
    }
    .cta:hover { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
    .cta:focus-visible, .mini:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .earlier-title { font-size: 0.85rem; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.1em; }
    .earlier-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .mini { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: inherit; padding: 14px 16px; }
    .mini:hover { border-color: var(--sc-accent); }
    .mini-top { display: flex; align-items: baseline; gap: 10px; color: var(--sc-fg-1); }
    .mini-text { color: var(--sc-fg-2); font-size: 0.85rem; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .affiliation { border-color: var(--sc-accent); }
    .affiliation .disclaimer {
      color: var(--sc-fg-2);
      font-size: max(0.78rem, var(--sc-fs-floor));
      border-top: 1px solid var(--sc-border);
      padding-top: 10px;
      margin-top: 12px;
    }
  `],
})
export class AboutComponent {
  private readonly notes = inject(ReleaseNotesService);
  private readonly seen = inject(ReleaseSeenService);
  private readonly feature = viewChild<ElementRef<HTMLElement>>('feature');

  readonly latest = computed<Release | null>(() => this.notes.notes()?.releases[0] ?? null);
  /** The two releases before the newest, as compact cards. */
  readonly earlier = computed<Release[]>(() => this.notes.notes()?.releases.slice(1, 3) ?? []);

  private readonly items = computed<Highlight[]>(() =>
    (this.latest()?.sections ?? []).flatMap((s) => s.items).filter((i) => i.title || i.text),
  );
  /** First item title, else the first section label. */
  readonly headline = computed(() => {
    const rel = this.latest();
    return this.items()[0]?.title || rel?.sections.find((s) => s.label)?.label || '';
  });
  /** 3-4 highlight rows: the first items' titles with a one-line text. */
  readonly highlights = computed<Highlight[]>(() => {
    const list = this.items().filter((i) => i.title);
    return (list.length ? list : this.items()).slice(0, HIGHLIGHTS);
  });

  constructor() {
    void this.notes.load();
    // The card counts as seen once at least half of it stayed visible for a second.
    effect((onCleanup) => {
      const el = this.feature()?.nativeElement;
      if (!el) return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      const arm = () => {
        if (!timer) timer = setTimeout(() => this.seen.markSeen(), SEEN_MS);
      };
      if (typeof IntersectionObserver === 'undefined') {
        arm();
        onCleanup(clear);
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1];
          if (e && e.intersectionRatio >= SEEN_RATIO) arm();
          else clear();
        },
        { threshold: [0, SEEN_RATIO, 1] },
      );
      io.observe(el);
      onCleanup(() => {
        clear();
        io.disconnect();
      });
    });
  }

  /** The first item titles of a release, joined into one teaser line. */
  miniTitles(r: Release): string {
    return r.sections
      .flatMap((s) => s.items)
      .map((i) => i.title)
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');
  }

  toDate(iso: string): Date | string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d;
  }
}
