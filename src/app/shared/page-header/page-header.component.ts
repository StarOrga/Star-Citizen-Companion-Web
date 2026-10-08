import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { NavOriginService, PageCrumb } from './nav-origin.service';

/**
 * The one page header of the Codex and Hangar pages (2026-10-07: every page
 * had hand-built its own — `.head`, `.kb-head`, `.crumbrow`, `.top-row` or
 * nothing — with the back link in three positions and four wordings).
 *
 *   Codex › Index › …                        [aside: build pill, view toggle]
 *   EYEBROW
 *   Title                                     [actions]
 *   Subtitle
 *
 * The crumbs are real anchors (middle click opens a tab). The page's own title
 * is the `<h1>`, never repeated as the last crumb. A page whose title lives in
 * a stage of its own (the ship page, the set page) leaves `title` empty and
 * gets the crumb row only.
 *
 * Slots: `[phAside]` right of the crumbs, `[phActions]` right of the title,
 * `[phTitle]` replaces the plain `<h1>` text (a title with markup).
 */
@Component({
  selector: 'sc-page-header',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ph-top">
      @if (crumbs().length) {
        <nav class="crumbs" [attr.aria-label]="'pageHeader.crumbsAria' | translate">
          <ol>
            @for (c of crumbs(); track $index) {
              <li>
                <a class="crumb" [routerLink]="$any(c.link)" [queryParams]="c.queryParams ?? null">{{
                  c.label ?? (c.labelKey! | translate: (c.labelParams ?? undefined))
                }}</a>
              </li>
            }
          </ol>
        </nav>
      }
      <div class="ph-aside"><ng-content select="[phAside]" /></div>
    </div>
    @if (title() || eyebrow() || subtitle()) {
      <div class="ph-main">
        <div class="ph-title">
          @if (eyebrow(); as e) { <p class="eyebrow">{{ e }}</p> }
          @if (title(); as t) {
            <h1>{{ t }}<ng-content select="[phTitle]" /></h1>
          }
          @if (subtitle(); as s) { <p class="sub">{{ s }}</p> }
        </div>
        <div class="ph-actions"><ng-content select="[phActions]" /></div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .ph-top { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; min-height: 28px; }
    .ph-aside { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ph-aside:empty { display: none; }
    .crumbs ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; }
    .crumbs li { display: inline-flex; align-items: center; min-width: 0; }
    .crumbs li + li::before {
      content: '›'; color: var(--sc-fg-2); margin: 0 8px; opacity: 0.6;
    }
    .crumb {
      font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-2); text-decoration: none;
      max-width: 28ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min);
      transition: color 0.16s;
    }
    .crumb:hover, .crumb:focus-visible { color: var(--sc-accent); text-decoration: none; }
    .ph-main {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 12px 24px; flex-wrap: wrap; margin-top: 10px;
    }
    .ph-title { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .eyebrow {
      margin: 0; color: var(--sc-accent); font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase;
    }
    h1 { margin: 0; }
    .sub { margin: 2px 0 0; color: var(--sc-fg-2); max-width: var(--sc-measure); }
    .ph-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ph-actions:empty { display: none; }
    @media (max-width: 720px) {
      .ph-main { flex-direction: column; align-items: stretch; }
      .crumb { max-width: 22ch; }
    }
  `],
})
export class PageHeaderComponent {
  private readonly origin = inject(NavOriginService);
  private readonly router = inject(Router);

  /** Ancestor pages, outermost first. The current page is the title, not a crumb. */
  readonly crumbs = input<readonly PageCrumb[]>([]);
  readonly eyebrow = input<string | null | undefined>(null);
  readonly title = input<string | null | undefined>(null);
  readonly subtitle = input<string | null | undefined>(null);
  /**
   * The name later pages show in a crumb back to this one — defaults to
   * `title`; a page whose title sits in its own stage passes it here.
   */
  readonly rememberAs = input<string | null | undefined>(null);

  constructor() {
    effect(() => {
      const name = this.rememberAs() ?? this.title();
      if (name) this.origin.rememberTitle(this.router.url, name);
    });
  }
}
