import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RoadmapService } from './roadmap.service';
import { OutlineSection, filterSections, outlineSections } from './patch-outline';
import { HighlightSegment, highlightSegments } from './patch-search';

/**
 * The inside of one patch note — the expanded half of the history row
 * (feedback 961ab0a5: "detail uncollapsed views vs collapsed, patch bullet
 * points erfasst und suchbar").
 *
 * A row in the patch history used to be a title and a link off to Spectrum.
 * Expanded, it is now the note itself: RSI's headings, its sub-headings and
 * every bullet point, rendered in the app and searchable with the same query
 * box as the rest of the page.
 *
 * LOADED ON DEMAND. The board lists a hundred-odd notes and nobody reads a
 * hundred, so the outline is fetched the first time a row is opened (or when
 * the board seeds the newest note per channel up front). That is what keeps
 * opening `/news/patches` a single small request.
 *
 * WHAT IS NOT HERE, ON PURPOSE: a "no contents" row is not an error. RSI's
 * older threads, deleted posts and the odd reshaped payload all land there, and
 * the honest answer is a link to the source rather than a red box — the link
 * out to RSI is present either way, so nothing is ever a dead end.
 */
@Component({
  selector: 'sc-patch-note-detail',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pn">
      @if (loading()) {
        <p class="pn-state">{{ 'news.patch.detail.loading' | translate }}</p>
      } @else if (!outline()) {
        <p class="pn-state">{{ 'news.patch.detail.unavailable' | translate }}</p>
      } @else if (sections().length === 0) {
        <p class="pn-state">{{ 'news.patch.detail.noMatch' | translate }}</p>
      } @else {
        <ol class="pn-sections">
          @for (section of sections(); track $index) {
            <li class="pn-section">
              @if (section.heading) {
                <h5 class="pn-heading">
                  @for (seg of mark(section.heading); track $index) {
                    @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> }
                  }
                </h5>
              }
              @if (section.links && section.links.length > 0) {
                <!-- RSI puts the "full, in-depth notes" link on the heading
                     line; it goes off-site, so a real anchor in a new tab. -->
                <a class="pn-link" [href]="section.links[0]" target="_blank" rel="noopener noreferrer">
                  {{ 'news.patch.detail.fullNotes' | translate }}
                </a>
              }
              @for (group of section.groups; track $index) {
                @if (group.label) {
                  <p class="pn-sub">
                    @for (seg of mark(group.label); track $index) {
                      @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> }
                    }
                  </p>
                }
                <ul class="pn-lines">
                  @for (node of group.nodes; track $index) {
                    <li class="pn-line" [attr.data-kind]="node.kind" [attr.data-depth]="node.depth">
                      <span class="pn-text">
                        @for (seg of mark(node.text); track $index) {
                          @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> }
                        }
                      </span>
                      @if (node.links && node.links.length > 0) {
                        <a class="pn-link" [href]="node.links[0]" target="_blank" rel="noopener noreferrer">
                          {{ 'news.patch.detail.linkOut' | translate }}
                        </a>
                      }
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ol>
        @if (outline()!.truncated) {
          <p class="pn-state">{{ 'news.patch.detail.truncated' | translate }}</p>
        }
      }

      <a class="pn-source" [href]="url()" target="_blank" rel="noopener noreferrer">
        {{ 'news.patch.detail.openOnRsi' | translate }}
      </a>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pn {
      display: flex; flex-direction: column; gap: 8px;
      padding: 8px 12px 12px 34px;
      border-top: 1px dashed color-mix(in srgb, var(--sc-border) 60%, transparent);
    }
    .pn-state {
      margin: 0; color: var(--sc-fg-2);
      font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .pn-sections, .pn-lines { list-style: none; margin: 0; padding: 0; }
    .pn-sections { display: flex; flex-direction: column; gap: 10px; }
    .pn-heading {
      margin: 0 0 4px; font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--sc-accent); font-weight: 700;
    }
    .pn-sub {
      margin: 6px 0 2px; font-size: max(0.74rem, var(--sc-fs-floor));
      font-weight: 600; color: var(--sc-fg-1);
    }
    .pn-lines { display: flex; flex-direction: column; gap: 2px; }
    .pn-line {
      display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px;
      font-size: max(0.78rem, var(--sc-fs-floor)); line-height: 1.5;
      color: var(--sc-fg-1);
    }
    /* A bullet gets a marker and an indent; a prose line does not — that is the
       whole visual difference between "one of the changes" and "context". */
    .pn-line[data-kind='bullet'] { padding-left: 14px; position: relative; }
    .pn-line[data-kind='bullet']::before {
      content: '▪'; position: absolute; left: 0;
      color: var(--sc-accent); font-size: 0.7em;
    }
    .pn-line[data-kind='bullet'][data-depth='1'] { margin-left: 14px; }
    .pn-line[data-kind='bullet'][data-depth='2'] { margin-left: 28px; }
    .pn-line[data-kind='bullet'][data-depth='3'] { margin-left: 42px; }
    .pn-line[data-kind='bullet'][data-depth='4'] { margin-left: 56px; }
    .pn-line[data-kind='text'] { color: var(--sc-fg-2); }
    .pn-text { flex: 1 1 auto; min-width: 0; }

    .pn-link, .pn-source {
      display: inline-flex; align-items: center;
      color: var(--sc-accent); text-decoration: none;
      font-size: max(0.72rem, var(--sc-fs-floor));
    }
    .pn-source { align-self: flex-start; min-height: var(--sc-tap-min); }
    .pn-link:hover, .pn-source:hover { text-decoration: underline; }
    .pn-link:focus-visible, .pn-source:focus-visible {
      outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px;
    }

    mark {
      background: color-mix(in srgb, var(--sc-accent) 32%, transparent);
      color: inherit; border-radius: 3px; padding: 0 1px;
    }

    @media (max-width: 480px) {
      .pn { padding-left: 14px; }
    }
  `],
})
export class PatchNoteDetailComponent {
  private readonly svc = inject(RoadmapService);

  /** RSI thread slug — the key the outline is cached under. */
  readonly slug = input.required<string>();
  /** The note's Spectrum permalink, so the source is always one click away. */
  readonly url = input.required<string>();
  /** Page search tokens: narrows the outline and marks the hits. */
  readonly tokens = input<readonly string[]>([]);

  readonly outline = computed(() => this.svc.outlineFor(this.slug()));
  readonly loading = computed(() => !this.outline() && this.svc.isPending(this.slug()));

  /** The outline as a tree, narrowed to the query. */
  readonly sections = computed<OutlineSection[]>(() => {
    const outline = this.outline();
    if (!outline) return [];
    return filterSections(outlineSections(outline.nodes), this.tokens());
  });

  /**
   * Rendering this component IS the request for its contents. The service
   * de-duplicates against what is loaded, in flight and known-missing, so a row
   * that is opened, closed and opened again costs exactly one fetch.
   */
  private readonly fetchOnRender = effect(() => {
    this.svc.requestOutlines([this.slug()]);
  });

  mark(text: string): HighlightSegment[] {
    return highlightSegments(text, this.tokens());
  }
}
