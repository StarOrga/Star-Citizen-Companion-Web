import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type * as THREE from 'three';
import {
  FIGURE_ASPECT,
  SUIT_CAMERA,
  SUIT_PARTS,
  SuitPalette,
  buildHardsuit,
  fallbackAnchors,
  fallbackZones,
  paintPart,
  suitAnchors3d,
  suitZones,
} from './codex-board-suit';
import type { AnchorSide, FigurePoint, Hardsuit, PartZone, SuitPart } from './codex-board-suit';

/** Which side of each part a leader line lands on unless `anchorSide` says otherwise. */
export const DEFAULT_ANCHOR_SIDE: Record<SuitPart, AnchorSide> = {
  helmet: 'left',
  core: 'left',
  arms: 'left',
  backpack: 'right',
  undersuit: 'right',
  legs: 'right',
};

/** Fallbacks for the three custom properties the suit is painted from. */
const PALETTE_FALLBACK: SuitPalette = { idle: '#3d5a6c', tint: '#f0c27b', accent: '#52c1e6' };

/** `THREE.Color.set()` warns on anything it can't parse — only hand it colours. */
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

/**
 * The AN BORD figure — a real 3D hard-suit, rendered to a still image.
 *
 * The round of 2026-09-02 drew the suit as an SVG and faked its depth with
 * gradients; the answer to it was "vllt. doch mit einer 3d engine? aber nur 2d
 * Ansicht … es soll schnieke aussehen". So the suit is now modelled geometry
 * (`codex-board-suit.ts`) lit by a key light and an accent rim, and the "2D
 * view" is taken literally: a fixed orthographic camera, **no controls, no
 * animation loop** — one draw per state change and then nothing, which keeps
 * the zone's cost at zero while the page is just sitting there.
 *
 * `three` is loaded lazily and only after a WebGL probe passes, and the drawn
 * SVG stays in the DOM as the fallback: without WebGL (or with the chunk
 * blocked) the zone renders exactly what it rendered before. That is also why
 * the SVG is hidden with CSS rather than `@if` — the fallback must be there
 * before the engine is, not after.
 */
