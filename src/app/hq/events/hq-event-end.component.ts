import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { ResolvedEnd } from './event-logic';
import { endView, formatEndDate } from './event-hq.util';

/** The end of an event in the one grammar: "bis 1. Dez. 2026", "spaetestens mit ... (geschaetzt)" or "Ende unbekannt". */
@Component({
  selector: 'sc-hq-event-end',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ view().key | translate: { date: date() } }}`,
})
export class HqEventEndComponent {
  readonly end = input.required<ResolvedEnd>();
  private readonly i18n = inject(TranslateService);
  protected readonly view = computed(() => endView(this.end()));
  protected readonly date = computed(() => (this.view().at ? formatEndDate(this.view().at!, this.i18n.getCurrentLang() || 'de') : ''));
}
