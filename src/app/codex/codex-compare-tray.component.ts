import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexDetail, CodexKind, CodexService, pickLocalized } from './codex.service';
import {
  CompareColumn,
  CompareTableRow,
  buildCompareTable,
  cleanLocaleValue,
  collectCompareAttributes,
} from './codex-format';

interface PinnedRef {
  key: string;
  kind: CodexKind;
  className: string;
}

/**
 * Floating compare tray. Collapsed, it shows the pinned entities (max 4) as
 * removable chips. Expanded, it renders a real side-by-side stat table built
 * from each pinned entity's detail — the union of comparable attributes, with
 * empty cells where an entity has no value. Stays in sync via the CodexService
 * compare signal so pins survive navigation.
 */
@Component({
  selector: 'sc-codex-compare-tray',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (refs().length > 0) {
      <aside class="tray" [class.expanded]="open()" aria-live="polite">
        <div class="bar">
          <span class="tray-label">{{ 'codex.compare.tray' | translate: { count: refs().length } }}</span>
          <ul class="chips">
            @for (r of refs(); track r.key) {
              <li class="chip">
                <a [routerLink]="['/codex', r.kind, r.className]" class="chip-link">{{ chipName(r) }}</a>
                <button type="button" class="chip-x" (click)="remove(r.key)"
                        [attr.aria-label]="'codex.compare.remove' | translate">×</button>
              </li>
            }
          </ul>
          @if (refs().length >= 2) {
            <button type="button" class="toggle" (click)="toggle()">
              {{ (open() ? 'codex.compare.close' : 'codex.compare.open') | translate }}
            </button>
          }
          <button type="button" class="clear" (click)="clear()">{{ 'codex.compare.clear' | translate }}</button>
        </div>

        @if (open() && refs().length >= 2) {
          <div class="panel">
            @if (loading()) {
              <p class="muted">{{ 'codex.results.loading' | translate }}</p>
            } @else {
              <table class="cmp">
                <thead>
                  <tr>
                    <th class="rowhead">{{ 'codex.compare.property' | translate }}</th>
                    @for (c of columns(); track c.key) {
                      <th>
                        <a [routerLink]="['/codex', c.kind, c.className]" class="col-link">{{ c.name }}</a>
                        <span class="col-kind">{{ ('codex.kindSingular.' + c.kind) | translate }}</span>
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of tableRows(); track row.id) {
                    <tr>
                      <td class="rowhead">{{ row.labelKey ? (row.labelKey | translate) : row.label }}</td>
                      @for (v of row.values; track $index) {
                        <td [class.na]="v === null">{{ v === null ? '—' : v }}</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
              @if (tableRows().length === 0) {
                <p class="muted">{{ 'codex.compare.noCommon' | translate }}</p>
              }
            }
          </div>
        }
      </aside>
    }
  `,
  styles: [`
    .tray {
      position: fixed; left: 50%; transform: translateX(-50%);
      bottom: 18px; z-index: 40;
      max-width: min(1100px, calc(100vw - 32px));
      border-radius: 12px;
      background: color-mix(in srgb, var(--sc-bg-2) 94%, transparent);
      border: 1px solid var(--sc-accent);
      box-shadow: 0 8px 30px rgba(0,0,0,0.5), 0 0 22px color-mix(in srgb, var(--sc-accent) 30%, transparent);
      backdrop-filter: blur(10px);
    }
    .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 14px; }
    .tray-label {
      font-family: var(--sc-font-display); font-size: 0.74rem; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--sc-accent); white-space: nowrap;
    }
    .chips { list-style: none; display: flex; gap: 6px; flex-wrap: wrap; margin: 0; padding: 0; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 4px 3px 10px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border); font-size: 0.76rem;
    }
    .chip-link { color: var(--sc-fg-0); text-decoration: none; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip-link:hover { color: var(--sc-accent); }
    .chip-x { border: none; background: transparent; color: var(--sc-fg-2); cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 0 4px; border-radius: 50%; }
    .chip-x:hover { color: var(--sc-danger); }
    .toggle { padding: 5px 14px; border-radius: 6px; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; }
    .toggle:hover { background: color-mix(in srgb, var(--sc-accent) 26%, transparent); }
    .clear { margin-left: auto; padding: 5px 12px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: 0.74rem; cursor: pointer; }
    .clear:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .panel { border-top: 1px solid var(--sc-border); padding: 12px 14px; max-height: min(60vh, 460px); overflow: auto; }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.84rem; }
    .cmp { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .cmp th, .cmp td { padding: 6px 10px; text-align: left; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); white-space: nowrap; }
    .cmp thead th { position: sticky; top: 0; background: var(--sc-bg-2); }
    .cmp .rowhead { color: var(--sc-fg-2); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; position: sticky; left: 0; background: var(--sc-bg-2); }
    .cmp tbody .rowhead { background: color-mix(in srgb, var(--sc-bg-1) 92%, transparent); }
    .col-link { display: block; color: var(--sc-accent); text-decoration: none; font-family: var(--sc-font-display); }
    .col-link:hover { text-decoration: underline; }
    .col-kind { display: block; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .cmp td.na { color: var(--sc-fg-2); }
  `],
})
export class CodexCompareTrayComponent {
  private readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);

  readonly open = signal(false);
  readonly loading = signal(false);
  private readonly details = signal<CodexDetail[]>([]);

  readonly refs = computed<PinnedRef[]>(() =>
    this.svc.compareKeys().map((key) => {
      const idx = key.indexOf(':');
      return {
        key,
        kind: key.slice(0, idx) as CodexKind,
        className: key.slice(idx + 1),
      };
    }),
  );

  constructor() {
    // Re-fetch details whenever the panel is open and the pinned set changes.
    effect(() => {
      const refs = this.refs();
      if (!this.open() || refs.length < 2) {
        this.details.set([]);
        return;
      }
      void this.loadDetails(refs);
    });
  }

  private async loadDetails(refs: PinnedRef[]): Promise<void> {
    this.loading.set(true);
    try {
      const loaded = await Promise.all(refs.map((r) => this.svc.getDetail(r.kind, r.className)));
      this.details.set(loaded.filter((d): d is CodexDetail => !!d));
    } catch {
      this.details.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  readonly columns = computed<CompareColumn[]>(() =>
    this.details().map((d) => ({
      key: `${d.kind}:${d.classNameSlug}`,
      name: this.entityName(d),
      kind: d.kind,
      className: d.classNameSlug,
    })),
  );

  readonly tableRows = computed<CompareTableRow[]>(() => {
    const ds = this.details();
    if (ds.length < 2) return [];
    const perEntity = ds.map((d) =>
      collectCompareAttributes({ kind: d.kind, payload: d.payload, row: d.row, ports: d.ports }),
    );
    return buildCompareTable(this.columns(), perEntity);
  });

  /** English SC name (SC has no real translations — see detail view). */
  private entityName(d: CodexDetail): string {
    const p = d.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const en = p?.name ? pickLocalized(p.name, 'en') : '';
    return en || cleanLocaleValue(d.row['name_localized'] as string) || d.classNameSlug;
  }

  chipName(r: PinnedRef): string {
    const found = this.details().find((d) => d.kind === r.kind && d.classNameSlug === r.className);
    return found ? this.entityName(found) : r.className;
  }

  toggle(): void {
    this.open.update((v) => !v);
  }
  remove(key: string): void {
    this.svc.unpin(key);
  }
  clear(): void {
    this.svc.clearCompare();
    this.open.set(false);
  }
}
