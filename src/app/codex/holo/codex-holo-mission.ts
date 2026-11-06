import type { MissionId } from '../codex-mission';
import type { ShipModuleSection } from '../ship-module-sections';

/**
 * What an Einsatz looks like on the Holotable: its symbol and its token
 * (`--sc-mission-*` in styles.scss). The symbol always travels with the hue, so
 * a colour never carries the meaning alone. The default stays the app accent.
 */
export const MISSION_ICON: Readonly<Record<MissionId, string>> = {
  all: 'M12 3l9 9-9 9-9-9z M12 8.5l3.5 3.5-3.5 3.5-3.5-3.5z',
  combat: 'M12 2v6M12 16v6M2 12h6M16 12h6M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
  transport: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  travel: 'M3 12h15M12 6l6 6-6 6',
  stealth: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM4 4l16 16',
  mining: 'M6 4h12l4 6-10 11L2 10zM2 10h20',
  salvage: 'M6 4v8a6 6 0 0 0 12 0V4M3 4h6M15 4h6',
};

export function missionColor(id: MissionId): string {
  return `var(--sc-mission-${id})`;
}

/**
 * The blocks that stay lit for an Einsatz, the rest goes quiet but stays
 * reachable. Read off the loadout sections, nothing is invented. `null`: every
 * part stays lit. The default has no focus, and Bergbau and Bergung have no
 * mining or salvage block in the extract to light.
 */
const MISSION_SECTIONS: Readonly<Record<MissionId, readonly ShipModuleSection[] | null>> = {
  all: null,
  combat: ['weapons', 'remoteTurrets', 'missiles', 'pod', 'shields'],
  transport: ['quantum', 'shields', 'powerPlants'],
  travel: ['quantum', 'powerPlants', 'coolers'],
  stealth: ['coolers', 'shields', 'countermeasures'],
  mining: null,
  salvage: null,
};

export function missionRelevantSections(id: MissionId): readonly ShipModuleSection[] | null {
  return MISSION_SECTIONS[id];
}
