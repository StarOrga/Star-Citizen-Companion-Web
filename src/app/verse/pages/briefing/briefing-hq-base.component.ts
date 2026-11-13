import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The crates of the storage yard (x, y, w, h, tone), bottom row first. */
const CRATES: readonly (readonly [number, number, number, number, 'a' | 'b' | 'c' | 'hot'])[] = [
  [118, 77, 13, 11, 'b'], [131.5, 77, 13, 11, 'a'], [145, 77, 13, 11, 'c'], [158.5, 77, 13, 11, 'b'],
  [124, 66, 13, 11, 'c'], [137.5, 66, 13, 11, 'hot'], [151, 66, 13, 11, 'a'],
  [131, 55, 13, 11, 'b'],
];

/**
 * The HQ outpost on the planet's right limb (the scene's `.hqst`, /verse feedback
 * 2026-11-12 "nicht erkennbar nach hangar / lager"): read at a glance as
 * hangar + storage. Left the hangar — a steel hall with a slanted roof, its bay
 * open and lit, a fighter parked inside, approach lights running into it across
 * a striped apron; right the storage yard — stacked SCU containers under a
 * gantry crane that holds one more crate; at the edge the comm mast with dish
 * and beacon. The app's palette: steel, cyan instrument light (--sc-accent),
 * a few warm windows; sun from the top right like every body on the stage.
 * Motion: the approach lights chase into the bay, the beacon blinks, the bay
 * glow breathes — all held by `--sc-brief-play`, none under reduced motion.
 * Purely decorative (aria-hidden) — the HQ beacon anchor carries the name.
 */
