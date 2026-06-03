import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  computed,
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
          <h3>{{ 'codex.skins.title' | translate }}</h3>
          <span class="src">{{ 'codex.skins.source' | translate }}</span>
        </header>
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

            @if (mode() === '3d' && modelUrl()) {
              <model-viewer
                [attr.src]="modelUrl()"
                camera-controls
                auto-rotate
                shadow-intensity="1"
                exposure="1.0"
                environment-image="neutral"
                camera-orbit="35deg 75deg 105%"
                interaction-prompt="none"
              ></model-viewer>
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

          <ul class="list">
            @for (s of skins(); track s.skinId) {
              <li
                [class.on]="s.skinId === current()?.skinId"
                [class.no3d]="!s.modelPath"
                (click)="select(s)"
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
      </section>
    }
  `,
  styles: [
    `
      .skins {
        margin-top: 1.5rem;
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
      .skins-head h3 {
        margin: 0;
        font-size: 1rem;
        color: var(--accent, #f0c420);
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

  private readonly service = inject(ShipSkinsService);
  readonly skins = signal<ShipSkin[]>([]);
  readonly current = signal<ShipSkin | null>(null);
  readonly mode = signal<ViewMode>('3d');

  readonly modelUrl = computed(() => this.service.assetUrl(this.current()?.modelPath));
  readonly iconUrl = computed(() => this.service.assetUrl(this.current()?.iconPath));

  constructor() {
    // load whenever the shipId input resolves/changes
    let last = '';
    queueMicrotask(async () => {
      const id = this.shipId();
      if (!id || id === last) return;
      last = id;
      const skins = await this.service.listSkins(id);
      this.skins.set(skins);
      const first = skins.find((s) => s.modelPath) ?? skins[0] ?? null;
      this.current.set(first);
      this.mode.set(first?.modelPath ? '3d' : 'paint');
    });
  }

  iconFor(s: ShipSkin): string | null {
    return this.service.assetUrl(s.iconPath);
  }

  select(s: ShipSkin): void {
    this.current.set(s);
    this.mode.set(s.modelPath ? '3d' : 'paint');
  }

  setMode(m: ViewMode): void {
    if (m === '3d' && !this.current()?.modelPath) return;
    this.mode.set(m);
  }
}
