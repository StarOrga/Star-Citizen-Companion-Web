import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { isPlainLeftClick } from '../../../core/modified-click.util';
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
/** The finished message stands this long after the pull-back (rounds/05 d5-pb-cycle: 5 s). */
export const TX_HOLD_MS = 5000;
/** Projected away again: the cone shoots out, the line runs down and erases the text (the write, reversed). */
export const TX_UNWRITE_MS = 900;
/** The line runs up and takes the glass with it (the build, reversed). */
export const TX_UNBUILD_MS = 700;
/** The cone pulls back into its planet (the charge, reversed). */
export const TX_UNCHARGE_MS = 1000;
/** Nothing projected, no panel (rounds/05 d5-pb-cycle: 5 s) before the next planet ignites. */
export const TX_GAP_MS = 5000;
/** The first planet ignites this long after the page stands (rounds/05 d5-pb-cycle: 5 s). */
export const TX_START_MS = 5000;
/** A planet whose WebGL body has not drawn by now shows its CSS art (the door's own fallback wait). */
export const TX_ART_MS = 2000;
/** A held panel (pointer / focus) is asked again after this long. */
const TX_HELD_RECHECK_MS = 500;
/** Touch: the first tap's name stays this long before the second tap is a first tap again. */
const NAME_ARMED_MS = 3500;

export const TX_DOORS: readonly VerseDoor[] = ['news', 'patches', 'gallery'];

export type TxPhase = 'charge' | 'build' | 'write' | 'pull' | 'hold' | 'unwrite' | 'unbuild' | 'uncharge' | 'rest';

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
  /** When the content was published (ms); 0 when unknown. The planet with the newest content sends first. */
  readonly at?: number;
}

/**
 * Projection order, newest content first (concept "Kamera-Welt" r5: "Das Neueste zuerst"): the
 * planet whose message is the newest ignites first, then the next older one - the order changes
 * from day to day. Equal or unknown dates keep the stage order (News, Patches, Galerie).
 */
export function newestFirst(items: readonly TransmitItem[]): TransmitItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (b.it.at ?? 0) - (a.it.at ?? 0) || a.i - b.i)
    .map((x) => x.it);
}

/**
 * The stage's transmission (concept "Funkfeuer 2"): three real SC planets
 * above the rim - Crusader = News, ArcCorp = Patches, microTech = Galerie,
 * each a real anchor to its area - take turns sending their newest item to the
 * holo in the planet's surface. The cycle (concept "Kamera-Welt", rounds/05
 * `d5-pb-cycle`), endless and the same whichever way the reader came:
 *
 *   rest      nothing projected; {@link TX_START_MS} after the page stands, then
 *             {@link TX_GAP_MS} between two projections
 *   charge    the sender's atmosphere glows, the light cone creeps out of it
 *             and shoots to the panel's top edge
 *   build     the scan line runs down, the cone's far end is that line, the
 *             panel's glass appears exactly behind it
 *   write     the line runs back up and writes the text, bottom to top
 *   pull      the line goes out, the cone pulls back into the planet
 *   hold      {@link TX_HOLD_MS}, the message stands
 *   unwrite / unbuild / uncharge
 *             the projection reversed with the same animations: the cone shoots out,
 *             the line erases the text, takes the glass with it, the cone returns
 *
 * The motion lives in the stylesheet: each phase runs one keyframe animation
 * on the host, the timers here only switch the phases. They run outside the Angular
 * zone. Pointer or focus on the holo holds the panel; a hidden tab or reduced motion
 * stops the cycle (the planets stay links).
 *
 * Planet names show only on hover / focus, as a label rising under the planet like the sun's
 * (never a tooltip); on touch the first tap shows the name, the second opens.
 *
 * Away from the top of the page (`away`, briefing-dock) the relay rests, `hold` keeps it
 * from starting until the page stands - back at the top it starts its clock again.
 */
