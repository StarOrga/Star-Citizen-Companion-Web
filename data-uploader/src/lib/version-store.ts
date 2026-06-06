/**
 * Keep-latest sync state with remembered progress.
 *
 * Persists exactly ONE snapshot (the latest — older ones are overwritten,
 * matching "nur die letzten speicherwürdig") plus an optional in-flight progress
 * checkpoint so a long / interrupted sync resumes its tile instead of starting
 * blank ("der downloadfortschritt sich gemerkt wird"). Plain JSON (no secrets)
 * via injected I/O for testability.
 */

import type { CatalogSnapshot, SyncProgress } from './sync.js';

export interface SyncCheckpoint {
  phase: SyncProgress['phase'];
  pct: number;
  /** Opaque resume cursor for a future paginated bulk download. */
  cursor?: string | null;
  /** Unix seconds. */
  updatedAt: number;
}

export interface SyncStateFile {
  v: number;
  snapshot: CatalogSnapshot | null;
  checkpoint: SyncCheckpoint | null;
}

/** Injectable text persistence (file-backed in production). */
export interface TextIO {
  read(): string | null;
  write(text: string): void;
  remove(): void;
}

const SCHEMA_VERSION = 1;

function empty(): SyncStateFile {
  return { v: SCHEMA_VERSION, snapshot: null, checkpoint: null };
}

export class VersionStore {
  constructor(private readonly io: TextIO) {}

  load(): SyncStateFile {
    const raw = this.io.read();
    if (!raw) return empty();
    try {
      const parsed = JSON.parse(raw) as Partial<SyncStateFile>;
      if (parsed.v !== SCHEMA_VERSION) return empty();
      return {
        v: SCHEMA_VERSION,
        snapshot: parsed.snapshot ?? null,
        checkpoint: parsed.checkpoint ?? null,
      };
    } catch {
      return empty();
    }
  }

  /** Persist the latest snapshot, clearing any in-flight checkpoint. */
  saveSnapshot(snapshot: CatalogSnapshot): void {
    const file: SyncStateFile = { v: SCHEMA_VERSION, snapshot, checkpoint: null };
    this.io.write(JSON.stringify(file));
  }

  /** Persist resume progress without touching the last good snapshot. */
  saveCheckpoint(checkpoint: SyncCheckpoint): void {
    const current = this.load();
    const file: SyncStateFile = { v: SCHEMA_VERSION, snapshot: current.snapshot, checkpoint };
    this.io.write(JSON.stringify(file));
  }

  clear(): void {
    this.io.remove();
  }
}
