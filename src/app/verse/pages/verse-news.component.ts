import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { NewsListComponent } from '../../news/news-list.component';
import { VerseBetaService } from '../data/verse-beta.service';
import { VerseHeaderComponent } from '../shared/verse-header.component';

/**
 * `/verse/news` — the Verse News stream under the uniform Verse subheader.
 * The stream's stage headline stays the page's `<h1>`, so the header carries
 * only crumbs, eyebrow and the status instrument. β off: the bare legacy list.
 */
@Component({
  selector: 'sc-verse-news',
  standalone: true,
  imports: [TranslatePipe, VerseHeaderComponent, NewsListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <sc-verse-header [eyebrow]="'verse.area.news' | translate" [rememberAs]="'verse.area.news' | translate" />
    }
    <sc-news-list />
  `,
  styles: [`:host { display: block; }`],
})
export class VerseNewsComponent {
  readonly enabled = inject(VerseBetaService).isEnabled('news');
}
