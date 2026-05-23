/**
 * Extractor — Phase 2 stub. Defines the contract so the renderer can already
 * wire the progress UI; real P4K parsing lands in a follow-up tranche.
 *
 * Phase 1 emits a realistic-looking event stream: phase changes, file ticks,
 * a curated list of plausible SC ship/item names so the log feels meaningful
 * even though no real parsing is happening yet.
 *
 * Open question for the implementation: yauzl-stream vs. native sidecar.
 * yauzl alone handles standard ZIP but P4K has CryEngine-specific encoding
 * for some streams (CGF/CGA/SKIN). See concept Open Question #1.
 */

import type { DiscoveredChannel } from './discovery.js';
import type { ProfileId } from './performance.js';

export interface ExtractorOptions {
  channel: DiscoveredChannel;
  profile: ProfileId;
  scope: {
    hdIcons: boolean;
    renderPngs: boolean;
    componentTree: boolean;
    /** Audio-Manifest, 3D-Models — both default-off; see concept Iter 2 § A. */
    audioManifest: boolean;
    threeDModels: boolean;
  };
}

export interface ExtractorEvent {
  type:
    | 'phase'
    | 'file'
    | 'count'
    | 'warning'
    | 'log'
    | 'done'
    | 'error';
  phase?: 'discover' | 'plan' | 'extract' | 'validate' | 'bundle';
  pct?: number;
  fileName?: string;
  bytesProcessed?: number;
  bytesTotal?: number;
  counter?: { key: string; value: number };
  message?: string;
  level?: 'info' | 'warn' | 'error';
}

export interface ExtractionResult {
  channel: DiscoveredChannel['channel'];
  patchVersion: string | null;
  schemaVersion: number;
  qualityScore: number;
  entityCounts: Record<string, number>;
  manifest: Record<string, unknown>;
  data: Record<string, unknown>;
}

export type ProgressHandler = (event: ExtractorEvent) => void;

/** A curated cross-section of SC ships — enough variety for the Phase-1
 *  log demo to feel real without bothering with full faction catalogs. */
const SAMPLE_SHIPS = [
  'AEGS_Avenger_Titan', 'AEGS_Avenger_Stalker', 'AEGS_Gladius', 'AEGS_Sabre', 'AEGS_Vanguard_Warden',
  'AEGS_Vanguard_Sentinel', 'AEGS_Redeemer', 'AEGS_Eclipse', 'AEGS_Reclaimer', 'AEGS_Idris_P',
  'ANVL_Arrow', 'ANVL_Hornet_F7C', 'ANVL_Hornet_F7C_M_Super', 'ANVL_Carrack', 'ANVL_Terrapin',
  'ANVL_Valkyrie', 'ANVL_Hawk', 'ANVL_Pisces', 'ANVL_Crucible', 'ANVL_Liberator',
  'ARGO_MPUV_Cargo', 'ARGO_MPUV_Personnel', 'ARGO_SRV', 'ARGO_Mole', 'ARGO_RAFT',
  'BANU_Defender', 'BANU_Merchantman',
  'CNOU_HoverQuad', 'CNOU_Nomad', 'CNOU_Mustang_Alpha', 'CNOU_Mustang_Beta', 'CNOU_Mustang_Gamma',
  'CRUS_C2_Hercules', 'CRUS_M2_Hercules', 'CRUS_A2_Hercules', 'CRUS_Mercury_Star_Runner', 'CRUS_Starlifter_A1',
  'DRAK_Cutlass_Black', 'DRAK_Cutlass_Blue', 'DRAK_Cutlass_Red', 'DRAK_Buccaneer', 'DRAK_Caterpillar',
  'DRAK_Corsair', 'DRAK_Herald', 'DRAK_Vulture', 'DRAK_Kraken',
  'KRIG_P-72_Archimedes',
  'MISC_Freelancer', 'MISC_Freelancer_MAX', 'MISC_Freelancer_DUR', 'MISC_Hull_A', 'MISC_Hull_C',
  'MISC_Prospector', 'MISC_Razor', 'MISC_Reliant_Kore', 'MISC_Starfarer', 'MISC_Endeavor',
  'ORIG_300i', 'ORIG_315p', 'ORIG_325a', 'ORIG_350r', 'ORIG_400i', 'ORIG_600i_Touring',
  'ORIG_600i_Explorer', 'ORIG_X1',
  'RSI_Aurora_MR', 'RSI_Aurora_LN', 'RSI_Aurora_CL', 'RSI_Aurora_LX', 'RSI_Aurora_ES',
  'RSI_Constellation_Andromeda', 'RSI_Constellation_Aquila', 'RSI_Constellation_Phoenix',
  'RSI_Constellation_Taurus', 'RSI_Polaris', 'RSI_Scorpius', 'RSI_Mantis', 'RSI_Apollo',
  'XIAN_Scout', 'XIAN_Nox', 'XIAN_Khartu-Al',
];

const SAMPLE_ITEMS = [
  'Quantum_Drive_VK-00', 'Quantum_Drive_XL-1', 'Quantum_Drive_TS-2', 'Cooler_T2_JS-300', 'Cooler_T3_VK-45',
  'Power_Plant_T1_Sentry', 'Power_Plant_T2_Boost', 'Shield_Generator_T2_Pulse', 'Shield_Generator_T3_Bastion',
  'CF-117_Bulldog_Repeater', 'M3A_Laser_Cannon', 'CF-227_Badger_Repeater', 'Distortion_Scattergun',
  'Behring_M5A_Laser_Cannon', 'KLWE_Mass_Driver', 'Apocalypse_Arms_Tigerstreik', 'EMP_MK_II',
];

