import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CodexListRow, CodexService } from '../codex/codex.service';
import { AnalyticsService } from '../core/analytics.service';
import { HangarService } from './hangar.service';

/**
 * Hangar import from a user-provided export file (#136, option 3).
 *
 * Reads a Hangar Transfer Format JSON export (docs.starcitizen.fans — the
 * format HangarXPLOR and friends emit: the user runs the export themselves
 * in their browser). We NEVER touch RSI credentials or scrape the RSI
 * account — the file is the only input. Entries are matched to the codex
 * catalog (exact ship_code first, name search as fuzzy fallback), previewed
 * with their match state, and only user-confirmed rows are added.
 *
 * The same matching + confirm UI is reused for the browser-extension handover
 * (`preloadedRows`, see browser-extension/README.md): the extension emits rows
 * in the same shape, so there is exactly one import code path.
 */
interface ImportEntry {
  /** display name from the file (core `name` = ship type) */
  sourceName: string;
  /** user's nickname from `ship_name` when it differs from the type name */
  customName: string | null;
  /** raw ship_code from the file, if any */
  shipCode: string | null;
  match: CodexListRow | null;
  matchKind: 'exact' | 'fuzzy' | null;
  alreadyInHangar: boolean;
  selected: boolean;
}

const MAX_ENTRIES = 200;

