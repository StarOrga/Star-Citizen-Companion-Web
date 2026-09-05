import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import type { FindGroup } from './patch-find';
import { HighlightSegment, fuzzyTokens, highlightSegments } from './patch-search';

/**
 * The board's search RESULT: the matching content itself, grouped by the patch
 * it belongs to (owner, 2026-09-05 — "nicht patches sondern dessen inhalte …
 * inklusive bild … ggf. gruppiert nach patch").
 *
 * A roadmap item arrives as a picture card, because that is how a reader
 * recognises "the Orison thing" — and the card is a real anchor onto RSI's own
 * Release View entry, which opens with that item's panel already expanded
 * (`…/release-view/1544-Instancing`). A release-note bullet arrives as the
 * sentence RSI wrote, under the heading path it sits below, spanning the row
 * because a sentence is not a tile. Both mark the query, including the
 * spelling the reader did NOT type.
 *
 * Every group header links into that patch's dossier with the query carried
 * along, so "show me everything 4.10 says about this" is one click away — the
 * board answers, the dossier goes deep.
 *
 * A hit without a usable link renders as an `<a>` with no `href`, which is
 * exactly a non-interactive span to both the browser and a screen reader — no
 * second copy of the markup, no fake button.
 */
@Component({
  selector: 'sc-patch-find-results',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="find">
      @for (g of groups(); track g.line) {
        <section class="grp" [attr.data-status]="g.cardStatus">
          <header class="gh">
            <a class="gline" [routerLink]="['/news/patches', g.line]" [queryParams]="{ q: query() }">
              <span class="gstatus" [attr.data-status]="g.cardStatus">{{ ('news.patch.status.' + g.cardStatus) | translate }}</span>
              <span class="gver">{{ g.line ? ('news.patch.line' | translate:{ version: g.line }) : ('news.patch.otherLine' | translate) }}</span>
            </a>
            <span class="gcount">{{ 'news.patch.find.groupCount' | translate:{ roadmap: g.roadmapTotal, notes: g.noteTotal } }}</span>
          </header>

          <ul class="hits">
            @for (h of g.hits; track h.id) {
              <li class="hit" [attr.data-kind]="h.kind">
                <a class="cell" [attr.href]="h.url || null"
                   [attr.target]="h.url ? '_blank' : null" [attr.rel]="h.url ? 'noopener noreferrer' : null">
                  @if (h.kind === 'roadmap') {
                    <span class="thumb" [class.ph]="!h.thumbnail">
                      @if (h.thumbnail) { <img [src]="h.thumbnail" alt="" loading="lazy" decoding="async" /> }
                      <span class="st" [attr.data-status]="h.status">{{ ('news.patch.roadmap.status.' + h.status) | translate }}</span>
                    </span>
                  }
                  <span class="txt">
                    <span class="t">
                      @for (seg of mark(h.text); track $index) { @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> } }
                    </span>
                    @if (h.context) {
                      <small class="ctx">
                        @for (seg of mark(h.context); track $index) { @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> } }
                      </small>
                    }
                  </span>
                </a>
              </li>
            }
          </ul>

          @if (g.total > g.hits.length) {
            <a class="more" [routerLink]="['/news/patches', g.line]" [queryParams]="{ q: query() }">
              {{ 'news.patch.find.moreInDossier' | translate:{ n: g.total - g.hits.length } }} →
            </a>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .find { display: flex; flex-direction: column; gap: 16px; }
    .grp { display: flex; flex-direction: column; gap: 8px; }

    .gh { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .gline { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--sc-fg-0); min-height: var(--sc-tap-min); }
    .gline:hover .gver { color: var(--sc-accent); }
    .gline:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 3px; border-radius: 6px; }
    /* Same fixed width as the stack's status word, so the two surfaces line up. */
    .gstatus {
      display: inline-flex; align-items: center; justify-content: center; min-width: 96px;
      padding: 3px 10px; border-radius: 6px; font-family: var(--sc-font-display);
      font-size: max(0.62rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase;
      font-weight: 600; white-space: nowrap;
    }
    .gstatus[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); }
    .gstatus[data-status='next'], .gstatus[data-status='ptu'] { color: var(--sc-accent); border: 1.5px solid var(--sc-accent); }
    .gstatus[data-status='evocati'] { color: var(--sc-fg-1); border: 1.5px solid color-mix(in srgb, var(--sc-fg-1) 50%, transparent); }
    .gstatus[data-status='superseded'], .gstatus[data-status='other'] { color: var(--sc-fg-2); border: 1.5px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }
    .gver { font-family: var(--sc-font-display); font-size: 1.1rem; font-weight: 600; }
    .gcount { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); }
    .hit[data-kind='note'] { grid-column: 1 / -1; }
    .cell {
      display: flex; gap: 10px; height: 100%; padding: 8px 10px; border: 1px solid var(--sc-border);
      border-radius: 8px; background: var(--sc-bg-1); color: var(--sc-fg-0); text-decoration: none;
      animation: pf-in 0.32s ease-out both;
    }
    a[href].cell:hover { border-color: var(--sc-accent); }
    a[href].cell:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .hit[data-kind='note'] .cell { background: transparent; border-style: dashed; }

    .thumb { position: relative; flex: 0 0 auto; width: 116px; min-height: 76px; border-radius: 5px; overflow: hidden; background: linear-gradient(135deg, var(--sc-bg-3), var(--sc-bg-0)); }
    .thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    .st {
      position: absolute; left: 4px; top: 4px; padding: 1px 5px; border-radius: 3px;
      background: color-mix(in srgb, var(--sc-bg-0) 82%, transparent);
      font-size: max(0.52rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2);
    }
    .st[data-status='released'] { color: var(--sc-success); }
    .st[data-status='committed'] { color: var(--sc-accent); }

    .txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .t { font-size: max(0.8rem, var(--sc-fs-floor)); font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
    .hit[data-kind='note'] .t { font-weight: 400; color: var(--sc-fg-1); }
    .ctx { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.4; overflow-wrap: anywhere; }
    mark { background: color-mix(in srgb, var(--sc-accent) 32%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }

    .more { align-self: flex-start; min-height: var(--sc-tap-min); display: inline-flex; align-items: center; color: var(--sc-accent); text-decoration: none; font-size: max(0.74rem, var(--sc-fs-floor)); }
    .more:hover { text-decoration: underline; }

    @keyframes pf-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .cell { animation: none; } }

    @media (max-width: 560px) {
      .thumb { width: 92px; min-height: 64px; }
      .gstatus { min-width: 78px; }
    }
  `],
})
export class PatchFindResultsComponent {
  readonly groups = input.required<readonly FindGroup[]>();
  readonly query = input('');
  readonly tokens = input<readonly string[]>([]);

  /** Marks every spelling of the query, so a British search still lights up American text. */
  private readonly marks = computed(() => fuzzyTokens(this.tokens()));

  mark(text: string): HighlightSegment[] {
    return highlightSegments(text, this.marks());
  }
}
