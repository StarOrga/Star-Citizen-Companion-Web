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
  ramCapMb: number;
  /** `null` = unthrottled. */
  diskThrottleMbps: number | null;
  workerProcessPriority: 'idle' | 'below_normal' | 'normal' | 'above_normal' | 'high';
  /** Seconds estimated per GB of source P4K (calibrated guess; updated after first real benchmark). */
  estimatedSecondsPerGb: number;
}

export const PROFILES: Record<Exclude<ProfileId, 'custom'>, PerformanceProfile> = {
  minimal: {
    id: 'minimal',
    label: { de: 'Minimaler Impact', en: 'Minimal Impact' },
    description: {
      de: '1 Worker + 1 IO, gedrosselte Disk-Reads. Du kannst flüssig weiterarbeiten.',
      en: '1 worker + 1 IO, throttled disk reads. Use your PC freely while it runs.',
    },
    cpuThreads: 1,
    ramCapMb: 512,
    diskThrottleMbps: 50,
    workerProcessPriority: 'idle',
    estimatedSecondsPerGb: 144,
  },
  standard: {
    id: 'standard',
    label: { de: 'Standard', en: 'Standard' },
    description: {
      de: '50 % der Kerne, normale Disk-Last. Browser oder Game spürbar langsamer.',
      en: 'Half the cores, normal disk load. Browser/game noticeably slower.',
    },
    cpuThreads: halfCores(),
    ramCapMb: 2048,
    diskThrottleMbps: null,
    workerProcessPriority: 'normal',
    estimatedSecondsPerGb: 36,
  },
  maximum: {
    id: 'maximum',
    label: { de: 'Maximum Throughput', en: 'Maximum Throughput' },
    description: {
      de: 'Alle Kerne, sequenziales Prefetch. Anderes Arbeiten am PC ist quasi unmöglich.',
      en: 'All cores, sequential prefetch. Hard to use the PC for anything else.',
    },
    cpuThreads: 'auto',
    ramCapMb: 8192,
    diskThrottleMbps: null,
    workerProcessPriority: 'above_normal',
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
    diskThrottleMbps: null,
    workerProcessPriority: 'below_normal',
    estimatedSecondsPerGb: 50,
  },
};

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

function halfCores(): number {
  // Available in both Node 20+ and browser
  const cores =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator
      ?.hardwareConcurrency === 'number'
      ? (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator!
          .hardwareConcurrency!
      : 8;
  return Math.max(2, Math.floor(cores / 2));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}
