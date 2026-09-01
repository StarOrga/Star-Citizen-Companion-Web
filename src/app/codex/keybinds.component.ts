import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  Signal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexService, toLang } from './codex.service';
import { cleanLocaleValue } from './codex-format';
import {
  KeybindContext,
  KeybindLabelSource,
  humanizeKeybindName,
  resolveKeybindLabel,
  sharedContext,
} from './keybind-format';
import { CodexStatusBannerComponent } from './codex-status-banner.component';
import { CodexKeybind, KeybindDevice, Lang } from './codex.types';
import { RoleService } from '../auth/role.service';
import { EnglishStringsService } from '../shared/english-strings.service';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { KeybindCategoryService, KeybindTarget, keybindKey } from './keybind-category.service';
import {
  EMPTY_ASSIGNMENT,
  KEYBIND_ACTION_GROUPS,
  KEYBIND_ACTIVITIES,
  KEYBIND_LAYERS,
  KEYBIND_SCOPES,
  KeybindAssignment,
  KeybindLayer,
  environmentsFor,
  isAssigned,
  normalizeAssignment,
  rolesFor,
  taxonomyKey,
} from './keybind-taxonomy';

interface KeybindRow {
  actionName: string;
  /** `actionmap::actionName` — selection key and category-map key. */
  key: string;
  actionmap: string;
  label: string;
  /** Where `label` came from — 'derived' means we built it from the raw key. */
  source: KeybindLabelSource;
  /** Context lifted out of the raw key's prefix, or null. */
  context: KeybindContext | null;
  description: string | null;
  binding: string | null; // for the currently selected device
  /** Curated hierarchy (L1–L5); all-null while unclassified. */
  assignment: KeybindAssignment;
  assigned: boolean;
}

interface KeybindGroup {
  actionmap: string;
  category: string;
  /** Context shared by every row — rendered once on the header instead of per row. */
  context: KeybindContext | null;
  rows: KeybindRow[];
}

/** Which rows the list shows — the admin's way through ~1.1k actions. */
type AssignFilter = 'all' | 'unassigned' | 'assigned';

/**
 * Which language the ACTION and CATEGORY names render in. `ui` follows the app
 * language; `en` pins them to the game's own English wording.
 */
type NameLang = 'ui' | 'en';

const DEVICES: readonly KeybindDevice[] = ['keyboard', 'mouse', 'gamepad', 'joystick'] as const;
const SKELETONS = Array.from({ length: 8 }, (_, i) => i);
const FILTERS: readonly AssignFilter[] = ['all', 'unassigned', 'assigned'] as const;
const NAME_LANGS: readonly NameLang[] = ['ui', 'en'] as const;

/**
 * Codex Keybindings — a lean, searchable reference of the game's DEFAULT action
 * bindings for the current build (extracted from Data/Libs/Config/
 * defaultProfile.xml). Categories = actionmaps, in the profile's own order; each
 * action shows its default binding for the selected input device. Labels resolve
 * from codex_locale_strings (all languages) in one batch. Read-only, public.
 *
 * Names can be switched between the app language and the ENGLISH ORIGINAL
 * (feedback d8f096a7): most players run the game client in English, so finding
 * an action here the way it reads in-game is worth more than a translation.
 * Both label tables are already fetched for the fallback chain, so the switch
 * only changes which one wins — nothing is machine-translated, and an action
 * without an English entry still degrades to the derived name.
 *
 * ADMINS additionally get an assignment mode (feedback fd58a5eb): every input
 * action can be placed in the SCC Context hierarchy (L1 Scope → L2 Environment
 * → L3 Role → L4 Activity → L5 Action Group, see keybind-taxonomy.ts). That
 * curation is extra information ON TOP of the datamine — it lives in its own
 * table and is served to the SCC app through GET /v1/keybinds. Only the
 * assignment UI is admin-gated; the resulting chips are public, like the rest
 * of the codex.
 */
