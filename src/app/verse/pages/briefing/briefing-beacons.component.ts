import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { VersePoint } from '../../data/verse.models';
import { BriefingSkyComponent } from './briefing-sky.component';
import { TREND_GLYPH, StabilityTrend, stabilityWord } from '../../../news/patch-stability';
import { splitChars } from './briefing.model';

/** Quiet time (no scroll, no pointer movement, window focused) before the idle hint. */
export const IDLE_HINT_MS = 8000;
/** How long the hint's labels stand before they calm down again. */
export const IDLE_SHOW_MS = 5000;

/**
 * The stage's two beacons, top right, both real anchors: the sun (→ the LIVE
 * patch's status) and the current patch's constellation below-left of it
 * (→ the star map). Hover: the sun's corona brightens and grows, a flare
 * streak crosses it (the sun itself: concept 2026-10-31 "Sonne & Planeten" —
 * a limb-darkened, boiling photosphere, small irregular storms — plasma loops
 * that rise and fade at the limb on their own clocks, now and then a flare —
 * a breathing two-layer corona with uneven streamers and a soft bloom), "Patch-Status" + "LIVE 4.3.1 · Stabilität 50 %" rise
 * letter by letter; the constellation redraws its lines and twinkles in the
 * star map's own white/blue and wording ("Sternkarte", "Sternbild von Patch …
 * · 3 von 5 Sternen"). Only the sun keeps its warm tone.
 *
 * Idle hint: after {@link IDLE_HINT_MS} without scroll or pointer movement
 * (window focused), once per visit — one light-ring pulse of the sun, the
 * constellation's lines glimmer once, both names rise and fade after
 * {@link IDLE_SHOW_MS}. Reduced motion: no hint, no hover motion.
 */
@Component({
  selector: 'sc-briefing-beacons',
  standalone: true,
  imports: [RouterLink, TranslatePipe, BriefingSkyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './briefing-beacons.component.scss',
  template: `
    @let sunName = 'verse.hub.sun' | translate;
    @let sunValue = version()
      ? ((stability() !== null ? 'verse.hub.sunValue' : 'verse.hub.sunValueNoScore') | translate: { v: version() })
      : '';
    @let sunScore = stability() !== null
      ? (trendGlyph() ? trendGlyph() + ' ' : '') + (('stability.word.' + word()) | translate) + ' ' + stability() + ' %'
      : '';
    <a class="sun-l" [routerLink]="sunLink()" [class.idle]="idle()" [attr.aria-label]="sunValue ? sunName + ' · ' + sunValue + (sunScore ? ' ' + sunScore : '') : sunName">
      @if (idle()) {
        <span class="ring" aria-hidden="true"></span>
      }
      <span class="sun" aria-hidden="true">
        <i class="glow"></i><i class="corona"></i><i class="corona c2"></i><i class="streamers"></i>
        @for (p of proms; track p.a) {
          <b class="prom" [style.--a]="p.a" [style.--d]="p.d" [style.--w]="p.w" [style.--z]="p.z"><i></i></b>
        }
        <i class="disc"></i><i class="flash"></i>
      </span>
      <span class="flare" aria-hidden="true"></span>
      <span class="lab warm" aria-hidden="true">
        <span class="lab-n">@for (ch of chars(sunName); track ch.i) {<i [style.--n]="ch.i">{{ ch.c }}</i>}</span>
        @if (sunValue) {
          <span class="lab-v">{{ sunValue }}@if (sunScore) { <span class="sw" [attr.data-word]="word()">{{ sunScore }}</span>}</span>
        }
      </span>
    </a>
    @if (skyReady()) {
      @let mapName = 'starmap.title' | translate;
      @let mapValue = patchLine()
        ? ('starmap.stageAria' | translate: { patch: patchLine() }) + ' · ' + ('starmap.progress' | translate: { lit: lit(), total: total() })
        : ('starmap.progress' | translate: { lit: lit(), total: total() });
      <a class="const-l" routerLink="/verse/explorer" [class.idle]="idle()" [attr.aria-label]="mapName + ' · ' + mapValue">
        <span class="fig" data-verse-fly="starmap" aria-hidden="true"><sc-briefing-sky [points]="points()" [lit]="lit()" [litSet]="litSet()" /></span>
        <span class="lab" aria-hidden="true">
          <span class="lab-n">@for (ch of chars(mapName); track ch.i) {<i [style.--n]="ch.i">{{ ch.c }}</i>}</span>
          <span class="lab-v">{{ mapValue }}</span>
        </span>
      </a>
    }
  `,
})
export class BriefingBeaconsComponent {
  readonly sunLink = input<string | readonly string[]>('/verse/patches');
  readonly version = input<string | null>(null);
  readonly stability = input<number | null>(null);
  /** Trend against the previous patch (▲/▼/≈); null while provisional or without a comparison. */
  readonly trend = input<StabilityTrend | null>(null);
  readonly word = computed(() => stabilityWord(this.stability()) ?? 'wackelig');
  readonly trendGlyph = computed(() => { const t = this.trend(); return t ? TREND_GLYPH[t] : ''; });
  readonly skyReady = input(false);
  readonly points = input<readonly VersePoint[] | null>(null);
  readonly lit = input(0);
  readonly total = input(0);
  readonly litSet = input<ReadonlySet<number> | null>(null);
  readonly patchLine = input<string | null>(null);

  /**
   * The sun's prominences: angle on the limb, cycle length, delay into it and
   * size. Cycles share no common beat, so the storms never fall into a pattern.
   */
  readonly proms = [
    { a: '-58deg', d: '7.9s', w: '-2.1s', z: '1' },
    { a: '24deg', d: '11.3s', w: '-6.4s', z: '0.8' },
    { a: '97deg', d: '13.7s', w: '-1.2s', z: '1.15' },
    { a: '168deg', d: '9.1s', w: '-7.7s', z: '0.7' },
    { a: '232deg', d: '16.9s', w: '-11.5s', z: '0.95' },
    { a: '-12deg', d: '19.3s', w: '-15.8s', z: '0.6' },
  ] as const;

  /** The idle hint is showing. */
  readonly idle = signal(false);

  constructor() {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const destroyRef = inject(DestroyRef);
    if (reduced) return;
    afterNextRender(() => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      const events = ['scroll', 'pointermove', 'wheel', 'touchstart'] as const;
      const detach = (): void => {
        for (const e of events) window.removeEventListener(e, arm, true);
        window.removeEventListener('focus', arm);
      };
      const fire = (): void => {
        timer = null;
        if (document.visibilityState !== 'visible' || !document.hasFocus()) return arm();
        done = true;
        detach();
        this.idle.set(true);
        timer = setTimeout(() => this.idle.set(false), IDLE_SHOW_MS);
      };
      function arm(): void {
        if (done) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(fire, IDLE_HINT_MS);
      }
      for (const e of events) window.addEventListener(e, arm, { capture: true, passive: true });
      window.addEventListener('focus', arm);
      arm();
      destroyRef.onDestroy(() => {
        detach();
        if (timer) clearTimeout(timer);
      });
    });
  }

  chars(text: string): { readonly c: string; readonly i: number }[] {
    return splitChars(text);
  }
}
