import { Injectable, computed, signal } from '@angular/core';
import { DraftMap, DraftValue, encodeDraftParam } from '../codex-loadout-draft';

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
  /** ISO timestamp of the first save — keeps the "Layout 1/2/…" order stable. Older entries lack it. */
  readonly createdAt?: string;
}

/** The query param the classic ship view restores a draft from (codex-loadout-draft store). */
export const SHARED_LOADOUT_PARAM = 'loadout';

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

  /** The layouts of one ship in the order they were created (the "Layout 1/2/…" switch). */
  layoutsOf(shipClassName: string): SavedLoadout[] {
    // The list is kept newest-first, so within one millisecond the later
    // position is the older layout.
    return this.state()
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.shipClassName === shipClassName)
      .sort((a, b) =>
        (a.l.createdAt ?? a.l.savedAt).localeCompare(b.l.createdAt ?? b.l.savedAt) || b.i - a.i)
      .map(({ l }) => l);
  }

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
    const now = new Date().toISOString();
    const existing = this.state().find((l) => l.shipClassName === shipClassName && l.name === trimmed);
    const entry: SavedLoadout = {
      id: existing?.id ?? newId(),
      shipClassName,
      name: trimmed,
      buildId,
      entries: [...draft.entries()],
      savedAt: now,
      createdAt: existing?.createdAt ?? existing?.savedAt ?? now,
    };
    this.state.update((list) => [entry, ...list.filter((l) => l.id !== entry.id)]);
    this.persist();
    return entry;
  }

  /** Write the current draft into an existing layout, keeping its name and place. null when unknown or empty. */
  overwrite(id: string, buildId: string, draft: DraftMap): SavedLoadout | null {
    const existing = this.get(id);
    if (!existing || draft.size === 0) return null;
    const entry: SavedLoadout = {
      ...existing,
      buildId,
      entries: [...draft.entries()],
      savedAt: new Date().toISOString(),
      createdAt: existing.createdAt ?? existing.savedAt,
    };
    this.state.update((list) => list.map((l) => (l.id === id ? entry : l)));
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

/**
 * The smallest N ≥ 1 whose default name ("Layout N", built by `nameFor`) no
 * layout of the ship carries yet — the name a new layout gets when the reader
 * types none.
 */
export function nextLayoutNumber(names: readonly string[], nameFor: (n: number) => string): number {
  const taken = new Set(names.map((n) => n.trim().toLowerCase()));
  let n = 1;
  while (taken.has(nameFor(n).trim().toLowerCase())) n++;
  return n;
}

/**
 * The share link of one layout (#322): the ship page's own URL with the
 * layout encoded in the `loadout` query param — the same param the page
 * mirrors its draft into, so the receiver's page opens with the layout on the
 * table as an unsaved draft they can keep as a layout of their own. Client
 * side only; null when the layout carries nothing.
 */
export function layoutShareUrl(pageUrl: string, entry: SavedLoadout): string | null {
  const param = encodeDraftParam(entry.buildId, new Map(entry.entries));
  if (!param) return null;
  const url = new URL(pageUrl);
  url.hash = '';
  url.searchParams.set(SHARED_LOADOUT_PARAM, param);
  return url.toString();
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