@Component({
  selector: 'sc-codex-keybinds',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslateModule,
    CodexStatusBannerComponent,
    ScSelectComponent,
  ],
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
        @for (s of skeletons; track s; let i = $index) {
          <div class="row-skel sc-skel" [style.--sc-skel-i]="i"></div>
        }
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
          <!-- Name language. Same segmented shape as the news stream's
               "Beiträge | Gemerkt", because it does the same job: two slices of
               one list, one active at a time. Hidden when the UI already runs
               in English — both halves would then say the same thing. -->
          @if (langSwitchVisible()) {
            <div class="seg lang" role="group"
                 [attr.aria-label]="'codex.keybinds.lang.aria' | translate">
              @for (l of nameLangs; track l) {
                <button type="button" class="seg-btn" [class.on]="nameLang() === l"
                        [attr.aria-pressed]="nameLang() === l"
                        [attr.title]="'codex.keybinds.lang.hint.' + l | translate"
                        (click)="setNameLang(l)">
                  {{ 'codex.keybinds.lang.short.' + l | translate }}
                </button>
              }
            </div>
          }
          @if (roles.isAdmin()) {
            <button type="button" class="assign-toggle" [class.on]="assignMode()"
                    [attr.aria-pressed]="assignMode()" (click)="toggleAssignMode()">
              {{ (assignMode() ? 'codex.keybinds.assign.exit' : 'codex.keybinds.assign.enter')
                 | translate }}
            </button>
          }
        </div>
        @if (langSwitchVisible()) {
          <p class="lang-note">{{ 'codex.keybinds.lang.note' | translate }}</p>
        }

        @if (roles.isAdmin() && assignMode()) {
          <!-- Assignment bar. Sticky under the controls so the picked hierarchy
               stays visible while scrolling through a 1.1k-row profile. -->
          <div class="assign-bar">
            <!-- "Am I in assignment mode, and how do I get out?" was the first
                 thing the mode failed to answer (feedback d8f096a7): the only
                 marker used to be the pressed state of a button in the row
                 above. So the bar now names itself, says what to do, and
                 carries its own way back. -->
            <div class="assign-head" role="status">
              <span class="assign-badge">
                <span class="dot" aria-hidden="true"></span>
                {{ 'codex.keybinds.assign.active' | translate }}
              </span>
              <p class="assign-help">{{ 'codex.keybinds.assign.help' | translate }}</p>
              <button type="button" class="assign-exit" (click)="toggleAssignMode()">
                {{ 'codex.keybinds.assign.exit' | translate }}
              </button>
            </div>

            <div class="assign-progress">
              <span class="ap-count">
                {{ 'codex.keybinds.assign.progress' | translate:
                   { assigned: assignedTotal(), total: total() } }}
              </span>
              <span class="ap-track" aria-hidden="true">
                <span class="ap-fill" [style.width.%]="assignedPercent()"></span>
              </span>
              <span class="filters" role="group"
                    [attr.aria-label]="'codex.keybinds.assign.filter' | translate">
                @for (f of filters; track f) {
                  <button type="button" class="filter" [class.active]="filter() === f"
                          [attr.aria-pressed]="filter() === f" (click)="setFilter(f)">
                    {{ 'codex.keybinds.assign.filters.' + f | translate }}
                  </button>
                }
              </span>
            </div>

            <!-- Themed listboxes, not native <select>s: the OPEN state of a
                 native select is drawn by the OS and cannot be styled, which is
                 what made the first cut look off-theme (fd58a5eb, round 2). The
                 label is a plain <span> + aria-label on the control, because a
                 <label> cannot wrap a custom element into an implicit pair. -->
            <div class="pickers">
              @for (p of pickers; track p.layer) {
                <div class="pick">
                  <span class="pick-label">
                    {{ tx('codex.keybinds.assign.layers.' + p.layer) }}
                  </span>
                  <sc-select
                    [options]="p.options()"
                    [value]="draft()[p.layer]"
                    [disabled]="p.options().length === 0"
                    placeholderKey="codex.keybinds.assign.none"
                    [placeholderLabel]="enText('codex.keybinds.assign.none')"
                    [ariaLabel]="tx('codex.keybinds.assign.layers.' + p.layer)"
                    (valueChange)="setLayer(p.layer, $event)"
                  />
                </div>
              }
            </div>

            <div class="assign-actions">
              <span class="sel-count">
                {{ 'codex.keybinds.assign.selected' | translate: { count: selectedCount() } }}
              </span>
              <button type="button" class="primary"
                      [disabled]="selectedCount() === 0 || !draftAssigned() || cats.saving()"
                      (click)="applyToSelection()">
                {{ 'codex.keybinds.assign.apply' | translate }}
              </button>
              <button type="button"
                      [disabled]="selectedCount() === 0 || cats.saving()"
                      (click)="clearSelectionAssignment()">
                {{ 'codex.keybinds.assign.clear' | translate }}
              </button>
              <button type="button" [disabled]="selectedCount() === 0" (click)="deselectAll()">
                {{ 'codex.keybinds.assign.deselect' | translate }}
              </button>
              <button type="button" class="export" (click)="exportJson()">
                {{ 'codex.keybinds.assign.export' | translate }}
              </button>
            </div>

            @if (cats.error(); as cerr) {
              <p class="assign-error" role="alert">{{ cerr }}</p>
            }
            @if (savedAt()) {
              <p class="assign-ok" role="status">{{ 'codex.keybinds.assign.saved' | translate }}</p>
            }
          </div>
        }

        @if (groups().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.empty.title' | translate }}</strong>
            <p>{{ 'codex.empty.filtered' | translate }}</p>
          </div>
        } @else {
          <p class="count">{{ 'codex.keybinds.count' | translate: { shown: shownCount(), total: total() } }}</p>
          @for (g of groups(); track g.actionmap) {
            <section class="cat">
              <h2 class="cat-head">
                <!-- A <label> so the category NAME is part of the checkbox's
                     hit area, not just the 16px box next to it. Renders as a
                     plain wrapper outside assignment mode (a label without a
                     control has no semantics of its own). -->
                <label class="head-pick" [class.selectable]="editing()">
                  @if (editing()) {
                    <input type="checkbox" class="pick-box" [checked]="groupSelected(g)"
                           [attr.aria-label]="'codex.keybinds.assign.selectGroup' | translate: { group: g.category }"
                           (change)="toggleGroup(g)" />
                  }
                  <span>{{ g.category }}</span>
                </label>
                @if (g.context) {
                  <span class="ctx">{{ tx('codex.keybinds.contexts.' + g.context) }}</span>
                }
              </h2>
              <ul class="rows">
                @for (r of g.rows; track r.key) {
                  <li class="row" [class.picked]="isSelected(r)"
                      [class.selectable]="editing()" [attr.title]="rowTitle(r)">
                    @if (editing()) {
                      <!-- The checkbox lives in its own <label>, whose ::after
                           is stretched over the whole row (see .row-pick::after).
                           Clicking anywhere in the row therefore activates the
                           label and toggles the box — natively, so the keyboard
                           and the aria-checked state come for free and nothing
                           has to re-implement a checkbox (feedback d8f096a7).
                           The row-edit button rides above that overlay. -->
                      <label class="row-pick">
                        <input type="checkbox" class="pick-box" [checked]="isSelected(r)"
                               [attr.aria-label]="'codex.keybinds.assign.selectRow' | translate: { action: r.label }"
                               (change)="toggleRow(r)" />
                      </label>
                    }
                    <span class="act">
                      <span class="act-label">
                        {{ r.label }}
                        @if (!g.context && r.context) {
                          <span class="ctx">{{ tx('codex.keybinds.contexts.' + r.context) }}</span>
                        }
                      </span>
                      @if (r.assigned) {
                        <span class="cats">
                          @for (c of chips(r); track c.layer) {
                            <span class="cat-chip" [class]="'cat-chip l-' + c.layer">
                              {{ tx(c.key) }}
                            </span>
                          }
                        </span>
                      }
                      @if (r.source === 'derived') {
                        <code class="act-raw"
                              [attr.aria-label]="'codex.keybinds.rawKey' | translate">{{ r.actionName }}</code>
                      }
                    </span>
                    @if (editing()) {
                      <button type="button" class="row-edit" (click)="editRow(r)">
                        {{ 'codex.keybinds.assign.edit' | translate }}
                      </button>
                    }
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
    .back { font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-accent); text-decoration: none; width: fit-content; }
    .back:hover { text-decoration: underline; }
    .kb-head h1 { margin: 4px 0 0; font-size: clamp(1.4rem, 2.6vw, 2rem); }
    .sub { margin: 0; color: var(--sc-fg-2); font-size: 0.84rem; }

    .kb-controls {
      display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
      /* Slides down under sc-impersonation-banner while a preview is active —
         see that component's constructor, which owns this var (0px = no-op). */
      position: sticky; top: var(--sc-imp-banner-h, 0px); z-index: 2; padding: 8px 0;
      background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent);
      backdrop-filter: blur(6px);
    }
    .devices { display: inline-flex; gap: 4px; padding: 4px; border-radius: 10px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .dev {
      padding: 7px 14px; border: none; background: transparent; color: var(--sc-fg-2);
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.04em;
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
    .assign-toggle {
      flex: 0 0 auto; padding: 10px 16px; border-radius: 10px; cursor: pointer; min-height: 48px;
      background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .assign-toggle:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .assign-toggle.on { background: var(--sc-accent); border-color: var(--sc-accent); color: var(--sc-bg-0); }

    /* ── name-language switch ──────────────────────────────────────────────
       Same segmented control as the news stream's "Beiträge | Gemerkt": two
       slices of one list, exactly one active. Short codes only — the pair is
       read as a unit, and the tooltip/aria carry the long form. */
    .seg {
      display: inline-flex; align-items: stretch; overflow: hidden; flex: 0 0 auto;
      border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1);
    }
    .seg-btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 6px 14px; min-height: var(--sc-tap-min, 48px); min-width: 48px;
      background: transparent; border: 0; border-right: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-family: var(--sc-font-display); cursor: pointer;
      font-size: max(0.72rem, var(--sc-fs-floor)); line-height: 1; letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .seg-btn:last-child { border-right: 0; }
    .seg-btn:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-fg-2) 9%, transparent); }
    .seg-btn.on { color: var(--sc-bg-0); background: var(--sc-accent); }
    .seg-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .lang-note { margin: -8px 0 0; color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); }

    /* ── admin assignment bar ─────────────────────────────────────────────── */
    .assign-bar {
      display: flex; flex-direction: column; gap: 12px;
      padding: 14px 16px; border-radius: 12px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      /* Parks below .kb-controls (its own sticky offset above), which itself
         slides down under sc-impersonation-banner — see that comment. */
      position: sticky; top: calc(var(--sc-imp-banner-h, 0px) + 60px); z-index: 2;
    }
    /* The bar is the mode's visible state: accent frame + a named badge, so
       "am I still assigning?" is answerable at a glance. */
    .assign-bar { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); }
    .assign-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .assign-badge {
      display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto;
      padding: 4px 10px; border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent);
      color: var(--sc-accent); font-family: var(--sc-font-display);
      font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase;
    }
    .assign-badge .dot {
      inline-size: 7px; block-size: 7px; border-radius: 50%; background: var(--sc-accent);
      animation: kb-pulse 1.8s ease-in-out infinite;
    }
    @keyframes kb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    @media (prefers-reduced-motion: reduce) { .assign-badge .dot { animation: none; } }
    .assign-help {
      margin: 0; flex: 1 1 220px; min-width: 0;
      color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .assign-exit {
      flex: 0 0 auto; padding: 8px 14px; border-radius: 8px; cursor: pointer; min-height: 48px;
      background: transparent; border: 1px solid var(--sc-accent); color: var(--sc-accent);
      font-family: var(--sc-font-display); font-size: max(0.7rem, var(--sc-fs-floor));
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .assign-exit:hover { background: var(--sc-accent); color: var(--sc-bg-0); }
    .assign-progress { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .ap-count { color: var(--sc-fg-1); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .ap-track { flex: 1 1 120px; height: 6px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
    .ap-fill { display: block; height: 100%; background: var(--sc-accent); }
    .filters { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .filter {
      padding: 6px 12px; border-radius: 999px; cursor: pointer; min-height: 48px;
      background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-family: var(--sc-font-display); font-size: max(0.68rem, var(--sc-fs-floor));
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .filter.active { border-color: var(--sc-accent); color: var(--sc-accent); }

    .pickers { display: flex; gap: 10px; flex-wrap: wrap; }
    .pick { display: flex; flex-direction: column; gap: 4px; flex: 1 1 150px; min-width: 0; }
    .pick-label {
      font-family: var(--sc-font-display); font-size: max(0.64rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2);
    }

    .assign-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .sel-count { color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); margin-right: auto; }
    .assign-actions button {
      padding: 9px 16px; border-radius: 8px; cursor: pointer; min-height: 48px;
      background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font-family: inherit; font-size: 0.85rem;
    }
    .assign-actions button:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .assign-actions button:disabled { opacity: 0.45; cursor: not-allowed; }
    .assign-actions .primary { background: var(--sc-accent); border-color: var(--sc-accent); color: var(--sc-bg-0); }
    .assign-error { margin: 0; color: var(--sc-danger); font-size: 0.82rem; }
    .assign-ok { margin: 0; color: var(--sc-accent); font-size: 0.82rem; }

    .count { margin: 0; color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }

    .cat { display: flex; flex-direction: column; gap: 6px; }
    .cat-head {
      margin: 10px 0 2px; font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--sc-accent); font-family: var(--sc-font-display);
      border-bottom: 1px solid var(--sc-border); padding-bottom: 6px;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .head-pick { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
    .head-pick.selectable { cursor: pointer; }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .row {
      position: relative;
      display: flex; align-items: center; gap: 12px; justify-content: space-between;
      padding: 8px 10px; border-radius: 8px; border: 1px solid transparent;
    }
    .row:hover { background: var(--sc-bg-1); border-color: var(--sc-border); }
    .row.selectable { cursor: pointer; }
    .row.picked { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    /* Sizing only — the box itself is painted by the global checkbox rules in
       styles.scss, so it matches every other check in the app. */
    .pick-box { flex: 0 0 auto; }
    .row-pick { display: inline-flex; align-items: center; flex: 0 0 auto; }
    /* The row-wide hit area: a pseudo-element of the checkbox's OWN label, so
       the browser does the toggling. Clicking the label's generated content
       activates the label exactly like clicking its text would. */
    .row-pick::after {
      content: ''; position: absolute; inset: 0; border-radius: 8px; cursor: pointer;
    }
    /* Everything that has its own click stays above the overlay. */
    .row .pick-box, .row .row-edit { position: relative; z-index: 1; }
    .row-edit {
      flex: 0 0 auto; padding: 6px 12px; border-radius: 6px; min-height: 48px;
      background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2);
      font-family: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer;
    }
    .row-edit:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .act { display: flex; flex-direction: column; gap: 2px; min-width: 0; margin-right: auto; }
    .act-label { font-size: 0.9rem; color: var(--sc-fg-0); min-width: 0; overflow-wrap: anywhere; }
    /* Context lifted out of the raw key's prefix (v_, spectate_, ui_, …) — the
       prefix's information, shown as a chip instead of polluting the label. */
    .ctx {
      display: inline-block; margin-left: 8px; padding: 1px 7px; border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent);
      color: var(--sc-accent); font-family: var(--sc-font-display);
      font-size: max(0.62rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase;
      white-space: nowrap; vertical-align: middle;
    }
    .cat-head .ctx { margin-left: 0; }
    /* Curated hierarchy (L1–L5) — admin-curated, publicly visible, like the
       rest of the codex. */
    .cats { display: flex; gap: 4px; flex-wrap: wrap; }
    .cat-chip {
      padding: 1px 7px; border-radius: 999px; white-space: nowrap;
      font-family: var(--sc-font-display); font-size: max(0.6rem, var(--sc-fs-floor));
      letter-spacing: 0.05em; text-transform: uppercase;
      border: 1px solid var(--sc-border); color: var(--sc-fg-2); background: var(--sc-bg-1);
    }
    .cat-chip.l-actionGroup { color: var(--sc-fg-0); border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    /* Ground truth for a derived label — nothing from the datamine is lost. */
    .act-raw {
      font-family: var(--sc-font-mono, ui-monospace, monospace); font-size: max(0.68rem, var(--sc-fs-floor));
      color: var(--sc-fg-2); overflow-wrap: anywhere;
    }
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

    .row-skel { height: 40px; border-radius: 8px; }

    /* Keyboard parity for the row-wide hit area: the checkbox draws its own
       ring, but the row is what the pointer selects, so it is outlined too. */
    .row:has(.pick-box:focus-visible) {
      outline: 2px solid var(--sc-accent); outline-offset: 1px;
    }

    @media (max-width: 640px) {
      .assign-bar { position: static; }
      .sel-count { margin-right: 0; flex: 1 1 100%; }
      /* Phone: the search field takes the full row, the switch and the mode
         button share the next one instead of squeezing into a 3-up line. */
      .search { flex: 1 1 100%; }
      .assign-toggle { flex: 1 1 auto; }
      .assign-help { flex: 1 1 100%; }
      .assign-exit { flex: 1 1 100%; }
    }
  `],
})
export class KeybindsComponent implements OnInit {
  readonly svc = inject(CodexService);
  readonly roles = inject(RoleService);
  readonly cats = inject(KeybindCategoryService);
  private readonly t = inject(TranslateService);
  private readonly english = inject(EnglishStringsService);

  readonly devices = DEVICES;
  readonly skeletons = SKELETONS;
  readonly filters = FILTERS;
  readonly nameLangs = NAME_LANGS;
  readonly scopes = KEYBIND_SCOPES;
  readonly activities = KEYBIND_ACTIVITIES;
  readonly actionGroups = KEYBIND_ACTION_GROUPS;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly device = signal<KeybindDevice>('keyboard');
  readonly searchInput = signal('');

  // ── name language (feedback d8f096a7) ──────────────────────────────────────
  /** The app language the label maps below were fetched for. */
  readonly uiLang = signal<Lang>('en');
  /** The user's own language wins on arrival — the switch is opt-in. */
  readonly nameLang = signal<NameLang>('ui');
  /** Nothing to choose when the app already runs in the game's language. */
  readonly langSwitchVisible = computed(() => this.uiLang() !== 'en');
  /** True when names must render in English — either by choice or by UI lang. */
  readonly englishNames = computed(() => this.uiLang() === 'en' || this.nameLang() === 'en');

  // ── admin assignment mode (feedback fd58a5eb) ──────────────────────────────
  readonly assignMode = signal(false);
  readonly filter = signal<AssignFilter>('all');
  readonly draft = signal<KeybindAssignment>(EMPTY_ASSIGNMENT);
  readonly selection = signal<ReadonlySet<string>>(new Set<string>());
  readonly savedAt = signal(false);

  private readonly all = signal<CodexKeybind[]>([]);
  /** @-key → value in the active UI language. */
  private readonly labels = signal<Map<string, string>>(new Map());
  /** @-key → English original, the fallback when the active language misses one. */
  private readonly labelsEn = signal<Map<string, string>>(new Map());

  readonly total = computed(() => this.all().length);
  /** Assignment controls only ever render for an admin who turned them on. */
  readonly editing = computed(() => this.roles.isAdmin() && this.assignMode());
  readonly selectedCount = computed(() => this.selection().size);
  readonly draftAssigned = computed(() => isAssigned(this.draft()));
  readonly environments = computed(() => environmentsFor(this.draft().scope));
  readonly rolesForDraft = computed(() => rolesFor(this.draft().environment));

  /**
   * The five hierarchy pickers in L1→L5 order. Declared as data rather than
   * five near-identical template blocks — the only thing that differs per layer
   * is its option list, and L2/L3 narrow with the layer above them.
   */
  readonly pickers: readonly { layer: KeybindLayer; options: Signal<readonly ScSelectOption[]> }[] = [
    { layer: 'scope', options: computed(() => this.taxonomyOptions('scope', this.scopes)) },
    { layer: 'environment', options: computed(() => this.taxonomyOptions('environment', this.environments())) },
    { layer: 'role', options: computed(() => this.taxonomyOptions('role', this.rolesForDraft())) },
    { layer: 'activity', options: computed(() => this.taxonomyOptions('activity', this.activities)) },
    { layer: 'actionGroup', options: computed(() => this.taxonomyOptions('actionGroup', this.actionGroups)) },
  ];

  constructor() {
    // The datamined names are fetched for ONE language in ngOnInit, so an app
    // language switch has to re-resolve them — otherwise the page keeps serving
    // the previous language's labels (and the DE|EN switch would label itself
    // for a language that is no longer active).
    this.t.onLangChange.pipe(takeUntilDestroyed()).subscribe(() => void this.ngOnInit());
  }

  /** Taxonomy values → themed-select options (value + i18n key, never literals). */
  private taxonomyOptions(
    layer: KeybindLayer,
    values: readonly string[],
  ): readonly ScSelectOption[] {
    return values.map((v) => {
      const labelKey = taxonomyKey(layer, v);
      return { value: v, labelKey, label: this.enText(labelKey) ?? undefined };
    });
  }

  /** How much of THIS build's profile is classified — the admin's progress. */
  readonly assignedTotal = computed(() => {
    const map = this.cats.byAction();
    let n = 0;
    for (const b of this.all()) if (map.has(keybindKey(b.actionmap, b.actionName))) n++;
    return n;
  });
  readonly assignedPercent = computed(() => {
    const t = this.total();
    return t === 0 ? 0 : Math.round((this.assignedTotal() / t) * 100);
  });

  /** Filtered actions grouped by actionmap, in document order. */
  readonly groups = computed<KeybindGroup[]>(() => {
    const dev = this.device();
    const term = this.searchInput().trim().toLowerCase();
    const labels = this.labels();
    const labelsEn = this.labelsEn();
    const cats = this.cats.byAction();
    const mode = this.filter();
    const lookup = (key: string | null, map: Map<string, string>): string | null =>
      key ? cleanLocaleValue(map.get(key) ?? '') || null : null;
    // English mode skips the active language's table entirely instead of
    // translating anything: the datamine already carries both, and the existing
    // english → derived fallback chain is exactly the right degradation for an
    // action the game never localized (~38 % of the profile).
    const en = this.englishNames();
    const localized = (key: string | null): string | null =>
      en ? null : lookup(key, labels);

    const out: KeybindGroup[] = [];
    let current: KeybindGroup | null = null;
    for (const b of this.all()) {
      const label = resolveKeybindLabel({
        actionName: b.actionName,
        localized: localized(b.labelKey),
        english: lookup(b.labelKey, labelsEn),
      });
      const binding = b.bindings[dev];
      // The raw key stays searchable even though it is no longer the label.
      if (term && !`${label.text} ${b.actionName} ${binding ?? ''}`.toLowerCase().includes(term)) {
        continue;
      }
      const key = keybindKey(b.actionmap, b.actionName);
      const assignment = cats.get(key) ?? EMPTY_ASSIGNMENT;
      const assigned = cats.has(key);
      // "Was ist noch offen?" is the question that carries an admin through
      // ~1.1k actions, so it filters this list instead of opening a second view.
      if (mode === 'unassigned' && assigned) continue;
      if (mode === 'assigned' && !assigned) continue;
      if (!current || current.actionmap !== b.actionmap) {
        current = {
          actionmap: b.actionmap,
          category:
            localized(b.categoryLabelKey) ??
            lookup(b.categoryLabelKey, labelsEn) ??
            humanizeKeybindName(b.actionmap),
          context: null, // filled once the group is complete (see below)
          rows: [],
        };
        out.push(current);
      }
      current.rows.push({
        actionName: b.actionName,
        key,
        actionmap: b.actionmap,
        label: label.text,
        source: label.source,
        context: label.context,
        description:
          localized(b.descriptionKey) ?? lookup(b.descriptionKey, labelsEn),
        binding: binding ?? null,
        assignment,
        assigned,
      });
    }
    // Hoist a context every row of a group shares onto the group header, so the
    // chip is shown once instead of on all ~500 vehicle rows.
    for (const g of out) g.context = sharedContext(g.rows.map((r) => r.context));
    return out;
  });

  /** Tooltip: the localized description plus the programmatic key behind the row. */
  rowTitle(r: KeybindRow): string {
    return r.description ? `${r.description}\n${r.actionName}` : r.actionName;
  }

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
      const lang = toLang(this.t.currentLang);
      this.uiLang.set(lang);
      // The taxonomy and context chips are app wording, not datamine values —
      // they come from the i18n bundles, so the English bundle has to be there
      // before the switch can show them.
      this.english.ensureLoaded();
      const wanted = [...keys];
      const map = await this.svc.resolveLocaleKeys(wanted, lang);
      this.labels.set(map);
      // Only ~62 % of actions resolve in English and ~55 % in German, so a
      // non-English UI additionally pulls the English originals: a readable
      // foreign name beats a programmatic key (the admin's explicit ask).
      this.labelsEn.set(
        lang === 'en' ? map : await this.svc.resolveLocaleKeys(wanted, 'en'),
      );
      // The curated categories are public, so they load for every visitor —
      // the chips are part of the reference, not of the admin tooling.
      await this.cats.load();
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

  // ── name language ──────────────────────────────────────────────────────────

  setNameLang(l: NameLang): void {
    this.nameLang.set(l);
  }

  /**
   * The English text for an i18n key while the switch is on EN, else null.
   * Null (rather than the current language) so callers can tell "no English
   * available" apart from "English happens to match" and fall back explicitly.
   */
  enText(key: string): string | null {
    return this.englishNames() ? this.english.text(key) : null;
  }

  /**
   * A UI string in whichever language the NAME switch is on. Used for the
   * curated taxonomy and the context chips: those are app-owned wording rather
   * than datamine values, so they live in the i18n bundles — but an admin who
   * switched to EN wants to read them the way the SCC API serves them, and a
   * player who switched wants the category next to an English action name in
   * the same language.
   */
  tx(key: string): string {
    return this.enText(key) ?? String(this.t.instant(key) ?? key);
  }

  // ── assignment mode ────────────────────────────────────────────────────────

  toggleAssignMode(): void {
    const on = !this.assignMode();
    this.assignMode.set(on);
    if (!on) {
      this.selection.set(new Set<string>());
      this.filter.set('all');
    }
  }

  setFilter(f: AssignFilter): void {
    this.filter.set(f);
  }

  /**
   * Set one layer of the draft. Children the new parent doesn't allow are
   * dropped right here, so the pickers can never offer a combination the DB
   * would reject on save.
   */
  setLayer(layer: KeybindLayer, value: string | null): void {
    const next = normalizeAssignment({
      ...this.draft(),
      [layer]: (value ?? null) as never,
    });
    this.draft.set(next);
    this.savedAt.set(false);
  }

  isSelected(r: KeybindRow): boolean {
    return this.selection().has(r.key);
  }

  toggleRow(r: KeybindRow): void {
    const next = new Set(this.selection());
    if (!next.delete(r.key)) next.add(r.key);
    this.selection.set(next);
    this.savedAt.set(false);
  }

  groupSelected(g: KeybindGroup): boolean {
    const sel = this.selection();
    return g.rows.length > 0 && g.rows.every((r) => sel.has(r.key));
  }

  /** Select or clear a whole actionmap — one click instead of ~500 vehicle rows. */
  toggleGroup(g: KeybindGroup): void {
    const next = new Set(this.selection());
    const on = !this.groupSelected(g);
    for (const r of g.rows) {
      if (on) next.add(r.key);
      else next.delete(r.key);
    }
    this.selection.set(next);
    this.savedAt.set(false);
  }

  deselectAll(): void {
    this.selection.set(new Set<string>());
  }

  /** Load a row's own assignment into the pickers and target just that row. */
  editRow(r: KeybindRow): void {
    this.draft.set(normalizeAssignment(r.assignment));
    this.selection.set(new Set<string>([r.key]));
    this.savedAt.set(false);
  }

  async applyToSelection(): Promise<void> {
    await this.write(this.draft());
  }

  /** Remove the assignment from every selected action (back to unclassified). */
  async clearSelectionAssignment(): Promise<void> {
    await this.write(EMPTY_ASSIGNMENT);
  }

  private async write(assignment: KeybindAssignment): Promise<void> {
    const targets = this.selectedTargets();
    if (targets.length === 0) return;
    this.savedAt.set(false);
    const ok = await this.cats.apply(targets, assignment);
    if (ok) {
      this.savedAt.set(true);
      this.selection.set(new Set<string>());
    }
  }

  private selectedTargets(): KeybindTarget[] {
    const sel = this.selection();
    const out: KeybindTarget[] = [];
    for (const b of this.all()) {
      if (sel.has(keybindKey(b.actionmap, b.actionName))) {
        out.push({ actionmap: b.actionmap, actionName: b.actionName });
      }
    }
    return out;
  }

  /** The assigned layers of a row, as translate keys, parent-first. */
  chips(r: KeybindRow): { layer: KeybindLayer; key: string }[] {
    const out: { layer: KeybindLayer; key: string }[] = [];
    for (const layer of KEYBIND_LAYERS) {
      const v = r.assignment[layer];
      if (v) out.push({ layer, key: taxonomyKey(layer, v) });
    }
    return out;
  }

  /**
   * Download the curated hierarchy as JSON — the same shape GET /v1/keybinds
   * serves, so an SCC-app integrator can diff a local export against the API,
   * and the admin keeps a copy that needs no token.
   */
  exportJson(): void {
    const map = this.cats.byAction();
    const data = this.all()
      .filter((b) => map.has(keybindKey(b.actionmap, b.actionName)))
      .map((b) => {
        const a = map.get(keybindKey(b.actionmap, b.actionName)) as KeybindAssignment;
        return {
          actionmap: b.actionmap,
          action_name: b.actionName,
          scope: a.scope,
          environment: a.environment,
          role: a.role,
          activity: a.activity,
          action_group: a.actionGroup,
        };
      });
    const blob = new Blob([JSON.stringify({ data, meta: { count: data.length } }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keybind-categories.json';
    a.click();
    URL.revokeObjectURL(url);
  }
}
