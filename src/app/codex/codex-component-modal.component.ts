import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CodexKind } from './codex.service';
import {
  SpecSection,
  StatRow,
  curateComponentStats,
  flattenSpec,
  meaningfulRows,
} from './codex-format';
import {
  EquippedStat,
  damageChannelsOf,
  equippedStats,
  formatEquippedStat,
} from './codex-equipped-stats';
import { AmmunitionPayload, ComponentPayload, ItemPayload, WeaponPayload } from './codex.types';

/**
 * Everything the overlay needs about ONE hardpoint occupant. Assembled by the
 * ship detail page, which already holds the resolved payloads — the overlay
 * itself fetches nothing, so opening it can never fail or spin.
 */
export interface ComponentInspectEntry {
  className: string;
  kind: CodexKind | null;
  name: string;
  /** Humanized hardpoint label this thing sits on. */
  port: string;
  /** How many identical hardpoints carry it (≥1). */
  count: number;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  /** "Gun", "Quantum Drive", … — the engine type, humanized. */
  typeLabel: string | null;
  payload: unknown;
  /** Matching `<class>_AMMO` projectile payload for guns, when one exists. */
  ammoPayload?: unknown;
}

/**
 * Full stat sheet for a single installed component, in our own visual language
 * (admin request 461288f9: "wenn ich auf die Waffe drücke, soll sich ein
 * Fenster öffnen … vor allem die Tabelle mit allen Werten").
 *
 * Three tiers, widest-use first: the curated headline stats a pilot compares
 * on (damage / regen / jump range …), then the item's own parameter block, then
 * the complete flattened payload — every numeric field the extract carries,
 * nothing hidden behind a "raw JSON" toggle.
 *
 * Deliberately self-contained: a fixed-position overlay with its own backdrop
 * rather than a CDK portal, so the ship page can render it inline and the
 * component stays unit-testable without an overlay container.
 */