@Component({
  selector: 'sc-codex-board-figure',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas
      #stage
      class="board-stage"
      [class.on]="ready()"
      [attr.role]="decorative() ? null : 'img'"
      [attr.aria-hidden]="decorative() || !ready() ? 'true' : null"
      [attr.aria-label]="decorative() ? null : ('codex.landing.paperdoll.aria' | translate)"
    ></canvas>

    <svg class="board-doll" viewBox="0 0 120 184" [class.has-hl]="!!highlight()"
         [attr.role]="decorative() ? null : 'img'"
         [attr.aria-hidden]="decorative() ? 'true' : null"
         [attr.aria-label]="decorative() ? null : ('codex.landing.paperdoll.aria' | translate)">
      <defs>
        <!-- One light, upper left. Each plate gets its own bbox ramp,
             which is what makes a plated suit out of flat shapes.
             Two copies rather than currentColor: a gradient stop
             resolves currentColor against the <defs>, not against the
             part that references it, so the hue has to come from the
             inherited custom property instead. -->
        <linearGradient id="pd-plate" class="pd-idle" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stop-opacity="0.62" />
          <stop offset="55%" stop-opacity="0.26" />
          <stop offset="100%" stop-opacity="0.08" />
        </linearGradient>
        <linearGradient id="pd-plate-on" class="pd-tint" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stop-opacity="0.72" />
          <stop offset="55%" stop-opacity="0.32" />
          <stop offset="100%" stop-opacity="0.1" />
        </linearGradient>
        <linearGradient id="pd-plate-hl" class="pd-accent" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stop-opacity="0.8" />
          <stop offset="55%" stop-opacity="0.38" />
          <stop offset="100%" stop-opacity="0.12" />
        </linearGradient>
        <linearGradient id="pd-visor" class="pd-idle" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-opacity="0.72" />
          <stop offset="100%" stop-opacity="0.16" />
        </linearGradient>
        <linearGradient id="pd-visor-on" class="pd-tint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-opacity="0.85" />
          <stop offset="100%" stop-opacity="0.2" />
        </linearGradient>
        <linearGradient id="pd-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fff" stop-opacity="0" />
          <stop offset="50%" stop-color="#fff" stop-opacity="0.14" />
          <stop offset="100%" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
        <!-- The sweep must not leave the figure's box; the box
             itself stays overflow:visible for the equipped glow. -->
        <clipPath id="pd-clip"><rect x="0" y="0" width="120" height="184" /></clipPath>
      </defs>

      <!-- RUCKSACK — life-support tanks behind the shoulders plus the
           antenna; the torso covers their inner half, which is what
           puts them *behind* the figure. -->
      <g class="pd-part" data-part="backpack" [class.on]="slotFilled('backpack')" [class.hl]="highlight() === 'backpack'" [attr.fill]="plateFill('backpack')">
        <rect class="plate" x="44" y="30" width="11" height="26" rx="5" />
        <rect class="plate" x="65" y="30" width="11" height="26" rx="5" />
        <path class="seam" d="M48 38h3M48 44h3M69 38h3M69 44h3M44 33h-7v-19" />
        <circle class="seam-dot" cx="37" cy="12" r="2.2" />
      </g>

      <!-- UNTERSUIT — the soft layer the plates ride on: neck seal,
           waist and hips. It was invisible before; the position is
           equippable, so it gets a body part like the other five. -->
      <g class="pd-part" data-part="undersuit" [class.on]="slotFilled('undersuit')" [class.hl]="highlight() === 'undersuit'" [attr.fill]="plateFill('undersuit')">
        <path class="plate" d="M53 36h14v10c0 2-3 4-7 4s-7-2-7-4z" />
        <path class="plate" d="M47 100h26v9c0 3-2 5-5 5H52c-3 0-5-2-5-5z" />
        <path class="plate" d="M45 112h30v10c0 4-3 7-7 7H52c-4 0-7-3-7-7z" />
        <path class="seam" d="M60 102v10M50 118h20" />
      </g>

      <!-- BEINE — thigh, knee joint, shin, boot. -->
      <g class="pd-part" data-part="legs" [class.on]="slotFilled('legs')" [class.hl]="highlight() === 'legs'" [attr.fill]="plateFill('legs')">
        <rect class="plate" x="46" y="122" width="12" height="26" rx="4" />
        <rect class="plate" x="62" y="122" width="12" height="26" rx="4" />
        <circle class="joint" cx="52" cy="151" r="5" />
        <circle class="joint" cx="68" cy="151" r="5" />
        <rect class="plate" x="47" y="154" width="10" height="16" rx="3" />
        <rect class="plate" x="63" y="154" width="10" height="16" rx="3" />
        <path class="plate" d="M47 168h10v4l1 6H44z" />
        <path class="plate" d="M73 168H63v4l-1 6h14z" />
        <path class="seam" d="M52 126v18M68 126v18M48 151h8M64 151h8" />
        <path class="rim" d="M47 128v16M47 157v10" />
      </g>

      <!-- TORSO — chest plate, collar, ribs and two abdomen bands. -->
      <g class="pd-part" data-part="core" [class.on]="slotFilled('core')" [class.hl]="highlight() === 'core'" [attr.fill]="plateFill('core')">
        <path class="plate" d="M60 48c-8 0-15 2-20 6l-2 20 3 14h38l3-14-2-20c-5-4-12-6-20-6z" />
        <path class="plate" d="M45 90h30l-2 5H47z" />
        <path class="plate" d="M47 97h26l-2 5H49z" />
        <path class="seam" d="M60 58v28M44 70h9M67 70h9" />
        <path class="seam" d="M48 55c8-3 16-3 24 0" />
        <path class="rim" d="M41 56l-2 18" />
      </g>

      <!-- ARME — pauldron, upper arm, elbow joint, forearm, glove. -->
      <g class="pd-part" data-part="arms" [class.on]="slotFilled('arms')" [class.hl]="highlight() === 'arms'" [attr.fill]="plateFill('arms')">
        <path class="plate" d="M41 49l-9 3c-4 1-6 5-6 9v7l15 3z" />
        <path class="plate" d="M79 49l9 3c4 1 6 5 6 9v7l-15 3z" />
        <rect class="plate" x="28" y="70" width="12" height="24" rx="5" />
        <rect class="plate" x="80" y="70" width="12" height="24" rx="5" />
        <circle class="joint" cx="34" cy="96" r="4.5" />
        <circle class="joint" cx="86" cy="96" r="4.5" />
        <rect class="plate" x="29" y="99" width="10" height="22" rx="4" />
        <rect class="plate" x="81" y="99" width="10" height="22" rx="4" />
        <path class="plate" d="M29 121h10v6c0 3-2 5-5 5s-5-2-5-5z" />
        <path class="plate" d="M81 121h10v6c0 3-2 5-5 5s-5-2-5-5z" />
        <path class="seam" d="M34 73v18M34 102v16M86 73v18M86 102v16" />
        <path class="rim" d="M29 76v14M29 103v14M28 60l-1 8" />
      </g>

      <!-- HELM — shell, visor, crest and comms nubs. -->
      <g class="pd-part" data-part="helmet" [class.on]="slotFilled('helmet')" [class.hl]="highlight() === 'helmet'" [attr.fill]="plateFill('helmet')">
        <path class="plate" d="M60 6c-11 0-19 7-19 17v9c0 5 3 8 8 8h22c5 0 8-3 8-8v-9c0-10-8-17-19-17z" />
        <path class="visor" [attr.fill]="visorFill()" d="M45 22h30v8c0 4-3 6-7 6H52c-4 0-7-2-7-6z" />
        <path class="seam" d="M60 7v11M45 16h-4M75 16h4M52 36h16" />
        <path class="rim" d="M43 30v-7c0-8 6-14 13-15" />
        <path class="glint" d="M50 25l5 9" />
      </g>

      <!-- Holo sweep: the one motion in the zone, and only where
           motion is welcome (prefers-reduced-motion). -->
      <g clip-path="url(#pd-clip)">
        <rect class="pd-scan" x="24" y="-14" width="72" height="14" fill="url(#pd-scan)" />
      </g>
    </svg>

    <!-- Pointer targets for the set page: invisible, aligned with whatever
         is on screen (3D zones projected from the meshes through the render
         camera, or the drawn suit's own shapes), one group per part. Mouse
         and touch alike: a tap is a pointerenter too. The tiles carry the
         names and the keyboard path; this layer is pointer-only and hidden
         from assistive tech. -->
    @if (interactive()) {
      <svg class="board-zones" viewBox="0 0 120 184" preserveAspectRatio="none" aria-hidden="true">
        @for (zone of zones(); track zone.part) {
          <g class="zone" [attr.data-part]="zone.part"
             (pointerenter)="partHover.emit(zone.part)"
             (pointerleave)="partHover.emit(null)">
            @for (poly of zone.polygons; track $index) {
              <polygon [attr.points]="points(poly)" />
            }
          </g>
        }
      </svg>
    }
  `,
  styles: [
    `
      /* Width-driven on purpose: a host that only knows its HEIGHT (the
         collapsed rail's horizontal bar on a phone) gives its box the 120:184
         ratio and lets max-width clamp the figure into it, so the suit's own
         ratio never has to be restated anywhere else. */
      :host {
        display: block;
        position: relative;
        width: 108px;
        max-width: 100%;
      }
      /* Same box as the canvas / drawn suit: top-left, full width, 120:184. */
      .board-zones {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: auto;
        aspect-ratio: 120 / 184;
        pointer-events: none;
      }
      .board-zones polygon { fill: transparent; stroke: none; pointer-events: all; }
      /* The canvas keeps the drawn suit's box exactly, so switching between the
         two changes the picture and never the layout. */
      .board-stage {
        display: none;
        width: 100%;
        aspect-ratio: 120 / 184;
      }
      .board-stage.on { display: block; }
      /* The highlight is painted into the render itself (one redraw); only the
         drawn suit's step-back eases, and only where motion is welcome. */
      @media (prefers-reduced-motion: no-preference) {
        .pd-part { transition: opacity 160ms ease, filter 160ms ease; }
      }
      .board-stage.on ~ .board-doll { display: none; }

      .board-doll { width: 100%; height: auto; overflow: visible; }

      /* ── The figure ──────────────────────────────────────────────────
         Six flat black boxes before (feedback 2026-09-03: "einfach nur
         schwarz … sieht nicht cool aus"), now a plated hard-suit. The
         colour vocabulary is UNCHANGED — a part group carries the color property,
         every stroke below is currentColor, and the plate ramp picks the
         same two hues: --idle = open, --tint = equipped. Depth comes from
         the per-plate gradient plus a white rim on the lit edge; white is
         a specular highlight here, never a state.
         Deliberately empty-state-first: with nothing equipped the suit is
         still fully drawn in --idle, which is the whole point of the
         seams and rims — an unequipped figure reads as a body, not a
         silhouette. */
      .pd-idle stop { stop-color: var(--idle, var(--sc-idle)); }
      .pd-tint stop { stop-color: var(--tint, var(--sc-warning)); }
      /* The open figure is LIT, not greyed out — the whole complaint was a
         figure that vanished into the panel when nothing is equipped. Same
         --idle hue, lifted with white so the suit is legible on its own. */
      .pd-part { color: color-mix(in srgb, var(--idle, var(--sc-idle)) 62%, var(--sc-fg-0)); }
      .pd-part.on {
        color: color-mix(in srgb, var(--tint, var(--sc-warning)) 88%, #fff);
        filter: drop-shadow(0 0 6px color-mix(in srgb, var(--tint, var(--sc-warning)) 32%, transparent));
      }
      .board-doll .plate, .board-doll .joint, .board-doll .visor {
        stroke: currentColor;
        stroke-width: 1.25;
        stroke-opacity: 0.88;
        stroke-linejoin: round;
      }
      .pd-part.on .plate, .pd-part.on .joint, .pd-part.on .visor {
        stroke-width: 1.7;
        stroke-opacity: 1;
      }
      /* Panel lines — the "mit einem strich angezeichnet" pass: sternum,
         ribs, limb ridges, joint bands, tank vents. */
      .board-doll .seam {
        fill: none;
        stroke: currentColor;
        stroke-width: 0.9;
        stroke-opacity: 0.55;
        stroke-linecap: round;
      }
      .board-doll .seam-dot { fill: currentColor; fill-opacity: 0.7; stroke: none; }
      .board-doll .rim, .board-doll .glint {
        fill: none;
        stroke: #fff;
        stroke-opacity: 0.2;
        stroke-width: 1.1;
        stroke-linecap: round;
      }
      .pd-part.on .rim, .pd-part.on .glint { stroke-opacity: 0.38; }
      /* Highlight in the drawn suit: the part in the accent, the rest steps back. */
      .pd-accent stop { stop-color: var(--sc-accent); }
      .pd-part.hl {
        color: color-mix(in srgb, var(--sc-accent) 85%, #fff);
        filter: drop-shadow(0 0 6px color-mix(in srgb, var(--sc-accent) 45%, transparent));
      }
      .board-doll.has-hl .pd-part:not(.hl) { opacity: 0.38; }
      /* Holo sweep: hidden unless motion is welcome, so the resting state
         of the zone is always a still image. */
      .pd-scan { display: none; pointer-events: none; }
      @media (prefers-reduced-motion: no-preference) {
        .pd-scan { display: block; animation: pd-sweep 9s linear infinite; }
      }
      @keyframes pd-sweep {
        from { transform: translateY(0); }
        to { transform: translateY(198px); }
      }
    `,
  ],
})
export class CodexBoardFigureComponent {
  /** Which of the six positions are equipped — the only state the suit carries. */
  readonly filled = input.required<ReadonlySet<string>>();
  /**
   * Text-free mode: the suit is pure decoration inside a control that already
   * names itself (the collapsed AN BORD rail). It drops `role="img"` and its
   * label rather than announcing a second name inside that button — the figure
   * is then what it looks like, a picture of the set, and nothing else.
   */
  readonly decorative = input(false);
  /**
   * The one part to light up (set page: hovered / focused tile). It renders in
   * `--sc-accent` and every other part steps back; `null` = normal figure.
   * One redraw per change, still no animation loop.
   */
  readonly highlight = input<string | null>(null);
  /** Render invisible per-part hit zones and emit {@link partHover}. */
  readonly interactive = input(false);
  /** Per-part override of which side's anchor {@link partAnchors} reports. */
  readonly anchorSide = input<Partial<Record<SuitPart, AnchorSide>>>({});
  /** The part under the pointer (enter) or `null` (leave). Only when `interactive`. */
  readonly partHover = output<string | null>();

  /** Width / height of the rendered figure box (the canvas client box). */
  private readonly aspect = signal(FIGURE_ASPECT);
  /** 3D hit zones, set once the engine has built and sized the suit. */
  private readonly zones3d = signal<PartZone[] | null>(null);

  /**
   * Leader-line end points for BOTH sides of every part, in fractions (0..1) of
   * the figure box (top-left origin, y down; see codex-board-suit.ts
   * "COORDINATE SYSTEM"). Projected through the render camera once the 3D suit
   * is on screen, taken from the drawn shapes while the fallback is.
   */
  readonly partAnchorsBySide = computed<Record<SuitPart, Record<AnchorSide, FigurePoint>>>(() =>
    this.ready() ? suitAnchors3d(this.aspect()) : fallbackAnchors(),
  );
  /** One anchor per part: the side from `anchorSide`, else DEFAULT_ANCHOR_SIDE. */
  readonly partAnchors = computed<Record<SuitPart, FigurePoint>>(() => {
    const both = this.partAnchorsBySide();
    const sides = this.anchorSide();
    const out = {} as Record<SuitPart, FigurePoint>;
    for (const part of SUIT_PARTS) out[part] = both[part][sides[part] ?? DEFAULT_ANCHOR_SIDE[part]];
    return out;
  });
  /** What the hit-zone layer draws: the 3D zones when the 3D suit is the picture. */
  readonly zones = computed<PartZone[]>(() => (this.ready() && this.zones3d()) || fallbackZones());

  private readonly stage = viewChild.required<ElementRef<HTMLCanvasElement>>('stage');
  private readonly destroyRef = inject(DestroyRef);

  /** True once a frame has actually been drawn; until then the SVG is the figure. */
  readonly ready = signal(false);

  private three: typeof THREE | null = null;
  private suit: Hardsuit | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.OrthographicCamera | null = null;
  private palette: SuitPalette = PALETTE_FALLBACK;
  private observer: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => void this.boot());

    // Repaints on every equip change, and once more when the engine arrives —
    // `ready` is read here so the first paint can't be missed by ordering.
    effect(() => {
      const filled = this.filled();
      const lit = this.highlight();
      if (!this.ready() || !this.three || !this.suit) return;
      for (const part of SUIT_PARTS) {
        const emphasis = !lit ? 'normal' : lit === part ? 'lit' : 'dim';
        paintPart(this.three, this.suit.armour[part], this.palette, filled.has(part), emphasis);
      }
      this.suit.glass.emissive
        .set(this.palette.accent)
        .multiplyScalar(filled.has('helmet') ? 0.5 : 0.2);
      this.draw();
    });

    this.destroyRef.onDestroy(() => this.teardown());
  }

  /** Whether one position is equipped — the SVG fallback's only question. */
  slotFilled(roleSlot: string): boolean {
    return this.filled().has(roleSlot);
  }

  /**
   * Which plate ramp one position's parts are filled with. A gradient stop
   * resolves `currentColor` against the `<defs>` it lives in, not against the
   * element referencing it, so the equipped/open hue cannot ride on the group's
   * `color` the way every stroke does — it has to pick one of two gradients.
   */
  plateFill(roleSlot: string): string {
    if (this.highlight() === roleSlot) return 'url(#pd-plate-hl)';
    return this.slotFilled(roleSlot) ? 'url(#pd-plate-on)' : 'url(#pd-plate)';
  }

  /** SVG `points` for one zone polygon, in the overlay's 120 x 184 viewBox. */
  points(poly: readonly FigurePoint[]): string {
    return poly.map((p) => `${(p.x * 120).toFixed(2)},${(p.y * 184).toFixed(2)}`).join(' ');
  }

  /** Same two-gradient trick for the visor glass. */
  visorFill(): string {
    return this.slotFilled('helmet') ? 'url(#pd-visor-on)' : 'url(#pd-visor)';
  }

  private async boot(): Promise<void> {
    const canvas = this.stage().nativeElement;
    if (!hasWebgl()) return;
    try {
      const T = await import('three');
      this.three = T;
      this.palette = readPalette(canvas);

      const renderer = new T.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
      renderer.setClearAlpha(0);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      this.renderer = renderer;

      const scene = new T.Scene();
      // One key from the upper left, one accent rim from behind right, and a
      // cool hemisphere so the unlit side never goes black — the exact
      // complaint the drawn version was built to answer.
      scene.add(new T.HemisphereLight(0x9fd8ff, 0x08131b, 0.95));
      const key = new T.DirectionalLight(0xfff2dd, 2.3);
      key.position.set(-1.9, 2.8, 3.6);
      scene.add(key);
      const rim = new T.DirectionalLight(safeColor(this.palette.accent, PALETTE_FALLBACK.accent), 1.5);
      rim.position.set(2.8, 1, -2.2);
      scene.add(rim);
      const fill = new T.DirectionalLight(0x6f9bb5, 0.5);
      fill.position.set(1.8, -0.8, 1.6);
      scene.add(fill);

      const suit = buildHardsuit(T, this.palette);
      scene.add(suit.root);
      this.suit = suit;
      this.scene = scene;

      // Slightly off-axis: enough for the pauldrons and the pack to show their
      // depth, not so much that the suit stops reading as a front view.
      // SUIT_CAMERA is also what projectSuitPoint() uses for anchors and zones.
      const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
      camera.position.set(...SUIT_CAMERA.position);
      camera.lookAt(...SUIT_CAMERA.target);
      this.camera = camera;

      this.resize();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);

      // Flipping this last runs the paint effect, which draws the first frame.
      this.ready.set(true);
    } catch {
      // No engine, no problem: the drawn suit is still on screen.
      this.teardown();
    }
  }

  /** Fits the frustum to the canvas box; the suit is always 2.05 units tall. */
  private resize(): void {
    const canvas = this.stage().nativeElement;
    const w = canvas.clientWidth || 108;
    const h = canvas.clientHeight || Math.round((108 * 184) / 120);
    const camera = this.camera;
    if (!camera || !this.renderer) return;
    const halfH = SUIT_CAMERA.halfHeight;
    const halfW = halfH * (w / h);
    this.aspect.set(w / h);
    if (this.three && this.suit) this.zones3d.set(suitZones(this.three, this.suit, w / h));
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.ready()) this.draw();
  }

  private draw(): void {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private teardown(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.suit?.dispose();
    this.suit = null;
    // dispose() frees three's resources but keeps the GL context alive until GC;
    // a page that mounts figures repeatedly (set ⇄ arsenal) runs into the browser's
    // context limit ("Context Lost") unless the context is handed back right away.
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.zones3d.set(null);
    this.ready.set(false);
  }
}

/** WebGL support does not change within a page — probe once, not per figure. */
let webglSupport: boolean | null = null;

/**
 * A context probe, not a feature test — cheap enough to run before the import.
 * The probe's own context is released at once: every figure used to leave one
 * behind, and enough of them push the page into the browser's context limit.
 */
function hasWebgl(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const probe = document.createElement('canvas');
    const gl = (probe.getContext('webgl2') ?? probe.getContext('webgl')) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    webglSupport = !!gl;
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

function safeColor(value: string, fallback: string): string {
  return COLOR_RE.test(value) ? value : fallback;
}

/**
 * The zone's own custom properties, resolved off the canvas: `--idle` from the
 * AN BORD panel's host, `--tint` from the page around it (the set page's
 * `.board-wrap`), so the 3D suit keeps exactly the palette of everything next
 * to it — including a future theme swap. Outside those (the Spot stage) the
 * fallbacks apply.
 */
function readPalette(el: HTMLElement): SuitPalette {
  const cs = getComputedStyle(el);
  const read = (name: string, fallback: string): string =>
    safeColor(cs.getPropertyValue(name).trim(), fallback);
  return {
    idle: read('--idle', PALETTE_FALLBACK.idle),
    tint: read('--tint', PALETTE_FALLBACK.tint),
    accent: read('--sc-accent', PALETTE_FALLBACK.accent),
  };
}
