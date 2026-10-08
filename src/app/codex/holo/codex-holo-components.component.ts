import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LayoutSection } from '../codex-hardpoint-layout.component';
import { ShipModuleSection } from '../ship-module-sections';
import { displayItemName } from '../codex-format';

/** One installed component the list offers for highlighting on the 3D hull. */
export interface HoloComponentEntry {
  /** Stable key: section + first raw port (unique within a ship). */
  key: string;
  section: ShipModuleSection;
  name: string;
  size: number | null;
  /** Every raw port this entry stands for (mount + child ports). */
  ports: readonly string[];
  /** The subset of `ports` the model actually has a locator for. */
  located: readonly string[];
}

export interface HoloComponentGroup {
  section: ShipModuleSection;
  entries: HoloComponentEntry[];
}

/**
 * Builds the component list from the loadout sections the page already
 * computes. Only installed slots (a resolved className) are listed; a slot's
 * ports are its own raw port plus its children's. `modelPorts` is what the
 * glb resolved — an entry with none of its ports in there has no position,
 * and never gets a guessed one.
 */
export function buildHoloComponentGroups(
  sections: readonly LayoutSection[],
  modelPorts: ReadonlySet<string>,
): HoloComponentGroup[] {
  const groups: HoloComponentGroup[] = [];
  const keys = new Set<string>();
  for (const sec of sections) {
    const entries: HoloComponentEntry[] = [];
    for (const slot of sec.slots) {
      if (!slot.className) continue;
      const ports = [
        ...(slot.rawPort ? [slot.rawPort] : []),
        ...(slot.children ?? []).flatMap((c) => c.rawPorts),
      ].filter((p, i, all) => !!p && all.indexOf(p) === i);
      if (ports.length === 0) continue;
      const key = `${sec.section}:${ports[0]}`;
      if (keys.has(key)) continue;
      keys.add(key);
      entries.push({
        key,
        section: sec.section,
        // An item the extract names nothing for arrives as its raw class name
        // (`AEGS_Gladius_Thruster_Main`); show it readable, as the ports list does.
        name: (slot.name ? displayItemName(slot.name) : '') || slot.typeLabel || slot.port,
        size: slot.size ?? null,
        ports,
        located: ports.filter((p) => modelPorts.has(p)),
      });
    }
    if (entries.length > 0) groups.push({ section: sec.section, entries });
  }
  return groups;
}

/**
 * The installed components next to the Holotable's 3D model. Hover or focus
 * lights the matching hotspot up (through the page's shared `activePorts`); a
 * click or tap pins it until Escape or a second click. An entry whose port the
 * model has no locator for says so and lights nothing.
 */
