import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { VerseDoor } from '../../data/verse.models';
import { BodyCanvasDirective } from './bodies/body.directive';
import type { BodyKind } from './bodies/body-engine';

/** The sender glows, then the cone creeps out and shoots to the holo (exponential). */
export const TX_CHARGE_MS = 2400;
/** The scan line runs down and builds the panel, plus its turn at the bottom. */
export const TX_BUILD_MS = 1080;
/** The scan line runs back up and writes the text into the panel. */
export const TX_WRITE_MS = 1320;
/** The line goes out, the cone pulls back into the planet and fades. */
export const TX_PULL_MS = 2000;
/** The finished message stands this long after the pull-back, before the next planet sends. */
export const TX_HOLD_MS = 6000;
/** Fade-out between two messages. */
export const TX_OUT_MS = 700;

export const TX_DOORS: readonly VerseDoor[] = ['news', 'patches', 'gallery'];

export type TxPhase = 'charge' | 'build' | 'write' | 'pull' | 'hold' | 'out';

/** One message the holo receives: the area's newest item. */
export interface TransmitItem {
  readonly key: string;
  readonly door: VerseDoor;
  readonly title: string;
  readonly body: string;
  /** In-app path or an https URL; the whole holo is this link. */
  readonly internal: boolean;
  readonly path: string;
  readonly query: Record<string, string> | null;
}

/**
 * The stage's transmission (concept "Funkfeuer 2"): three real SC planets
 * above the rim — Crusader = News, ArcCorp = Patches, microTech = Galerie,
 * each a real anchor to its area — take turns (News → Patches → Galerie)
 * sending their newest item to the holo in the planet's surface:
 *
 *   charge   the sender's atmosphere glows, the light cone creeps out of it
 *            and shoots to the panel's top edge
 *   build    the scan line runs down, the cone's far end is that line, the
 *            panel's glass appears exactly behind it
 *   write    the line runs back up and writes the text, bottom to top
 *   pull     the line goes out, the cone pulls back into the planet
 *   hold     {@link TX_HOLD_MS}, the message stands
 *
 * The motion lives in the stylesheet: each phase runs one keyframe animation
 * on the host, the timers here only switch the phases (concept
 * "Verse-Projektion", design "Anbahnung 2,4 s").
 *
 * Pointer or focus on the holo holds the relay. Reduced motion: no cone, no
 * build or write animation — the message stands, the relay swaps it.
 *
 * Away from the top of the page (`away`, briefing-dock) the relay rests:
 * no cone, no holo, no timers — back at the top it sends again.
 *
 * `hold` keeps it from starting while the entrance plays. With `stands` the
 * first message is simply there when the relay starts, the next planet sends.
 */