const SAMPLE_WARNINGS = [
  'schema mismatch in weapon.xml (extra field "alt_fire_mode") — soft-ignored',
  'icon at 64px fallback (no 128px source) for component coolers/JS300',
  'corrupted preview asset skipped: ships/CRUS/A2/loadout_preview.dds',
];

/** Phase 1 demo — emits a structured stream of phase changes + log entries
 *  with concrete ship/item names so the renderer log feels meaningful. */
export async function extract(
  opts: ExtractorOptions,
  onProgress: ProgressHandler,
): Promise<ExtractionResult> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // === Discover ===
  onProgress({ type: 'phase', phase: 'discover', pct: 0 });
  await sleep(120);
  onProgress({
    type: 'log',
    level: 'info',
    message: `discovered channel ${opts.channel.channel} at ${opts.channel.installPath}`,
  });
  onProgress({
    type: 'log',
    level: 'info',
    message: `Data.p4k size ${(opts.channel.sizeBytes / 1024 ** 3).toFixed(1)} GB`,
  });

  // === Plan ===
  onProgress({ type: 'phase', phase: 'plan', pct: 4 });
  await sleep(80);
  const scopeKeys = (Object.entries(opts.scope) as [string, boolean][])
    .filter(([, on]) => on)
    .map(([k]) => k);
  onProgress({
    type: 'log',
    level: 'info',
    message: `profile=${opts.profile} scope=[${scopeKeys.join(', ')}]`,
  });

  // === Extract — emit ship/item names with file ticks ===
  onProgress({ type: 'phase', phase: 'extract', pct: 8 });
  const ships = shuffle(SAMPLE_SHIPS).slice(0, 32);
  const items = shuffle(SAMPLE_ITEMS).slice(0, 12);
  const total = ships.length + items.length;
  let processed = 0;
  let shipsExtracted = 0;
  let itemsExtracted = 0;

  for (const ship of ships) {
    await sleep(35);
    processed++;
    shipsExtracted++;
    const pct = 8 + Math.round((processed / total) * 70);
    onProgress({
      type: 'file',
      pct,
      fileName: `Data/Objects/Spaceships/${ship}/${ship}.xml`,
      bytesProcessed: processed * 8_000_000,
      bytesTotal: total * 8_000_000,
    });
    onProgress({
      type: 'log',
      level: 'info',
      message: `extracted ship: ${ship}`,
    });
    if (shipsExtracted % 6 === 0) {
      onProgress({ type: 'count', counter: { key: 'ships', value: shipsExtracted } });
    }
  }

  for (const item of items) {
    await sleep(28);
    processed++;
    itemsExtracted++;
    const pct = 8 + Math.round((processed / total) * 70);
    onProgress({
      type: 'file',
      pct,
      fileName: `Data/Items/${item}.xml`,
      bytesProcessed: processed * 8_000_000,
      bytesTotal: total * 8_000_000,
    });
    onProgress({
      type: 'log',
      level: 'info',
      message: `extracted item: ${item}`,
    });
    if (itemsExtracted % 4 === 0) {
      onProgress({ type: 'count', counter: { key: 'items', value: itemsExtracted } });
    }
  }

  // Final-tick counter values
  onProgress({ type: 'count', counter: { key: 'ships', value: shipsExtracted } });
  onProgress({ type: 'count', counter: { key: 'items', value: itemsExtracted } });
  onProgress({ type: 'count', counter: { key: 'weapons', value: 18 } });
  onProgress({ type: 'count', counter: { key: 'components', value: 42 } });
  onProgress({ type: 'count', counter: { key: 'strings', value: 12_840 } });

  // Sprinkle a few warnings to test the warn-level styling
  for (const w of SAMPLE_WARNINGS) {
    onProgress({ type: 'log', level: 'warn', message: w });
    onProgress({ type: 'warning', message: w });
  }

  // === Validate ===
  onProgress({ type: 'phase', phase: 'validate', pct: 85 });
  await sleep(80);
  onProgress({ type: 'log', level: 'info', message: 'schema coverage: 18/22 fields per ship (avg)' });
  onProgress({ type: 'log', level: 'info', message: 'computed quality_score = 72 (yellow)' });

  // === Bundle ===
  onProgress({ type: 'phase', phase: 'bundle', pct: 95 });
  await sleep(60);
  onProgress({ type: 'log', level: 'info', message: 'manifest packed, ready for upload' });
  onProgress({ type: 'done', pct: 100 });

  return {
    channel: opts.channel.channel,
    patchVersion: opts.channel.version,
    schemaVersion: 1,
    qualityScore: 72,
    entityCounts: {
      ships: shipsExtracted,
      items: itemsExtracted,
      weapons: 18,
      components: 42,
      strings: 12_840,
    },
    manifest: {
      _placeholder: true,
      note: 'phase-1 demo — real extraction in phase 2 (see desktop-tool/src/lib/extractor.ts)',
      ships,
      items,
    },
    data: {},
  };
}

function shuffle<T>(arr: readonly T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}
