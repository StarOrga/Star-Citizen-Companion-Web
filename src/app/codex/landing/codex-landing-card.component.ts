import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ACC_MOVE_PX, ACC_REST_MS } from '../../verse/pages/briefing/briefing-accordion';
import { formatNumber, humanizeClassName } from '../codex-format';
import { LandingItem, LandingOverviewField, LandingPaint, LandingValue } from './codex-landing-data.types';

/** Paint tiles shown before the "+ N" tile takes the fourth place. */
const PAINT_TILES = 3;

/** One value row ready for the template. */
export interface CardValueRow {
  key: string;
  label: string;
  text: string;
}

/**
 * Label for a top value: `codex.landing.value.<key>` when translated, else the
 * humanised last path segment (non-ship categories emit generic payload keys).
 */
export function valueLabel(t: Pick<TranslateService, 'instant'>, key: string): string {
  const k = `codex.landing.value.${key}`;
  const out = t.instant(k);
  if (typeof out === 'string' && out !== k) return out;
  const last = key.split('.').pop() ?? key;
  return humanizeClassName(last.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

export function valueText(v: LandingValue): string {
  const n = formatNumber(v.value);
  if (!v.unit) return n;
  return v.unit === 'scu' ? `${n} SCU` : v.unit === 'hp' ? `${n} HP` : `${n} ${v.unit}`;
}

/**
 * Hover intent for the small card (mirrors the Verse News accordion,
 * `briefing-accordion.ts`): it opens only after the pointer came to rest on it
 * for {@link ACC_REST_MS}, measured from the last movement beyond
 * {@link ACC_MOVE_PX}. A fly-over starts nothing.
 */
export class CardRestIntent {
  private anchor: { x: number; y: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly fire: () => void) {}

  move(x: number, y: number): void {
    const a = this.anchor;
    if (a && Math.hypot(x - a.x, y - a.y) <= ACC_MOVE_PX) return;
    this.anchor = { x, y };
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, ACC_REST_MS);
  }

  leave(): void {
    this.anchor = null;
    this.clear();
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * The Datenkarte of the Codex landing (round 6, d1-s1…d1-s4, d1-s7): small at
 * rest, enlarged on click or a deliberate rest; front = RSI render + source
 * line, back = overview, 7 top values and the paints. Items without an RSI
 * image show a title block with the values on the front and never flip.
 * Paint order never changes: the shown paint is only marked.
 */
@Component({
  selector: 'sc-codex-landing-card',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-open]': 'open()' },
  template: `
    @if (item(); as it) {
      <!-- Small card: stays in the DOM while enlarged (focus returns to its trigger). -->
      <figure class="card small" [class.solo]="!image()" [class.under]="open()"
              (pointermove)="onPointerMove($event)" (pointerleave)="intent.leave()">
        <button type="button" class="grow" [attr.aria-label]="'codex.landing.card.grow' | translate"
                [attr.aria-expanded]="open()" (click)="open.set(true)"></button>
        @if (image(); as src) {
          <span class="thumb"><img [src]="src" alt="" loading="lazy" decoding="async" /></span>
          <span class="grow-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></span>
          <figcaption class="cap">
            <span class="cap-line">{{ paintName() }}
              @if (paints().length) { <span>· {{ 'codex.landing.card.paintOf' | translate: { index: paintIndex(), count: paints().length } }}</span> }
            </span>
            <ng-container *ngTemplateOutlet="srcLine" />
          </figcaption>
        } @else {
          <span class="grow-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></span>
          <div class="solo-body">
            <span class="label">{{ 'codex.landing.category.' + it.category | translate }}</span>
            <span class="solo-name">{{ it.name }}</span>
            <dl class="top3">
              @for (v of values().slice(0, 3); track v.key) {
                <div><dd>{{ v.text }}</dd><dt>{{ v.label }}</dt></div>
              }
            </dl>
          </div>
        }
      </figure>

      @if (open()) {
        <div class="card big" [class.solo]="!image()" scDialog [scDialogModal]="false" role="dialog"
             [attr.aria-label]="it.name" (scDialogEscape)="close()">
          @if (!image()) {
            <!-- No RSI image: title block + up to 7 values, no flip (d1-s7). -->
            <div class="back">
              <div class="back-head">
                <div>
                  <span class="label">{{ 'codex.landing.category.' + it.category | translate }}</span>
                  <a class="back-name" [routerLink]="it.detailRoute">{{ it.name }}<i aria-hidden="true">↗</i></a>
                </div>
                <ng-container *ngTemplateOutlet="shrinkBtn" />
              </div>
              <ng-container *ngTemplateOutlet="facts" />
              <dl class="top7 solo-values">
                @for (v of values(); track v.key) { <div><dt>{{ v.label }}</dt><dd>{{ v.text }}</dd></div> }
              </dl>
            </div>
          } @else if (!flipped()) {
            <div class="front">
              <img class="shot" [src]="image()" alt="" decoding="async" />
              <span class="shade" aria-hidden="true"></span>
              <ng-container *ngTemplateOutlet="shrinkBtn" />
              <div class="cap big-cap">
                <span class="label">{{ 'codex.landing.category.' + it.category | translate }}</span>
                <a class="back-name" [routerLink]="it.detailRoute">{{ it.name }}<i aria-hidden="true">↗</i></a>
                <span class="cap-line">{{ paintName() }}
                  @if (paints().length) { <span>· {{ 'codex.landing.card.paintOf' | translate: { index: paintIndex(), count: paints().length } }}</span> }
                </span>
                <ng-container *ngTemplateOutlet="srcLine" />
              </div>
              <button type="button" class="fold" [attr.aria-label]="'codex.landing.card.flipLabel' | translate" (click)="flipped.set(true)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>
                <span class="fold-tip" aria-hidden="true">{{ 'codex.landing.card.flip' | translate }}</span>
              </button>
            </div>
          } @else {
            <div class="back">
              <div class="back-head">
                <div>
                  <span class="label">{{ 'codex.landing.category.' + it.category | translate }}</span>
                  <a class="back-name" [routerLink]="it.detailRoute">{{ it.name }}<i aria-hidden="true">↗</i></a>
                </div>
                <ng-container *ngTemplateOutlet="shrinkBtn" />
              </div>
              @if (!showAll()) {
                <ng-container *ngTemplateOutlet="facts" />
                <dl class="top7">
                  @for (v of values(); track v.key) { <div><dt>{{ v.label }}</dt><dd>{{ v.text }}</dd></div> }
                </dl>
              }
              @if (paints().length) {
                <section class="paints" [class.fill]="showAll()">
                  <div class="paints-head">
                    <span class="label">{{ 'codex.landing.card.paints' | translate }}</span>
                    @if (showAll()) {
                      <button type="button" class="more" (click)="showAll.set(false)">{{ 'codex.landing.card.fewer' | translate }}</button>
                    }
                  </div>
                  <div class="pgrid" [class.all]="showAll()">
                    @for (p of visiblePaints(); track p.id) {
                      <button type="button" class="pt" [class.on]="p.id === selectedId()" [attr.aria-pressed]="p.id === selectedId()"
                              (click)="choosePaint(p)">
                        <span class="pimg"><img [src]="p.imageUrl" alt="" loading="lazy" decoding="async" /></span>
                        @if (p.isNew) { <em>{{ 'codex.landing.card.isNew' | translate }}</em> }
                        <span class="pn">{{ p.name }}</span>
                      </button>
                    }
                    @if (!showAll() && hiddenPaints() > 0) {
                      <button type="button" class="pt pmore" (click)="showAll.set(true)"
                              [attr.aria-label]="'codex.landing.card.morePaints' | translate: { count: paints().length }">
                        <span class="pimg"><b>+{{ hiddenPaints() }}</b></span>
                        <span class="pn">{{ 'codex.landing.card.paints' | translate }}</span>
                      </button>
                    }
                  </div>
                </section>
              }
              <button type="button" class="fold" [attr.aria-label]="'codex.landing.card.frontLabel' | translate" (click)="flipped.set(false)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>
                <span class="fold-tip" aria-hidden="true">{{ 'codex.landing.card.front' | translate }}</span>
              </button>
            </div>
          }
        </div>
      }

      <ng-template #shrinkBtn>
        <button type="button" class="shrink" [attr.aria-label]="'codex.landing.card.shrink' | translate"
                [scTooltip]="'codex.landing.card.shrink' | translate" scTooltipTier="label" (click)="close()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 4l-7 7M13 5v6h6M4 20l7-7M11 19v-6H5"/></svg>
        </button>
      </ng-template>
      <ng-template #srcLine>
        @if (sourceUrl(); as url) {
          <a class="src" [href]="url" target="_blank" rel="noopener noreferrer"><i aria-hidden="true"></i>{{ 'codex.landing.card.render' | translate }} · {{ paintName() }} <b aria-hidden="true">↗</b></a>
        } @else {
          <span class="src"><i aria-hidden="true"></i>{{ 'codex.landing.card.render' | translate }}</span>
        }
      </ng-template>
      <ng-template #facts>
        @if (overview().length) {
          <dl class="facts">
            @for (f of overview(); track f.id) {
              <div><dt>{{ 'codex.landing.overview.' + f.id | translate }}</dt><dd>{{ f.value }}</dd></div>
            }
          </dl>
        }
      </ng-template>
    }
  `,
  styleUrl: './codex-landing-card.component.scss',
})
export class CodexLandingCardComponent {
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly item = input<LandingItem | null>(null);
  readonly paints = input<readonly LandingPaint[]>([]);
  /** Enlarged. Two-way: the landing pauses its rotation while it is true. */
  readonly open = model(false);

  protected readonly flipped = signal(false);
  protected readonly showAll = signal(false);
  /** Selected paint id; null = the item's own RSI render ("Standard"). */
  protected readonly selectedId = signal<string | null>(null);

  readonly intent = new CardRestIntent(() => this.open.set(true));
  /** ngx-translate's current language (a signal): labels follow a switch. */
  private readonly lang = this.translate.currentLang;

  private readonly selected = computed(() => {
    const id = this.selectedId();
    const list = this.paints();
    if (id) return list.find((p) => p.id === id) ?? null;
    // No own render: the newest paint stands in (and is marked).
    return this.item()?.imageUrl ? null : (list[0] ?? null);
  });

  readonly image = computed(() => this.selected()?.imageUrl ?? this.item()?.imageUrl ?? null);
  readonly paintName = computed(() => {
    this.lang();
    return this.selected()?.name ?? (this.translate.instant('codex.landing.card.standard') as string);
  });
  readonly sourceUrl = computed(() => this.selected()?.rsiUrl ?? null);
  readonly paintIndex = computed(() => {
    const s = this.selected();
    return s ? this.paints().indexOf(s) + 1 : 1;
  });

  readonly overview = computed<LandingOverviewField[]>(() => (this.item()?.overview ?? []).filter((f) => !!f.value));
  readonly values = computed<CardValueRow[]>(() => {
    this.lang();
    return (this.item()?.topValues ?? []).slice(0, 7).map((v) => ({
      key: v.key,
      label: valueLabel(this.translate, v.key),
      text: valueText(v),
    }));
  });

  /** Order never changes; with more than 4 paints the 4th place is the "+ N" tile. */
  readonly visiblePaints = computed(() => {
    const list = this.paints();
    if (this.showAll() || list.length <= PAINT_TILES + 1) return list;
    return list.slice(0, PAINT_TILES);
  });
  readonly hiddenPaints = computed(() => this.paints().length - this.visiblePaints().length);

  constructor() {
    // A new item: back to the front, its own render, the compact paint list.
    effect(() => {
      this.item();
      untracked(() => {
        this.flipped.set(false);
        this.showAll.set(false);
        this.selectedId.set(null);
      });
    });
    effect(() => {
      if (!this.open()) untracked(() => this.intent.clear());
    });
    const onDown = (ev: PointerEvent) => {
      if (!this.open()) return;
      const big = this.host.querySelector('.card.big');
      if (big && ev.target instanceof Node && !big.contains(ev.target)) this.close();
    };
    document.addEventListener('pointerdown', onDown, true);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerdown', onDown, true);
      this.intent.clear();
    });
  }

  onPointerMove(ev: PointerEvent): void {
    if (this.open() || ev.pointerType === 'touch') return;
    this.intent.move(ev.clientX, ev.clientY);
  }

  close(): void {
    this.open.set(false);
    this.flipped.set(false);
    this.showAll.set(false);
  }

  choosePaint(p: LandingPaint): void {
    this.selectedId.set(p.id);
    this.showAll.set(false);
    this.flipped.set(false);
  }
}
