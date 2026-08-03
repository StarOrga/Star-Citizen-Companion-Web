/**
 * Performance-Profile per concept Iteration 2 § C.
 *
 * B (standard + live-switch) is the DEFAULT primary, surfaced as 3 large pills in
 * the UI. A (3 fest) is the same definitions but exposed via CLI flag for
 * headless mode. C (auto) and D (slider) are Phase 2 / Advanced.
 */

export type ProfileId = 'minimal' | 'standard' | 'maximum' | 'auto' | 'custom';

export interface LocalisedString {
  de: string;
  en: string;
}

export interface PerformanceProfile {
  id: ProfileId;
  label: LocalisedString;
  description: LocalisedString;
  /** `'auto'` = navigator.hardwareConcurrency or all logical cores. */
  cpuThreads: number | 'auto';
  /**
   * Advisory memory budget handed to the sidecar as `--mem-cap-mb`.
   *
   * It clamps the WORKER COUNT and nothing else — it is not, and cannot be, a
   * ceiling on the process: CPython on Windows has no per-process memory limit
   * short of the Job Object API. The UI copy must not promise otherwise.
   */
  ramCapMb: number;
  workerProcessPriority: 'idle' | 'below_normal' | 'normal' | 'above_normal' | 'high';
  /** Seconds estimated per GB of source P4K (calibrated guess; updated after first real benchmark). */
  estimatedSecondsPerGb: number;
}

/**
 * Worker processes the record dump may use under `profile`.
 *
 * This is the knob that actually makes the levels differ. Priority class does
 * not: Windows only propagates a parent's class to new children when it is
 * Idle or BelowNormal (measured on Win11 — AboveNormal and High are NOT
 * inherited, children start at Normal), so the old "maximum = AboveNormal"
 * could never reach the processes doing the work. Parallelism can.
 *
 * `maximum` deliberately leaves one core to the rest of the machine. Saturating
 * every logical processor with CPU-bound workers starves the Electron UI on the
 * same box — including the cancel button and the mode switch, i.e. exactly the
 * controls an operator reaches for when a run is too aggressive.
 */
export function workersFor(profile: Exclude<ProfileId, 'custom'>, cores = logicalCores()): number {
  const total = Math.max(1, Math.floor(cores));
  switch (profile) {
    case 'minimal':
      return 1; // the serial path, byte-for-byte
    case 'standard':
      return Math.max(1, Math.floor(total / 2));
    case 'maximum':
      return Math.max(1, total - 1); // one core stays with the UI
    case 'auto':
      return Math.max(1, Math.floor(total / 2));
  }
}

export const PROFILES: Record<Exclude<ProfileId, 'custom'>, PerformanceProfile> = {
  minimal: {
    id: 'minimal',
    label: { de: 'Minimaler Impact', en: 'Minimal Impact' },
    description: {
      de: '1 Prozess auf 1 Kern, niedrigste Priorität. Du kannst flüssig weiterarbeiten.',
      en: '1 process on 1 core, lowest priority. Use your PC freely while it runs.',
    },
    cpuThreads: 1,
    ramCapMb: 512,
    workerProcessPriority: 'idle',
    estimatedSecondsPerGb: 144,
  },
  standard: {
    id: 'standard',
    label: { de: 'Standard', en: 'Standard' },
    description: {
      de: 'Hälfte der Kerne als eigene Prozesse. Browser oder Game spürbar langsamer.',
      en: 'Half the cores as separate processes. Browser/game noticeably slower.',
    },
    cpuThreads: halfCores(),
    ramCapMb: 2048,
    workerProcessPriority: 'normal',
    estimatedSecondsPerGb: 36,
  },
  maximum: {
    id: 'maximum',
    label: { de: 'Maximum Throughput', en: 'Maximum Throughput' },
    description: {
      de: 'Alle Kerne bis auf einen, als eigene Prozesse. Anderes Arbeiten am PC ist quasi unmöglich.',
      en: 'Every core but one, as separate processes. Hard to use the PC for anything else.',
    },
    cpuThreads: 'auto',
    ramCapMb: 8192,
    // NOT above_normal: Windows does not propagate it to children (measured),
    // so it could only ever raise the coordinating process — which is idle while
    // the workers run — and on a low-core box it starves the Electron UI that
    // owns the cancel button. The parallelism is what makes this profile fast.
    workerProcessPriority: 'normal',
    estimatedSecondsPerGb: 20,
  },
  auto: {
    id: 'auto',
    label: { de: 'Smart-Modus', en: 'Smart (Auto)' },
    description: {
      de: 'Skaliert dynamisch nach System-Last. Phase 2 — Implementierung folgt.',
      en: 'Scales dynamically with system load. Phase 2 — coming soon.',
    },
    cpuThreads: 'auto',
    ramCapMb: 4096,
    workerProcessPriority: 'below_normal',
    estimatedSecondsPerGb: 50,
  },
};

/**
 * Profiles the operator may actually choose.
 *
 * `auto` is excluded until it does what its own description says. It used to be
 * rendered as a clickable pill labelled "Smart" whose only real effect was
 * BelowNormal — so picking the smart-sounding option made the run SLOWER than
 * Standard, with nothing in the UI saying so.
 */
export const SELECTABLE_PROFILES: readonly Exclude<ProfileId, 'custom' | 'auto'>[] = [
  'minimal',
  'standard',
  'maximum',
];

export const DEFAULT_PROFILE: ProfileId = 'standard';

export interface ETA {
  seconds: number;
  formatted: string;
}

export function estimateForSize(
  profileId: Exclude<ProfileId, 'custom'>,
  sizeBytes: number,
): ETA {
  const sizeGb = sizeBytes / 1024 ** 3;
  const seconds = Math.max(1, Math.round(PROFILES[profileId].estimatedSecondsPerGb * sizeGb));
  return { seconds, formatted: formatDuration(seconds) };
}

/** Logical processors, or 8 where the runtime will not say. */
export function logicalCores(): number {
  // Available in both Node 20+ and browser
  const cores =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator
      ?.hardwareConcurrency === 'number'
      ? (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator!
          .hardwareConcurrency!
      : 8;
  return Math.max(1, cores);
}

function halfCores(): number {
  return Math.max(2, Math.floor(logicalCores() / 2));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}
