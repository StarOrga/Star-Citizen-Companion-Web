import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { HangarPickerComponent, HangarPickerItem } from './hangar-picker.component';
import { DEFAULT_FIELD, fallbackGeometry, sampleStage, spotGeometry } from '../stage-sample';
import { StageArt } from '../upcoming-ships.service';

/** Everything `.stage-img` and its mask need, whichever of the two source geometries produced it. */
interface UiGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
  cx: number;
  cy: number;
  field: string;
  fallback: boolean;
}

function centeredFallback(stageW: number, stageH: number, imgW: number, imgH: number): UiGeometry {
  const g = fallbackGeometry(stageW, stageH, imgW, imgH);
  return { ...g, rx: 0, ry: 0, cx: 50, cy: 50, field: DEFAULT_FIELD, fallback: true };
}

/**
 * The Codex "Spot" stage (concept 2026-09-20, rounds 14–17) — ship and
 * person share this one component. The RSI render (or, for `person`, the
 * projected figure) is bbox-fitted and masked so the source's own nebula
 * frames it; there is no scrim, no ghost, no second copy. Sampling
 * (`../stage-sample.ts`) runs once per image, in the browser, after
 * `decode()`.
 *
 * `kind="ship"`: an `<img crossorigin>` is the subject; the whole picture is
 * the anchor to the ship page (Q1) — everything visually on top of it
 * (picker, archive line) is a real sibling element with a higher stacking
 * order, never nested inside the anchor.
 * `kind="person"`: a shared field + amber key light + halo stand in for the
 * photograph; the actual figure is projected in via `stageFigure` (reuses
 * `sc-codex-board-figure`) so this component never has to know about suits.
 */