@Component({
  selector: 'sc-briefing-transmit',
  standalone: true,
  imports: [RouterLink, TranslatePipe, NgTemplateOutlet, BodyCanvasDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './briefing-transmit.component.scss',
  host: { '[class.away]': 'away()', '[class.docked]': 'docked()', '[class.stands]': 'standing()', '[attr.data-phase]': 'phase()' },
  template: `
    @let c = cur();
    <span class="cone" aria-hidden="true" [attr.data-door]="c?.door ?? null"><i class="wide"><i class="fill"></i></i><i class="soft"><i class="fill"></i><i class="wave"></i></i></span>
    @for (d of doors; track d) {
      <a class="pl" [attr.data-door]="d" [attr.data-verse-fly]="d" [class.send]="c?.door === d && sending()"
         [routerLink]="'/verse/' + d" (click)="door.emit(d)">
        <canvas class="pl-gl" [scBody]="bodyOf[d]"></canvas>
        <span class="plab">{{ ('verse.gates.' + d + '.topic') | translate }}</span>
      </a>
    }
    @if (c) {
      @if (c.internal) {
        <a class="holo" [routerLink]="c.path" [queryParams]="c.query"
           (click)="open(c)" (auxclick)="open(c)" (mouseenter)="held.set(true)" (mouseleave)="held.set(false)"
           (focusin)="held.set(true)" (focusout)="held.set(false)">
          <ng-container *ngTemplateOutlet="body; context: { $implicit: c }" />
        </a>
      } @else {
        <a class="holo" [href]="c.path" target="_blank" rel="noopener noreferrer"
           (click)="open(c)" (auxclick)="open(c)" (mouseenter)="held.set(true)" (mouseleave)="held.set(false)"
           (focusin)="held.set(true)" (focusout)="held.set(false)">
          <ng-container *ngTemplateOutlet="body; context: { $implicit: c }" />
        </a>
      }
    }
    <ng-template #body let-c>
      <span class="holo-glass"></span>
      <span class="holo-in">
        <span class="k">{{ ('verse.gates.' + c.door + '.topic') | translate }}</span>
        <span class="t">{{ c.title }}</span>
        <span class="b">{{ c.body }}</span>
      </span>
      <i class="holo-scan"></i>
    </ng-template>
  `,
})
export class BriefingTransmitComponent {
  readonly items = input<readonly TransmitItem[]>([]);
  /** The reader left the top of the page: the relay rests until they are back. */
  readonly away = input(false);
  /** The planets landed in the hub heads: they hide, the heads show their own. */
  readonly docked = input(false);
  /** The hub's entrance plays: nothing is sent yet. */
  readonly hold = input(false);
  /** The first message stands at once instead of being projected. */
  readonly stands = input(false);
  /** A planet was used (analytics). */
  readonly door = output<VerseDoor>();
  /** The holo was opened. */
  readonly opened = output<TransmitItem>();

  readonly doors = TX_DOORS;
  /** The living planet behind each door (concept "Sonne & Planeten"). */
  readonly bodyOf: Readonly<Record<VerseDoor, BodyKind>> = { news: 'crusader', patches: 'arccorp', gallery: 'microtech' };
  readonly index = signal(0);
  readonly phase = signal<TxPhase>('out');
  /** The projection runs: the sender's atmosphere glows. */
  readonly sending = computed(() => ['charge', 'build', 'write', 'pull'].includes(this.phase()));
  /** The first message is standing, not yet the next planet's turn. */
  readonly standing = signal(false);
  /** Pointer / focus on the holo: the relay waits. */
  readonly held = signal(false);
  readonly cur = computed<TransmitItem | null>(() => {
    const l = this.items();
    return l.length ? l[this.index() % l.length] : null;
  });

  private readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private first = true;

  constructor() {
    effect(() => {
      const n = this.items().length;
      const away = this.away() || this.hold();
      untracked(() => {
        if (away) {
          this.stop();
          this.phase.set('out');
        } else if (n && !this.running) {
          this.running = true;
          this.run();
        } else if (!n) {
          this.stop();
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  open(c: TransmitItem): void {
    this.opened.emit(c);
  }

  private later(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
  }

  private run(): void {
    const c = this.cur();
    if (!c) return this.stop();
    const first = this.first;
    this.first = false;
    if (first && this.stands() && !this.reduced) {
      this.standing.set(true);
      this.phase.set('hold');
      return this.later(TX_HOLD_MS, () => this.next());
    }
    this.standing.set(false);
    if (this.reduced) {
      this.phase.set('hold');
      return this.later(TX_HOLD_MS, () => this.next());
    }
    this.phase.set('charge');
    this.later(TX_CHARGE_MS, () => {
      this.phase.set('build');
      this.later(TX_BUILD_MS, () => {
        this.phase.set('write');
        this.later(TX_WRITE_MS, () => {
          this.phase.set('pull');
          this.later(TX_PULL_MS, () => {
            this.phase.set('hold');
            this.later(TX_HOLD_MS, () => this.next());
          });
        });
      });
    });
  }

  private next(): void {
    if (this.held()) return this.later(1000, () => this.next());
    const n = this.items().length;
    if (n < 2) {
      this.running = false;
      return;
    }
    if (this.reduced) {
      this.index.update((i) => (i + 1) % n);
      return this.run();
    }
    this.phase.set('out');
    this.later(TX_OUT_MS, () => {
      this.index.update((i) => (i + 1) % n);
      this.run();
    });
  }
}
