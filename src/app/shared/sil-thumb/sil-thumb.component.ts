import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { SEARCH_KIND_ICONS, type SearchIconKind } from '../../shell/fusion-bar/search-icons';
import { SilThumbsService } from './sil-thumbs.service';

const KIND_ICON: Readonly<Record<string, SearchIconKind>> = {
  ship: 'ship',
  vehicle: 'ship',
  upcoming: 'upcoming',
  weapon: 'weapon',
  component: 'component',
  item: 'item',
  ammunition: 'ammunition',
  blueprint: 'blueprint',
  material: 'stock',
  news: 'page',
  gallery: 'gallery',
};

/**
 * `<sc-sil-thumb kind className>`: the silhouette of an entry, drawn to fit its box (`contain`, never stretched), or
 * the kind icon when the build has none. Fills its parent; the parent sets the box and the colour (`currentColor`).
 */
@Component({
  selector: 'sc-sil-thumb',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (thumb(); as t) {
      <svg class="sil" [attr.viewBox]="t.viewBox" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor"
           stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
        <path [attr.d]="t.path" [attr.transform]="t.transform || null" vector-effect="non-scaling-stroke" />
      </svg>
    } @else {
      <svg class="ic" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.5"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        @for (d of icon(); track $index) { <path [attr.d]="d" /> }
      </svg>
    }
  `,
  styles: [
    `
      :host { display: block; width: 100%; height: 100%; color: inherit; }
      svg { display: block; width: 100%; height: 100%; }
      svg.ic { opacity: 0.7; }
    `,
  ],
})
export class SilThumbComponent {
  private readonly thumbs = inject(SilThumbsService);
  readonly kind = input.required<string>();
  readonly className = input.required<string>();

  protected readonly thumb = computed(() => this.thumbs.thumbOf(this.kind(), this.className()));
  protected readonly icon = computed(() => SEARCH_KIND_ICONS[KIND_ICON[this.kind()] ?? 'item']);

  constructor() {
    effect(() => this.thumbs.request([{ kind: this.kind(), className: this.className() }]));
  }
}
