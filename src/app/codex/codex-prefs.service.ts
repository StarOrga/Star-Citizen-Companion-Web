import { Injectable, signal } from '@angular/core';
import type { RankScope } from './codex-rank';

/** localStorage key of the opt-in (`'1'` = non-usable items shown). */
const SHOW_NON_USABLE_KEY = 'sc.codex.showNonUsable';

/** localStorage key of the Holotable's comparison group per ship. */
export const SHIP_RANK_SCOPE_KEY = 'sc.codex.rankScopeByShip';

/** How long a picked comparison group holds for one ship (12 h, concept r1-default). */
export const SHIP_RANK_SCOPE_TTL_MS = 12 * 60 * 60 * 1000;

const RANK_SCOPES: ReadonlySet<string> = new Set(['all', 'career', 'role', 'sizeClass']);

interface ShipScopeEntry {
  scope: RankScope;
  /** When it was picked, epoch ms. */
  at: number;
}

/**
 * Codex reading preferences (package C, 2026-11-06).
 *
 * `showNonUsable`: game records a player cannot use — doors, seats, displays,
 * control panels, character-creator parts (see codex-area-taxonomy) — are
 * hidden from the area tree, the lists and the search by default. This opt-in
 * shows them as their own "Nicht nutzbar" area and lets the search reach them,
 * always ranked after every usable hit.
 *
 * Persisted unconditionally like the other functional preferences
 * (FeedbackFabPrefsService): it stores no personal data.
 */
@Injectable({ providedIn: 'root' })
export class CodexPrefsService {
  private readonly showNonUsableState = signal(readFlag(SHOW_NON_USABLE_KEY));

  /** `false` (default) → non-usable records stay out of tree, lists and search. */
  readonly showNonUsable = this.showNonUsableState.asReadonly();

  /** Bumped on every write, so a computed that reads a ship's group re-runs. */
  private readonly shipScopeRev = signal(0);

  /** The clock; a spec replaces it to step past the 12 hours. */
  now: () => number = () => Date.now();

  /**
   * The Holotable's comparison group the reader picked for THIS ship, while it
   * is younger than 12 hours (concept r1-default "keep": switching between
   * ships keeps each one's group for the comparison, the next day starts fresh
   * at the narrowest group). Never an account-wide choice: another ship is
   * untouched. Null = nothing picked, or picked too long ago.
   */
  shipRankScope(className: string): RankScope | null {
    this.shipScopeRev();
    if (!className) return null;
    const entry = readShipScopes()[className];
    if (!entry) return null;
    return this.now() - entry.at < SHIP_RANK_SCOPE_TTL_MS ? entry.scope : null;
  }

  /** Remembers a clicked group for this ship (expired entries of other ships are dropped). */
  setShipRankScope(className: string, scope: RankScope): void {
    if (!className) return;
    const now = this.now();
    const next: Record<string, ShipScopeEntry> = {};
    for (const [ship, entry] of Object.entries(readShipScopes())) {
      if (now - entry.at < SHIP_RANK_SCOPE_TTL_MS) next[ship] = entry;
    }
    next[className] = { scope, at: now };
    try {
      localStorage.setItem(SHIP_RANK_SCOPE_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — the choice simply does not outlive this view */
    }
    this.shipScopeRev.update((n) => n + 1);
  }

  setShowNonUsable(value: boolean): void {
    this.showNonUsableState.set(value);
    try {
      if (value) localStorage.setItem(SHOW_NON_USABLE_KEY, '1');
      else localStorage.removeItem(SHOW_NON_USABLE_KEY);
    } catch {
      /* private mode / quota — the in-memory signal still applies this session */
    }
  }
}

function readFlag(key: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function readShipScopes(): Record<string, ShipScopeEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SHIP_RANK_SCOPE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, ShipScopeEntry> = {};
    for (const [ship, v] of Object.entries(raw as Record<string, unknown>)) {
      const e = v as Partial<ShipScopeEntry> | null;
      if (e && typeof e.scope === 'string' && RANK_SCOPES.has(e.scope) && typeof e.at === 'number' && Number.isFinite(e.at)) {
        out[ship] = { scope: e.scope, at: e.at };
      }
    }
    return out;
  } catch {
    return {};
  }
}