@Component({
  selector: 'sc-codex-stage',
  standalone: true,
  imports: [RouterLink, TranslateModule, HangarPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="stage"
      [class.person]="kind() === 'person'"
      [class.fallback]="geometry().fallback"
      [style.--field]="geometry().field"
      [style.--sx]="geometry().left + 'px'"
      [style.--sy]="geometry().top + 'px'"
      [style.--sw]="geometry().width + 'px'"
      [style.--sh]="geometry().height + 'px'"
      [style.--rx]="geometry().rx + 'px'"
      [style.--ry]="geometry().ry + 'px'"
      [style.--cx]="geometry().cx + '%'"
      [style.--cy]="geometry().cy + '%'"
    >
      @if (kind() === 'ship') {
        @if (activeSrc(); as src) {
          <img
            #img
            class="stage-img"
            [class.loaded]="loaded()"
            [src]="src"
            alt=""
            crossorigin="anonymous"
            (load)="onImageLoad()"
            (error)="onImageError()"
          />
        }
        @if (title()) {
          @if (routerLinkTo(); as link) {
            <a class="stage-hit" [routerLink]="link">
              <span class="stage-eyebrow">
                {{ eyebrow() }}
                @if (eyebrowSuffix()) {
                  <span class="stage-eyebrow__suffix">{{ eyebrowSuffix() }}</span>
                }
              </span>
              <span class="stage-title">{{ title() }}</span>
            </a>
          } @else {
            <div class="stage-hit static">
              <span class="stage-eyebrow">
                {{ eyebrow() }}
                @if (eyebrowSuffix()) {
                  <span class="stage-eyebrow__suffix">{{ eyebrowSuffix() }}</span>
                }
              </span>
              <span class="stage-title">{{ title() }}</span>
            </div>
          }
        }
      } @else {
        <span class="stage-key" aria-hidden="true"></span>
        <span class="stage-halo" aria-hidden="true"></span>
        <span class="stage-figure">
          <ng-content select="[stageFigure]" />
        </span>
        @if (routerLinkTo(); as link) {
          <!-- The set page is where the person is configured (T1); the whole text block is the anchor. -->
          <a class="stage-text stage-text--link" [routerLink]="link">
            <span class="stage-eyebrow amber">
              {{ eyebrow() }}
              @if (eyebrowSuffix()) {
                <span class="stage-eyebrow__suffix">{{ eyebrowSuffix() }}</span>
              }
            </span>
            <span class="stage-title">{{ title() }}</span>
          </a>
        } @else {
          <div class="stage-text">
            <span class="stage-eyebrow amber">
              {{ eyebrow() }}
              @if (eyebrowSuffix()) {
                <span class="stage-eyebrow__suffix">{{ eyebrowSuffix() }}</span>
              }
            </span>
            <span class="stage-title">{{ title() }}</span>
          </div>
        }
      }

      <span class="stage-seam" aria-hidden="true"></span>

      <sc-hangar-picker
        class="stage-picker"
        [kind]="pickerKind()"
        [items]="pickerItems()"
        (pick)="pick.emit($event)"
        (open)="open.emit()"
      />

      <div class="stage-archive">
        <ng-content select="[stageArchive]" />
      </div>
    </article>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      .stage {
        position: relative;
        overflow: hidden;
        height: 100%;
        background: var(--field, #071520);
      }
      .stage-img {
        position: absolute;
        left: var(--sx, 0);
        top: var(--sy, 0);
        width: var(--sw, 100%);
        height: var(--sh, 100%);
        opacity: 0;
        transition: opacity .24s ease;
        -webkit-mask-image: radial-gradient(ellipse var(--rx, 50%) var(--ry, 50%) at var(--cx, 50%) var(--cy, 50%), #000 55%, transparent 100%);
        mask-image: radial-gradient(ellipse var(--rx, 50%) var(--ry, 50%) at var(--cx, 50%) var(--cy, 50%), #000 55%, transparent 100%);
      }
      .stage-img.loaded { opacity: 1; }
      .stage.fallback .stage-img {
        left: 0; top: 0; width: 100%; height: 100%;
        object-fit: contain; object-position: center;
        -webkit-mask-image: none; mask-image: none;
      }

      .stage-hit { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; justify-content: flex-end; align-items: flex-start; gap: 2px; padding: 0 24px 44px; text-decoration: none; }
      .stage-hit:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }

      .stage-eyebrow {
        display: block;
        font-family: var(--font-display, 'Orbitron', sans-serif);
        font-size: 10px;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--sc-accent) 78%, var(--sc-fg-0));
        text-shadow: 0 1px 2px rgba(0, 0, 0, .6), 0 0 14px rgba(0, 0, 0, .4);
      }
      .stage-eyebrow.amber { color: var(--amber, #f0c27b); }
      .stage-eyebrow__suffix { color: rgba(242, 247, 251, .72); }
      .stage-title {
        display: block;
        font-size: 24px;
        font-weight: 700;
        line-height: 1.15;
        color: var(--sc-fg-0);
        text-shadow: 0 1px 2px rgba(0, 0, 0, .6), 0 0 14px rgba(0, 0, 0, .4);
      }
      .stage-hit:hover .stage-title, .stage-hit:focus-visible .stage-title { color: var(--sc-accent); }

      /* ── person ────────────────────────────────────────────────────── */
      .stage-key {
        position: absolute; inset: 0;
        background: linear-gradient(155deg, color-mix(in srgb, var(--amber, #f0c27b) 14%, var(--field)) 0%, var(--field) 55%);
      }
      .stage-halo {
        position: absolute; inset: 0;
        background: radial-gradient(ellipse 170px 248px at 62% 50%, color-mix(in srgb, var(--amber, #f0c27b) 20%, var(--field)) 0 55%, var(--field) 100%);
      }
      .stage-figure {
        position: absolute;
        left: 62%;
        bottom: 8%;
        height: 68%;
        transform: translateX(-50%);
        display: flex;
        align-items: flex-end;
        z-index: 1;
      }
      /* Sizes the projected figure to the person stage's 68%-of-height rule
         (K5). Content projected via ng-content keeps ITS OWN component's
         style scope, not this one's — ::ng-deep is the documented escape
         hatch the codebase already uses for exactly this (codex-swap-picker). */
      .stage-figure ::ng-deep sc-codex-board-figure { display: block; height: 100%; width: auto; }
      .stage.person .stage-text--link { text-decoration: none; display: flex; flex-direction: column; gap: 2px; }
      .stage.person .stage-text--link:hover .stage-title, .stage.person .stage-text--link:focus-visible .stage-title { color: var(--sc-accent); }
      .stage.person .stage-text--link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 4px; }
      .stage.person .stage-text {
        position: absolute;
        left: 24px;
        bottom: 44px;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      /* ── seam between the two stages — 48px into rgba(3,10,16,.8), no line ── */
      .stage-seam {
        position: absolute; top: 0; bottom: 0; z-index: 3; pointer-events: none;
        right: 0; width: 48px; background: linear-gradient(to right, transparent, rgba(3, 10, 16, .8));
      }
      .stage.person .stage-seam {
        right: auto; left: 0;
        background: linear-gradient(to left, transparent, rgba(3, 10, 16, .8));
      }

      /* ── picker + archive line sit above everything, including the anchor ── */
      .stage-picker { position: relative; z-index: 4; }
      .stage-archive {
        position: absolute;
        left: 24px;
        right: 24px;
        bottom: 12px;
        z-index: 4;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        font-family: var(--font-display, 'Orbitron', sans-serif);
        font-size: 9px;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: rgba(242, 247, 251, .45);
      }
    `,
  ],
})
export class CodexStageComponent implements OnDestroy {
  readonly kind = input.required<'ship' | 'person'>();

  /** Ship only — `stageArtFor()`'s primary + onerror fallback chain. `null` while there is nothing to show. */
  readonly art = input<StageArt | null>(null);

  readonly eyebrow = input<string | null>(null);
  readonly eyebrowSuffix = input<string | null>(null);
  readonly title = input<string>('');
  /** Ship only: the routerLink the whole picture becomes an anchor to. `null` while there is nothing to show yet. */
  readonly routerLinkTo = input<readonly unknown[] | null>(null);

  readonly pickerKind = input<'ship' | 'set'>('ship');
  readonly pickerItems = input<readonly HangarPickerItem[]>([]);

  readonly pick = output<string>();
  readonly open = output<void>();

  private readonly imgEl = viewChild<ElementRef<HTMLImageElement>>('img');

  readonly loaded = signal(false);
  readonly geometry = signal<UiGeometry>(centeredFallback(0, 0, 1, 1));

  /** The full ordered chain — primary first — walked by `onImageError` on a miss. */
  private readonly chain = computed(() => {
    const a = this.art();
    return a ? [a.src, ...a.fallbacks] : [];
  });
  private readonly candidateIndex = signal(0);
  readonly activeSrc = computed<string | null>(() => this.chain()[this.candidateIndex()] ?? null);

  constructor() {
    // A new subject (picker switch) resets the sample and walks the fresh candidate list from the top.
    effect(() => {
      this.art();
      this.candidateIndex.set(0);
      this.loaded.set(false);
      this.geometry.set(centeredFallback(0, 0, 1, 1));
    });
  }

  /** Last successful sample — re-laid-out (not re-sampled) when the stage resizes. */
  private lastSample: ReturnType<typeof sampleStage> = null;
  private resizeObserver: ResizeObserver | null = null;

  /** Stage box = the image's positioned parent; 0×0 while the split is still laying out. */
  private stageSize(el: HTMLImageElement): { w: number; h: number } {
    const box = el.parentElement?.getBoundingClientRect();
    return { w: Math.round(box?.width ?? 0), h: Math.round(box?.height ?? 0) };
  }

  private layout(el: HTMLImageElement, stageW: number, stageH: number): void {
    const imgW = el.naturalWidth || 1;
    const imgH = el.naturalHeight || 1;
    const sample = this.lastSample;
    if (!sample) {
      this.geometry.set(centeredFallback(stageW, stageH, imgW, imgH));
      return;
    }
    const spot = spotGeometry(sample, stageW, stageH, imgW, imgH);
    this.geometry.set({ ...spot, field: sample.field, fallback: false });
  }

  onImageLoad(): void {
    const el = this.imgEl()?.nativeElement;
    if (!el) return;
    this.loaded.set(true);
    let attempts = 0;
    const run = () => {
      const { w: stageW, h: stageH } = this.stageSize(el);
      // The image can finish loading before the split grid has a size (route
      // transition, HMR remount): a 0×0 stage would freeze the geometry at 0.
      if ((stageW === 0 || stageH === 0) && attempts++ < 20) {
        requestAnimationFrame(run);
        return;
      }
      const decode = el.decode ? el.decode() : Promise.resolve();
      decode
        .then(() => {
          this.lastSample = sampleStage(el);
          this.layout(el, stageW, stageH);
          this.observeResize(el);
        })
        .catch(() => {
          this.lastSample = null;
          this.layout(el, stageW, stageH);
        });
    };
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (idle) idle(run);
    else setTimeout(run, 0);
  }

  /** Viewport changes only re-run the (pure) geometry — the sample stays. */
  private observeResize(el: HTMLImageElement): void {
    const host = el.parentElement;
    if (!host || this.resizeObserver || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      const { w, h } = this.stageSize(el);
      if (w > 0 && h > 0) this.layout(el, w, h);
    });
    this.resizeObserver.observe(host);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  onImageError(): void {
    const next = this.candidateIndex() + 1;
    if (next < this.chain().length) {
      this.candidateIndex.set(next);
    } else {
      this.geometry.set(centeredFallback(0, 0, 1, 1));
    }
  }
}