@Component({
  selector: 'sc-briefing-transmit',
  standalone: true,
  imports: [RouterLink, TranslatePipe, NgTemplateOutlet, BodyCanvasDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './briefing-transmit.component.scss',
  host: { '[class.art]': 'art()', '[class.away]': 'away()', '[class.docked]': 'docked()', '[class.waits]': 'hold()', '[attr.data-phase]': 'phase()' },
  template: `
    @let c = cur();
    <span class="cone" aria-hidden="true" [attr.data-door]="c?.door ?? null"><i class="wide"><i class="fill"></i></i><i class="soft"><i class="fill"></i><i class="wave"></i></i></span>
    @for (d of doors; track d) {
      <a class="pl" [attr.data-door]="d" [attr.data-verse-fly]="d" [class.send]="c?.door === d && sending()" [class.tap]="armed() === d"
         [routerLink]="'/verse/' + d" [attr.aria-label]="('verse.gates.' + d + '.topic') | translate" (click)="tap($event, d)">
        <canvas class="pl-gl" [scBody]="bodyOf[d]"></canvas>
        <span class="plab" aria-hidden="true">{{ ('verse.gates.' + d + '.topic') | translate }}</span>
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
  /** The page does not stand yet (entrance / menu switch / reload still building): nothing is sent. */
  readonly hold = input(false);
  /** A planet was used (analytics). */
  readonly door = output<VerseDoor>();
  /** The holo was opened. */
  readonly opened = output<TransmitItem>();

  readonly doors = TX_DOORS;
  /** The living planet behind each door (concept "Sonne & Planeten"). */
  readonly bodyOf: Readonly<Record<VerseDoor, BodyKind>> = { news: 'crusader', patches: 'arccorp', gallery: 'microtech' };
  /** Counts the projections; the planet in turn is `order()[index % n]`. */
  readonly index = signal(0);
  readonly phase = signal<TxPhase>('rest');
  /** The projection runs: the sender's atmosphere glows. */
  readonly sending = computed(() => ['charge', 'build', 'write', 'pull'].includes(this.phase()));
  /** Pointer / focus on the holo: the relay waits. */
  readonly held = signal(false);
  /**
   * The CSS art may paint: {@link TX_ART_MS} after mount. Before that only the living planet can
   * show - the art's first raster (SVG feTurbulence) held the GPU ~0.9 s on a cold menu switch (QA D12).
   */
  readonly art = signal(false);
  /** Touch: the planet whose name the first tap showed. */
  readonly armed = signal<VerseDoor | null>(null);
  /** The projection order: the planet with the newest content first. */
  readonly order = computed(() => newestFirst(this.items()));
  readonly cur = computed<TransmitItem | null>(() => {
    const l = this.order();
    return l.length ? l[this.index() % l.length] : null;
  });

  private readonly zone = inject(NgZone);
  private readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armedTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';

  constructor() {
    effect(() => {
      const n = this.items().length;
      const away = this.away() || this.hold();
      untracked(() => {
        if (away || this.reduced) {
          this.stop();
          this.phase.set('rest');
        } else if (n && !this.running && this.visible) {
          this.running = true;
          this.rest(TX_START_MS);
        } else if (!n) {
          this.stop();
        }
      });
    });
    // A hidden tab draws no frames: the cycle stops and starts over (with its first wait) when the tab is back.
    const onVisibility = (): void => {
      this.visible = document.visibilityState !== 'hidden';
      if (!this.visible) {
        this.stop();
        this.phase.set('rest');
      } else if (!this.away() && !this.hold() && this.items().length && !this.reduced && !this.running) {
        this.running = true;
        this.rest(TX_START_MS);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    // Touch, first tap on a planet: the name, not the page (QA D2). RouterLink's own click
    // listener on the anchor navigates whatever a sibling listener does, so the first tap is
    // taken here, in the capture phase on the host, before it ever reaches the anchor.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const onCapture = (ev: MouseEvent): void => {
      const pl = (ev.target as Element | null)?.closest?.('a.pl[data-door]');
      if (!pl || !host.contains(pl)) return;
      const d = pl.getAttribute('data-door') as VerseDoor;
      if (!this.firstTap(ev, d)) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.zone.run(() => this.arm(d));
    };
    host.addEventListener('click', onCapture, true);
    const artTimer = this.zone.runOutsideAngular(() => setTimeout(() => this.art.set(true), TX_ART_MS));
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(artTimer);
      host.removeEventListener('click', onCapture, true);
      document.removeEventListener('visibilitychange', onVisibility);
      this.stop();
      if (this.armedTimer) clearTimeout(this.armedTimer);
    });
  }

  open(c: TransmitItem): void {
    this.opened.emit(c);
  }

  /** A planet was clicked. On touch the first tap only shows the name, the second one opens it. */
  tap(ev: MouseEvent, d: VerseDoor): void {
    if (this.firstTap(ev, d)) {
      ev.preventDefault();
      this.arm(d);
      return;
    }
    this.armed.set(null);
    this.door.emit(d);
  }

  /** A plain tap on touch on a planet whose name is not showing yet: it shows the name. Modified clicks pass. */
  private firstTap(ev: MouseEvent, d: VerseDoor): boolean {
    return this.coarse && this.armed() !== d && isPlainLeftClick(ev);
  }

  private arm(d: VerseDoor): void {
    this.armed.set(d);
    if (this.armedTimer) clearTimeout(this.armedTimer);
    this.zone.runOutsideAngular(() => {
      this.armedTimer = setTimeout(() => this.zone.run(() => this.armed.set(null)), NAME_ARMED_MS);
    });
  }


  /** Timers run outside the Angular zone: the signals they set schedule the change detection themselves. */
  private later(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => {
        this.timer = null;
        fn();
      }, ms);
    });
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
  }

  /** Nothing projected for `ms`, then the planet in turn ignites. */
  private rest(ms: number): void {
    this.phase.set('rest');
    this.later(ms, () => this.ignite());
  }

  private ignite(): void {
    if (!this.cur()) return this.stop();
    this.phase.set('charge');
    this.later(TX_CHARGE_MS, () => {
      this.phase.set('build');
      this.later(TX_BUILD_MS, () => {
        this.phase.set('write');
        this.later(TX_WRITE_MS, () => {
          this.phase.set('pull');
          this.later(TX_PULL_MS, () => {
            this.phase.set('hold');
            this.later(TX_HOLD_MS, () => this.retract());
          });
        });
      });
    });
  }

  /** The panel is projected away with the projection's own animations, reversed; then the pause. */
  private retract(): void {
    if (this.held()) return this.later(TX_HELD_RECHECK_MS, () => this.retract());
    this.phase.set('unwrite');
    this.later(TX_UNWRITE_MS, () => {
      this.phase.set('unbuild');
      this.later(TX_UNBUILD_MS, () => {
        this.phase.set('uncharge');
        this.later(TX_UNCHARGE_MS, () => {
          this.index.update((i) => i + 1);
          this.rest(TX_GAP_MS);
        });
      });
    });
  }
}
