import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ShipSkin, ShipSkinsService } from './ship-skins.service';

// Side-effect import registers the <model-viewer> custom element. Because this
// component is lazy-loaded inside the ship detail route, model-viewer (~1 MB)
// only enters the bundle chunk for that route — never the initial bundle.
import '@google/model-viewer';

type ViewMode = '3d' | 'paint';

/**
 * Per-ship skin selector with a lazy-loaded 3D <model-viewer>.
 *
 * Selecting a livery loads that skin's web-glb (real hull + real textures from
 * the P4K, ~3 MB) on demand. Skins without a 3D model still appear with their
 * official store-icon (the faithful CIG render) — the view falls back to the
 * paint render. Hidden entirely when a ship has no skins.
 */
@Component({
  selector: 'sc-ship-skin-viewer',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (skins().length) {
      <section class="skins">
        <header class="skins-head">
          <button
            type="button"
            class="head-toggle"
            [attr.aria-expanded]="expanded()"
            [attr.aria-label]="(expanded() ? 'codex.skins.collapse' : 'codex.skins.expand') | translate"
            (click)="toggleExpanded()"
          >
            <span class="caret" [class.open]="expanded()" aria-hidden="true">▸</span>
            <span class="ttl">{{ 'codex.skins.title' | translate }}</span>
          </button>
          <span class="src">{{ 'codex.skins.source' | translate }}</span>
        </header>
        @if (expanded()) {
        <div class="skins-body">
          <div class="stage">
            <div class="modes">
              <button
                type="button"
                [class.on]="mode() === '3d'"
                [disabled]="!current()?.modelPath"
                (click)="setMode('3d')"
              >
                {{ 'codex.skins.mode3d' | translate }}
              </button>
              <button type="button" [class.on]="mode() === 'paint'" (click)="setMode('paint')">
                {{ 'codex.skins.modePaint' | translate }}
              </button>
            </div>

            @if (mode() === '3d' && modelUrl() && !modelError()) {
              <!-- keyed by skinId: Angular destroys + recreates the element on
                   skin change, so a previous skin's late (load)/(error) event
                   can never mutate the new skin's loading/error state. -->
              @for (sid of [current()?.skinId]; track sid) {
                <model-viewer
                  [attr.src]="modelUrl()"
                  camera-controls
                  auto-rotate
                  shadow-intensity="1"
                  exposure="1.0"
                  environment-image="neutral"
                  camera-orbit="35deg 75deg 105%"
                  interaction-prompt="none"
                  (load)="onModelLoad()"
                  (error)="onModelError()"
                ></model-viewer>
              }
              @if (modelLoading()) {
                <div class="overlay" role="status">
                  <span class="spinner" aria-hidden="true"></span>
                  {{ 'codex.skins.loading' | translate }}
                </div>
              }
            } @else if (mode() === '3d' && modelError()) {
              <div class="empty error">{{ 'codex.skins.loadError' | translate }}</div>
            } @else if (iconUrl()) {
              <img class="paint-render" [src]="iconUrl()" [alt]="current()?.name || ''" />
            } @else {
              <div class="empty">{{ 'codex.skins.no3d' | translate }}</div>
            }

            @if (current(); as c) {
              <div class="badge">
                <strong>{{ c.name }}</strong>
                @if (c.description) {
                  <p>{{ c.description }}</p>
                }
                <span class="meta">
                  {{ c.source }}
                  @if (c.nameVerified) {
                    · ✓ {{ 'codex.skins.verified' | translate }}
                  }
                </span>
              </div>
            }
          </div>

          <ul class="list" role="listbox" [attr.aria-label]="'codex.skins.title' | translate">
            @for (s of skins(); track s.skinId) {
              <li
                role="option"
                tabindex="0"
                [attr.aria-selected]="s.skinId === current()?.skinId"
                [class.on]="s.skinId === current()?.skinId"
                [class.no3d]="!s.modelPath"
                (click)="select(s)"
                (keydown)="onKey($event, s)"
              >
                @if (iconFor(s); as ic) {
                  <img [src]="ic" [alt]="s.name" loading="lazy" />
                } @else {
                  <span class="noicon"></span>
                }
                <div class="meta">
                  <span class="nm">{{ s.name }}</span>
                  <span class="tags">
                    @if (s.nameVerified) {
                      <span class="tag v">{{ 'codex.skins.verified' | translate }}</span>
                    }
                    <span class="tag s">{{ s.source }}</span>
                  </span>
                </div>
              </li>
            }
          </ul>
        </div>
        }
      </section>
    } @else if (catalogError()) {
      <section class="skins">
        <header class="skins-head">
          <h3>{{ 'codex.skins.title' | translate }}</h3>
        </header>
        <div class="catalog-error">
          <span>{{ 'codex.skins.loadCatalogError' | translate }}</span>
          <button type="button" (click)="retry()">{{ 'codex.skins.retry' | translate }}</button>
        </div>
      </section>
    }
  `,
  styles: [
    `
      .skins {
        border: 1px solid var(--border, #23262d);
        border-radius: 12px;
        overflow: hidden;
        background: var(--surface, #15171c);
      }
      .skins-head {
        display: flex;
        align-items: baseline;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--border, #23262d);
      }
      .head-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0;
        padding: 0;
        background: none;
        border: 0;
        cursor: pointer;
        font: inherit;
        color: var(--accent, #f0c420);
      }
      .head-toggle .ttl {
        font-size: 1rem;
        font-weight: 600;
      }
      .head-toggle .caret {
        display: inline-block;
        color: var(--muted, #8a92a0);
        transition: transform 0.15s ease;
      }
      .head-toggle .caret.open {
        transform: rotate(90deg);
      }
      .head-toggle:focus-visible {
        outline: 2px solid var(--accent, #f0c420);
        outline-offset: 2px;
        border-radius: 4px;
      }
      @media (prefers-reduced-motion: reduce) {
        .head-toggle .caret {
          transition: none;
        }
      }
      .skins-head .src {
        font-size: 0.72rem;
        color: var(--muted, #8a92a0);
      }
      .skins-body {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
      }
      @media (max-width: 720px) {
        .skins-body {
          grid-template-columns: 1fr;
        }
      }
      .stage {
        position: relative;
        min-height: 320px;
        background: radial-gradient(circle at 50% 38%, #1c2029, #0c0d10);
      }
      model-viewer,
      .paint-render {
        width: 100%;
        height: 100%;
        min-height: 320px;
        display: block;
      }
      .paint-render {
        object-fit: contain;
        padding: 1rem;
      }
      .empty {
        display: grid;
        place-items: center;
        min-height: 320px;
        color: var(--muted, #8a92a0);
        text-align: center;
        padding: 1rem;
      }
      .empty.error {
        color: #e88;
      }
      .catalog-error {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding: 0.9rem 1rem;
        color: var(--muted, #8a92a0);
        font-size: 0.85rem;
      }
      .catalog-error button {
        background: var(--panel, #1c2330);
        color: #cdd;
        border: 1px solid var(--border, #23262d);
        border-radius: 7px;
        padding: 0.3rem 0.8rem;
        cursor: pointer;
        font: inherit;
      }
      .catalog-error button:hover {
        border-color: var(--accent, #f0c420);
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        gap: 0.6rem;
        grid-auto-flow: row;
        color: var(--muted, #8a92a0);
        background: #0c0d10aa;
        pointer-events: none;
      }
      .spinner {
        width: 26px;
        height: 26px;
        border: 3px solid #ffffff22;
        border-top-color: var(--accent, #f0c420);
        border-radius: 50%;
        animation: sc-spin 0.8s linear infinite;
      }
      @keyframes sc-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: none;
        }
      }
      .modes {
        position: absolute;
        right: 0.75rem;
        top: 0.6rem;
        z-index: 3;
        display: inline-flex;
        border: 1px solid var(--border, #23262d);
        border-radius: 8px;
        overflow: hidden;
      }
      .modes button {
        background: #15171cdd;
        color: #cdd;
        border: 0;
        padding: 0.35rem 0.7rem;
        cursor: pointer;
        font: inherit;
      }
      .modes button.on {
        background: var(--accent, #f0c420);
        color: #111;
        font-weight: 600;
      }
      .modes button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .badge {
        position: absolute;
        left: 0.9rem;
        top: 0.8rem;
        max-width: 70%;
        background: #000a;
        border: 1px solid var(--border, #23262d);
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
      }
      .badge strong {
        color: var(--accent, #f0c420);
      }
      .badge p {
        margin: 0.2rem 0 0;
        font-size: 0.78rem;
        color: #cdd3db;
      }
      .badge .meta {
        font-size: 0.7rem;
        color: var(--muted, #8a92a0);
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0.6rem;
        overflow: auto;
        max-height: 420px;
        border-left: 1px solid var(--border, #23262d);
      }
      .list li {
        display: flex;
        gap: 0.7rem;
        align-items: center;
        padding: 0.45rem;
        border: 1px solid var(--border, #23262d);
        border-radius: 9px;
        margin-bottom: 0.45rem;
        cursor: pointer;
      }
      .list li.on {
        border-color: var(--accent, #f0c420);
        box-shadow: inset 0 0 0 1px var(--accent, #f0c420);
      }
      .list li:hover {
        border-color: #3a4150;
      }
      .list li:focus-visible {
        outline: 2px solid var(--accent, #f0c420);
        outline-offset: 1px;
      }
      .list li.no3d {
        opacity: 0.7;
      }
      .list img,
      .list .noicon {
        width: 54px;
        height: 54px;
        flex: 0 0 auto;
        border-radius: 7px;
        border: 1px solid var(--border, #23262d);
        object-fit: cover;
        background: #000;
      }
      .list .nm {
        font-size: 0.82rem;
        font-weight: 600;
      }
      .list .tags {
        display: block;
        margin-top: 0.15rem;
      }
      .tag {
        font-size: 0.62rem;
        padding: 0.05rem 0.4rem;
        border-radius: 5px;
        margin-right: 0.3rem;
      }
      .tag.v {
        background: #173a25;
        color: #6ad28a;
      }
      .tag.s {
        background: #1c2330;
        color: #8fb0e0;
      }
    `,
  ],
})
export class ShipSkinViewerComponent {
  readonly shipId = input.required<string>();

  // Persist the collapsed/expanded state of the whole viewer (#137 part 2).
  // Default when the user never toggled it: expanded on desktop, collapsed on
  // mobile (the 3D stage eats a lot of vertical space on phones). The stored
  // choice then wins on every ship/page. While collapsed the body is removed
  // from the DOM, so the ~3 MB model-viewer glb is never downloaded until the
  // user opens it.
  private static readonly OPEN_KEY = 'sc.skinViewer.open';
  readonly expanded = signal<boolean>(this.initialExpanded());

  private readonly service = inject(ShipSkinsService);
  readonly skins = signal<ShipSkin[]>([]);
  readonly current = signal<ShipSkin | null>(null);
  readonly mode = signal<ViewMode>('3d');
  readonly loading = signal(false); // loading the skin catalog for a ship
  readonly catalogError = signal(false); // the skin catalog query failed (vs. empty)
  readonly modelLoading = signal(false); // the current skin's glb is downloading
  readonly modelError = signal(false); // the current skin's glb failed to load

  readonly modelUrl = computed(() => this.service.assetUrl(this.current()?.modelPath));
  readonly iconUrl = computed(() => this.service.assetUrl(this.current()?.iconPath));

  // Monotonic request token: guards against a slow listSkins() for a previous
  // ship resolving after the user has already navigated to another ship.
  private reqSeq = 0;

  constructor() {
    // React to shipId changes (router navigation between ships reuses this
    // component, so the input value changes without a new constructor call).
    effect(() => this.load(this.shipId()));
  }

  private load(id: string): void {
    const seq = ++this.reqSeq;
    this.skins.set([]);
    this.current.set(null);
    this.modelError.set(false);
    this.catalogError.set(false);
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    void this.service.listSkins(id).then((res) => {
      if (seq !== this.reqSeq) return; // stale response — a newer ship won
      this.loading.set(false);
      this.catalogError.set(res.error);
      this.skins.set(res.skins);
      const first = res.skins.find((s) => s.modelPath) ?? res.skins[0] ?? null;
      this.applySelection(first);
    });
  }

  /** Re-fetch the skin catalog after a transient load failure. */
  retry(): void {
    this.load(this.shipId());
  }

  /** Initial expanded state: stored preference wins, else viewport default. */
  private initialExpanded(): boolean {
    try {
      const saved =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(ShipSkinViewerComponent.OPEN_KEY)
          : null;
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch {
      // localStorage unavailable (private mode / SSR) — fall through to default.
    }
    // No stored choice → expanded on desktop, collapsed on mobile (≤720px,
    // matching the layout breakpoint below).
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return !window.matchMedia('(max-width: 720px)').matches;
    }
    return true;
  }

  /** Toggle the viewer open/closed and remember the choice. */
  toggleExpanded(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ShipSkinViewerComponent.OPEN_KEY, next ? '1' : '0');
      }
    } catch {
      // best-effort persistence — ignore write failures
    }
  }

  iconFor(s: ShipSkin): string | null {
    return this.service.assetUrl(s.iconPath);
  }

  select(s: ShipSkin): void {
    if (s.skinId === this.current()?.skinId) return;
    this.applySelection(s);
  }

  /** Keyboard activation for the skin list items (a11y). */
  onKey(event: KeyboardEvent, s: ShipSkin): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select(s);
    }
  }

  setMode(m: ViewMode): void {
    if (m === '3d' && !this.current()?.modelPath) return;
    this.mode.set(m);
  }

  // model-viewer lifecycle → drives the loading/error overlays.
  onModelLoad(): void {
    this.modelLoading.set(false);
    this.modelError.set(false);
  }
  onModelError(): void {
    this.modelLoading.set(false);
    this.modelError.set(true);
  }

  private applySelection(s: ShipSkin | null): void {
    this.current.set(s);
    this.modelError.set(false);
    const has3d = !!s?.modelPath;
    this.mode.set(has3d ? '3d' : 'paint');
    this.modelLoading.set(has3d);
  }
}
