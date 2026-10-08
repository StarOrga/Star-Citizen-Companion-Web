import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { PageCrumb } from '../../shared/page-header/nav-origin.service';
import { ExplorerGlyphComponent } from '../starmap/explorer-glyph.component';
import { VerseBetaService } from '../data/verse-beta.service';
import { VerseStatusComponent } from './verse-status.component';

/** First crumb of every Verse sub-page. */
export const VERSE_ROOT_CRUMB: PageCrumb = { labelKey: 'verse.crumb', link: '/verse' };

/**
 * The uniform Verse subheader: `<sc-page-header>` with the slim status
 * instrument in the aside and the star-map glyph as the first action. No
 * server pill, no route frame. `[vhActions]` content lands next to the glyph.
 */
@Component({
  selector: 'sc-verse-header',
  standalone: true,
  imports: [PageHeaderComponent, VerseStatusComponent, ExplorerGlyphComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header [crumbs]="crumbs()" [eyebrow]="eyebrow()" [title]="title()"
                    [subtitle]="subtitle()" [rememberAs]="rememberAs()">
      <sc-verse-status phAside />
      <div phActions class="vh-actions">
        <ng-content select="[vhActions]" />
        @if (starmap()) { <sc-explorer-glyph /> }
      </div>
    </sc-page-header>
  `,
  styles: [`
    :host { display: block; margin-bottom: var(--sc-gap-3, 18px); }
    .vh-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  `],
})
export class VerseHeaderComponent {
  private readonly beta = inject(VerseBetaService);

  /** Crumbs AFTER the Verse root; the root crumb is added unless `root` is set. */
  readonly trail = input<readonly PageCrumb[]>([]);
  /** The briefing IS the root — it carries no crumb row. */
  readonly root = input(false);
  readonly eyebrow = input<string | null>(null);
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly rememberAs = input<string | null>(null);

  readonly crumbs = computed<readonly PageCrumb[]>(() => (this.root() ? [] : [VERSE_ROOT_CRUMB, ...this.trail()]));
  /** The glyph is the star map's entry — shown while its β area is on. */
  readonly starmap = this.beta.isEnabled('starmap');
}
