import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexKind, CodexService, CompatibleItem } from './codex.service';
import { StatDelta, computeStatDeltas } from './codex-format';
import { ammoClassNameFor, ammoClassNamesFor } from './codex-equipped-stats';
import {
  EMPTY_SWAP_FILTERS,
  NAME_SORT_KEY,
  SwapCandidate,
  SwapColumn,
  SwapFilters,
  SwapSort,
  buildSwapCandidate,
  defaultSwapSort,
  filterSwapCandidates,
  pruneSwapFilters,
  sortSwapCandidates,
  swapCell,
  swapColumnBars,
  swapColumns,
  swapFacets,
  swapStatRows,
  toggleSwapSort,
} from './swap-table';

/**
 * The hardpoint a picker was opened for. Assembled by the ship detail page from
 * either a module row or one of its sub-slots (the gun inside a gimbal mount),
 * so both open the same table.
 */
export interface SwapTarget {
  /** Humanized hardpoint label; may stand for several identical ports. */
  port: string;
  /** How many identical hardpoints the choice would apply to (≥1). */
  count: number;
  /** What is installed right now — the EQUIPPED row and the delta baseline. */
  className: string | null;
  kind: CodexKind | null;
  name: string | null;
  size: number | null;
}

/** Supabase rejects very long `in.()` lists — hydrate payloads in batches. */
const HYDRATE_CHUNK = 100;

/**
 * The swap picker (admin request 461288f9): click a configurable module and get
 * the full list of what else fits, as a comparison table — search, damage-type
 * and archetype pills, sortable columns, the installed item marked EQUIPPED.
 *
 * It is a SANDBOX and stays one: picking a row previews the stat change against
 * what is installed and nothing is ever written. There is deliberately no
 * "apply"/"remove" action — this codex has no loadout to save to, and a button
 * that pretends otherwise would be the one lie the surface cannot afford.
 *
 * Columns come from the data (see swap-table.ts): a stat no candidate carries
 * yields no column, a candidate missing a stat the others have renders "—".
 */