@Component({
  selector: 'sc-hangar-import',
  standalone: true,
  imports: [TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="import sc-card"
         [class.drag]="dragActive()"
         [class.embedded]="embedded()"
         (dragover)="onDragOver($event)"
         (dragleave)="dragActive.set(false)"
         (drop)="onDrop($event)">
      @if (!embedded()) {
        <div class="head">
          <h3>{{ 'hangar.import.title' | translate }}</h3>
          <button type="button" class="close" (click)="closed.emit()"
                  [attr.aria-label]="'hangar.import.close' | translate">✕</button>
        </div>
        <p class="hint">{{ 'hangar.import.hint' | translate }}</p>
        <!-- Discovery: the extension is the no-file path to the same screen -->
        <p class="hint">
          <a routerLink="/tools/extension">{{ 'extension.hangarHint' | translate }}</a>
        </p>
      }

      @if (entries().length === 0 && !embedded()) {
        <div class="pick">
          <button type="button" class="sc-btn" (click)="fileInput.click()" [disabled]="parsing()">
            {{ (parsing() ? 'hangar.import.parsing' : 'hangar.import.pickFile') | translate }}
          </button>
          <span class="pick-hint">{{ 'hangar.import.dropHint' | translate }}</span>
        </div>
      }
      @if (embedded() && parsing()) {
        <p class="hint">{{ 'hangar.import.parsing' | translate }}</p>
      }
      <input #fileInput type="file" accept=".json,application/json" hidden
             (change)="onFileInput($event)" />

      @if (parseError(); as err) {
        <div class="err">{{ err | translate }}</div>
      }

      @if (entries().length > 0) {
        <div class="summary-row">
          <span>{{ 'hangar.import.matched' | translate: { matched: matchedCount(), total: entries().length } }}</span>
          @if (!embedded()) {
            <button type="button" class="link-btn" (click)="reset()">{{ 'hangar.import.chooseOther' | translate }}</button>
          }
        </div>
        <ul class="rows">
          @for (e of entries(); track $index) {
            <li class="row" [class.disabled]="!e.match || e.alreadyInHangar">
              <label>
                <input type="checkbox"
                       [checked]="e.selected"
                       [disabled]="!e.match || e.alreadyInHangar"
                       (change)="toggle($index)" />
                <span class="src">{{ e.sourceName }}</span>
                @if (e.customName) { <span class="nick">„{{ e.customName }}"</span> }
              </label>
              <span class="state">
                @if (e.alreadyInHangar) {
                  <span class="badge muted">{{ 'hangar.add.already' | translate }}</span>
                } @else if (e.match && e.matchKind === 'exact') {
                  <span class="badge ok">{{ 'hangar.import.exact' | translate }}</span>
                } @else if (e.match) {
                  <span class="badge fuzzy">{{ 'hangar.import.fuzzy' | translate: { name: matchName(e) } }}</span>
                } @else {
                  <span class="badge miss">{{ 'hangar.import.noMatch' | translate }}</span>
                }
              </span>
            </li>
          }
        </ul>
        <div class="actions">
          <button type="button" class="sc-btn sc-btn-primary"
                  [disabled]="selectedCount() === 0 || importing()"
                  (click)="runImport()">
            {{ (importing() ? 'hangar.import.importing' : 'hangar.import.confirm') | translate: { count: selectedCount() } }}
          </button>
          @if (doneCount() > 0) {
            <span class="done-note">{{ 'hangar.import.done' | translate: { count: doneCount() } }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .import { display: flex; flex-direction: column; gap: 10px; border-color: var(--sc-accent); }
    .import.embedded { border: 0; background: transparent; padding: 0; }
    .import.drag { background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-1)); }
    .head { display: flex; justify-content: space-between; align-items: center; }
    .head h3 { margin: 0; font-size: 0.95rem; font-family: var(--sc-font-display); letter-spacing: 0.04em; }
    .close { background: transparent; border: 0; color: var(--sc-fg-2); cursor: pointer; }
    .close:hover { color: var(--sc-fg-0); }
    .hint { color: var(--sc-fg-2); font-size: 0.8rem; margin: 0; line-height: 1.5; }
    .pick { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .pick-hint { color: var(--sc-fg-2); font-size: 0.75rem; }
    .err { color: var(--sc-danger); font-size: 0.82rem; }
    .summary-row { display: flex; justify-content: space-between; align-items: center; gap: 12px;
      font-size: 0.8rem; color: var(--sc-fg-1); }
    .link-btn { background: transparent; border: 0; color: var(--sc-accent); cursor: pointer; font-size: 0.76rem; }
    .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px;
      max-height: 320px; overflow-y: auto; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 6px 8px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .row.disabled { opacity: 0.65; }
    .row label { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
    .row input { accent-color: var(--sc-accent); }
    .src { font-size: 0.85rem; color: var(--sc-fg-0); }
    .nick { font-size: 0.76rem; color: var(--sc-fg-2); font-style: italic; }
    .badge { font-size: 0.62rem; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
      border: 1px solid var(--sc-border); color: var(--sc-fg-2); }
    .badge.ok { color: var(--sc-success); border-color: color-mix(in srgb, var(--sc-success) 50%, transparent); }
    .badge.fuzzy { color: #f0b35c; border-color: color-mix(in srgb, #f0b35c 50%, transparent); }
    .badge.miss { color: var(--sc-danger); border-color: color-mix(in srgb, var(--sc-danger) 50%, transparent); }
    .badge.muted { font-style: italic; }
    .actions { display: flex; align-items: center; gap: 12px; }
    .sc-btn-primary { background: var(--sc-accent); color: var(--sc-bg-0); border-color: var(--sc-accent); }
    .done-note { color: var(--sc-success); font-size: 0.8rem; }
  `],
})
export class HangarImportComponent {
  private readonly codex = inject(CodexService);
  private readonly hangar = inject(HangarService);
  private readonly analytics = inject(AnalyticsService);

  /**
   * Rows supplied from outside instead of a picked file — the browser
   * extension's hangar handover. Same shape as a Hangar Transfer Format entry.
   */
  readonly preloadedRows = input<readonly unknown[] | null>(null);
  /** Embedded mode: the host page owns the framing, so hide card chrome + picker. */
  readonly embedded = input(false);

  readonly closed = output<void>();
  /** Number of ships actually written, emitted after a confirmed import. */
  readonly imported = output<number>();

  readonly entries = signal<ImportEntry[]>([]);
  readonly parsing = signal(false);
  readonly importing = signal(false);
  readonly parseError = signal<string | null>(null);
  readonly dragActive = signal(false);
  readonly doneCount = signal(0);

  constructor() {
    // untracked: buildEntries reads hangar.ships(), which would otherwise
    // become an effect dependency and re-run the import on every hangar write.
    effect(() => {
      const rows = this.preloadedRows();
      if (rows && rows.length > 0) untracked(() => void this.loadRows(rows));
    });
  }

  matchedCount(): number {
    return this.entries().filter((e) => e.match).length;
  }
  selectedCount(): number {
    return this.entries().filter((e) => e.selected).length;
  }
  matchName(e: ImportEntry): string {
    return e.match?.nameLocalized ?? e.match?.classNameSlug ?? '';
  }

  onDragOver(ev: DragEvent): void {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    ev.preventDefault();
    this.dragActive.set(true);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragActive.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) void this.parseFile(file);
  }

  onFileInput(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.parseFile(file);
  }

  toggle(index: number): void {
    this.entries.set(
      this.entries().map((e, i) => (i === index ? { ...e, selected: !e.selected } : e)),
    );
  }

  reset(): void {
    this.entries.set([]);
    this.parseError.set(null);
    this.doneCount.set(0);
  }

  private async parseFile(file: File): Promise<void> {
    this.parsing.set(true);
    this.parseError.set(null);
    this.doneCount.set(0);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const list = Array.isArray(json) ? json : null;
      if (!list) throw new Error('not-array');
      await this.buildEntries(list);
    } catch (err) {
      const code = (err as Error).message;
      this.parseError.set(
        code === 'not-array' || code === 'no-ships'
          ? 'hangar.import.errNoShips'
          : 'hangar.import.errParse',
      );
    } finally {
      this.parsing.set(false);
    }
  }

  /** Load rows handed in by the browser extension (no file involved). */
  async loadRows(list: readonly unknown[]): Promise<void> {
    this.parsing.set(true);
    this.parseError.set(null);
    this.doneCount.set(0);
    try {
      await this.buildEntries(list);
    } catch {
      this.parseError.set('hangar.import.errNoShips');
    } finally {
      this.parsing.set(false);
    }
  }

  private async buildEntries(list: readonly unknown[]): Promise<void> {
    {
      // Tolerant extraction: HTF core `name` is the ship type; `ship_code`
      // (e.g. ANVL_Carrack) matches our classNameSlug convention directly.
      const rawEntries = list
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .filter((r) => !r['entity_type'] || r['entity_type'] === 'ship')
        .slice(0, MAX_ENTRIES);
      if (rawEntries.length === 0) throw new Error('no-ships');

      const inHangar = new Set(this.hangar.ships().map((s) => s.shipClassName));
      const codes = [
        ...new Set(
          rawEntries
            .map((r) => (typeof r['ship_code'] === 'string' ? (r['ship_code'] as string) : ''))
            .filter(Boolean),
        ),
      ];
      const exact = codes.length ? await this.codex.getShipsByClassNames(codes) : new Map<string, CodexListRow>();

      const entries: ImportEntry[] = [];
      for (const r of rawEntries) {
        const sourceName = str(r['name']) || str(r['ship_name']) || str(r['ship_code']) || '?';
        const shipCode = str(r['ship_code']) || null;
        const nick = str(r['ship_name']);
        let match: CodexListRow | null = shipCode ? (exact.get(shipCode) ?? null) : null;
        let matchKind: ImportEntry['matchKind'] = match ? 'exact' : null;
        if (!match && sourceName !== '?') {
          // Fuzzy fallback: catalog name search, first hit wins — the preview
          // shows the resolved name so the user can deselect bad matches.
          try {
            const res = await this.codex.listByKind('ship', { search: sourceName, limit: 1 });
            match = res.rows[0] ?? null;
            matchKind = match ? 'fuzzy' : null;
          } catch {
            /* search unavailable → entry stays unmatched */
          }
        }
        const already = !!match && inHangar.has(match.classNameSlug);
        entries.push({
          sourceName,
          customName: nick && nick.toLowerCase() !== sourceName.toLowerCase() ? nick : null,
          shipCode,
          match,
          matchKind,
          alreadyInHangar: already,
          selected: !!match && !already,
        });
      }
      this.entries.set(entries);
    }
  }

  async runImport(): Promise<void> {
    if (this.importing()) return;
    this.importing.set(true);
    let done = 0;
    const next = [...this.entries()];
    for (let i = 0; i < next.length; i++) {
      const e = next[i];
      if (!e.selected || !e.match || e.alreadyInHangar) continue;
      const ship = await this.hangar.addShip(e.match.classNameSlug, 'owned');
      if (ship) {
        if (e.customName) await this.hangar.updateShip(ship.id, { customName: e.customName });
        next[i] = { ...e, selected: false, alreadyInHangar: true };
        done++;
      }
    }
    this.entries.set(next);
    this.doneCount.set(done);
    this.importing.set(false);
    if (done > 0) {
      this.analytics.capture('hangar_fleet_imported', {
        ships_imported: done,
        total_in_file: next.length,
        source: this.embedded() ? 'extension' : 'file',
      });
    }
    this.imported.emit(done);
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