@Component({
  selector: 'sc-codex-component-modal',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entry(); as e) {
      <div class="cm-backdrop" (click)="closed.emit()">
        <article class="cm-panel sc-card" role="dialog" aria-modal="true"
                 [attr.aria-label]="e.name" (click)="$event.stopPropagation()">
          <header class="cm-head">
            <div class="cm-ident">
              @if (badge(); as b) { <span class="cm-size">{{ b }}</span> }
              <div class="cm-titles">
                <h2>{{ e.name }}</h2>
                <p class="cm-meta">
                  @if (metaLine(); as m) { <span class="cm-meta-txt">{{ m }}</span> }
                  @for (ch of channels(); track ch) {
                    <span class="chip dmg">{{ ('codex.damage.' + ch) | translate }}</span>
                  }
                  @if (e.grade) { <span class="chip">{{ e.grade }}</span> }
                </p>
                <p class="cm-port">{{ 'codex.inspect.hardpoint' | translate }}: {{ e.port }}</p>
              </div>
            </div>
            <button type="button" class="cm-close" (click)="closed.emit()"
                    [attr.aria-label]="'codex.inspect.close' | translate">✕</button>
          </header>

          @if (headline().length > 0) {
            <dl class="cm-headline">
              @for (st of headline(); track st.labelKey) {
                <div class="hs">
                  <dt>
                    {{ st.labelKey | translate }}
                    @if (st.derived) {
                      <span class="derived" [attr.title]="'codex.equipped.derivedHint' | translate">*</span>
                    }
                  </dt>
                  <dd>{{ fmtStat(st) }}</dd>
                </div>
              }
            </dl>
          }

          @if (paramRows().length > 0) {
            <section class="cm-block">
              <h3>{{ 'codex.inspect.parameters' | translate }}</h3>
              <table class="cm-table">
                <tbody>
                  @for (r of paramRows(); track r.key) {
                    <tr>
                      <td class="ct-key">{{ r.key }}</td>
                      <td class="ct-val">{{ r.value }}@if (r.unit) {<span class="ct-unit"> {{ r.unit }}</span>}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          @for (sec of specSections(); track sec.title) {
            <section class="cm-block">
              <h3>{{ sec.title || ('codex.inspect.general' | translate) }}</h3>
              <table class="cm-table">
                <tbody>
                  @for (r of sec.rows; track r.key) {
                    <tr>
                      <td class="ct-key">{{ r.key }}</td>
                      <td class="ct-val">{{ r.value }}@if (r.unit) {<span class="ct-unit"> {{ r.unit }}</span>}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          @for (sec of ammoSections(); track sec.title) {
            <section class="cm-block ammo">
              <h3>{{ 'codex.inspect.projectile' | translate }}@if (sec.title) { — {{ sec.title }} }</h3>
              <table class="cm-table">
                <tbody>
                  @for (r of sec.rows; track r.key) {
                    <tr>
                      <td class="ct-key">{{ r.key }}</td>
                      <td class="ct-val">{{ r.value }}@if (r.unit) {<span class="ct-unit"> {{ r.unit }}</span>}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }

          @if (isEmpty()) {
            <p class="cm-empty">{{ 'codex.inspect.noStats' | translate }}</p>
          }

          <footer class="cm-foot">
            @if (e.kind) {
              <a class="cm-open" [routerLink]="['/codex', e.kind, e.className]" (click)="closed.emit()">
                {{ 'codex.inspect.openDetail' | translate }} →
              </a>
            }
            <code class="cm-cls">{{ e.className }}</code>
          </footer>
        </article>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .cm-backdrop {
      position: fixed; inset: 0; z-index: 140;
      background: rgba(0, 0, 0, 0.72);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      display: flex; justify-content: center; align-items: flex-start;
      padding: 6vh 16px 16px; overflow-y: auto;
    }
    .cm-panel {
      position: relative; width: 100%; max-width: 760px;
      display: flex; flex-direction: column; gap: 14px; padding: 18px 20px 20px;
      border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent);
      animation: cm-in .18s ease;
    }
    @keyframes cm-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .cm-panel { animation: none; } }

    .cm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .cm-ident { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
    .cm-size { flex: 0 0 auto; font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600; line-height: 1.5;
      padding: 2px 8px; border-radius: 4px; white-space: nowrap; font-variant-numeric: tabular-nums;
      color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .cm-titles { min-width: 0; }
    .cm-titles h2 { margin: 0; font-size: 1.05rem; line-height: 1.2; overflow-wrap: anywhere; }
    .cm-meta { margin: 4px 0 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cm-meta-txt { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .cm-port { margin: 4px 0 0; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .chip { font-size: max(0.58rem, var(--sc-fs-floor)); letter-spacing: 0.04em; text-transform: uppercase;
      padding: 0 5px; border-radius: 3px; background: var(--sc-bg-2); color: var(--sc-fg-2);
      border: 1px solid var(--sc-border); white-space: nowrap; }
    /* Same rule as the module row it opens from: the hot accent means
       "elevated access" and is banned on the ship page (concept section 0). */
    .chip.dmg { color: var(--sc-warn);
      border-color: color-mix(in srgb, var(--sc-warn) 45%, transparent);
      background: color-mix(in srgb, var(--sc-warn) 10%, transparent); }
    .cm-close { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      cursor: pointer; font-size: 0.9rem; line-height: 1; }
    .cm-close:hover { border-color: var(--sc-accent); color: var(--sc-accent); }

    .cm-headline { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); display: flex; flex-wrap: wrap; gap: 6px 20px; }
    .cm-headline .hs { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .cm-headline dt { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .cm-headline dd { margin: 0; font-size: 0.86rem; color: var(--sc-accent);
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .derived { color: var(--sc-fg-2); cursor: help; }

    .cm-block h3 { margin: 0 0 6px; font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--sc-fg-2); }
    .cm-block.ammo h3 { color: var(--sc-warn); }
    .cm-table { width: 100%; border-collapse: collapse; }
    .cm-table tr { border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .cm-table tr:last-child { border-bottom: none; }
    .ct-key { padding: 3px 10px 3px 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .ct-val { padding: 3px 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-0); text-align: right;
      white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ct-unit { color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); }

    .cm-empty { margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .cm-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--sc-border); }
    .cm-open { font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-accent); text-decoration: none; }
    .cm-open:hover { text-decoration: underline; }
    .cm-cls { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace);
      overflow-wrap: anywhere; }

    @media (max-width: 640px) {
      .cm-backdrop { padding: 0; }
      .cm-panel { max-width: none; min-height: 100%; border-radius: 0; }
    }
  `],
})
export class CodexComponentModalComponent {
  /** The occupant to inspect; `null` renders nothing (closed). */
  readonly entry = input<ComponentInspectEntry | null>(null);
  readonly closed = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.entry()) this.closed.emit();
  }

  /** "3× S3" / "S3" / "3×" — never a guessed size. */
  badge(): string | null {
    const e = this.entry();
    if (!e) return null;
    if (e.size == null) return e.count > 1 ? `${e.count}×` : null;
    return e.count > 1 ? `${e.count}× S${e.size}` : `S${e.size}`;
  }

  /** "KLA · Gun" — catalog data, so untranslated like everywhere else. */
  metaLine(): string {
    const e = this.entry();
    if (!e) return '';
    return [e.manufacturerCode, e.typeLabel].filter(Boolean).join(' · ');
  }

  readonly channels = computed<string[]>(() => {
    const e = this.entry();
    return e ? damageChannelsOf(e.payload, e.ammoPayload) : [];
  });

  /** The curated stats for this occupant's type — the same the rows show. */
  readonly headline = computed<EquippedStat[]>(() => {
    const e = this.entry();
    if (!e) return [];
    return equippedStats({ kind: e.kind, payload: e.payload, ammoPayload: e.ammoPayload });
  });

  /** The item's own parameter block (weaponParams / curated component stats). */
  readonly paramRows = computed<StatRow[]>(() => {
    const e = this.entry();
    if (!e?.payload) return [];
    const entityKind = (e.payload as { entityKind?: string }).entityKind ?? e.kind ?? '';
    if (entityKind === 'weapon') {
      return meaningfulRows((e.payload as WeaponPayload).weaponParams);
    }
    if (entityKind === 'component') {
      return curateComponentStats((e.payload as ComponentPayload).stats);
    }
    return curateComponentStats((e.payload as ItemPayload).stats);
  });

  /** Every remaining field of the payload — the "table with all values". */
  readonly specSections = computed<SpecSection[]>(() => {
    const e = this.entry();
    return e?.payload ? flattenSpec(e.payload) : [];
  });

  /** The projectile's numbers, where a gun resolves to one. */
  readonly ammoSections = computed<SpecSection[]>(() => {
    const e = this.entry();
    const ammo = e?.ammoPayload as AmmunitionPayload | undefined;
    return ammo ? flattenSpec(ammo) : [];
  });

  readonly isEmpty = computed(
    () =>
      this.headline().length === 0 &&
      this.paramRows().length === 0 &&
      this.specSections().length === 0 &&
      this.ammoSections().length === 0,
  );

  fmtStat(stat: EquippedStat): string {
    return formatEquippedStat(stat);
  }
}
