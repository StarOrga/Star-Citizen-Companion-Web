import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CompatibleItem, CodexKind, CodexService } from './codex.service';
import { ComponentPayload, WeaponPayload } from './codex.types';
import {
  StatDelta,
  StatRow,
  computeStatDeltas,
  curateComponentStats,
  meaningfulRows,
} from './codex-format';
import { LayoutSlot } from './codex-hardpoint-layout.component';

/**
 * Swap-preview dock (loadout ladder Rung 2): for a filled loadout slot,
 * lists what else fits (same attach type + size, via the compatibility RPC)
 * and previews the stat delta a swap would cause — WITHOUT persisting
 * anything. A sandbox to answer "what if", per iteration-2 §4.
 */
@Component({
  selector: 'sc-codex-swap-dock',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (slot(); as s) {
      <aside class="dock sc-card" role="dialog" [attr.aria-label]="'codex.swap.title' | translate">
        <header class="dk-head">
          <div>
            <h2>{{ 'codex.swap.title' | translate }}</h2>
            <p class="dk-sub">
              <span class="dk-port">{{ s.port }}</span> ·
              <span class="dk-installed">{{ 'codex.swap.installed' | translate }}: {{ s.name }}</span>
            </p>
          </div>
          <button type="button" class="dk-close" (click)="closed.emit()"
                  [attr.aria-label]="'codex.swap.close' | translate">×</button>
        </header>
        <p class="dk-hint">{{ 'codex.swap.previewHint' | translate }}</p>

        @if (loading()) {
          <p class="muted">{{ 'codex.swap.loading' | translate }}</p>
        } @else if (error(); as err) {
          <p class="err-inline">{{ err }}</p>
        } @else if (items().length === 0) {
          <p class="muted">{{ 'codex.swap.none' | translate }}</p>
        } @else {
          <ul class="dk-list">
            @for (it of items(); track it.classNameSlug) {
              <li class="dk-item" [class.sel]="selected()?.classNameSlug === it.classNameSlug">
                <button type="button" class="dk-pick" (click)="pick(it)">
                  <span class="dk-name">{{ it.nameLocalized || it.classNameSlug }}</span>
                  <span class="dk-chips">
                    @if (it.size != null) { <span class="chip">S{{ it.size }}</span> }
                    @if (it.grade) { <span class="chip">{{ it.grade }}</span> }
                    @if (it.manufacturerCode) { <span class="chip">{{ it.manufacturerCode }}</span> }
                  </span>
                </button>
                @if (selected()?.classNameSlug === it.classNameSlug) {
                  <div class="dk-delta">
                    @if (deltasLoading()) {
                      <p class="muted">{{ 'codex.swap.loading' | translate }}</p>
                    } @else if (deltas().length === 0) {
                      <p class="muted">{{ 'codex.swap.noDelta' | translate }}</p>
                    } @else {
                      <p class="dk-delta-head">{{ 'codex.swap.delta' | translate }}</p>
                      <ul class="dk-deltas">
                        @for (d of deltas(); track d.key) {
                          <li class="dd" [class.up]="(d.pct ?? 0) > 0" [class.down]="(d.pct ?? 0) < 0">
                            <span class="dd-pct">{{ d.pct === null ? '±' : (d.pct > 0 ? '+' + d.pct + '%' : d.pct + '%') }}</span>
                            <span class="dd-key">{{ d.key }}</span>
                            <span class="dd-vals">{{ d.from }} → {{ d.to }}@if (d.unit) { {{ d.unit }} }</span>
                          </li>
                        }
                      </ul>
                    }
                    <a class="dk-open" [routerLink]="['/codex', it.kind, it.classNameSlug]">
                      {{ 'codex.swap.openDetail' | translate }} →
                    </a>
                  </div>
                }
              </li>
            }
          </ul>
        }
      </aside>
    }
  `,
  styles: [`
    :host { display: block; }
    .dock { padding: 14px 16px; border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .dk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .dk-head h2 { margin: 0; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-accent); }
    .dk-sub { margin: 4px 0 0; font-size: 0.76rem; color: var(--sc-fg-1); }
    .dk-port { color: var(--sc-fg-2); }
    .dk-close { border: none; background: transparent; color: var(--sc-fg-2); font-size: 1.3rem; line-height: 1; cursor: pointer; padding: 2px 6px; }
    .dk-close:hover { color: var(--sc-danger); }
    .dk-hint { margin: 8px 0 12px; font-size: 0.7rem; color: var(--sc-fg-2); font-style: italic; }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.8rem; }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; margin: 0; }

    .dk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 380px; overflow: auto; }
    .dk-item { border-radius: 6px; border: 1px solid var(--sc-border); background: var(--sc-bg-1); overflow: hidden; }
    .dk-item.sel { border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .dk-pick { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 7px 10px; background: transparent; border: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .dk-pick:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .dk-name { font-size: 0.8rem; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .dk-chips { display: inline-flex; gap: 4px; flex-shrink: 0; }
    .chip { font-size: 0.6rem; padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-2); color: var(--sc-fg-2); border: 1px solid var(--sc-border); white-space: nowrap; }

    .dk-delta { padding: 8px 12px 10px; background: var(--sc-bg-0); border-top: 1px solid var(--sc-border); }
    .dk-delta-head { margin: 0 0 6px; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .dk-deltas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .dd { display: flex; align-items: baseline; gap: 8px; font-size: 0.78rem; }
    .dd-pct { min-width: 52px; text-align: right; font-family: var(--sc-font-display); color: var(--sc-fg-1); }
    .dd.up .dd-pct { color: #5fd698; }
    .dd.down .dd-pct { color: var(--sc-danger, #ff5252); }
    .dd-key { color: var(--sc-fg-0); flex: 1 1 auto; overflow-wrap: anywhere; }
    .dd-vals { color: var(--sc-fg-2); font-size: 0.72rem; white-space: nowrap; }
    .dk-open { display: inline-block; margin-top: 8px; font-size: 0.76rem; color: var(--sc-accent); text-decoration: none; }
    .dk-open:hover { text-decoration: underline; }
  `],
})
export class CodexSwapDockComponent {
  private readonly svc = inject(CodexService);

  /** The filled loadout slot to explore; null renders nothing (closed). */
  readonly slot = input<LayoutSlot | null>(null);
  readonly closed = output<void>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly items = signal<CompatibleItem[]>([]);
  readonly selected = signal<CompatibleItem | null>(null);
  readonly deltas = signal<StatDelta[]>([]);
  readonly deltasLoading = signal(false);

  // Installed item's curated stats — the delta baseline, loaded once per slot.
  private installedRows: StatRow[] = [];

  constructor() {
    effect(() => {
      const s = this.slot();
      // Reset + (re)load whenever a different slot opens.
      this.items.set([]);
      this.selected.set(null);
      this.deltas.set([]);
      this.error.set(null);
      this.installedRows = [];
      if (s?.className) void this.load(s);
    });
  }

  private async load(s: LayoutSlot): Promise<void> {
    this.loading.set(true);
    try {
      const payloads = await this.svc.getEntityPayloads([s.className!]);
      const installed = payloads.get(s.className!);
      const attachType = (installed?.payload as { attachType?: string | null } | undefined)
        ?.attachType;
      const size =
        s.size ?? ((installed?.payload as { size?: number | null } | undefined)?.size ?? null);
      this.installedRows = installed ? curatedRowsFor(installed.kind, installed.payload) : [];
      if (!attachType) {
        this.items.set([]);
        return;
      }
      const items = await this.svc.getCompatibleItems({
        types: [attachType],
        minSize: size,
        maxSize: size,
      });
      this.items.set(items.filter((it) => it.classNameSlug !== s.className));
    } catch (e) {
      this.error.set((e as Error).message ?? 'error');
    } finally {
      this.loading.set(false);
    }
  }

  async pick(it: CompatibleItem): Promise<void> {
    if (this.selected()?.classNameSlug === it.classNameSlug) {
      this.selected.set(null);
      return;
    }
    this.selected.set(it);
    this.deltas.set([]);
    this.deltasLoading.set(true);
    try {
      const payloads = await this.svc.getEntityPayloads([it.classNameSlug]);
      const cand = payloads.get(it.classNameSlug);
      const candRows = cand ? curatedRowsFor(cand.kind, cand.payload) : [];
      this.deltas.set(computeStatDeltas(this.installedRows, candRows));
    } catch {
      this.deltas.set([]);
    } finally {
      this.deltasLoading.set(false);
    }
  }
}

/** Same curation the detail view uses, picked by entity kind. */
function curatedRowsFor(kind: CodexKind, payload: unknown): StatRow[] {
  if (kind === 'component') {
    return curateComponentStats((payload as ComponentPayload | undefined)?.stats);
  }
  if (kind === 'weapon') {
    return meaningfulRows((payload as WeaponPayload | undefined)?.weaponParams);
  }
  return [];
}
