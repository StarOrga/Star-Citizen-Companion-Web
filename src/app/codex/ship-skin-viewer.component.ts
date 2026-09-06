import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ShipSkin, ShipSkinsService } from './ship-skins.service';
import {
  Vec3,
  hotspotPosition,
  parseGlbNodePositions,
  resolveAnchors,
} from './glb-hardpoints';

// Side-effect import registers the <model-viewer> custom element. Because this
// component is lazy-loaded inside the ship detail route, model-viewer (~1 MB)
// only enters the bundle chunk for that route — never the initial bundle.
import '@google/model-viewer';

/**
 * Register the SELF-HOSTED meshopt decoder (#305).
 *
 * model-viewer already bundles three's `MeshoptDecoder`, but it only wires it
 * into the loader once `meshoptDecoderLocation` is set — unset, a
 * meshopt-compressed glb fails with "setMeshoptDecoder must be called before
 * loading compressed files". Unlike `dracoDecoderLocation` there is no CDN
 * default here, so pointing it at our own copy means the decoder is genuinely
 * same-origin: no request to Google, and the 3D view keeps working on networks
 * that block third-party CDNs.
 *
 * Setting this is harmless for the Draco hulls currently in the bucket — it only
 * adds meshopt capability. That ordering is deliberate: the viewer must be able
 * to read meshopt BEFORE the uploader starts producing it, and `www.gstatic.com`
 * may only leave the CSP once no Draco hull is left to decode.
 *
 * Verified in a real browser: a meshopt hull renders with the same dimensions as
 * the Draco one (18.88 x 9.82 x 23.78 m, delta < 1 mm), decoder fetched from our
 * own origin, and unlike the Draco setter this location is NOT reset on load.
 */
function useSelfHostedMeshoptDecoder(ctor: unknown): void {
  if (ctor) {
    (ctor as { meshoptDecoderLocation?: string }).meshoptDecoderLocation =
      '/meshopt/meshopt_decoder.loader.js';
  }
}
useSelfHostedMeshoptDecoder(customElements.get('model-viewer'));
void customElements
  .whenDefined('model-viewer')
  .then((ctor) => useSelfHostedMeshoptDecoder(ctor ?? customElements.get('model-viewer')))
  .catch(() => {
    /* a model-viewer that never defines already surfaces as a model load error */
  });

type ViewMode = '3d' | 'paint';

/** A port the detail view wants located on the model. */
export interface HardpointPortRef {
  /** Raw port name — the key every hardpoint view highlights by. */
  port: string;
  label: string;
  itemName: string | null;
}

/** One resolved hotspot, ready to hand to `<model-viewer>`. */
interface HotspotView {
  port: string;
  label: string;
  itemName: string | null;
  /** `slot` attribute; must be unique per model-viewer and start with `hotspot-`. */
  slot: string;
  /** `data-position` — model-space coordinates as a "x y z" string. */
  position: string;
}

