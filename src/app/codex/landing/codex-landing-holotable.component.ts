import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import { LandingCategory, LandingItem } from './codex-landing-data.types';

/** How long a "no hull" answer of the viewer is doubted: its first emit precedes the skin catalog read. */
const NO_HULL_GRACE_MS = 3000;

/** Tiny etched glyph per rotation category (decorative, the label carries the meaning). */
export const CATEGORY_GLYPH: Record<LandingCategory, string> = {
  ship: '⛭',
  fpsWeapon: '✶',
  armor: '⛨',
  component: '◈',
  tool: '⚒',
};

/**
 * The holotable of the Codex landing (concept 2026-10-29-codex-landing-neu,
 * round 6, d1-s1): emitter + light beam, the item's hologram, a glowing name
 * plate and the rotation selector etched into the table rim.
 *
 * Ships render through the ship page's own holo viewer (texture-free hull,
 * `sc-ship-skin-viewer` in holo mode) — never tinted by a paint. Everything
 * without a 3D hull gets a holo-style icon silhouette. Hologram and name are
 * real anchors to the item's detail page.
 */
@Component({
  selector: 'sc-codex-landing-holotable',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, ShipSkinViewerComponent, CodexCategoryIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.still]': 'still()', '[class.paused]': 'paused()' },
  template: `
    <div class="air">
      <span class="halo" aria-hidden="true"></span>
      <span class="beam" aria-hidden="true"><i></i></span>
      @if (item(); as it) {
        @for (key of [it.category + ':' + it.className]; track key) {
          <a class="holo" [routerLink]="it.detailRoute"
             [attr.aria-label]="'codex.landing.holo.open' | translate: { name: it.name }">
            <span class="ring" aria-hidden="true"></span>
            @if (it.kind === 'ship' && !no3d().has(it.className)) {
              @defer (on immediate) {
                <sc-ship-skin-viewer class="viewer" [shipId]="it.className" [embedded]="true" [holo]="true"
                                     [still]="still()" (available)="onAvailable(it.className, $event)" />
              } @placeholder {
                <span class="viewer" aria-hidden="true"></span>
              }
            } @else {
              <span class="sil" aria-hidden="true"><sc-codex-icon [kind]="it.kind" /></span>
            }
            <span class="scan" aria-hidden="true"></span>
            <span class="sweep" aria-hidden="true"></span>
            <span class="go" aria-hidden="true">↗</span>
          </a>
          <div class="plate">
            <p class="plate-eyebrow">
              <span>{{ 'codex.landing.holo.newIn' | translate }} · {{ 'codex.landing.category.' + it.category | translate }}</span>
              @if (it.eyebrow.manufacturer) { <span> · {{ it.eyebrow.manufacturer }}</span> }
            </p>
            <a class="name" [routerLink]="it.detailRoute">{{ it.name }}<i aria-hidden="true">↗</i></a>
          </div>
        }
      } @else if (loading()) {
        <p class="state" role="status">{{ 'codex.landing.holo.loading' | translate }}</p>
      }
    </div>
    <div class="table">
      <span class="skirt" aria-hidden="true"></span>
      <span class="top" aria-hidden="true"><i class="reflect"></i><i class="streak"></i></span>
      <span class="emitter" aria-hidden="true"></span>
      <div class="arc" role="group" [attr.aria-label]="'codex.landing.holo.rotation' | translate">
        @for (cat of categories(); track cat; let i = $index) {
          <button type="button" class="seg" [style.--x]="segX(i)" [style.--y]="segY(i)" [style.--r]="segR(i)"
                  [class.on]="i === active()" [class.held]="held() && i === active()" [class.done]="i < active()"
                  [attr.aria-pressed]="held() && i === active()"
                  [attr.aria-label]="'codex.landing.category.' + cat | translate"
                  [scTooltip]="(held() && i === active() ? 'codex.landing.holo.next' : 'codex.landing.holo.hold') | translate"
                  scTooltipTier="label"
                  (click)="pick.emit(i)">
            @if (i === active()) {
              @for (c of [cycle()]; track c) { <i class="fill" [style.animation-duration.ms]="cycleMs()"></i> }
            } @else {
              <i class="fill"></i>
            }
            <b><span aria-hidden="true">{{ glyph(cat) }}</span><span class="seg-label">{{ 'codex.landing.category.' + cat | translate }}</span></b>
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        --holo: #8fe3ff;
        position: relative;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .air { position: relative; z-index: 2; flex: 1 1 auto; min-height: 120px; }
      .halo {
        position: absolute; left: 10%; right: 10%; top: -10%; bottom: 20%;
        background: radial-gradient(ellipse 50% 50% at 50% 50%, rgba(82, 193, 230, 0.17), transparent 70%);
        pointer-events: none;
      }
      /* The light beam (Verse planet beam construction): a trapezoid of light from the emitter up. */
      .beam {
        position: absolute; left: 0; right: 0; top: 34%; bottom: -30px;
        clip-path: polygon(46% 100%, 54% 100%, 82% 0, 18% 0);
        pointer-events: none; mix-blend-mode: screen;
        background: linear-gradient(0deg, rgba(160, 230, 255, 0.34), rgba(82, 193, 230, 0.1) 60%, transparent);
        animation: beam 3.2s ease-in-out infinite;
      }
      .beam::before {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(1px 1px at 40% 30%, rgba(255, 255, 255, 0.85), transparent),
          radial-gradient(1px 1px at 58% 52%, rgba(255, 255, 255, 0.7), transparent),
          radial-gradient(1.5px 1.5px at 47% 72%, rgba(255, 255, 255, 0.85), transparent),
          radial-gradient(1px 1px at 64% 20%, rgba(255, 255, 255, 0.6), transparent),
          radial-gradient(1px 1px at 33% 12%, rgba(255, 255, 255, 0.6), transparent),
          radial-gradient(1px 1px at 52% 40%, rgba(255, 255, 255, 0.7), transparent);
      }
      .beam i {
        position: absolute; left: 50%; top: 6%; bottom: 0; width: 5px; transform: translateX(-50%);
        background: linear-gradient(0deg, rgba(240, 253, 255, 0.95), rgba(160, 230, 255, 0.4) 55%, transparent);
        filter: blur(1.5px);
      }
      a.holo {
        position: absolute; left: 50%; top: 0; bottom: 24%; z-index: 2;
        width: min(96%, 700px); transform: translateX(-50%);
        display: block; color: var(--holo); text-decoration: none;
      }
      .holo:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 4px; border-radius: 6px; }
      /* The viewer turns on its own; the whole hologram is the link, so it takes no pointer. */
      .viewer { position: absolute; inset: 0; display: block; pointer-events: none; }
      .viewer ::ng-deep .stage { height: 100%; min-height: 0; background: transparent; }
      .viewer ::ng-deep model-viewer { width: 100%; height: 100%; }
      .sil {
        position: absolute; inset: 14% 30%; display: grid; place-items: center;
        color: var(--holo);
        filter: drop-shadow(0 0 3px rgba(170, 235, 255, 0.9)) drop-shadow(0 0 16px rgba(82, 193, 230, 0.55));
        opacity: 0.9;
        animation: flicker 7s steps(1) infinite;
      }
      .sil sc-codex-icon { --sc-icon-max: 200px; width: 100%; height: 100%; }
      /* A hologram is never tinted: the category colour of the icon gives way to holo light. */
      .sil sc-codex-icon ::ng-deep svg { color: var(--holo) !important; }
      .scan {
        position: absolute; inset: 4% 8%; pointer-events: none; mix-blend-mode: screen;
        background: repeating-linear-gradient(180deg, rgba(150, 230, 255, 0.1) 0 1px, transparent 1px 4px);
        -webkit-mask-image: radial-gradient(ellipse 48% 44% at 50% 52%, #000 30%, transparent 74%);
        mask-image: radial-gradient(ellipse 48% 44% at 50% 52%, #000 30%, transparent 74%);
      }
      /* One soft sweep line, faded at both ends and at the turn of each pass. */
      .sweep {
        position: absolute; left: 22%; right: 22%; top: 10%; height: 2px; pointer-events: none;
        background: linear-gradient(90deg, transparent, rgba(210, 248, 255, 0.75), transparent);
        box-shadow: 0 0 12px rgba(130, 220, 255, 0.7);
        opacity: 0;
        animation: sweep 5.2s cubic-bezier(0.45, 0, 0.55, 1) infinite;
      }
      .ring {
        position: absolute; left: 28%; right: 28%; bottom: -4%; height: 13%; border-radius: 50%;
        border: 1px solid rgba(150, 230, 255, 0.4);
        box-shadow: 0 0 18px rgba(82, 193, 230, 0.3), inset 0 0 18px rgba(82, 193, 230, 0.22);
        pointer-events: none;
      }
      .go { position: absolute; right: 6%; top: 4%; font-size: 15px; line-height: 1; color: var(--sc-accent); opacity: 0.45; }
      .holo:hover .go, .holo:focus-visible .go { opacity: 1; }
      .plate {
        position: absolute; left: 50%; bottom: 8px; z-index: 3;
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        max-width: 100%; padding: 8px 44px 10px; white-space: nowrap;
        transform: translateX(-50%) perspective(600px) rotateX(16deg); transform-origin: 50% 100%;
        background: radial-gradient(ellipse 62% 74% at 50% 60%, rgba(82, 193, 230, 0.32), rgba(82, 193, 230, 0.07) 60%, transparent 76%);
      }
      .plate::before, .plate::after {
        content: ''; position: absolute; left: 0; right: 0; height: 1px;
        background: linear-gradient(90deg, transparent, rgba(190, 240, 255, 0.85) 28%, rgba(190, 240, 255, 0.85) 72%, transparent);
        box-shadow: 0 0 10px rgba(130, 220, 255, 0.7);
      }
      .plate::before { top: 0; }
      .plate::after { bottom: 0; }
      .plate-eyebrow {
        margin: 0; font: 600 max(10px, 0.64rem) / 1.3 var(--sc-font-display);
        letter-spacing: 0.18em; text-transform: uppercase; color: var(--sc-fg-1);
      }
      .name {
        display: inline-flex; align-items: center; gap: 8px; max-width: 100%;
        overflow: hidden; text-overflow: ellipsis;
        font: 500 26px / 1.05 var(--sc-font-display); color: #eaf9ff; text-decoration: none;
        text-shadow: 0 0 14px rgba(130, 220, 255, 0.75), 0 0 34px rgba(82, 193, 230, 0.45);
      }
      .name i { font-style: normal; font-size: 13px; line-height: 1; color: var(--sc-accent); opacity: 0.7; transform: translateY(-0.1em); }
      .name:hover i, .name:focus-visible i { opacity: 1; }
      .state { position: absolute; left: 0; right: 0; top: 40%; margin: 0; text-align: center; color: var(--sc-fg-2); font-size: 13px; }
      /* ── The table: top disc, skirt, emitter, etched rim ── */
      .table { position: relative; z-index: 1; flex: 0 0 auto; width: min(560px, 92%); height: 104px; margin: 0 auto; }
      /* Skirt: a plain lit gradient — round 6 dropped the vertical strokes. */
      .skirt {
        position: absolute; left: 3%; right: 3%; top: 32px; bottom: 0;
        clip-path: polygon(0 0, 100% 0, 95% 100%, 5% 100%);
        background:
          linear-gradient(90deg, rgba(0, 0, 0, 0.45), transparent 22%, transparent 78%, rgba(0, 0, 0, 0.45)),
          linear-gradient(180deg, #12303f 0%, #0a1c27 45%, #050d13 100%);
      }
      .top {
        position: absolute; left: 0; right: 0; top: 0; height: 64px; overflow: hidden; border-radius: 50%;
        background:
          repeating-radial-gradient(ellipse at 50% 50%, transparent 0 18px, rgba(130, 210, 240, 0.06) 18px 19px),
          radial-gradient(ellipse at 50% 45%, #1d4356 0%, #0e2532 45%, #07141c 75%);
        box-shadow:
          inset 0 2px 0 rgba(190, 240, 255, 0.45), inset 0 -2px 0 rgba(82, 193, 230, 0.25),
          inset 0 -14px 26px rgba(0, 0, 0, 0.6), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 34px rgba(82, 193, 230, 0.14);
      }
      .reflect {
        position: absolute; left: 20%; right: 20%; top: 6%; height: 62%; border-radius: 50%;
        background: radial-gradient(ellipse at 50% 60%, rgba(150, 230, 255, 0.45), rgba(82, 193, 230, 0.12) 50%, transparent 72%);
        filter: blur(2px);
      }
      .streak { position: absolute; left: 30%; right: 30%; top: 16%; height: 3px; border-radius: 50%; background: rgba(200, 245, 255, 0.35); filter: blur(1.5px); }
      .emitter {
        position: absolute; left: 50%; top: 32px; z-index: 1; width: 96px; height: 26px; border-radius: 50%;
        transform: translate(-50%, -50%);
        background: radial-gradient(ellipse at 50% 50%, #f4feff 0 9%, #a6ecff 16%, rgba(82, 193, 230, 0.75) 26%, #0f3445 38%, #2b5a70 44%, #0b1c26 52%, #183a4a 60%, #08141b 72%);
        box-shadow: 0 0 26px 6px rgba(82, 193, 230, 0.45), inset 0 -2px 4px rgba(0, 0, 0, 0.6);
        animation: emitter 3.2s ease-in-out infinite;
      }
      .arc { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
      .seg {
        position: absolute; left: var(--x); top: var(--y); width: 13%; min-height: 32px;
        transform: translateX(-50%) rotate(var(--r));
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 6px 0 2px; border: 0; background: none; cursor: pointer; pointer-events: auto;
      }
      .seg:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 3px; }
      .fill {
        position: relative; display: block; width: 100%; height: 3px; border-radius: 2px; overflow: hidden;
        background: rgba(2, 8, 12, 0.85);
        box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(190, 240, 255, 0.16);
      }
      .fill::before {
        content: ''; position: absolute; inset: 0 auto 0 0; width: 0;
        background: linear-gradient(90deg, rgba(130, 220, 255, 0.6), #c8f2ff);
        box-shadow: 0 0 6px rgba(130, 220, 255, 0.9);
      }
      .seg.on .fill::before { animation: fill linear both; animation-duration: inherit; }
      :host(.paused) .seg.on .fill::before { animation-play-state: paused; }
      :host(.still) .seg.on .fill::before { animation: none; width: 100%; }
      .seg.done .fill::before { width: 100%; opacity: 0.3; box-shadow: none; }
      .seg.held .fill::before { animation: none; width: 100%; background: #dff6ff; box-shadow: 0 0 10px rgba(160, 230, 255, 0.95); }
      .seg b {
        display: flex; align-items: center; gap: 5px;
        font: 400 11px / 1 var(--sc-font-body); color: rgba(159, 179, 200, 0.5);
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
      }
      .seg-label { font: 600 max(9px, 0.56rem) / 1 var(--sc-font-display); letter-spacing: 0.14em; text-transform: uppercase; white-space: nowrap; }
      .seg:not(.on) .seg-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .seg:hover b, .seg:focus-visible b { color: var(--sc-fg-1); }
      .seg.on b { color: #dff6ff; text-shadow: 0 0 8px rgba(130, 220, 255, 0.85); }
      .seg.held b { animation: breathe 2.4s ease-in-out infinite; }
      @keyframes fill { from { width: 0; } to { width: 100%; } }
      @keyframes beam { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.8; } }
      @keyframes emitter { 0%, 100% { box-shadow: 0 0 26px 6px rgba(82, 193, 230, 0.45), inset 0 -2px 4px rgba(0, 0, 0, 0.6); } 50% { box-shadow: 0 0 32px 8px rgba(82, 193, 230, 0.55), inset 0 -2px 4px rgba(0, 0, 0, 0.6); } }
      @keyframes flicker { 0%, 95%, 100% { opacity: 0.9; } 96% { opacity: 0.68; } 97% { opacity: 0.9; } 98% { opacity: 0.8; } }
      @keyframes sweep {
        0% { top: 10%; opacity: 0; }
        12% { opacity: 0.5; }
        80% { opacity: 0.5; }
        100% { top: 86%; opacity: 0; }
      }
      @keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
      @media (prefers-reduced-motion: reduce) {
        .beam, .sil, .sweep, .emitter, .seg.held b { animation: none; }
        .sweep { display: none; }
      }
      @media (max-width: 720px) {
        .air { min-height: 0; }
        a.holo { bottom: 30%; }
        .name { font-size: 18px; }
        .plate { padding: 6px 24px 8px; bottom: 2px; }
        .table { width: 100%; height: 84px; }
        .seg b { font-size: 10px; }
      }
    `,
  ],
})
export class CodexLandingHolotableComponent {
  readonly item = input<LandingItem | null>(null);
  readonly categories = input<readonly LandingCategory[]>([]);
  readonly active = input(0);
  readonly held = input(false);
  readonly paused = input(false);
  readonly still = input(false);
  readonly loading = input(false);
  /** Bumps on every rotation step: restarts the active segment's fill. */
  readonly cycle = input(0);
  readonly cycleMs = input(8000);
  readonly pick = output<number>();