@Component({
  selector: 'sc-codex-swap-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target(); as t) {
      <div class="sp-backdrop" (click)="closed.emit()">
        <article #dialog class="sp-panel sc-card" role="dialog" aria-modal="true"
                 [attr.aria-label]="'codex.swap.pickerTitle' | translate"
                 (click)="$event.stopPropagation()" (keydown)="onKeydown($event)">
          <header class="sp-head">
            <div class="sp-titles">
              <h2>
                <span class="sp-icon" aria-hidden="true">⇄</span>
                {{ 'codex.swap.pickerTitle' | translate }}
              </h2>
              <p class="sp-sub">
                <span class="sp-port">{{ t.port }}</span>
                @if (t.name) {
                  · <span>{{ 'codex.swap.installed' | translate }}: {{ t.name }}</span>
                }
              </p>
            </div>
            <button type="button" class="sp-close" (click)="closed.emit()"
                    [attr.aria-label]="'codex.swap.close' | translate">✕</button>
          </header>

          <p class="sp-hint">{{ 'codex.swap.previewHint' | translate }}</p>

          @if (loading()) {
            <p class="sp-msg">{{ 'codex.swap.loading' | translate }}</p>
          } @else if (error()) {
            <p class="sp-msg err">{{ 'codex.swap.failed' | translate }}</p>
          } @else if (candidates().length === 0) {
            <p class="sp-msg">{{ 'codex.swap.none' | translate }}</p>
          } @else {
            <div class="sp-tools">
              <label class="sp-search">
                <span class="sr-only">{{ 'codex.swap.searchLabel' | translate }}</span>
                <input #search type="search" autocomplete="off"
                       [value]="filters().query"
                       (input)="setQuery($event)"
                       [attr.placeholder]="'codex.swap.searchPlaceholder' | translate" />
              </label>

              @if (facets().damage.length > 0) {
                <div class="sp-group" role="group"
                     [attr.aria-label]="'codex.swap.damageFilter' | translate">
                  <span class="sp-group-label">{{ 'codex.swap.damageFilter' | translate }}</span>
                  <button type="button" class="pill" [class.on]="!filters().damage"
                          [attr.aria-pressed]="!filters().damage" (click)="setDamage(null)">
                    {{ 'codex.swap.filterAll' | translate }}
                  </button>
                  @for (f of facets().damage; track f.value) {
                    <button type="button" class="pill" [class.on]="filters().damage === f.value"
                            [attr.aria-pressed]="filters().damage === f.value"
                            (click)="setDamage(f.value)">
                      {{ ('codex.damage.' + f.value) | translate }}
                      <span class="pill-ct">{{ f.count }}</span>
                    </button>
                  }
                </div>
              }

              @if (facets().type.length > 0) {
                <div class="sp-group" role="group"
                     [attr.aria-label]="'codex.swap.typeFilter' | translate">
                  <span class="sp-group-label">{{ 'codex.swap.typeFilter' | translate }}</span>
                  <button type="button" class="pill" [class.on]="!filters().type"
                          [attr.aria-pressed]="!filters().type" (click)="setType(null)">
                    {{ 'codex.swap.filterAll' | translate }}
                  </button>
                  @for (f of facets().type; track f.value) {
                    <button type="button" class="pill" [class.on]="filters().type === f.value"
                            [attr.aria-pressed]="filters().type === f.value"
                            (click)="setType(f.value)">
                      {{ f.value }}
                      <span class="pill-ct">{{ f.count }}</span>
                    </button>
                  }
                </div>
              }
            </div>

            @if (rows().length === 0) {
              <p class="sp-msg">{{ 'codex.swap.noMatch' | translate }}</p>
            } @else {
              <div class="sp-scroll">
                <table class="sp-table">
                  <thead>
                    <tr>
                      <th scope="col" class="c-name" [attr.aria-sort]="ariaSort(NAME_KEY)">
                        <button type="button" class="hd" (click)="sortBy(NAME_KEY, $event)">
                          {{ 'codex.swap.colName' | translate }}
                          <span class="hd-dir" aria-hidden="true">{{ sortMark(NAME_KEY) }}</span>
                        </button>
                      </th>
                      @for (col of columns(); track col.key) {
                        <th scope="col" class="c-num" [attr.aria-sort]="ariaSort(col.key)">
                          <button type="button" class="hd" (click)="sortBy(col.key, $event)"
                                  [attr.title]="col.derived ? ('codex.equipped.derivedHint' | translate) : null">
                            {{ col.key | translate }}@if (col.derived) {<span class="derived" aria-hidden="true">*</span>}
                            <span class="hd-dir" aria-hidden="true">{{ sortMark(col.key) }}</span>
                          </button>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of rows(); track c.className) {
                      <tr class="sp-row" [class.equipped]="c.equipped"
                          [class.sel]="selected() === c.className" (click)="rowClick(c, $event)">
                        <td class="c-name">
                          <button type="button" class="pick" (click)="pick(c)">
                            @if (c.size != null) { <span class="size-tag">S{{ c.size }}</span> }
                            <span class="pick-ident">
                              <span class="pick-name">
                                {{ c.name }}
                                @for (ch of c.damageChannels; track ch) {
                                  <span class="tag dmg">{{ ('codex.damage.' + ch) | translate }}</span>
                                }
                                @if (c.equipped) {
                                  <span class="tag eq">✓ {{ 'codex.swap.equipped' | translate }}</span>
                                }
                              </span>
                              <span class="pick-meta">{{ metaLine(c) }}</span>
                            </span>
                          </button>
                        </td>
                        @for (col of columns(); track col.key) {
                          <td class="c-num" [class.lead]="col.key === primaryKey()">
                            @if (bars().get(c.className); as pct) {
                              @if (col.key === primaryKey()) {
                                <span class="bar" [style.width.%]="pct" aria-hidden="true"></span>
                              }
                            }
                            <span class="cell">{{ cell(c, col) }}</span>
                          </td>
                        }
                      </tr>
                      @if (selected() === c.className) {
                        <tr class="sp-delta">
                          <td [attr.colspan]="columns().length + 1">
                            @if (deltas().length === 0) {
                              <p class="sp-msg">{{ 'codex.swap.noDelta' | translate }}</p>
                            } @else {
                              <p class="dl-head">{{ 'codex.swap.delta' | translate }}</p>
                              <ul class="dl-list">
                                @for (d of deltas(); track d.key) {
                                  <li class="dd" [class.up]="(d.pct ?? 0) > 0" [class.down]="(d.pct ?? 0) < 0">
                                    <span class="dd-pct">{{ pctLabel(d) }}</span>
                                    <span class="dd-key">{{ d.key | translate }}</span>
                                    <span class="dd-vals">{{ d.from }} → {{ d.to }}</span>
                                  </li>
                                }
                              </ul>
                            }
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            }
          }

          <footer class="sp-foot">
            <div class="sp-counts">
              @if (candidates().length > 0) {
                <p class="sp-applies">
                  {{ (target()!.count > 1 ? 'codex.swap.appliesToMany' : 'codex.swap.appliesToOne')
                     | translate: { count: target()!.count, port: target()!.port } }}
                  ·
                  {{ 'codex.swap.matched' | translate: { shown: rows().length, total: candidates().length } }}
                </p>
                <p class="sp-sorthint">{{ 'codex.swap.sortHint' | translate }}</p>
              }
              @if (missingColumns(); as missing) {
                <p class="sp-missing">{{ 'codex.swap.missingColumns' | translate: { fields: missing } }}</p>
              }
            </div>
            <button type="button" class="sp-cancel" (click)="closed.emit()">
              {{ 'codex.swap.cancel' | translate }}
            </button>
          </footer>
        </article>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    .sp-backdrop { position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, 0.74);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      display: flex; justify-content: center; align-items: flex-start; padding: 4vh 16px 16px; overflow-y: auto; }
    .sp-panel { position: relative; width: 100%; max-width: 1180px; display: flex; flex-direction: column;
      gap: 12px; padding: 16px 18px 14px; max-height: 92vh;
      border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); animation: sp-in .18s ease; }
    @keyframes sp-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .sp-panel { animation: none; } }

    .sp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .sp-titles h2 { margin: 0; font-size: 1.02rem; display: flex; align-items: center; gap: 8px; }
    .sp-icon { color: var(--sc-accent); }
    .sp-sub { margin: 3px 0 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-1); overflow-wrap: anywhere; }
    .sp-port { color: var(--sc-fg-2); }
    .sp-close { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); cursor: pointer; font-size: 0.9rem; line-height: 1; }
    .sp-close:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .sp-hint { margin: 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .sp-msg { margin: 6px 0; font-size: 0.8rem; color: var(--sc-fg-2); }
    .sp-msg.err { color: var(--sc-danger, #ff5252); }

    /* search + the two pill groups */
    .sp-tools { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 18px; }
    .sp-search { flex: 1 1 240px; min-width: 180px; }
    .sp-search input { width: 100%; padding: 7px 10px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-0); font: inherit; font-size: 0.8rem; }
    .sp-search input:focus-visible { outline: none; border-color: var(--sc-accent); }
    /* A plain grouped div rather than fieldset/legend: a legend is rendered
       outside the flex flow, which breaks the pill row's wrapping. */
    .sp-group { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .sp-group-label { flex: 0 0 100%; padding-bottom: 3px; font-size: max(0.58rem, var(--sc-fs-floor)); letter-spacing: 0.07em;
      text-transform: uppercase; color: var(--sc-fg-2); }
    .pill { padding: 4px 10px; border-radius: 999px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      color: var(--sc-fg-1); font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer; display: inline-flex;
      align-items: center; gap: 5px; }
    .pill:hover { border-color: var(--sc-accent); }
    .pill.on { color: var(--sc-accent); border-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .pill-ct { font-size: max(0.6rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }

    .sp-scroll { overflow: auto; border-radius: 8px; border: 1px solid var(--sc-border); }
    .sp-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    .sp-table thead th { position: sticky; top: 0; z-index: 1; background: var(--sc-bg-1);
      border-bottom: 1px solid var(--sc-border); padding: 0; text-align: right; }
    .sp-table thead th.c-name { text-align: left; }
    .hd { width: 100%; padding: 6px 8px; background: transparent; border: none; color: var(--sc-fg-2);
      font: inherit; font-size: max(0.6rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase;
      cursor: pointer; text-align: inherit; white-space: nowrap; }
    .hd:hover { color: var(--sc-accent); }
    .hd-dir { color: var(--sc-accent); margin-left: 3px; }
    .derived { color: var(--sc-fg-2); }

    .sp-row { border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 55%, transparent); cursor: pointer; }
    .sp-row:hover { background: color-mix(in srgb, var(--sc-accent) 7%, transparent); }
    .sp-row.sel { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .sp-row.equipped { background: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 10%, transparent);
      box-shadow: inset 2px 0 0 var(--sc-accent-hot, #ff7a45); }

    td.c-name { padding: 0; }
    .pick { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 6px 8px;
      background: transparent; border: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pick-ident { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .pick-name { font-size: 0.8rem; color: var(--sc-fg-0); overflow-wrap: anywhere;
      display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .sp-row.equipped .pick-name { color: var(--sc-accent-hot, #ff7a45); }
    .pick-meta { font-size: max(0.64rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .size-tag { flex: 0 0 auto; font-size: max(0.62rem, var(--sc-fs-floor)); font-weight: 600; line-height: 1.5; padding: 1px 6px;
      border-radius: 4px; white-space: nowrap; color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .tag { font-size: max(0.54rem, var(--sc-fs-floor)); letter-spacing: 0.04em; text-transform: uppercase; padding: 0 5px;
      border-radius: 3px; background: var(--sc-bg-2); color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); white-space: nowrap; }
    .tag.dmg { color: var(--sc-accent-hot, #ff7a45);
      border-color: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 45%, transparent);
      background: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 10%, transparent); }
    .tag.eq { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent);
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }

    td.c-num { position: relative; padding: 6px 8px; text-align: right; font-size: max(0.76rem, var(--sc-fs-floor));
      color: var(--sc-fg-1); white-space: nowrap; }
    td.c-num.lead { color: var(--sc-fg-0); }
    /* Magnitude cue on the column the table is sorted by. */
    .bar { position: absolute; inset: 2px auto 2px 0; border-radius: 0 3px 3px 0;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .cell { position: relative; }

    .sp-delta td { padding: 8px 10px; background: var(--sc-bg-0);
      border-bottom: 1px solid var(--sc-border); }
    .dl-head { margin: 0 0 5px; font-size: max(0.62rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--sc-fg-2); }
    .dl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 3px 22px; }
    .dd { display: flex; align-items: baseline; gap: 7px; font-size: max(0.76rem, var(--sc-fs-floor)); }
    .dd-pct { min-width: 50px; text-align: right; font-family: var(--sc-font-display); color: var(--sc-fg-1); }
    .dd.up .dd-pct { color: #5fd698; }
    .dd.down .dd-pct { color: var(--sc-danger, #ff5252); }
    .dd-key { color: var(--sc-fg-0); }
    .dd-vals { color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); white-space: nowrap; }

    .sp-foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px;
      flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--sc-border); }
    .sp-counts p { margin: 0; }
    .sp-applies { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .sp-sorthint { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); margin-top: 2px !important; }
    .sp-missing { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; margin-top: 3px !important; }
    .sp-cancel { padding: 7px 16px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); cursor: pointer; }
    .sp-cancel:hover { border-color: var(--sc-accent); color: var(--sc-accent); }

    @media (max-width: 720px) {
      .sp-backdrop { padding: 0; }
      .sp-panel { max-width: none; min-height: 100%; max-height: none; border-radius: 0; }
    }
  `],
})
export class CodexSwapPickerComponent {
  private readonly svc = inject(CodexService);
  private readonly i18n = inject(TranslateService);

  /**
   * Signal-tracked UI language, so the one string this component resolves
   * outside a `| translate` pipe still re-renders on a language switch (#50).
   */
  private readonly lang = signal(this.i18n.currentLang);

  /** The hardpoint to explore; `null` renders nothing (closed). */
  readonly target = input<SwapTarget | null>(null);
  readonly closed = output<void>();

  readonly NAME_KEY = NAME_SORT_KEY;

  readonly loading = signal(false);
  readonly error = signal(false);
  readonly candidates = signal<SwapCandidate[]>([]);
  readonly filters = signal<SwapFilters>(EMPTY_SWAP_FILTERS);
  readonly sorts = signal<SwapSort[]>([]);
  readonly selected = signal<string | null>(null);
  readonly deltas = signal<StatDelta[]>([]);

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  /** What had focus before the dialog opened, so it can be handed back. */
  private returnFocus: HTMLElement | null = null;
  /** Guards against a slow response for a previous target overwriting a newer one. */
  private loadToken = 0;

  constructor() {
    this.i18n.onLangChange.pipe(takeUntilDestroyed()).subscribe((e) => this.lang.set(e.lang));

    effect(() => {
      const t = this.target();
      this.loadToken += 1;
      this.candidates.set([]);
      this.filters.set(EMPTY_SWAP_FILTERS);
      this.sorts.set([]);
      this.selected.set(null);
      this.deltas.set([]);
      this.error.set(false);
      if (t) {
        this.returnFocus = (globalThis.document?.activeElement as HTMLElement | null) ?? null;
        void this.load(t, this.loadToken);
      } else {
        this.restoreFocus();
      }
    });

    // Move focus INTO the dialog once its rows exist, so a keyboard user lands
    // on the search box instead of at the top of the page behind the backdrop.
    effect(() => {
      if (this.candidates().length > 0 || this.loading()) {
        queueMicrotask(() => this.search()?.nativeElement.focus());
      }
    });
  }

  // ── data ───────────────────────────────────────────────────────────────────

  private async load(t: SwapTarget, token: number): Promise<void> {
    this.loading.set(true);
    try {
      const installedName = t.className;
      const seedPayloads = installedName ? await this.svc.getEntityPayloads([installedName]) : null;
      const installed = installedName ? seedPayloads?.get(installedName) : undefined;
      const attachType = (installed?.payload as { attachType?: string | null } | undefined)?.attachType;
      const size =
        t.size ?? ((installed?.payload as { size?: number | null } | undefined)?.size ?? null);
      if (!attachType) {
        if (token === this.loadToken) this.candidates.set([]);
        return;
      }

      const items = await this.svc.getCompatibleItems({
        types: [attachType],
        minSize: size,
        maxSize: size,
      });
      // The installed item is a ROW here, not an exception: a pilot needs to see
      // where what they own already sits in the ranking.
      const names = items.map((i) => i.classNameSlug);
      if (installedName && !names.includes(installedName)) names.push(installedName);

      const payloads = await this.hydrate(names, (n) => this.svc.getEntityPayloads(n));
      const ammo = await this.hydrate(ammoClassNamesFor(names), (n) => this.svc.getAmmoPayloads(n));

      const rows = items.map((it) =>
        this.toCandidate(it, payloads, ammo, it.classNameSlug === installedName),
      );
      if (installedName && !items.some((i) => i.classNameSlug === installedName)) {
        const hit = payloads.get(installedName);
        if (hit) {
          rows.unshift(
            this.toCandidate(
              {
                kind: hit.kind,
                classNameSlug: installedName,
                nameLocalized: t.name,
                manufacturerCode: null,
                size: t.size,
                subType: (hit.payload as { subType?: string | null } | undefined)?.subType ?? null,
                grade: null,
              },
              payloads,
              ammo,
              true,
            ),
          );
        }
      }

      if (token !== this.loadToken) return; // a newer target won
      this.candidates.set(rows);
      this.sorts.set(defaultSwapSort(swapColumns(rows)));
    } catch {
      if (token === this.loadToken) this.error.set(true);
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  private toCandidate(
    it: CompatibleItem,
    payloads: Map<string, { kind: CodexKind; payload: unknown }>,
    ammo: Map<string, unknown>,
    equipped: boolean,
  ): SwapCandidate {
    const hit = payloads.get(it.classNameSlug);
    return buildSwapCandidate({
      className: it.classNameSlug,
      kind: hit?.kind ?? it.kind,
      nameLocalized: it.nameLocalized,
      manufacturerCode: it.manufacturerCode,
      size: it.size,
      grade: it.grade,
      subType: it.subType,
      payload: hit?.payload ?? null,
      ammoPayload: ammo.get(ammoClassNameFor(it.classNameSlug) ?? ''),
      equipped,
    });
  }

  /** Fetch in chunks — a single `in.()` with hundreds of class names is fragile. */
  private async hydrate<T>(
    names: string[],
    fetch: (chunk: string[]) => Promise<Map<string, T>>,
  ): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (let i = 0; i < names.length; i += HYDRATE_CHUNK) {
      const part = await fetch(names.slice(i, i + HYDRATE_CHUNK));
      for (const [k, v] of part) out.set(k, v);
    }
    return out;
  }

  // ── derived view state ─────────────────────────────────────────────────────

  readonly columns = computed<SwapColumn[]>(() => swapColumns(this.candidates()));

  readonly facets = computed(() => swapFacets(this.candidates()));

  readonly rows = computed<SwapCandidate[]>(() =>
    sortSwapCandidates(filterSwapCandidates(this.candidates(), this.filters()), this.sorts()),
  );

  /** The column the table is currently ordered by (drives the magnitude bars). */
  readonly primaryKey = computed<string | null>(() => this.sorts()[0]?.key ?? null);

  readonly bars = computed<Map<string, number | null>>(() => {
    const key = this.primaryKey();
    return key && key !== NAME_SORT_KEY
      ? swapColumnBars(this.rows(), key)
      : new Map<string, number | null>();
  });

  /**
   * The reference layout also lists fire rate, DPS, magazine, power draw, EM and
   * spread. Our 4.9.0 extract carries none of them for ship weapons, so instead
   * of twelve columns of "—" the table names what is missing once, in the
   * footer — the honest version of an empty column.
   */
  readonly missingColumns = computed<string | null>(() => {
    const have = new Set(this.columns().map((c) => c.key));
    const wanted = ['codex.equipped.dps', 'codex.equipped.fireRate'];
    const gaps = wanted.filter((k) => !have.has(k));
    if (this.candidates().length === 0 || gaps.length === 0) return null;
    // Re-read on a language switch, and name the stats the way the table would
    // have labelled their columns.
    this.lang();
    return gaps.map((k) => this.i18n.instant(k) as string).join(', ');
  });



  // ── interaction ────────────────────────────────────────────────────────────

  setQuery(ev: Event): void {
    const query = (ev.target as HTMLInputElement).value;
    this.filters.update((f) => ({ ...f, query }));
  }

  setDamage(value: string | null): void {
    this.filters.update((f) => pruneSwapFilters({ ...f, damage: value }, this.facets()));
  }

  setType(value: string | null): void {
    this.filters.update((f) => pruneSwapFilters({ ...f, type: value }, this.facets()));
  }

  /** Ctrl (or ⌘ on macOS) adds the column as a secondary sort instead of replacing. */
  sortBy(key: string, ev: MouseEvent): void {
    this.sorts.update((s) => toggleSwapSort(s, key, ev.ctrlKey || ev.metaKey));
  }

  sortMark(key: string): string {
    const at = this.sorts().findIndex((s) => s.key === key);
    if (at < 0) return '';
    const arrow = this.sorts()[at].dir === 'asc' ? '▲' : '▼';
    return this.sorts().length > 1 ? `${arrow}${at + 1}` : arrow;
  }

  ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    const hit = this.sorts().find((s) => s.key === key);
    return hit ? (hit.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  cell(candidate: SwapCandidate, column: SwapColumn): string {
    return swapCell(candidate, column);
  }

  /** "KLA · Laser Repeater · Grade A" — catalog data, so untranslated. */
  metaLine(c: SwapCandidate): string {
    return [c.manufacturerCode, c.typeLabel, c.grade].filter(Boolean).join(' · ');
  }

  pctLabel(d: StatDelta): string {
    if (d.pct === null) return '±';
    return d.pct > 0 ? `+${d.pct}%` : `${d.pct}%`;
  }

  /** Clicking anywhere on a row picks it; the name button handles its own click. */
  rowClick(c: SwapCandidate, ev: Event): void {
    if ((ev.target as HTMLElement | null)?.closest('button')) return;
    this.pick(c);
  }

  /** Preview a candidate against what is installed. Never persists anything. */
  pick(c: SwapCandidate): void {
    if (this.selected() === c.className) {
      this.selected.set(null);
      this.deltas.set([]);
      return;
    }
    this.selected.set(c.className);
    const installedName = this.target()?.className;
    const installed = this.candidates().find((x) => x.className === installedName);
    this.deltas.set(
      installed && installed.className !== c.className
        ? computeStatDeltas(swapStatRows(installed), swapStatRows(c))
        : [],
    );
  }

  // ── dialog behaviour ───────────────────────────────────────────────────────

  /**
   * ESC closes, Tab cycles inside the dialog. The trap is a plain wrap-around
   * over the panel's focusable children — no CDK overlay, so the ship page can
   * render the picker inline and it stays unit-testable.
   */
  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.closed.emit();
      return;
    }
    if (ev.key !== 'Tab') return;
    const focusable = this.focusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = globalThis.document?.activeElement as HTMLElement | null;
    if (ev.shiftKey && active === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  private focusable(): HTMLElement[] {
    const root = this.dialog()?.nativeElement;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled'));
  }

  private restoreFocus(): void {
    const el = this.returnFocus;
    this.returnFocus = null;
    if (el?.isConnected) el.focus();
  }
}
