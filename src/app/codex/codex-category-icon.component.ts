import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CodexKind } from './codex.service';

/**
 * Stroke-based category glyphs (24×24 viewBox, single `d` path each so Angular's
 * SVG binding stays simple). Every entity gets a guaranteed visual anchor even
 * when it has no datamined artwork — which is the case for ~94% of catalog
 * entities (components & ammunition have 0% art). See UC-01.
 */
// Exported additively for the energy dock (`codex-energy-dock.component.ts`),
// which reuses weapon/shield/thruster/cooler/quantum and adds seven glyphs of
// its own (radar, lifeSupport, tractor, ir, em, crossSection, heat) — same
// 24×24 stroke idiom, one `d` path each (UI spec §12).
export const ICON_PATHS: Readonly<Record<string, string>> = {
  ship: 'M12 2 C13.6 4.3 14.5 7.4 14.5 11 L14.5 15 L18 19 L14.5 18 L13 22 L11 22 L9.5 18 L6 19 L9.5 15 L9.5 11 C9.5 7.4 10.4 4.3 12 2 Z',
  weapon: 'M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22 M8 12 A4 4 0 0 1 16 12 A4 4 0 0 1 8 12 M12 12 H12.01',
  component: 'M9 2 V5 M15 2 V5 M9 19 V22 M15 19 V22 M2 9 H5 M2 15 H5 M19 9 H22 M19 15 H22 M5 5 H19 V19 H5 Z M9 9 H15 V15 H9 Z',
  shield: 'M12 2 L20 5 V11 C20 16 16.4 20 12 22 C7.6 20 4 16 4 11 V5 Z',
  power: 'M13 2 L4 14 H10 L9 22 L20 9 H13 Z',
  cooler: 'M12 2 V22 M3 7 L21 17 M21 7 L3 17 M5.5 4.2 L7 8 L11 7 M18.5 4.2 L17 8 L13 7 M5.5 19.8 L7 16 L11 17 M18.5 19.8 L17 16 L13 17',
  quantum: 'M12 9 A3 3 0 1 1 11.99 9 M4 12 C8 8.6 16 8.6 20 12 C16 15.4 8 15.4 4 12 M10.3 4.3 C13.7 8.3 13.7 15.7 10.3 19.7',
  thruster: 'M8 3 H16 L14.5 13 H9.5 Z M9.5 13 C9.5 17 8.5 19 12 22 C15.5 19 14.5 17 14.5 13',
  fuel: 'M12 2.5 C12 2.5 19 10.6 19 15 A7 7 0 0 1 5 15 C5 10.6 12 2.5 12 2.5 Z',
  cargo: 'M12 2 L21 7 V17 L12 22 L3 17 V7 Z M3 7 L12 12 L21 7 M12 12 V22',
  item: 'M4 7 L12 3 L20 7 L20 17 L12 21 L4 17 Z M4 7 L12 11 L20 7 M12 11 V21',
  // Non-lethal on-foot gear filed under codex_weapons (sub_type 'Gadget'):
  // multi-tool, fire extinguisher, glowsticks. A wrench, never a crosshair.
  gadget:
    'M18.4 4.1 A4.6 4.6 0 0 0 12.3 10.2 L4.6 17.9 A1.9 1.9 0 0 0 7.3 20.6 L15 12.9 A4.6 4.6 0 0 0 21.1 6.8 L18 9.9 L15.3 9.9 L15.3 7.2 Z',
  blade: 'M12 2 L15 8 V14 H9 V8 Z M8 14 H16 M12 14 V20 M10 20 H14',
  grenade:
    'M6 14 A6 6 0 1 0 18 14 A6 6 0 1 0 6 14 M10 5 H14 V7.4 H10 Z M14 5.6 H17.5 V2.8 M10 5 L9 2.8',
  ammunition: 'M9 2 H15 V5 L17 8 V20 A2 2 0 0 1 15 22 H9 A2 2 0 0 1 7 20 V8 L9 5 Z M7 11 H17',
  manufacturer: 'M3 21 V10 L9 13 V10 L15 13 V7 L21 10 V21 Z M3 21 H21 M7 17 H8 M11 17 H12 M15 17 H16',
  generic: 'M5 4 C5 3.4 5.4 3 6 3 H18 C18.6 3 19 3.4 19 4 V20 C19 20.6 18.6 21 18 21 H6 C5.4 21 5 20.6 5 20 Z M9 3 V21 M12 8 H16 M12 12 H16',
  // ── energy dock glyphs (UI spec §12) ──────────────────────────────────────
  radar:
    'M12 21 A9 9 0 1 1 21 12 M12 21 V12 L21 12 M12 16.5 A4.5 4.5 0 0 0 16.5 12 M12 12 L18.4 5.6',
  lifeSupport:
    'M9 4 H15 V8 C15 9.2 15.6 10 16.4 10.8 L17.6 12 C18.5 12.9 19 14 19 15.3 V19 A2 2 0 0 1 17 21 H7 A2 2 0 0 1 5 19 V15.3 C5 14 5.5 12.9 6.4 12 L7.6 10.8 C8.4 10 9 9.2 9 8 Z M9.5 15 H14.5 M12 12.5 V17.5',
  tractor:
    'M9 3 H15 L15 6 H9 Z M9.5 6 L4 20 M14.5 6 L20 20 M6.6 13 H17.4 M5.3 16.5 H18.7 M12 9 V20',
  ir: 'M12 3 C12 3 8.5 7 8.5 10 A3.5 3.5 0 0 0 15.5 10 C15.5 7 12 3 12 3 Z M12 21 A6 6 0 0 1 6 15 M12 21 A6 6 0 0 0 18 15 M4 12 H2 M22 12 H20',
  em: 'M12 5 V19 M8 8 A5 5 0 0 0 8 16 M16 8 A5 5 0 0 1 16 16 M5 5 A10 10 0 0 0 5 19 M19 5 A10 10 0 0 1 19 19',
  crossSection:
    'M3 12 A9 9 0 0 1 21 12 A9 9 0 0 1 3 12 M12 7.5 L16.5 12 L12 16.5 L7.5 12 Z M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21',
  heat: 'M12 2.5 C12 2.5 16 6.5 16 10 A4 4 0 0 1 8 10 C8 8.4 9 7 9 7 C9 8.6 10 9.5 10.8 9.5 C11.8 9.5 12 8.2 12 2.5 Z M6 16 H18 M6 19 H18',
};