  /** Ships whose viewer reported "no 3D hull": they fall back to the silhouette. */
  protected readonly no3d = signal<ReadonlySet<string>>(new Set());

  /** Segment positions along the rim arc (round 6: 18/34/50/66/82 %, curved). */
  private readonly layout = computed(() => {
    const n = Math.max(1, this.categories().length);
    return Array.from({ length: n }, (_, i) => {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1 … 1
      return { x: 50 + t * 32, y: 58 - 8 * t * t, r: -5.4 * t };
    });
  });

  glyph(cat: LandingCategory): string {
    return CATEGORY_GLYPH[cat];
  }
  segX(i: number): string {
    return `${this.layout()[i]?.x ?? 50}%`;
  }
  segY(i: number): string {
    return `${this.layout()[i]?.y ?? 58}px`;
  }
  segR(i: number): string {
    return `${this.layout()[i]?.r ?? 0}deg`;
  }

  private readonly noHullTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.noHullTimers.forEach((t) => clearTimeout(t)));
  }

  /**
   * The viewer emits false at once (skin list still empty) and true when the
   * catalog arrives, so a false only counts as "no 3D hull" if no true
   * follows within the grace period.
   */
  onAvailable(className: string, available: boolean): void {
    const pending = this.noHullTimers.get(className);
    if (pending) clearTimeout(pending);
    if (available) {
      this.noHullTimers.delete(className);
      return;
    }
    this.noHullTimers.set(
      className,
      setTimeout(() => {
        this.noHullTimers.delete(className);
        this.no3d.update((s) => new Set([...s, className]));
      }, NO_HULL_GRACE_MS),
    );
  }
}
