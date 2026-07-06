import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import {
  CodexKind,
  CodexService,
  CompatibleItem,
  PortQuery,
} from '../codex/codex.service';
import { humanizeClassName } from '../codex/codex-format';

/** What the picker hands back when the user chooses an entry. */
export interface PickedItem {
  className: string;
  kind: string;
  nameLocalized: string | null;
}

/**
 * Inline item picker, two modes:
 * - `port` set   → lists everything that FITS the hardpoint (compatible-items
 *                  RPC: accepted types + size range), filterable by text.
 * - `port` null  → free search across weapons/items (role-loadout editor);
 *                  `fpsOnly` restricts weapons to weapon_class='FPS'.
 */
@Component({
  selector: 'sc-hangar-item-picker',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker sc-card" (click)="$event.stopPropagation()">
      <div class="picker-head">
        <input
          class="search"
          type="search"
          [ngModel]="query()"
          (ngModelChange)="onQuery($event)"
          [attr.placeholder]="'hangar.picker.searchPlaceholder' | translate"
          [attr.aria-label]="'hangar.picker.searchPlaceholder' | translate" />
        <button type="button" class="close" (click)="closed.emit()"
                [attr.aria-label]="'hangar.picker.close' | translate">×</button>
      </div>

      @if (loading()) {
        <p class="state">{{ 'hangar.picker.loading' | translate }}</p>
      } @else if (results().length === 0) {
        <p class="state">
          {{ (port() ? 'hangar.picker.emptyPort' : 'hangar.picker.empty') | translate }}
        </p>
      } @else {
        <ul class="results" role="listbox">
          @for (r of results(); track r.classNameSlug) {
            <li>
              <button type="button" class="result" role="option" (click)="pick(r)">
                <span class="r-name">{{ r.nameLocalized || humanize(r.classNameSlug) }}</span>
                <span class="r-badges">
                  @if (r.manufacturerCode) { <span class="badge mfr">{{ r.manufacturerCode }}</span> }
                  <span class="badge subtle">{{ ('codex.kindSingular.' + r.kind) | translate }}</span>
                  @if (r.size != null) { <span class="badge">S{{ r.size }}</span> }
                  @if (r.grade) { <span class="badge">{{ r.grade }}</span> }
                </span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .picker { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
    .picker-head { display: flex; gap: 8px; align-items: center; }
    .search {
      flex: 1; padding: 8px 12px; border-radius: 6px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.86rem;
    }
    .search:focus { outline: none; border-color: var(--sc-accent); }
    .close { border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.3rem; cursor: pointer; line-height: 1; }
    .close:hover { color: var(--sc-danger); }
    .state { margin: 0; color: var(--sc-fg-2); font-size: 0.82rem; padding: 6px 2px; }
    .results { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .result {
      width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 6px; border: 1px solid transparent;
      background: var(--sc-bg-0); color: var(--sc-fg-0); cursor: pointer;
      font-family: inherit; font-size: 0.85rem; text-align: left;
    }
    .result:hover { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)); }
    .r-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .r-badges { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; flex-shrink: 0; }
    .badge { font-size: 0.62rem; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.mfr { background: color-mix(in srgb, var(--sc-accent-hot) 14%, transparent); border-color: color-mix(in srgb, var(--sc-accent-hot) 35%, transparent); }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
  `],
})
export class HangarItemPickerComponent implements OnInit {
  private readonly svc = inject(CodexService);

  /** Hardpoint constraints — when set, the picker is in port mode. */
  readonly port = input<PortQuery | null>(null);
  /** Free-search mode: restrict weapons to FPS class (role loadouts). */
  readonly fpsOnly = input(false);

  readonly picked = output<PickedItem>();
  readonly closed = output<void>();

  readonly query = signal('');
  readonly loading = signal(false);
  private readonly compat = signal<CompatibleItem[]>([]);
  private readonly searchResults = signal<CompatibleItem[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  readonly results = computed(() => {
    if (this.port()) {
      const q = this.query().trim().toLowerCase();
      const all = this.compat();
      if (!q) return all.slice(0, 60);
      return all
        .filter(
          (r) =>
            (r.nameLocalized ?? '').toLowerCase().includes(q) ||
            r.classNameSlug.toLowerCase().includes(q),
        )
        .slice(0, 60);
    }
    return this.searchResults();
  });

  async ngOnInit(): Promise<void> {
    const port = this.port();
    if (port) {
      this.loading.set(true);
      try {
        this.compat.set(await this.svc.getCompatibleItems(port));
      } catch {
        this.compat.set([]);
      } finally {
        this.loading.set(false);
      }
    } else {
      await this.runSearch('');
    }
  }

  humanize(cls: string): string {
    return humanizeClassName(cls);
  }

  onQuery(value: string): void {
    this.query.set(value);
    if (this.port()) return; // port mode filters client-side
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.runSearch(value), 250);
  }

  pick(r: CompatibleItem): void {
    this.picked.emit({
      className: r.classNameSlug,
      kind: r.kind,
      nameLocalized: r.nameLocalized,
    });
  }

  private async runSearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.loading.set(true);
    try {
      const queries: Promise<CompatibleItem[]>[] = [
        this.listAs('weapon', term, this.fpsOnly() ? 'FPS' : undefined),
        this.listAs('item', term),
      ];
      const [weapons, items] = await Promise.all(queries);
      if (seq !== this.searchSeq) return;
      this.searchResults.set([...weapons, ...items].slice(0, 40));
    } catch {
      if (seq === this.searchSeq) this.searchResults.set([]);
    } finally {
      if (seq === this.searchSeq) this.loading.set(false);
    }
  }

  private async listAs(
    kind: CodexKind,
    term: string,
    weaponClass?: string,
  ): Promise<CompatibleItem[]> {
    const res = await this.svc.listByKind(kind, {
      search: term || undefined,
      weaponClass,
      limit: 20,
    });
    return res.rows.map((r) => ({
      kind,
      classNameSlug: r.classNameSlug,
      nameLocalized: r.nameLocalized,
      manufacturerCode: r.manufacturerCode,
      size: r.size,
      subType: r.subType,
      grade: r.grade,
    }));
  }
}
