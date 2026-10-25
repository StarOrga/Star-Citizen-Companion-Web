import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { VerseDoor } from '../../data/verse.models';
import { splitChars } from './briefing.model';

/** Length of one moon's caption slot in the relay, in seconds. */
export const MOON_SLOT_S = 7;
/** Minimum shared rest after the last slot, in seconds. */
export const MOON_CALM_S = 6;
/** The calm never drops below this share of the loop. */
export const MOON_CALM_SHARE = 0.2;

export interface MoonTiming {
  /** CSS time: `animation-delay` of the moon's caption keyframes (bind as `--start`). */
  readonly start: string;
  /** CSS time: length of the shared loop (bind as `--cycle`). */
  readonly cycle: string;
}

/**
 * The relay clock for the moon captions: one global loop in which the moons
 * take turns, never two at once, followed by a rest in which all of them only
 * show their topic word.
 *
 *   loop  = count × MOON_SLOT_S + calm,  calm = max(MOON_CALM_S, share so calm ≥ 20 %)
 *   start = introSeconds + index × MOON_SLOT_S
 *
 * Every moon gets the same `cycle`, so their slots stay phase-locked for good.
 * The moon order is the caller's index order (the stage renders News →
 * Patches → Gallery). For three moons: loop 27 s, calm 6 s (22 %).
 *
 * The caption keyframes in `briefing-moon.component.scss` are written for that
 * three-moon loop (slot = 7/27 of `--cycle`); another count scales the slot
 * proportionally. A moon with nothing new keeps its slot and plays topic +
 * hook in it — skipping a slot would need a second set of keyframes.
 *
 * The parent binds both per moon:
 * `[style.--start]="t.start" [style.--cycle]="t.cycle"`.
 *
 * @example moonSchedule(1, 3, 4.2) → { start: '11.20s', cycle: '27.00s' }
 */
export function moonSchedule(index: number, count: number, introSeconds = 0): MoonTiming {
  const n = Math.max(1, Math.floor(count));
  const slots = n * MOON_SLOT_S;
  const calm = Math.max(MOON_CALM_S, (slots * MOON_CALM_SHARE) / (1 - MOON_CALM_SHARE));
  const i = Math.min(Math.max(0, Math.floor(index)), n - 1);
  const start = Math.max(0, introSeconds) + i * MOON_SLOT_S;
  return { start: `${start.toFixed(2)}s`, cycle: `${(slots + calm).toFixed(2)}s` };
}

/**
 * One jump gate as a planet of the Stanton system — microTech for News,
 * Crusader for Patches, Hurston for the Galerie — pure CSS art, one shared sun
 * (upper left). Below it the caption: only the topic word at rest; in the
 * moon's relay slot (see `moonSchedule`) the topic lights up, the hook line
 * flashes, then NEU appears centred, slides left and the concrete new item
 * types in to its right. Hover lifts the planet and brightens its rim; the
 * caption keeps running. The whole moon is one anchor.
 */
@Component({
  selector: 'sc-briefing-moon',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="moon" [attr.data-door]="door()" [routerLink]="link()" [attr.aria-label]="label()"
       (click)="opened.emit()" (auxclick)="opened.emit()">
      <span [class]="'art ' + art()" aria-hidden="true">
        <span class="atm"></span>
        <span class="orb"><i class="srf"></i><i class="tex"></i><i class="shd"></i><i class="nit"></i><i class="lim"></i></span>
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

  readonly art = computed(() => ({ news: 'microtech', patches: 'crusader', gallery: 'hurston' })[this.door()]);
  readonly chars = computed(() => splitChars(this.fresh() ?? ''));
  readonly label = computed(() => {
    const f = this.fresh();
    return f ? `${this.topic()}: ${this.neu()} · ${f}` : `${this.topic()}: ${this.hook()}`;
  });
}
