import { Injectable, computed, signal } from '@angular/core';
import { DraftMap, DraftValue } from '../codex-loadout-draft';

/** One named loadout the reader saved for a ship (#322). */
export interface SavedLoadout {
  readonly id: string;
  readonly shipClassName: string;
  readonly name: string;
  /** The codex build the slots were picked against — the restore checks it like the draft mirror does. */
  readonly buildId: string;
  readonly entries: readonly [string, DraftValue][];
  /** ISO timestamp of the last save. */
  readonly savedAt: string;
}

export const SAVED_LOADOUTS_STORAGE_KEY = 'scc-codex-saved-loadouts:v1';
export const SAVED_LOADOUT_NAME_MAX = 60;

/**
 * Named loadouts per ship, kept in this browser's localStorage (#322).
 *
 * The hangar config (`hangar_ship_configs`) only takes top-level, joinable
 * slots of a ship you own; a codex reader — signed in or not — wants to keep
 * "my mining fit" and "my bounty fit" of any ship and switch between them.
 * So the store is local and carries the FULL draft (nested and emptied slots
 * included). Saving the same name again for the same ship overwrites it.
 * Best-effort throughout: private mode or a full quota keeps the list in
 * memory for this session instead of breaking the page.
 */
@Injectable({ providedIn: 'root' })
export class SavedLoadoutsService {
  private readonly state = signal<readonly SavedLoadout[]>(readAll());
  readonly all = this.state.asReadonly();

  /** The saved loadouts of one ship, newest first. */
  forShip(shipClassName: string) {
    return computed(() =>
      this.state()
        .filter((l) => l.shipClassName === shipClassName)
        .slice()
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    );
  }

  /** null when the name is empty or the draft carries nothing to save. */
  save(shipClassName: string, name: string, buildId: string, draft: DraftMap): SavedLoadout | null {
    const trimmed = name.trim().slice(0, SAVED_LOADOUT_NAME_MAX);
    if (!trimmed || draft.size === 0) return null;
    const existing = this.state().find((l) => l.shipClassName === shipClassName && l.name === trimmed);
    const entry: SavedLoadout = {
      id: existing?.id ?? newId(),
      shipClassName,
      name: trimmed,
      buildId,
      entries: [...draft.entries()],
      savedAt: new Date().toISOString(),
    };
    this.state.update((list) => [entry, ...list.filter((l) => l.id !== entry.id)]);
    this.persist();
    return entry;
  }

  remove(id: string): void {
    this.state.update((list) => list.filter((l) => l.id !== id));
    this.persist();
  }

  get(id: string): SavedLoadout | null {
    return this.state().find((l) => l.id === id) ?? null;
  }

  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SAVED_LOADOUTS_STORAGE_KEY, JSON.stringify(this.state()));
    } catch {
      // Private mode / quota — the list lives on in memory for this session.
    }
  }
}

function readAll(): readonly SavedLoadout[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SAVED_LOADOUTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedLoadout);
  } catch {
    return [];
  }
}

function isSavedLoadout(v: unknown): v is SavedLoadout {
  const o = v as Partial<SavedLoadout> | null;
  return !!o && typeof o.id === 'string' && typeof o.shipClassName === 'string' && typeof o.name === 'string'
    && typeof o.buildId === 'string' && typeof o.savedAt === 'string' && Array.isArray(o.entries);
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