@Component({
  selector: 'sc-briefing-hq-base',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="hb" viewBox="0 0 200 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hqb-wall" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#1a2631" /><stop offset="0.55" stop-color="#3a4d5c" /><stop offset="1" stop-color="#8fa5b4" />
        </linearGradient>
        <linearGradient id="hqb-roof" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#2a3a47" /><stop offset="0.6" stop-color="#7d93a3" /><stop offset="1" stop-color="#e4eef3" />
        </linearGradient>
        <linearGradient id="hqb-bay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b1a24" /><stop offset="0.55" stop-color="#1d4f66" /><stop offset="1" stop-color="#bff0ff" />
        </linearGradient>
        <linearGradient id="hqb-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4b5f6d" /><stop offset="0.25" stop-color="#1c2932" /><stop offset="1" stop-color="#0a1117" />
        </linearGradient>
        <linearGradient id="hqb-crate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6f8595" /><stop offset="1" stop-color="#26343f" />
        </linearGradient>
        <radialGradient id="hqb-spill" cx="0.5" cy="1" r="0.7">
          <stop offset="0" style="stop-color: var(--sc-accent, #52c1e6); stop-opacity: 0.55" /><stop offset="1" style="stop-color: var(--sc-accent, #52c1e6); stop-opacity: 0" />
        </radialGradient>
        <pattern id="hqb-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill="#e8b04a" /><rect x="3" width="3" height="6" fill="#141c22" />
        </pattern>
      </defs>

      <!-- Bay light spilling onto the apron. -->
      <ellipse class="spill" cx="65" cy="90" rx="52" ry="9" fill="url(#hqb-spill)" />

      <!-- Ground slab with its lit top edge. -->
      <path d="M2 88 H198 L196 100 H4 Z" fill="url(#hqb-ground)" />
      <path d="M2 88 H198" class="edge" />

      <!-- HANGAR: slanted-roof hall, open bay. -->
      <path d="M16 88 V54 L32 36 H98 L114 54 V88 Z" fill="url(#hqb-wall)" />
      <path d="M32 36 H98 L114 54 H16 Z" fill="url(#hqb-roof)" />
      <path d="M38 40 H92 M24 50 H106" class="seam" />
      @for (x of roofLights; track x) { <circle class="rl" [attr.cx]="x" cy="38.4" r="0.9" /> }
      <!-- Bay opening: lit interior, parked fighter, door leaves retracted to the sides. -->
      <rect x="30" y="56" width="70" height="32" fill="url(#hqb-bay)" />
      <rect class="bay-glow" x="30" y="56" width="70" height="32" />
      <path class="ship" d="M65 66 L69 72 L86 76 L86 78 L70 78 L67 82 H63 L60 78 H44 V76 L61 72 Z" />
      <path class="ship-cock" d="M63.4 70.5 L65 67.6 L66.6 70.5 Z" />
      <rect x="24" y="56" width="6" height="32" class="leaf" /><rect x="100" y="56" width="6" height="32" class="leaf r" />
      @for (y of leafRibs; track y) { <path [attr.d]="'M24 ' + y + 'H30M100 ' + y + 'H106'" class="rib" /> }
      <path d="M28 55 H102" class="lintel" />
      <!-- Bay marker: one lit strip with the hangar's number tiles. -->
      <rect x="54" y="46" width="22" height="4" rx="0.8" class="sign" />
      <rect x="56" y="47" width="4" height="2" class="sign-t" /><rect x="61" y="47" width="4" height="2" class="sign-t" /><rect x="66" y="47" width="8" height="2" class="sign-t dim" />
      <!-- Warm office windows on the lit flank. -->
      @for (y of [60, 68, 76]; track y) { <rect x="107.5" [attr.y]="y" width="4.5" height="2.2" class="win" /> }
      <!-- Apron: hazard stripes at the bay mouth and the approach lights into it. -->
      <rect x="30" y="88.4" width="70" height="2" fill="url(#hqb-stripe)" opacity="0.85" />
      @for (l of approach; track l.i) {
        <circle class="al" [attr.cx]="l.x" cy="94" r="1.1" [style.--i]="l.i" />
      }

      <!-- STORAGE: SCU containers under a gantry crane. -->
      <path d="M116 88 V40 M178 88 V40 M114 40 H180" class="gantry" />
      <path d="M116 46 L122 40 M178 46 L172 40" class="gantry thin" />
      <rect x="140" y="38" width="10" height="4" class="trolley" />
      <path d="M145 42 V47" class="cable" />
      <g class="crate-hang">
        <rect x="139" y="47" width="12" height="7" rx="0.6" fill="url(#hqb-crate)" />
        <path d="M139 50.5 H151" class="crate-band" />
      </g>
      @for (c of crates; track $index) {
        <g [attr.class]="'crate ' + c[4]">
          <rect [attr.x]="c[0]" [attr.y]="c[1]" [attr.width]="c[2]" [attr.height]="c[3]" rx="0.6" fill="url(#hqb-crate)" />
          <path [attr.d]="'M' + (c[0] + 0.8) + ' ' + (c[1] + c[3] / 2) + 'H' + (c[0] + c[2] - 0.8)" class="crate-band" />
          <path [attr.d]="'M' + (c[0] + c[2] - 1.2) + ' ' + (c[1] + 0.8) + 'V' + (c[1] + c[3] - 0.8)" class="crate-hi" />
        </g>
      }

      <!-- Comm mast: lattice, dish, beacon. -->
      <path d="M188 88 L186 46 M188 88 L190 46 M186.5 60 L189.6 66 M189.5 60 L186.4 66 M186.3 52 L189.8 58" class="mast" />
      <path d="M181 50 Q186 56 193 50" class="dish" /><path d="M187 53 L184 46" class="mast" />
      <circle class="beacon" cx="188" cy="44" r="1.6" />
      <circle class="strobe" cx="188" cy="44" r="4" />
    </svg>
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .hb { display: block; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0.1cqw 0.2cqw rgba(0, 4, 10, 0.7)); }
    .edge { stroke: color-mix(in srgb, var(--sc-accent) 55%, #fff); stroke-width: 0.6; opacity: 0.6; }
    .seam { stroke: rgba(10, 18, 24, 0.55); stroke-width: 0.5; fill: none; }
    .rl { fill: color-mix(in srgb, var(--sc-accent) 50%, #fff); }
    .bay-glow { fill: var(--sc-accent); opacity: 0.12; mix-blend-mode: screen;
      animation: hb-breathe 5s ease-in-out infinite; animation-play-state: var(--sc-brief-play, running); }
    .ship { fill: #0c151c; stroke: #3b5566; stroke-width: 0.4; }
    .ship-cock { fill: color-mix(in srgb, var(--sc-accent) 70%, #fff); opacity: 0.85; }
    .leaf { fill: #2b3a46; }
    .leaf.r { fill: #6e8494; }
    .rib { stroke: rgba(8, 14, 20, 0.6); stroke-width: 0.5; }
    .lintel { stroke: #c9d7df; stroke-width: 1.1; }
    .sign { fill: #0b1720; stroke: color-mix(in srgb, var(--sc-accent) 60%, transparent); stroke-width: 0.4; }
    .sign-t { fill: var(--sc-accent); }
    .sign-t.dim { opacity: 0.45; }
    .win { fill: #ffcf8a; opacity: 0.8; }
    .al { fill: color-mix(in srgb, var(--sc-accent) 40%, #fff); opacity: 0.25;
      animation: hb-chase 2.4s linear calc(var(--i) * 0.2s) infinite; animation-play-state: var(--sc-brief-play, running); }
    .gantry { stroke: #8296a5; stroke-width: 1.6; fill: none; stroke-linecap: square; }
    .gantry.thin { stroke-width: 0.8; }
    .trolley { fill: #a8bac6; }
    .cable { stroke: #9fb2bf; stroke-width: 0.5; }
    .crate-band { stroke: rgba(8, 14, 20, 0.55); stroke-width: 0.6; }
    .crate-hi { stroke: rgba(230, 240, 246, 0.45); stroke-width: 0.5; }
    .crate.a rect { filter: brightness(1.12); }
    .crate.c rect { filter: brightness(0.82); }
    .crate.b .crate-band { stroke: color-mix(in srgb, var(--sc-accent) 70%, transparent); stroke-width: 0.9; }
    .crate.hot .crate-band { stroke: #e8b04a; stroke-width: 1.1; }
    .mast { stroke: #9cb0bd; stroke-width: 0.7; fill: none; }
    .dish { stroke: #d5e2e9; stroke-width: 1.3; fill: none; stroke-linecap: round; }
    .beacon { fill: var(--sc-accent); animation: hb-blink 2s ease-in-out infinite; animation-play-state: var(--sc-brief-play, running); }
    .strobe { fill: color-mix(in srgb, var(--sc-accent) 50%, #fff); opacity: 0; filter: blur(1.2px);
      animation: hb-strobe 3s linear infinite; animation-play-state: var(--sc-brief-play, running); }
    @keyframes hb-breathe { 0%, 100% { opacity: 0.08; } 50% { opacity: 0.22; } }
    @keyframes hb-chase { 0%, 70%, 100% { opacity: 0.25; } 10% { opacity: 1; } }
    @keyframes hb-blink { 0%, 60%, 100% { opacity: 0.35; } 75% { opacity: 1; } }
    @keyframes hb-strobe { 0%, 92%, 100% { opacity: 0; } 94% { opacity: 0.9; } }
    @media (prefers-reduced-motion: reduce) {
      .bay-glow, .al, .beacon, .strobe { animation: none; }
      .al { opacity: 0.7; }
      .beacon { opacity: 0.9; }
    }
  `,
})
export class BriefingHqBaseComponent {
  readonly roofLights = [40, 50, 60, 70, 80, 90];
  readonly leafRibs = [62, 68, 74, 80];
  /** Approach lights from the apron's front edge into the bay, chased in that order. */
  readonly approach = [10, 22, 34, 46, 58, 70, 82, 94, 106].map((x, i) => ({ x, i }));
  readonly crates = CRATES;
}
