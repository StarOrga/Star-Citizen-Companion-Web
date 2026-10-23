import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { VerseDoor } from '../../data/verse.models';
import { splitChars } from './briefing.model';

/**
 * One jump gate as a moon: a static, sun-lit sphere (icy relay moon for News,
 * banded ringed gas giant for Patches, dusty mosaic moon for the Galerie) and
 * its caption trailer — the topic blinks in, below it the hook line rolls in,
 * then rolls up to NEU and the concrete new item fades in char by char.
 * Hover enlarges the moon and holds the trailer. The whole moon is one anchor.
 */
@Component({
  selector: 'sc-briefing-moon',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="moon" [attr.data-door]="door()" [routerLink]="link()" [attr.aria-label]="label()"
       (click)="opened.emit()" (auxclick)="opened.emit()">
      <span [class]="'art ' + art()" aria-hidden="true">
        @if (door() === 'news') { <span class="satorb"></span> }
        @if (door() === 'patches') { <span class="ringb"></span> }
        <span class="atm"></span>
        <span class="orb"><i class="srf"></i><i class="tex"></i><i class="shd"></i><i class="lim"></i></span>
        @if (door() === 'news') { <span class="sat"></span> }
        @if (door() === 'patches') { <span class="ringf"></span> }
      </span>
      <span class="cap" aria-hidden="true">
        <b class="topic">{{ topic() }}</b>
        <span class="line" [class.quiet]="!fresh()">
          <span class="hook">{{ hook() }}</span>
          @if (fresh()) {
            <span class="new"><i class="neu">{{ neu() }}</i><span class="item">@for (ch of chars(); track ch.i) {<span class="chr" [style.--i]="ch.i">{{ ch.c }}</span>}</span></span>
          }
        </span>
      </span>
    </a>
  `,
  styleUrl: './briefing-moon.component.scss',
})
export class BriefingMoonComponent {
  readonly door = input.required<VerseDoor>();
  readonly link = input.required<string>();
  /** Translated topic word ("News"). */
  readonly topic = input.required<string>();
  /** Translated hook line ("Was CIG diese Woche verraten hat"). */
  readonly hook = input.required<string>();
  /** Translated "NEU". */
  readonly neu = input('');
  /** The concrete new thing (an item title or "3 diese Woche"); null = nothing new, the hook stays. */
  readonly fresh = input<string | null>(null);
  readonly opened = output<void>();

  readonly art = computed(() => ({ news: 'ice', patches: 'gas', gallery: 'rock' })[this.door()]);
  readonly chars = computed(() => splitChars(this.fresh() ?? ''));
  readonly label = computed(() => {
    const f = this.fresh();
    return f ? `${this.topic()}: ${this.neu()} · ${f}` : `${this.topic()}: ${this.hook()}`;
  });
}