// Only the head of a glb is needed: node transforms live in the JSON chunk,
// which precedes the (draco-compressed) binary payload. One ranged request
// keeps this off the ~3 MB the viewer itself streams.
const GLB_HEAD_BYTES = 1_048_576;

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
      <section class="skins" [class.embedded]="embedded()">
        @if (!embedded()) {
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
        }
        @if (expanded() || embedded()) {
        <div class="skins-body">
          <div class="stage">
            @if (!embedded()) {
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
            }

            @if (mode() === '3d' && modelUrl() && !modelError()) {
              <!-- keyed by skinId: Angular destroys + recreates the element on
                   skin change, so a previous skin's late (load)/(error) event
                   can never mutate the new skin's loading/error state. -->
              @for (sid of [current()?.skinId]; track sid) {
                <model-viewer
                  [attr.src]="modelUrl()"
                  camera-controls
                  [attr.auto-rotate]="hotspots().length && activePorts().length ? null : ''"
                  shadow-intensity="1"
                  exposure="1.0"
                  environment-image="neutral"
                  camera-orbit="35deg 75deg 105%"
                  interaction-prompt="none"
                  (load)="onModelLoad()"
                  (error)="onModelError()"
                >
                  <!-- Component hover -> position on the hull (#256). The
                       markers come out of the model's OWN locator nodes, so a
                       ship whose glb carries none simply shows no markers. -->
                  @for (h of hotspots(); track h.port) {
                    <button
                      type="button"
                      class="hp-dot"
                      [class.on]="isActive(h.port)"
                      [attr.slot]="h.slot"
                      [attr.data-position]="h.position"
                      data-normal="0 1 0"
                      data-visibility-attribute="visible"
                      [attr.aria-label]="h.itemName ? h.label + ' — ' + h.itemName : h.label"
                      (mouseenter)="hovered.emit([h.port])"
                      (mouseleave)="hovered.emit(null)"
                      (focus)="hovered.emit([h.port])"
                      (blur)="hovered.emit(null)"
                    >
                      <span class="hp-tip">
                        {{ h.label }}
                        @if (h.itemName) {
                          <em>{{ h.itemName }}</em>
                        }
                      </span>
                    </button>
                  }
                </model-viewer>
              }
              @if (modelLoading()) {
                <div class="overlay" role="status">
                  <span class="spinner" aria-hidden="true"></span>
                  {{ 'codex.skins.loading' | translate }}
                </div>
              }
              @if (hotspots().length > 0) {
                <p class="hp-hint">
                  {{ 'codex.skins.hardpointHint' | translate: { count: hotspots().length } }}
                </p>
              }
            } @else if (mode() === '3d' && modelError()) {
              <div class="empty error">{{ 'codex.skins.loadError' | translate }}</div>
            } @else if (iconUrl()) {
              <img class="paint-render" [src]="iconUrl()" [alt]="current()?.name || ''" />
            } @else {
              <div class="empty">{{ 'codex.skins.no3d' | translate }}</div>
            }

            @if (!embedded() && current(); as c) {
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

          @if (!embedded()) {
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
          }
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
      /* Bare stage inside the hero card: no chrome, no border, no rounding —
         the card already provides all three. */
      .skins.embedded {
        border: 0;
        border-radius: 0;
        background: transparent;
        block-size: 100%;
      }
      .skins.embedded .skins-body,
      .skins.embedded .stage {
        block-size: 100%;
        margin: 0;
        padding: 0;
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
        font-size: max(0.72rem, var(--sc-fs-floor));
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
        font-size: max(0.78rem, var(--sc-fs-floor));
        color: #cdd3db;
      }
      .badge .meta {
        font-size: max(0.7rem, var(--sc-fs-floor));
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
        font-size: max(0.62rem, var(--sc-fs-floor));
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

      .hp-hint {
        position: absolute;
        left: 0.6rem;
        bottom: 0.5rem;
        margin: 0;
        max-width: 60%;
        font-size: max(0.64rem, var(--sc-fs-floor));
        line-height: 1.3;
        color: #7f92ab;
        pointer-events: none;
      }

      /* ── Hardpoint markers on the hull (#256) ───────────────────────
         model-viewer positions these itself via the slot/data-position
         pair; everything here is only what the dot looks like. The
         occluded state comes from the PER-HOTSPOT
         data-visibility-attribute (on the button, not on <model-viewer>),
         which makes model-viewer add data-visible while the marker is
         unoccluded — so a marker on the far side of the hull fades
         instead of floating in front of it. */
      .hp-dot {
        position: relative; /* anchors .hp-tip */
        width: 14px;
        height: 14px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid var(--sc-accent, #4da3ff);
        background: rgba(10, 14, 20, 0.75);
        cursor: pointer;
        transition: transform 0.12s ease, opacity 0.12s ease, background 0.12s ease;
      }
      /* Occluded markers recede but stay usable. model-viewer ADDS data-visible
         to an unoccluded hotspot and removes it again — so "no attribute" means
         either "behind the hull" or "the per-hotspot data-visibility-attribute
         is not wired". Dimming is therefore the most this rule may do: a version
         that also killed pointer-events turned a wiring slip into a dead
         feature (every marker faint and unclickable) instead of a cosmetic one. */
      .hp-dot:not([data-visible]) {
        opacity: 0.4;
      }
      .hp-dot:hover,
      .hp-dot:focus-visible,
      .hp-dot.on {
        background: var(--sc-accent, #4da3ff);
        transform: scale(1.45);
        outline: none;
      }
      .hp-tip {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        transform: translateX(-50%);
        display: none;
        white-space: nowrap;
        padding: 0.2rem 0.45rem;
        border-radius: 6px;
        background: rgba(8, 11, 16, 0.94);
        border: 1px solid #2a3444;
        color: #dce6f5;
        font-size: max(0.66rem, var(--sc-fs-floor));
        pointer-events: none;
      }
      .hp-tip em {
        display: block;
        font-style: normal;
        color: #8fb0e0;
      }
      .hp-dot:hover .hp-tip,
      .hp-dot:focus-visible .hp-tip,
      .hp-dot.on .hp-tip {
        display: block;
      }
    `,
  ],
})
export class ShipSkinViewerComponent {
  readonly shipId = input.required<string>();

  /**
   * Ports the detail view would like located on the hull (#256).
   *
   * The viewer resolves them against the loaded model's own locator nodes and
   * emits back the subset it could place, so the list rows only advertise a
   * marker that actually exists.
   */
  readonly hardpointPorts = input<readonly HardpointPortRef[]>([]);
  /** Raw port names currently highlighted anywhere in the detail view. */
  readonly activePorts = input<readonly string[]>([]);
  /** A marker was hovered/focused: its raw port name, or `null` on leave. */
  readonly hovered = output<string[] | null>();
  /** Ports this model can locate — drives the row affordance in the list. */
  readonly locatable = output<string[]>();

  /**
   * Render as bare stage: no header, no mode buttons, no skin list, no badge —
   * only the model. Used by the ship page's hero card, whose own 2D/3D switch
   * already owns the decision this component's chrome would duplicate.
   */
  readonly embedded = input(false);
  /**
   * Whether this ship has an interactive model at all. The hero switch is only
   * offered when the answer is yes, and only this component can answer it: the
   * skin catalog is what says whether a glb exists.
   */
  readonly available = output<boolean>();

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

  // Locator nodes of the currently loaded glb: node name -> model-space
  // position. Empty until the model's head has been read, and for any model
  // that carries no named locators at all.
  private readonly nodePositions = signal<Map<string, Vec3>>(new Map());

  /** The markers to draw, in the order the detail view listed its ports. */
  readonly hotspots = computed<HotspotView[]>(() => {
    const positions = this.nodePositions();
    if (positions.size === 0) return [];
    return resolveAnchors(positions, this.hardpointPorts()).map((a, i) => ({
      port: a.port,
      label: a.label,
      itemName: a.itemName,
      // Slot names are attribute values and must be unique: the index keeps
      // them so even if two ports sanitize to the same string.
      slot: `hotspot-${i}-${a.port.replace(/[^a-zA-Z0-9_-]/g, '')}`,
      position: hotspotPosition(a.position),
    }));
  });

  isActive(port: string): boolean {
    return this.activePorts().includes(port);
  }

  // Monotonic request token: guards against a slow listSkins() for a previous
  // ship resolving after the user has already navigated to another ship.
  private reqSeq = 0;
  // Same guard for the glb head reads, which race the same way.
  private headSeq = 0;

  constructor() {
    // React to shipId changes (router navigation between ships reuses this
    // component, so the input value changes without a new constructor call).
    effect(() => this.load(this.shipId()));
    // Locators come from whichever glb is on screen. Skins of one ship share a
    // hull, but re-reading per skin costs one cached ranged request and keeps
    // this correct if a skin ever ships its own geometry.
    effect(() => this.readLocators(this.modelUrl()));
    // Publish what the model can locate, so the list rows can offer the
    // affordance only for ports that really have a marker.
    effect(() => this.locatable.emit(this.hotspots().map((h) => h.port)));
    // Publish whether a 3D model exists at all, so the hero can offer (or not
    // offer) its 2D/3D switch. Emitted from the catalog, not from a loaded
    // model: the answer must be known before anything is downloaded.
    effect(() => this.available.emit(this.skins().some((s) => !!s.modelPath)));
  }

  /**
   * Read the loaded model's locator nodes.
   *
   * Only the head of the file is requested — node transforms live in the glb's
   * JSON chunk, ahead of the compressed geometry. A server that ignores the
   * Range header simply returns more than asked for, which parses the same.
   * Every failure path (no url, network error, unparsable container, a JSON
   * chunk larger than the window) ends in an empty map, i.e. no markers.
   */
  private readLocators(url: string | null): void {
    const seq = ++this.headSeq;
    this.nodePositions.set(new Map());
    if (!url) return;
    void fetch(url, { headers: { Range: `bytes=0-${GLB_HEAD_BYTES - 1}` } })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((buf) => {
        if (seq !== this.headSeq || !buf) return; // stale — a newer model won
        this.nodePositions.set(parseGlbNodePositions(buf));
      })
      .catch(() => {
        /* markers are a bonus: a failed head read just means no markers */
      });
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
