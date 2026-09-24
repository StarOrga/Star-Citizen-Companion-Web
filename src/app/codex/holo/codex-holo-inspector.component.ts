import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LayoutChild, LayoutSlot, LayoutTarget } from '../codex-hardpoint-layout.component';
import { CodexLoadoutSaveBarComponent } from '../codex-loadout-save-bar.component';
import { formatEquippedStat } from '../codex-equipped-stats';
import type { EquippedStat } from '../codex-equipped-stats';
import { displayItemName } from '../codex-format';
import type { PortPinBadge } from './codex-holo-patch.component';
import { JournalEntry, PinGroup } from './codex-holo-model';

/**
 * The Holotable's right panel body: the inspected hardpoint — occupant, its
 * first four values, what the mount carries, swap / open — and, while nothing
 * is inspected, the table's hardpoints as a list (grouped by block, numbered
 * like the pins), so the panel is never an empty box. Below either: the
 * change journal with the save bar.
 *
 * Purely presentational: the stage resolves the target and owns every write.
 */
@Component({
  selector: 'sc-codex-holo-inspector',
  standalone: true,
  imports: [TranslatePipe, CodexLoadoutSaveBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target(); as it) {
      <!-- Keyed on the port: every new pin re-enters with the card animation. -->
      @for (key of [inspectedPort()]; track key) {
        <div class="inspector" role="region" [attr.aria-label]="'codex.holo.stage.inspector' | translate">
          <div class="insp-head">
            @if (sizeBadge(it.slot); as b) { <span class="size-tag">{{ b }}</span> }
            <div class="insp-ident">
              <b>{{ it.slot.name ? itemName(it.slot.name) : ((it.slot.emptyLabelKey ?? 'codex.holo.stage.emptyBay') | translate) }}</b>
              <small>{{ meta(it.slot) }}</small>
            </div>
            <button type="button" class="inspector-close" (click)="closed.emit()"
                    [attr.aria-label]="'codex.swap.close' | translate"
                    [title]="('codex.swap.close' | translate) + ' (Esc)'">✕</button>
          </div>
          @if (patchPin(); as pin) {
            <!-- slot: patch-delta — the per-PORT occupant delta for the pin under inspection -->
            <p class="inspector-patch-delta" [class.unresolved]="pin.unresolved">
              {{ pin.fromClassName ?? '—' }} → {{ pin.unresolved ? ('codex.holo.pinUnresolved' | translate) : (pin.toClassName ?? '—') }}
            </p>
          }
          @if (stats(it.slot).length > 0) {
            <dl class="insp-stats">
              @for (st of stats(it.slot); track st.labelKey) {
                <div><dt>{{ st.labelKey | translate }}</dt><dd>{{ fmtStat(st) }}</dd></div>
              }
            </dl>
          }
          @if (it.slot.draftState; as ds) {
            <p class="insp-draft">
              <span class="tag draft" [class.pending]="ds === 'pending'" [class.unresolved]="ds === 'unresolved'">{{ ('codex.loadout.draftState.' + ds) | translate }}</span>
              @if (it.slot.draftPaths?.length) {
                <button type="button" class="lnk" (click)="reverted.emit(it.slot.draftPaths!)">{{ 'codex.loadout.revert' | translate }}</button>
              }
            </p>
          }
          @if (!isRawPort()) {
            <div class="insp-actions">
              <button type="button" class="btn" (click)="swapRequested.emit(it)">⇄ {{ 'codex.swap.open' | translate }}</button>
              <button type="button" class="btn quiet" (click)="inspected.emit(it)">{{ 'codex.inspect.openStats' | translate }}</button>
            </div>
          } @else {
            <p class="mut">{{ 'codex.holo.stage.rawPortHint' | translate }}</p>
          }
          <!-- What the mount carries (the gun in the gimbal, the missiles in
               the rack) — the thing that actually shoots. -->
          @for (kid of it.slot.children ?? []; track kid.port) {
            <div class="insp-kid" [class.empty]="!kid.className">
              <div class="insp-head">
                @if (kid.size != null) { <span class="size-tag">{{ kid.count > 1 ? kid.count + '×' : '' }}S{{ kid.size }}</span> }
                <div class="insp-ident">
                  <b>{{ kid.name ? itemName(kid.name) : '—' }}</b>
                  <small>{{ kidMeta(kid) }}</small>
                </div>
              </div>
              @if (kid.stats?.length) {
                <dl class="insp-stats">
                  @for (st of kid.stats!.slice(0, 4); track st.labelKey) {
                    <div><dt>{{ st.labelKey | translate }}</dt><dd>{{ fmtStat(st) }}</dd></div>
                  }
                </dl>
              }
              <div class="insp-actions">
                @if (kid.className || kid.rawTypes.length > 0) {
                  <button type="button" class="btn quiet" (click)="swapRequested.emit(childTarget(it, kid))">⇄ {{ 'codex.swap.open' | translate }}</button>
                }
                @if (kid.className) {
                  <button type="button" class="btn quiet" (click)="inspected.emit(childTarget(it, kid))">{{ 'codex.inspect.openStats' | translate }}</button>
                }
              </div>
            </div>
          }
        </div>
      }
    } @else if (pinGroups().length > 0) {
      <!-- Nothing inspected: the table's hardpoints as a list — the same
           numbers, hover lights the pin, a click inspects it. -->
      <div class="plist" role="region" [attr.aria-label]="'codex.holo.stage.pinListTitle' | translate">
        <p class="plist-hint">{{ 'codex.holo.stage.inspectorEmptyBody' | translate: { n: hotkeyPinCount() } }}</p>
        @for (g of pinGroups(); track g.key) {
          <div class="pgroup">
            <span class="pg-head">{{ g.labelKey | translate }}<i></i><em>{{ g.pins.length }}</em></span>
            @for (pin of g.pins; track pin.portName) {
              <button type="button" class="prow"
                      [class.gold]="pin.tone === 'gold'"
                      [class.active]="activePorts().includes(pin.portName)"
                      [style.--r]="$index"
                      (mouseenter)="hovered.emit([pin.portName])"
                      (mouseleave)="hovered.emit(null)"
                      (focus)="hovered.emit([pin.portName])"
                      (blur)="hovered.emit(null)"
                      (click)="pinInspect.emit(pin.portName)">
                <i aria-hidden="true">{{ pin.index }}</i>
                <span class="pr-name">{{ pin.label }}</span>
                @if (pin.short) { <em>{{ pin.short }}</em> }
              </button>
            }
          </div>
        }
      </div>
    } @else {
      <div class="empty">
        <b>{{ 'codex.holo.stage.inspectorEmptyTitle' | translate }}</b>
        {{ 'codex.holo.stage.noPorts' | translate }}
      </div>
    }

    <div class="card flat">
      <div class="h2"><span>{{ 'codex.holo.stage.journal' | translate }}</span><span class="rule"></span></div>
      @if (journal().length === 0) {
        <p class="mut">{{ 'codex.holo.stage.journalEmpty' | translate }}</p>
      } @else {
        <ul class="journal">
          @for (e of journal(); track e.port) {
            <li>
              <span class="j-label">{{ itemName(e.label) }}</span>
              <span class="j-state">{{ ('codex.loadout.draftState.' + e.state) | translate }}</span>
              <button type="button" class="lnk" (click)="reverted.emit(e.paths)">{{ 'codex.holo.stage.undo' | translate }}</button>
            </li>
          }
        </ul>
        <sc-codex-loadout-save-bar
          class="draft-controls"
          [changed]="draftChangedCount()"
          [saveable]="saveableCount()"
          [saving]="saving()"
          [error]="saveError()"
          [inHangar]="inHangar()"
          (save)="saveDraft.emit()"
          (discard)="discardDraft.emit()"
          (addAndSave)="saveDraft.emit()" />
        <button type="button" class="lnk" (click)="reverted.emit(journalAllPaths())">
          {{ 'codex.detail.actionFactoryLoadout' | translate }}
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: grid; gap: 10px; align-content: start; padding: 12px; min-width: 0;
      --f: var(--sc-fs-floor); --d: var(--sc-font-display); --m: var(--font-monospace, "Share Tech Mono", monospace);
      --e-out: cubic-bezier(0.2, 0.7, 0.2, 1); }
    .btn, .empty b, .insp-stats dt, .h2, .pg-head { font-family: var(--d); text-transform: uppercase; }
    .rule { flex: 1; height: 1px; background: var(--l1); }
    .lnk { background: none; border: none; padding: 0; color: var(--sc-accent); cursor: pointer; font: inherit;
      font-size: max(11px, var(--f)); min-height: var(--sc-tap-min, 24px); justify-self: start; }
    .lnk:hover { text-decoration: underline; }
    .btn { min-height: var(--sc-tap-min, 32px); padding: 5px 12px; border-radius: 3px; border: 1px solid var(--l2); background: var(--a10);
      color: var(--sc-fg-0); cursor: pointer; font-size: max(11px, var(--f)); letter-spacing: 0.08em;
      transition: border-color 160ms ease, color 160ms ease, background 160ms ease; }
    .btn.quiet { background: none; border-color: var(--l1); color: var(--sc-fg-1); }
    .btn:hover, .btn:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
    .empty { display: grid; place-items: center; text-align: center; gap: 8px; color: var(--sc-fg-2); padding: 40px 10px;
      border: 1px dashed var(--l2); border-radius: 4px; font-size: max(12px, var(--f)); }
    .empty b { font-size: max(11px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-1); font-weight: 400; }

    /* ── The inspected hardpoint ── */
    .inspector { display: grid; gap: 10px; padding: 10px 12px; border: 1px solid var(--sc-accent); border-radius: 4px; background: var(--ink);
      min-width: 0; box-shadow: 0 0 0 1px var(--a10), 0 8px 24px rgb(0 0 0 / 0.25);
      animation: insp-in 260ms var(--e-out) backwards; }
    @keyframes insp-in { from { opacity: 0; transform: translateY(6px); } }
    .insp-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .size-tag { font-family: var(--m); font-size: 10px; color: var(--sc-fg-2); border: 1px solid var(--l1); border-radius: 2px; padding: 1px 5px; flex: none; margin-top: 2px; }
    .insp-ident { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .insp-ident b { font-weight: 500; color: var(--sc-fg-0); font-size: max(13px, var(--f)); overflow-wrap: anywhere; }
    .insp-ident small { font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .inspector-close { background: none; border: none; color: var(--sc-fg-2); cursor: pointer; min-height: var(--sc-tap-min, 24px); min-width: 24px;
      padding: 0; flex: none; transition: color 160ms ease; }
    .inspector-close:hover { color: var(--sc-fg-0); }
    .inspector-patch-delta { margin: 0; font-size: max(11px, var(--f)); color: var(--sc-accent); font-family: var(--m); overflow-wrap: anywhere; }
    .inspector-patch-delta.unresolved { color: var(--sc-fg-2); font-style: italic; }
    /* minmax(0,1fr): a long label ("Geschossgeschwindigkeit") wraps inside its
       tile instead of pushing the card past the panel edge. */
    .insp-stats { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .insp-stats div { display: grid; gap: 1px; align-content: space-between; padding: 5px 8px; min-width: 0;
      background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); border-radius: 3px; }
    .insp-stats dt { font-size: max(8px, var(--f)); letter-spacing: 0.1em; color: var(--sc-fg-2); overflow-wrap: anywhere; hyphens: auto; }
    .insp-stats dd { margin: 0; font-family: var(--m); font-size: 13px; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .insp-draft { margin: 0; display: flex; align-items: center; gap: 8px; }
    .tag.draft { font-size: max(10px, var(--f)); color: var(--sc-accent); border: 1px solid var(--sc-accent); border-radius: 2px; padding: 1px 6px; }
    .tag.draft.pending { color: var(--sc-fg-2); border-color: var(--sc-fg-2); }
    .tag.draft.unresolved { color: var(--sc-warning); border-color: var(--sc-warning); }
    .insp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .insp-actions:empty { display: none; }
    .insp-kid { display: grid; gap: 8px; margin-inline-start: 10px; padding: 8px 0 0 10px; border-inline-start: 2px solid var(--a40); min-width: 0; }
    .insp-kid.empty .insp-ident b { color: var(--sc-fg-2); font-weight: 400; }
    .insp-kid .btn { padding: 3px 8px; min-height: var(--sc-tap-min, 26px); font-size: max(9.5px, var(--f)); }

    /* ── The hardpoint list (nothing inspected) ── */
    .plist { display: grid; gap: 10px; animation: list-in 280ms var(--e-out) backwards; }
    @keyframes list-in { from { opacity: 0; } }
    .plist-hint { margin: 0; font-size: max(11px, var(--f)); color: var(--sc-fg-2); line-height: 1.4; }
    .pgroup { display: grid; gap: 2px; }
    .pg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); }
    .pg-head i { flex: 1; height: 1px; background: var(--l1); }
    .pg-head em { font-style: normal; font-family: var(--m); letter-spacing: 0; color: var(--sc-fg-2); }
    .prow { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 4px 6px; border: 1px solid transparent; border-radius: 3px;
      background: none; color: var(--sc-fg-1); cursor: pointer; font: inherit; font-size: max(11.5px, var(--f)); text-align: start;
      min-height: var(--sc-tap-min, 28px); --pc: var(--sc-accent);
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
      animation: row-in 300ms var(--e-out) backwards; animation-delay: calc(min(var(--r, 0), 12) * 18ms); }
    @keyframes row-in { from { opacity: 0; transform: translateX(6px); } }
    .prow.gold { --pc: var(--holo-gold); }
    .prow i { width: 18px; height: 18px; flex: none; border-radius: 50%; border: 1px solid var(--pc); color: var(--pc); font-family: var(--m);
      font-style: normal; font-size: 9.5px; display: grid; place-items: center; transition: background 160ms ease, color 160ms ease; }
    .pr-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--sc-fg-0); }
    .prow em { font-style: normal; font-family: var(--m); font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); white-space: nowrap; }
    .prow:hover, .prow:focus-visible, .prow.active { background: color-mix(in srgb, var(--pc) 8%, transparent); border-color: color-mix(in srgb, var(--pc) 40%, transparent); outline: none; }
    .prow:hover i, .prow:focus-visible i, .prow.active i { background: var(--pc); color: var(--sc-bg-0); }

    /* ── Journal ── */
    .card.flat { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--l1); border-radius: 4px; }
    .h2 { display: flex; align-items: center; gap: 8px; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); }
    .mut { margin: 0; font-size: max(11.5px, var(--f)); color: var(--sc-fg-2); }
    .journal { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .journal li { display: flex; align-items: center; gap: 8px; font-size: max(11.5px, var(--f)); animation: list-in 260ms var(--e-out) backwards; }
    .j-label { color: var(--sc-fg-0); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .j-state { color: var(--sc-fg-2); font-size: max(10px, var(--f)); }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  `],
})
export class CodexHoloInspectorComponent {
  readonly target = input<LayoutTarget | null>(null);
  /** The inspected pin has no loadout slot behind it — nothing to swap or open. */
  readonly isRawPort = input(false);
  readonly patchPin = input<PortPinBadge | null>(null);
  readonly inspectedPort = input<string | null>(null);
  readonly pinGroups = input<readonly PinGroup[]>([]);
  readonly hotkeyPinCount = input(0);
  readonly activePorts = input<readonly string[]>([]);
  readonly journal = input<readonly JournalEntry[]>([]);
  readonly draftChangedCount = input(0);
  readonly saveableCount = input(0);
  readonly saving = input(false);
  readonly saveError = input<string | null>(null);
  readonly inHangar = input(false);

  readonly closed = output<void>();
  readonly pinInspect = output<string>();
  readonly hovered = output<string[] | null>();
  readonly swapRequested = output<LayoutTarget>();
  readonly inspected = output<LayoutTarget>();
  readonly reverted = output<string[]>();
  readonly saveDraft = output<void>();
  readonly discardDraft = output<void>();

  itemName(name: string): string {
    return displayItemName(name);
  }

  /** The same dotted `parent.child` target the ports list emits for a sub-slot. */
  childTarget(it: LayoutTarget, kid: LayoutChild): LayoutTarget {
    const kids = kid.rawPorts.length > 0 ? kid.rawPorts : [kid.port];
    return { slot: it.slot, count: kid.count, child: kid, rawPorts: it.rawPorts.flatMap((p) => kids.map((k) => `${p}.${k}`)) };
  }

  sizeBadge(slot: LayoutSlot): string | null {
    const size = slot.size ?? slot.portSize;
    return size != null ? `S${size}` : null;
  }

  kidMeta(kid: LayoutChild): string {
    return [kid.manufacturerCode, kid.typeLabel, kid.port].filter((x): x is string => !!x).join(' · ');
  }

  meta(slot: LayoutSlot): string {
    return [slot.manufacturerCode, slot.typeLabel, slot.port].filter((x): x is string => !!x).join(' · ');
  }

  stats(slot: LayoutSlot): readonly EquippedStat[] {
    return (slot.stats ?? []).slice(0, 4);
  }

  fmtStat(stat: EquippedStat): string {
    return formatEquippedStat(stat);
  }

  journalAllPaths(): string[] {
    return this.journal().flatMap((e) => e.paths);
  }
}
