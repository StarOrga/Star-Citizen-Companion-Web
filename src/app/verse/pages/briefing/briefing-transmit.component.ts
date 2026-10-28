import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { VerseDoor } from '../../data/verse.models';

/** Charge + light cone grow out of the sending planet. */
export const TX_CHARGE_MS = 1000;
/** The holo is revealed top to bottom ("received"), the title stands at once. */
export const TX_REVEAL_MS = 700;
/** Typing speed of the holo's body. */
export const TX_CHARS_PER_S = 45;
/** The finished message stands this long before the next planet sends. */
export const TX_HOLD_MS = 8000;
/** Fade-out between two messages. */
export const TX_OUT_MS = 400;

export const TX_DOORS: readonly VerseDoor[] = ['news', 'patches', 'gallery'];

export type TxPhase = 'charge' | 'reveal' | 'type' | 'hold' | 'out';

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
 *   charge   the sender's atmosphere brightens, the trapezoid light cone
 *            grows out of it, soft area waves run planet → holo (~1 s)
 *   reveal   the holo is received top to bottom, the title stands at once
 *   type     the body types at {@link TX_CHARS_PER_S} chars/s, the cone
 *            stays weak (~35 %)
 *   hold     {@link TX_HOLD_MS}, the cone fades out
 *
 * No line beam, packets, impact flash, shock wave or glitch, no radar rings.
 * Pointer or focus on the holo holds the relay. Reduced motion: no cone, no
 * waves, no reveal or typing — the message stands, the relay swaps it.
 */
@Component({
  selector: 'sc-briefing-transmit',
  standalone: true,
  imports: [RouterLink, TranslatePipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './briefing-transmit.component.scss',
  template: `
    @let c = cur();
    <span class="cone" aria-hidden="true" [attr.data-door]="c?.door ?? null" [attr.data-phase]="phase()"><i class="waves"></i></span>
    @for (d of doors; track d) {
      <a class="pl" [attr.data-door]="d" [class.send]="c?.door === d && (phase() === 'charge' || phase() === 'reveal')"
         [routerLink]="'/verse/' + d" (click)="door.emit(d)">
        <span class="plab">{{ ('verse.gates.' + d + '.topic') | translate }}</span>
      </a>
    }
    @if (c) {
      @if (c.internal) {
        <a class="holo" [attr.data-phase]="phase()" [routerLink]="c.path" [queryParams]="c.query"
           (click)="open(c)" (auxclick)="open(c)" (mouseenter)="held.set(true)" (mouseleave)="held.set(false)"
           (focusin)="held.set(true)" (focusout)="held.set(false)">
          <ng-container *ngTemplateOutlet="body; context: { $implicit: c }" />
        </a>
      } @else {
        <a class="holo" [attr.data-phase]="phase()" [href]="c.path" target="_blank" rel="noopener noreferrer"
           (click)="open(c)" (auxclick)="open(c)" (mouseenter)="held.set(true)" (mouseleave)="held.set(false)"
           (focusin)="held.set(true)" (focusout)="held.set(false)">
          <ng-container *ngTemplateOutlet="body; context: { $implicit: c }" />
        </a>
      }
    }
    <ng-template #body let-c>
      <span class="holo-in">
        <span class="k">{{ ('verse.gates.' + c.door + '.topic') | translate }}</span>
        <span class="t">{{ c.title }}</span>
        <span class="b"><span class="typed">{{ c.body.slice(0, typed()) }}</span><span class="ghost" aria-hidden="true">{{ c.body.slice(typed()) }}</span></span>
      </span>
    </ng-template>
  `,
})
export class BriefingTransmitComponent {
  readonly items = input<readonly TransmitItem[]>([]);
  /** A planet was used (analytics). */
  readonly door = output<VerseDoor>();
  /** The holo was opened. */
  readonly opened = output<TransmitItem>();

  readonly doors = TX_DOORS;
  readonly index = signal(0);
  readonly phase = signal<TxPhase>('out');
  readonly typed = signal(0);
  /** Pointer / focus on the holo: the relay waits. */
  readonly held = signal(false);
  readonly cur = computed<TransmitItem | null>(() => {
    const l = this.items();
    return l.length ? l[this.index() % l.length] : null;
  });

  private readonly reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor() {
    effect(() => {
      const n = this.items().length;
      untracked(() => {
        if (n && !this.running) {
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
    if (this.reduced) {
      this.typed.set(c.body.length);
      this.phase.set('hold');
      return this.later(TX_HOLD_MS, () => this.next());
    }
    this.typed.set(0);
    this.phase.set('charge');
    this.later(TX_CHARGE_MS, () => {
      this.phase.set('reveal');
      this.later(TX_REVEAL_MS, () => {
        this.phase.set('type');
        this.type(c.body.length);
      });
    });
  }

  private type(total: number): void {
    if (this.typed() >= total) {
      this.phase.set('hold');
      return this.later(TX_HOLD_MS, () => this.next());
    }
    this.later(1000 / TX_CHARS_PER_S, () => {
      this.typed.update((n) => n + 1);
      this.type(total);
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
