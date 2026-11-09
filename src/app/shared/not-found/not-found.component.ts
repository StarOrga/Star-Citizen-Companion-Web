import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../action/sc-action.directive';
import type { PageCrumb } from '../page-header/nav-origin.service';

/**
 * The "this id does not exist" state of a detail page: the load succeeded and
 * found no row (a failed load keeps its own error state with retry). The
 * heading is the page's `<h1>` — never an empty one — followed by one short
 * line and a real anchor back to the list the reader came from (`back` is the
 * same shape as a breadcrumb, so pages pass their parent crumb).
 * `level` 2 when the page already shows an `<h1>` of its own.
 */
@Component({
  selector: 'sc-not-found',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card nf">
      @if (level() === 2) {
        <h2 class="nf-h">{{ titleKey() | translate }}</h2>
      } @else {
        <h1 class="nf-h">{{ titleKey() | translate }}</h1>
      }
      <p class="nf-body">{{ bodyKey() | translate }}</p>
      @if (back(); as b) {
        <a scAction tier="secondary" class="nf-back" [routerLink]="$any(b.link)" [queryParams]="b.queryParams ?? null">
          @if (b.label) {
            {{ 'notFound.backTo' | translate: { target: b.label } }}
          } @else {
            {{ 'notFound.backTo' | translate: { target: (b.labelKey! | translate: (b.labelParams ?? undefined)) } }}
          }
        </a>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .nf { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    .nf-h { margin: 0; }
    .nf-body { margin: 0; color: var(--sc-fg-2); max-width: var(--sc-measure); }
  `],
})
export class NotFoundComponent {
  readonly titleKey = input.required<string>();
  readonly bodyKey = input.required<string>();
  readonly back = input<PageCrumb | null>(null);
  readonly level = input<1 | 2>(1);
}
