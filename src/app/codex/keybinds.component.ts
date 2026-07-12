import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexService, toLang } from './codex.service';
import { cleanLocaleValue, humanizeClassName } from './codex-format';
import { CodexStatusBannerComponent } from './codex-status-banner.component';
import { CodexKeybind, KeybindDevice } from './codex.types';

interface KeybindRow {
  actionName: string;
  label: string;
  description: string | null;
  binding: string | null; // for the currently selected device
}

interface KeybindGroup {
  actionmap: string;
  category: string;
  rows: KeybindRow[];
}

const DEVICES: readonly KeybindDevice[] = ['keyboard', 'mouse', 'gamepad', 'joystick'] as const;
const SKELETONS = Array.from({ length: 8 }, (_, i) => i);

/**
 * Codex Keybindings — a lean, searchable reference of the game's DEFAULT action
 * bindings for the current build (extracted from Data/Libs/Config/
 * defaultProfile.xml). Categories = actionmaps, in the profile's own order; each
 * action shows its default binding for the selected input device. Labels resolve
 * from codex_locale_strings (all languages) in one batch. Read-only, public.
 */
@Component({
  selector: 'sc-codex-keybinds',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, CodexStatusBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="kb">
      <header class="kb-head">
        <a class="back" routerLink="/codex">← {{ 'codex.keybinds.back' | translate }}</a>
        <h1>{{ 'codex.keybinds.title' | translate }}</h1>
        <p class="sub">{{ 'codex.keybinds.subtitle' | translate }}</p>
        <sc-codex-status-banner />
      </header>

      @if (error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}
          <button type="button" class="retry" (click)="reload()">
            {{ 'codex.error.retry' | translate }}
          </button>
        </div>
      }

      @if (loading()) {
        @for (s of skeletons; track s) { <div class="skel row-skel"></div> }
      } @else if (total() === 0) {
        <div class="sc-card empty">
          <strong>{{ 'codex.empty.title' | translate }}</strong>
          <p>{{ 'codex.empty.noBuild' | translate }}</p>
        </div>
      } @else {
        <div class="kb-controls">
          <div class="devices" role="tablist" [attr.aria-label]="'codex.keybinds.device' | translate">
            @for (d of devices; track d) {
              <button type="button" class="dev" role="tab"
                      [class.active]="device() === d" [attr.aria-selected]="device() === d"
                      (click)="setDevice(d)">
                {{ 'codex.keybinds.devices.' + d | translate }}
              </button>
            }
          </div>
          <input class="search" type="search" [ngModel]="searchInput()"
                 (ngModelChange)="onSearch($event)"
                 [attr.placeholder]="'codex.keybinds.searchPlaceholder' | translate"
                 [attr.aria-label]="'codex.keybinds.search' | translate" />
        </div>

        @if (groups().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            <p>{{ 'codex.empty.filtered' | translate }}</p>
          </div>
        } @else {
          <p class="count">{{ 'codex.keybinds.count' | translate: { shown: shownCount(), total: total() } }}</p>
          @for (g of groups(); track g.actionmap) {
            <section class="cat">
              <h2 class="cat-head">{{ g.category }}</h2>
              <ul class="rows">
                @for (r of g.rows; track r.actionName) {
                  <li class="row" [attr.title]="r.description">
                    <span class="act-label">{{ r.label }}</span>
                    @if (r.binding) {
                      <kbd class="bind">{{ r.binding }}</kbd>
                    } @else {
                      <span class="bind unbound">{{ 'codex.keybinds.unbound' | translate }}</span>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .kb { display: flex; flex-direction: column; gap: 18px; padding-bottom: 90px; }

    .kb-head { display: flex; flex-direction: column; gap: 4px; }
    .back { font-size: 0.78rem; color: var(--sc-accent); text-decoration: none; width: fit-content; }
    .back:hover { text-decoration: underline; }
    .kb-head h1 { margin: 4px 0 0; font-size: clamp(1.4rem, 2.6vw, 2rem); }
    .sub { margin: 0; color: var(--sc-fg-2); font-size: 0.84rem; }

    .kb-controls {
      display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
      position: sticky; top: 0; z-index: 2; padding: 8px 0;
      background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent);
      backdrop-filter: blur(6px);
    }
    .devices { display: inline-flex; gap: 4px; padding: 4px; border-radius: 10px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .dev {
      padding: 7px 14px; border: none; background: transparent; color: var(--sc-fg-2);
      font-family: var(--sc-font-display); font-size: 0.72rem; letter-spacing: 0.04em;
      text-transform: uppercase; border-radius: 7px; cursor: pointer;
    }
    .dev:hover { color: var(--sc-fg-0); }
    .dev.active { background: var(--sc-accent); color: var(--sc-bg-0); }
    .search {
      flex: 1 1 220px; padding: 11px 14px; border-radius: 10px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.95rem;
    }
    .search:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px rgba(0,212,255,0.22); }

    .count { margin: 0; color: var(--sc-fg-2); font-size: 0.76rem; }

    .cat { display: flex; flex-direction: column; gap: 6px; }
    .cat-head {
      margin: 10px 0 2px; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--sc-accent); font-family: var(--sc-font-display);
      border-bottom: 1px solid var(--sc-border); padding-bottom: 6px;
    }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .row {
      display: flex; align-items: center; gap: 12px; justify-content: space-between;
      padding: 8px 10px; border-radius: 8px; border: 1px solid transparent;
    }
    .row:hover { background: var(--sc-bg-1); border-color: var(--sc-border); }
    .act-label { font-size: 0.9rem; color: var(--sc-fg-0); min-width: 0; overflow-wrap: anywhere; }
    .bind {
      flex: 0 0 auto; font-family: var(--sc-font-mono, ui-monospace, monospace); font-size: 0.8rem;
      padding: 4px 10px; border-radius: 6px; background: var(--sc-bg-2);
      border: 1px solid var(--sc-border); color: var(--sc-fg-0); white-space: nowrap;
    }
    .bind.unbound { background: transparent; color: var(--sc-fg-2); border-style: dashed; }

    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }
    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }

    .skel { background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; }
    .row-skel { height: 40px; border-radius: 8px; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    @media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
  `],
})
export class KeybindsComponent implements OnInit {
  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);

  readonly devices = DEVICES;
  readonly skeletons = SKELETONS;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly device = signal<KeybindDevice>('keyboard');
  readonly searchInput = signal('');

  private readonly all = signal<CodexKeybind[]>([]);
  private readonly labels = signal<Map<string, string>>(new Map());

  readonly total = computed(() => this.all().length);

  /** Filtered actions grouped by actionmap, in document order. */
  readonly groups = computed<KeybindGroup[]>(() => {
    const dev = this.device();
    const term = this.searchInput().trim().toLowerCase();
    const labels = this.labels();
    const resolve = (key: string | null, fallback: string): string =>
      key ? cleanLocaleValue(labels.get(key) ?? '', fallback) : fallback;

    const out: KeybindGroup[] = [];
    let current: KeybindGroup | null = null;
    for (const b of this.all()) {
      const label = resolve(b.labelKey, humanizeClassName(b.actionName));
      const binding = b.bindings[dev];
      if (term && !`${label} ${b.actionName} ${binding ?? ''}`.toLowerCase().includes(term)) {
        continue;
      }
      if (!current || current.actionmap !== b.actionmap) {
        current = {
          actionmap: b.actionmap,
          category: resolve(b.categoryLabelKey, humanizeClassName(b.actionmap)),
          rows: [],
        };
        out.push(current);
      }
      current.rows.push({
        actionName: b.actionName,
        label,
        description: resolve(b.descriptionKey, '') || null,
        binding: binding ?? null,
      });
    }
    return out;
  });

  readonly shownCount = computed(() => this.groups().reduce((n, g) => n + g.rows.length, 0));

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const binds = await this.svc.listKeybinds();
      this.all.set(binds);
      const keys = new Set<string>();
      for (const b of binds) {
        if (b.labelKey) keys.add(b.labelKey);
        if (b.descriptionKey) keys.add(b.descriptionKey);
        if (b.categoryLabelKey) keys.add(b.categoryLabelKey);
      }
      const map = await this.svc.resolveLocaleKeys([...keys], toLang(this.t.currentLang));
      this.labels.set(map);
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  reload(): void {
    void this.ngOnInit();
  }

  setDevice(d: KeybindDevice): void {
    this.device.set(d);
  }

  onSearch(v: string): void {
    this.searchInput.set(v);
  }
}
