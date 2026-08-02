/**
 * Binds a durable {@link UploadJobStore} to the catalog/skin upload stages.
 *
 * This is the wiring that actually implements "resume": which phases to skip,
 * which cursor to start from, and when to flush progress to disk. It lives here
 * — pure, Electron-free — rather than inline in the IPC handlers, so the
 * resume contract can be tested against the real upload code instead of being
 * re-implemented (and quietly diverging) in a test.
 */

import type { PauseControl } from './pause-control.js';
import type { ThrottleControl } from './throttle-control.js';
import { UploadJobStore, sentFor } from './upload-job.js';

/** Structural mirror of `main/catalog-bridge.ts:CatalogHooks`. */
export interface CatalogHookSet {
  control?: PauseControl;
  pace?: () => Promise<void>;
  buildId?: string | null;
  donePhases?: string[];
  sentFor?: (phase: string) => number;
  onBuildId?: (buildId: string) => void;
  onCursor?: (phase: string, sent: number) => void;
  onPhaseDone?: (phase: string) => void;
}

/** Structural mirror of `main/skin-ingest.ts:SkinUploadHooks`. */
export interface SkinHookSet {
  control?: PauseControl;
  pace?: () => Promise<void>;
  doneShips?: string[];
  onShipDone?: (shipId: string) => void;
}

/**
 * Bind the throttle as a per-call getter, never as a captured value: the whole
 * point is that a stage started under "maximum" observes a later switch to
 * "minimal" at its next work unit.
 */
function pacer(throttle?: ThrottleControl): (() => Promise<void>) | undefined {
  return throttle ? () => throttle.pace() : undefined;
}

export function catalogHooks(
  store: UploadJobStore,
  control?: PauseControl,
  throttle?: ThrottleControl,
): CatalogHookSet {
  const job = store.load();
  return {
    control,
    pace: pacer(throttle),
    // Read once at stage start: the build row is fixed for the job's lifetime.
    buildId: job?.catalog.buildId ?? null,
    donePhases: job?.catalog.donePhases ?? [],
    // Read live — a resume must see cursors written earlier in THIS run too.
    sentFor: (phase) => {
      const s = store.load();
      return s ? sentFor(s, phase) : 0;
    },
    onBuildId: (buildId) => {
      store.update((s) => ({ ...s, catalog: { ...s.catalog, status: 'running', buildId } }));
    },
    onCursor: (phase, sent) => {
      store.update((s) => ({ ...s, catalog: { ...s.catalog, status: 'running', cursor: { phase, sent } } }));
    },
    onPhaseDone: (phase) => {
      store.update((s) => ({
        ...s,
        catalog: {
          ...s.catalog,
          status: 'running',
          // Drop the cursor with the phase it belonged to — a stale cursor
          // would make the NEXT phase look partially sent.
          cursor: null,
          donePhases: s.catalog.donePhases.includes(phase)
            ? s.catalog.donePhases
            : [...s.catalog.donePhases, phase],
        },
      }));
    },
  };
}

export function skinHooks(
  store: UploadJobStore,
  control?: PauseControl,
  throttle?: ThrottleControl,
): SkinHookSet {
  const job = store.load();
  return {
    control,
    pace: pacer(throttle),
    doneShips: job?.skins.doneShips ?? [],
    onShipDone: (shipId) => {
      store.update((s) => ({
        ...s,
        skins: {
          status: 'running',
          doneShips: s.skins.doneShips.includes(shipId) ? s.skins.doneShips : [...s.skins.doneShips, shipId],
        },
      }));
    },
  };
}
