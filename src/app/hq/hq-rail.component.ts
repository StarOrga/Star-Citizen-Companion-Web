import { EventHqService } from './events/event-hq.service';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { translateTick } from '../shared/section-rail/translate-tick';
import { SectionRailComponent, SectionRailGo, SectionRailItem } from '../shared/section-rail/section-rail.component';
import { HQ_PAGE_ICONS, HqPageNavService, hqPageHotkey } from './hq-page-nav.service';
import type { HqPageId } from './hq-routes';

/**
 * The left-edge quick-scroll rail (concept D4): the five HQ pages as slim vertical real anchors at the page edge,
 * outside the content column; the label shows as plain text on hover and focus, the page in view carries
 * `aria-current`. Since the camera world the look is the shared {@link SectionRailComponent} (the same rail now hangs
 * on every page with a section menu); this wrapper only feeds it the HQ pages. Desktop only at the edge
 * (≥ 1024px) — narrower viewports get the bottom bar ({@link HqPageBarComponent}); the shared rail's compact strip
 * is hidden here so HQ keeps its own phone bar. The page's hotkey never shows at rest: a long hover says it
 * (info tier), the label stays as it is.
 */
@Component({
  selector: 'sc-hq-rail',
  standalone: true,
  imports: [TranslatePipe, SectionRailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<sc-section-rail [items]="items()" [ariaLabel]="'hq.rail.label' | translate" (go)="onGo($event)" />`,
  styles: [
    `
      :host { display: none; }
      @media (min-width: 1024px) { :host { display: block; } }
    `,
  ],
})
export class HqRailComponent {
  protected readonly events = inject(EventHqService);
  private readonly warm = this.events.ensure();
  protected readonly nav = inject(HqPageNavService);
  private readonly translate = inject(TranslateService);
  protected readonly icons = HQ_PAGE_ICONS;
  protected readonly hotkey = hqPageHotkey;

  /** Ticks when the language or its strings change, so the computed names below follow. */
  private readonly lang = translateTick(this.translate);

  protected readonly items = computed<SectionRailItem[]>(() => {
    this.lang();
    return this.nav.pages.map((p) => {
      const key = hqPageHotkey(p);
      const name = this.translate.instant('hq.pages.' + p) as string;
      return {
        id: p,
        href: this.nav.href(p),
        label: name,
        icon: HQ_PAGE_ICONS[p],
        active: this.nav.active() === p,
        ariaLabel: this.translate.instant('hq.rail.goto', { page: name }) as string,
        current: 'page',
        shortcut: key ? String(key) : null,
        hint: key ? (this.translate.instant('hq.hotkey', { key }) as string) : null,
        dot: p === 'planen' && this.events.hasOpen() ? (this.translate.instant('hq.events.dot') as string) : null,
      };
    });
  });

  protected onGo(ev: SectionRailGo): void {
    this.nav.go(ev.event, ev.item.id as HqPageId);
  }
}