/** Category accent colours — semantic, theme-token-aware where one exists. */
const CAT_COLORS: Readonly<Record<string, string>> = {
  ship: 'var(--sc-accent, #52c1e6)',
  weapon: 'var(--sc-accent-hot, #e8864a)',
  component: 'var(--sc-accent, #52c1e6)',
  shield: '#52c1e6',
  power: '#f0c419',
  cooler: '#5fd3ff',
  quantum: '#a674ff',
  thruster: 'var(--sc-accent-hot, #e8864a)',
  fuel: '#5fd698',
  cargo: '#c8a84b',
  item: '#c8a84b',
  gadget: '#6fd0c2',
  blade: '#b6c2d2',
  grenade: '#9bb35a',
  ammunition: '#ff8282',
  manufacturer: 'var(--sc-fg-1, #b6c2d2)',
  generic: 'var(--sc-fg-2, #8a92a0)',
};

// componentKind (codex_components.kind) → icon/colour key.
const COMPONENT_SUB: Readonly<Record<string, string>> = {
  PowerPlant: 'power',
  Shield: 'shield',
  Cooler: 'cooler',
  QuantumDrive: 'quantum',
  Thruster: 'thruster',
  FuelTank: 'fuel',
  FuelIntake: 'fuel',
  CargoGrid: 'cargo',
};

/**
 * weapon sub_type → icon/colour key. The extract files a lot of NON-weapons
 * under `codex_weapons` (anything the character holds in the weapon slot), so
 * the crosshair glyph leaked onto the APX Fire Extinguisher and the Pyro RYT
 * Multi-Tool (admin feedback 8cd0aed7). A crosshair must only mean "this thing
 * shoots"; everything else gets its own glyph here. Sub-types that really are
 * guns (Small/Medium/Large, Ship Gun/Turret/…) intentionally stay on 'weapon'.
 */
const WEAPON_SUB: Readonly<Record<string, string>> = {
  Gadget: 'gadget',
  Utility: 'gadget',
  Knife: 'blade',
  Melee: 'blade',
  Grenade: 'grenade',
};

/** Resolve a (kind, sub) pair to an icon key in ICON_PATHS. Never returns null. */
export function categoryIconKey(kind: CodexKind, sub?: string | null): string {
  if (kind === 'component' && sub && COMPONENT_SUB[sub]) return COMPONENT_SUB[sub];
  if (kind === 'weapon' && sub && WEAPON_SUB[sub]) return WEAPON_SUB[sub];
  switch (kind) {
    case 'ship':
      return 'ship';
    case 'weapon':
      return 'weapon';
    case 'component':
      return 'component';
    case 'item':
      return 'item';
    case 'ammunition':
      return 'ammunition';
    case 'manufacturer':
      return 'manufacturer';
    default:
      return 'generic';
  }
}

/** Accent colour for a (kind, sub) pair — mirrors categoryIconKey. */
export function categoryColor(kind: CodexKind, sub?: string | null): string {
  return CAT_COLORS[categoryIconKey(kind, sub)] ?? CAT_COLORS['generic'];
}

/**
 * Guaranteed visual anchor for any codex entity. Renders a stroke category
 * glyph that inherits its category colour — used as the fallback wherever real
 * artwork is missing (list cards, detail hero, future compare pins).
 */
@Component({
  selector: 'sc-codex-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      [style.color]="color()"
      aria-hidden="true"
    >
      <path [attr.d]="path()" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }
      /* The cap travels as a custom property so a large frame (the detail hero,
         where 72px reads as "tiny lost glyph") can grow it across the style
         encapsulation boundary without the host reaching into this template. */
      svg {
        width: 56%;
        height: 56%;
        max-width: var(--sc-icon-max, 72px);
        max-height: var(--sc-icon-max, 72px);
        opacity: 0.92;
        filter: drop-shadow(0 0 10px color-mix(in srgb, currentColor 35%, transparent));
      }
    `,
  ],
})
export class CodexCategoryIconComponent {
  readonly kind = input.required<CodexKind>();
  readonly sub = input<string | null>(null);

  readonly path = computed(() => ICON_PATHS[categoryIconKey(this.kind(), this.sub())] ?? ICON_PATHS['generic']);
  readonly color = computed(() => categoryColor(this.kind(), this.sub()));
}
