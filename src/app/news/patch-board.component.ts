import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NewsService } from './news.service';
import { PatchNotesSectionComponent } from './patch-notes-section.component';

/**
 * `/news/patches` — the patch depth, on its own page.
 *
 * Measured on the old Verse News page (2026-08-20, production): this apparatus
 * — the rotating KPI carousel, the "newest per channel" row, two multi-select
 * filter axes and the full history — occupied 2,019 px and sat ENTIRELY above
 * the first news article. Analytics about release cadence outranked today's
 * news on a page whose job is today's news.
 *
 * It is not less valuable here, it is more: nothing on this page competes with
 * it, so the carousel's slides can be read at leisure instead of rotating past.
 * Verse News keeps exactly one sentence of it (the verdict card) and links here.
 */
@Component({
  selector: 'sc-patch-board',
  standalone: true,
  imports: [TranslateModule, RouterLink, PatchNotesSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="board">
      <header class="head">
        <a class="back" routerLink="/news">← {{ 'news.patch.board.back' | translate }}</a>
        <h1>{{ 'news.patch.board.title' | translate }}</h1>
        <p class="sub">{{ 'news.patch.board.sub' | translate }}</p>
      </header>

      @if (svc.error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'news.errorTitle' | translate }}:</strong> {{ err }}
        </div>
      } @else if (svc.loading() && !svc.feed()) {
        <p class="sc-card loading">{{ 'news.loading' | translate }}</p>
      } @else {
        <sc-patch-notes-section />
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .board { display: flex; flex-direction: column; gap: 14px; }
    .head { padding-left: 6px; }
    .back {
      display: inline-block; margin-bottom: 10px; min-height: var(--sc-tap-min);
      color: var(--sc-fg-2); text-decoration: none;
      font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .back:hover { color: var(--sc-accent); }
    .back:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 3px; border-radius: 4px; }
    h1 { margin: 0; }
    .sub { margin: 4px 0 0; color: var(--sc-fg-2); }
    sc-patch-notes-section {
      display: block;
      border: 1px solid var(--sc-border); border-radius: 10px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      overflow: hidden;
    }
    .loading, .err { padding: 16px; margin: 0; }
    .err { color: var(--sc-danger); }
  `],
})
export class PatchBoardComponent implements OnInit, OnDestroy {
  readonly svc = inject(NewsService);

  ngOnInit(): void {
    // The feed is the same one Verse News uses and the service coalesces
    // concurrent loads, so arriving here directly costs one request, and
    // arriving via the verdict card costs none.
    void this.svc.refresh();
    this.svc.startPolling();
  }

  ngOnDestroy(): void {
    this.svc.stopPolling();
  }
}
