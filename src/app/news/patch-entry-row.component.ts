import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { PatchNoteEntry, patchLineOf } from './patch-notes';
import { PatchNoteDetailComponent } from './patch-note-detail.component';
import { PatchStabilityService } from './patch-stability.service';
import { StabilityChipComponent } from './stability-chip.component';
import { RoadmapService, threadSlugOf } from './roadmap.service';
import { outlineMatchCount } from './patch-outline';
import { HighlightSegment, highlightSegments } from './patch-search';

/**
 * One patch note in the history — collapsed to a line, expandable to the note
 * itself (feedback 961ab0a5).
 *
 * Its own component because the history renders this row in two places (as a
 * top-level entry and inside a folded run of build waves) and the two had
 * drifted into two near-identical copies of the same markup. One component,
 * one behaviour, one stylesheet — and the patch-notes section stays under the
 * per-component CSS budget.
 *
 * TWO CONTROLS, TWO KINDS OF THING, per the project's anchor/button rule:
 *   - expanding the note is an ACTION on this page → a button, which is also
 *     what makes it work with a keyboard and announce `aria-expanded`;
 *   - the note lives on RSI → a real anchor beside it, so middle click and
 *     "open in new tab" keep working. Both are always present, so the source is
 *     never more than one click away no matter which way the reader works.
 */
@Component({
  selector: 'sc-patch-entry-row',
  standalone: true,
  imports: [TranslateModule, PatchNoteDetailComponent, StabilityChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" [class.open]="open()">
      <button type="button" class="main"
              [attr.aria-expanded]="open()"
              (click)="toggled.emit(entry().item.id)">
        <span class="caret" aria-hidden="true">›</span>
        <span class="body">
          <span class="title">
            @for (seg of titleSegments(); track $index) {
              @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> }
            }
          </span>
          <span class="meta">
            @if (!compact() && entry().version) {
              <span class="tag ver">{{ entry().version }}</span>
            }
            @if (!compact() && entry().stage) {
              <span class="tag" [attr.data-stage]="entry().stage">
                {{ ('news.patch.stage.' + entry().stage) | translate }}
              </span>
            }
            @if (!compact() && entry().hotfix) {
              <span class="tag hotfix">{{ 'news.patch.hotfix' | translate }}</span>
            }
            @if (!compact() && chipVerdict(); as v) {
              <sc-stability-chip [verdict]="v" />
            }
            <time>{{ when() }}</time>
            <!-- How many lines INSIDE the note the query hits. Only shown once
                 the note's contents are actually loaded, so it can never
                 promise a number it had to guess. -->
            @if (matchCount() > 0) {
              <span class="tag hits">{{ 'news.patch.detail.hits' | translate:{ count: matchCount() } }}</span>
            } @else if (bulletCount() > 0) {
              <span class="tag pts">{{ 'news.patch.detail.points' | translate:{ count: bulletCount() } }}</span>
            }
          </span>
        </span>
      </button>
      <a class="rsi" [href]="entry().item.url" target="_blank" rel="noopener noreferrer"
         [attr.aria-label]="'news.patch.detail.openOnRsiAria' | translate:{ title: entry().item.title }">
        <span aria-hidden="true">↗</span>
      </a>
    </div>
    @if (open()) {
      <sc-patch-note-detail [slug]="slug()" [url]="entry().item.url" [tokens]="tokens()" [verdict]="verdict()" />
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: stretch; }
    .main {
      display: flex; align-items: flex-start; gap: 10px; flex: 1 1 auto;
      min-width: 0; min-height: var(--sc-tap-min);
      padding: 9px 6px 9px 12px;
      background: transparent; border: 0; color: var(--sc-fg-0);
      font-family: inherit; text-align: left; cursor: pointer;
    }
    .main:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .main:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }
    .caret {
      flex: 0 0 auto; width: 12px; text-align: center; line-height: 1.4;
      color: var(--sc-accent); transition: transform .16s ease;
    }
    .row.open .caret { transform: rotate(90deg); }
    .body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .title { font-size: max(0.86rem, var(--sc-fs-floor)); line-height: 1.35; }
    .meta {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .rsi {
      flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
      color: var(--sc-fg-2); text-decoration: none; font-size: 0.9rem;
    }
    .rsi:hover { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .rsi:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }

    .tag {
      display: inline-flex; align-items: center;
      padding: 1px 7px; border-radius: 999px;
      font-size: max(0.64rem, var(--sc-fs-floor)); font-weight: 700;
      letter-spacing: 0.07em; text-transform: uppercase; white-space: nowrap;
      color: var(--sc-fg-2); border: 1px solid color-mix(in srgb, var(--sc-fg-2) 45%, transparent);
    }
    .tag.ver, .tag.pts, .tag.hits { text-transform: none; letter-spacing: 0.02em; }
    .tag.ver { color: var(--sc-fg-1); }
    .tag[data-stage='live'] { color: var(--sc-success); border-color: color-mix(in srgb, var(--sc-success) 55%, transparent); }
    .tag[data-stage='ptu'] { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .tag.hotfix { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 55%, transparent); }
    .tag.hits {
      color: var(--sc-bg-0); font-weight: 700;
      background: var(--sc-accent); border-color: var(--sc-accent);
    }

    mark {
      background: color-mix(in srgb, var(--sc-accent) 32%, transparent);
      color: inherit; border-radius: 3px; padding: 0 1px;
    }
  `],
})
export class PatchEntryRowComponent {
  private readonly svc = inject(RoadmapService);
  private readonly stability = inject(PatchStabilityService);

  /**
   * Only the LIVE release-notes row carries the verdict: it is the one row a
   * reader identifies with "the patch". Hotfix threads and PTU waves stay bare.
   * Inside a folded wave the summary row already names the patch, so the chip
   * stays off compact rows like the other per-row tags.
   */
  readonly verdict = computed(() => {
    const e = this.entry();
    if (e.stage !== 'live' || e.hotfix || !e.version) return null;
    return this.stability.verdictFor(patchLineOf(e.version));
  });

  /**
   * The chip renders nothing without a level, so don't give it a flex slot
   * either — an empty host still costs `.meta`'s gap.
   */
  readonly chipVerdict = computed(() => {
    const v = this.verdict();
    return v && v.level !== null ? v : null;
  });

  readonly entry = input.required<PatchNoteEntry>();
  /** Pre-rendered relative timestamp — the section owns the one ticking clock. */
  readonly when = input('');
  readonly tokens = input<readonly string[]>([]);
  readonly open = input(false);
  /**
   * Inside a folded run of build waves the version and channel are already on
   * the summary above, so repeating them on every wave is noise.
   */
  readonly compact = input(false);

  readonly toggled = output<string>();

  readonly slug = computed(() => threadSlugOf(this.entry().item.url));

  /** Bullets in the note — only known once its contents have been loaded. */
  readonly bulletCount = computed(() => this.svc.outlineFor(this.slug())?.bulletCount ?? 0);

  readonly matchCount = computed(() => {
    const tokens = this.tokens();
    if (tokens.length === 0) return 0;
    const outline = this.svc.outlineFor(this.slug());
    return outline ? outlineMatchCount(outline, tokens) : 0;
  });

  readonly titleSegments = computed<HighlightSegment[]>(
    () => highlightSegments(this.entry().item.title, this.tokens()),
  );
}