@Component({
  selector: 'sc-codex-holo-components',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'clearPin($event)' },
  template: `
    @if (groups().length > 0) {
      <div class="hc" role="group" [attr.aria-label]="'codex.holo.components.title' | translate">
        <p class="hc-head">
          <span class="hc-title">{{ 'codex.holo.components.title' | translate }}</span>
          <span class="hc-hint">{{ 'codex.holo.components.hint' | translate }}</span>
        </p>
        @for (g of groups(); track g.section) {
          <div class="hc-sec">
            <p class="hc-sec-head">
              <span class="hc-sec-label">{{ ('codex.moduleSection.' + g.section) | translate }}</span>
              <span class="hc-sec-count">{{ 'codex.holo.components.groupCount' | translate: { count: g.entries.length, located: locatedCount(g) } }}</span>
            </p>
            <ul class="hc-list">
              @for (e of g.entries; track e.key) {
                <li>
                  <button type="button" class="hc-btn"
                          [class.on]="pinnedKey() === e.key"
                          [class.unknown]="e.located.length === 0"
                          [attr.aria-pressed]="e.located.length > 0 ? pinnedKey() === e.key : null"
                          [attr.aria-disabled]="e.located.length === 0 ? 'true' : null"
                          (mouseenter)="preview(e)" (mouseleave)="endPreview()"
                          (focus)="preview(e)" (blur)="endPreview()"
                          (click)="togglePin(e)">
                    @if (e.size !== null) { <span class="hc-size">S{{ e.size }}</span> }
                    <span class="hc-name">{{ e.name }}</span>
                    @if (e.located.length === 0) {
                      <span class="hc-unknown">{{ 'codex.holo.components.unknownPosition' | translate }}</span>
                    }
                  </button>
                </li>
              }
            </ul>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .hc { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--sc-border);
      border-radius: var(--holo-r, 6px); background: color-mix(in srgb, var(--sc-bg-1) 85%, transparent);
      max-height: 340px; overflow-y: auto; overflow-x: hidden; }
    .hc-head { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
    .hc-title { color: var(--sc-fg-0); font-weight: 600; }
    .hc-hint { color: var(--sc-fg-2); font-size: max(11px, var(--sc-fs-floor, 11px)); }
    .hc-sec { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .hc-sec-head { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
    .hc-sec-count { color: var(--sc-fg-2); font-size: max(11px, var(--sc-fs-floor, 11px)); font-variant-numeric: tabular-nums; }
    .hc-sec-label { color: var(--sc-fg-2); font-size: max(11px, var(--sc-fs-floor, 11px)); text-transform: uppercase; letter-spacing: 0.06em; }
    .hc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
    .hc-list li { min-width: 0; max-width: 100%; }
    .hc-btn { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; max-width: 100%;
      min-height: var(--sc-tap-min, 32px); padding: 4px 10px; border: 1px solid var(--sc-border); border-radius: var(--holo-r, 6px);
      background: var(--sc-bg-2); color: var(--sc-fg-1); font: inherit; text-align: left; cursor: pointer;
      transition: border-color 120ms ease, background-color 120ms ease; }
    .hc-name { overflow-wrap: anywhere; }
    .hc-size { color: var(--sc-accent); font-variant-numeric: tabular-nums; }
    .hc-btn:not(.unknown):hover, .hc-btn:not(.unknown):focus-visible { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .hc-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .hc-btn.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 18%, var(--sc-bg-2)); color: var(--sc-fg-0); }
    .hc-btn.unknown { cursor: default; color: var(--sc-fg-2); border-style: dashed; }
    .hc-unknown { flex-basis: 100%; font-size: max(11px, var(--sc-fs-floor, 11px)); color: var(--sc-fg-2); }
    @media (max-width: 640px) { .hc { max-height: 260px; } }
    @media (prefers-reduced-motion: reduce) { .hc-btn { transition: none; } }
  `],
})
export class CodexHoloComponentsComponent {
  readonly sections = input<readonly LayoutSection[]>([]);
  /** Ports the glb resolved to a position (the viewer's `locatable`). */
  readonly modelPorts = input<readonly string[]>([]);

  /** Transient highlight (hover / focus); null = nothing previewed. */
  readonly hovered = output<string[] | null>();
  /** The pinned entry's located ports; [] = no pin. */
  readonly pinned = output<string[]>();

  readonly pinnedKey = signal<string | null>(null);

  readonly groups = computed(() => buildHoloComponentGroups(this.sections(), new Set(this.modelPorts())));

  /** Entries of a group the model can place — the counter next to its heading. */
  locatedCount(g: HoloComponentGroup): number {
    return g.entries.filter((e) => e.located.length > 0).length;
  }

  constructor() {
    // A pin whose entry vanished (new ship, model lost the port) is dropped.
    effect(() => {
      const groups = this.groups();
      const key = untracked(() => this.pinnedKey());
      if (key == null) return;
      const entry = groups.flatMap((g) => g.entries).find((e) => e.key === key);
      if (!entry || entry.located.length === 0) untracked(() => this.setPin(null));
    });
  }

  preview(e: HoloComponentEntry): void {
    if (e.located.length > 0) this.hovered.emit([...e.located]);
  }

  endPreview(): void {
    this.hovered.emit(null);
  }

  togglePin(e: HoloComponentEntry): void {
    if (e.located.length === 0) return;
    this.setPin(this.pinnedKey() === e.key ? null : e);
  }

  clearPin(ev?: Event): void {
    if (this.pinnedKey() == null) return;
    ev?.stopPropagation();
    this.setPin(null);
  }

  private setPin(e: HoloComponentEntry | null): void {
    this.pinnedKey.set(e?.key ?? null);
    this.pinned.emit(e ? [...e.located] : []);
    if (!e) this.hovered.emit(null);
  }
}
