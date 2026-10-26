import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

/**
 * "Companion fragen" — the placeholder the Fusion search hands a long question
 * to (spec §5: the target is not decided yet). Says so honestly and offers the
 * question back to the normal search.
 */
@Component({
  selector: 'sc-companion-stub',
  standalone: true,
  imports: [RouterLink, TranslatePipe, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header [title]="'fusionBar.companion.title' | translate" [subtitle]="'fusionBar.companion.subtitle' | translate" />
    <section class="stub sc-card">
      @if (question(); as q) {
        <p class="q"><span class="mark" aria-hidden="true">✦</span> „{{ q }}“</p>
      }
      <p>{{ 'fusionBar.companion.body' | translate }}</p>
      @if (question(); as q) {
        <a class="back" [routerLink]="['/codex']" [queryParams]="{ q }">{{ 'fusionBar.companion.searchInstead' | translate }}</a>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .stub { margin-top: var(--sc-space-5); display: flex; flex-direction: column; gap: var(--sc-space-3); max-width: var(--sc-measure); }
    .q { margin: 0; font-size: 1.1rem; color: var(--sc-fg-0); }
    .mark { color: var(--sc-accent); }
    p { margin: 0; color: var(--sc-fg-1); }
    .back { align-self: flex-start; color: var(--sc-accent); text-decoration: none; min-height: 44px; display: inline-flex; align-items: center; }
    .back:hover { text-decoration: underline; }
    .back:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
  `],
})
export class CompanionStubComponent {
  readonly question = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((p) => (p.get('q') ?? '').trim() || null)),
    { initialValue: null },
  );
}
