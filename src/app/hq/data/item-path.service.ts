import { Injectable, Injector, Signal, computed, inject, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { HangarService } from '../../hangar/hangar.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqLiveService } from '../now/hq-live.service';
import { isGameLive, readLocation } from '../now/hq-live.util';
import { HqSuppliesService, SupplyUnit, lineAmount, roundAmount } from '../hq-supplies.service';
import { NachschubEdgeService } from '../nachschub/nachschub-edge.service';
import { parseStockRef } from '../stock/hq-stock-ref';
import { HqInventoryService } from './hq-inventory.service';

/*
 * ItemPathService - THE contract of the way an item takes outside the HQ (concept nachschub-hq r4-d1-s8): two stops,
 * Wunschliste -> Inventar / Hangar / Sammlung by kind. Every surface (search rows, Codex pages, popups) reads and
 * writes the path through this service only. Nachschub is built in the HQ (`hq/nachschub`), never from here.
 *
 * READ  `state(kind, className, name?)` -> Signal<ItemPathState>
 *   wished / wishQty  on the wishlist, and how many (SearchWishlistService adds up a ship's two homes)
 *   inventarQty       units in Inventar over all places;  places[] = [{ location, qty }]
 *   inHangar          ship owned (kind ship); hangarQty its copies, hangarShipId for the link "Im Hangar ansehen"
 *   nachschubQty      units still open in a Nachschub (read only: the HQ hints use it)
 *   steps             item/blueprint wish+inventar, ship wish+hangar, upcoming ONLY wish (hint 'notYetInGame')
 *   The stops run in parallel: an owned ship can be wished again (a second copy is allowed, r1).
 *
 * WRITE  every action resolves to a PathResult { ok, key, params?, undo?, tone? }: `key` is an i18n key
 *   (itemPath.done.* for the toast, errors.* / itemPath.err.* when ok is false). A refusal that is no failure (this
 *   step does not exist here) carries `tone: 'info'` and is shown neutral, never in the danger tone.
 *     addWish / setWishQty / removeWish
 *     nachholen(qty)             Inventar row "Nachholen": counted up on the wishlist, stock untouched
 *     moveToInventar(place, qty) writes Inventar (an empty place falls back to currentPlaceDefault()) and closes a
 *                                matching Nachschub line
 *     addToHangar                first copy, or one more copy of an owned ship
 *     adjustInventar / removeFromInventar / removeFromHangar
 *   Owning fulfils the wish (W1.5): Inventar and Hangar adds lower the item's own wish by what arrived (to zero = it
 *   goes); the toast says so and its undo brings the wish back with the rest.
 *   `ensureLoaded()`: surfaces call it once they show a state; loads once per user.
 *   `knownPlaces()`: the reader's Inventar places, for the place popover.
 *   `currentPlaceDefault()`: live location when the game runs and the app knows it, else PLACE_WITH_ME (A8).
 *
 * Blueprints are collected, not counted: their Inventar stop is one stock row at PLACE_BLUEPRINTS (the Sammlung).
 */

/** Stored location of "Bei mir" (replaces the old "Ortsfrei" label). */
export const PLACE_WITH_ME = 'Bei mir';
/** Stored location of collected blueprints (always available). */
export const PLACE_BLUEPRINTS = 'Blueprints';

export type PathStep = 'wish' | 'nachschub' | 'inventar' | 'hangar';

export interface PathPlace {
  location: string;
  qty: number;
}

export interface ItemPathState {
  kind: string;
  className: string;
  wished: boolean;
  /** Wished quantity (the cart counter), 0 when not wished. */
  wishQty: number;
  /** Open lines of the class added up: pieces, or SCU when `nachschubUnit` is 'scu'. */
  nachschubQty: number;
  /** 'scu' when the open lines count an exact SCU amount (a blueprint's material), else null = pieces. */
  nachschubUnit: SupplyUnit | null;
  inventarQty: number;
  places: readonly PathPlace[];
  inHangar: boolean;
  /** Owned copies of the ship, 0 when it is not in the Hangar. */
  hangarQty: number;
  hangarShipId: string | null;
  steps: readonly PathStep[];
  /** 'notYetInGame' for announced ships (only the wish step exists). */
  hint: 'notYetInGame' | null;
  signedIn: boolean;
}

/** How a result that is not ok reads: `error` = it failed (danger tone), `info` = refused, nothing went wrong. */
export type PathTone = 'info' | 'error';

export interface PathResult {
  ok: boolean;
  /** i18n key: `itemPath.done.*` (toast text) on success, `errors.*` / `itemPath.err.*` when not ok. */
  key: string;
  params?: Record<string, string | number>;
  /** Reverts exactly this action; absent where nothing sensible can be undone. */
  undo?: () => Promise<PathResult>;
  /** Only when not ok; absent = 'error'. */
  tone?: PathTone;
}

/** A result that is not ok shows as a failure unless it says it is only a refusal. */
export function isPathError(r: Pick<PathResult, 'ok' | 'tone'>): boolean {
  return !r.ok && r.tone !== 'info';
}

/** `moveToInventar`: which line closes, and the unit of the quantity (default: the line's own). */
export interface MoveOpts {
  lineId?: string;
  unit?: 'pcs' | 'scu' | null;
}

const NO_PLACES: readonly PathPlace[] = [];

/** The stops a kind has. */
export function stepsOf(kind: string): readonly PathStep[] {
  if (kind === 'upcoming') return ['wish'];
  if (kind === 'ship') return ['wish', 'hangar'];
  return ['wish', 'inventar'];
}

/** The word the second node carries: Hangar for ships, Sammlung for blueprints, Inventar for everything else. */
export type OwnWord = 'inventar' | 'hangar' | 'sammlung';
export function ownWordOf(kind: string): OwnWord | null {
  if (kind === 'upcoming') return null;
  if (kind === 'ship') return 'hangar';
  return kind === 'blueprint' ? 'sammlung' : 'inventar';
}

const fail = (key: string): PathResult => ({ ok: false, key });
/** Not a failure: the step simply is not there for this item. Shown neutral. */
const refuse = (key: string): PathResult => ({ ok: false, key, tone: 'info' });

/** What owning did to the item's own wish: the quantity before and what is left (0 = the wish went). */
interface WishFulfilled {
  before: number;
  left: number;
  restore: () => Promise<boolean>;
}

@Injectable({ providedIn: 'root' })
export class ItemPathService {
  private readonly auth = inject(AuthService);
  private readonly wishlist = inject(SearchWishlistService);
  private readonly supplies = inject(HqSuppliesService);
  private readonly inventory = inject(HqInventoryService);
  private readonly hangar = inject(HangarService);
  private readonly live = inject(HqLiveService);

  private readonly injector = inject(Injector);

  private readonly cache = new Map<string, Signal<ItemPathState>>();
  private loadedFor: string | null = null;

  /** The stores behind `state()` hold nothing until somebody loads them. Once per user. */
  ensureLoaded(): void {
    const id = this.auth.user()?.id ?? null;
    untracked(() => {
      this.wishlist.ensureLoaded();
      if (!id || this.loadedFor === id) return;
      this.loadedFor = id;
      void this.inventory.load();
      void this.injector.get(HqOwnershipService).ensureLoaded();
    });
  }

  /**
   * Class names of the blueprints the reader has (the PLACE_BLUEPRINTS shelf): the codex
   * blueprint list's "Nur meine" filter and its "Ich habe diese" toggle read this one set.
   */
  readonly ownedBlueprints = computed<ReadonlySet<string>>(() => {
    const out = new Set<string>();
    for (const i of this.inventory.items()) {
      if (i.location !== PLACE_BLUEPRINTS) continue;
      const cls = parseStockRef(i.class_name)?.className;
      if (cls) out.add(cls);
    }
    return out;
  });

  /**
   * "Ich habe diese" (codex blueprint list): marks a blueprint as collected without the desktop
   * app, or takes the mark off again. Same rows as the item path's Inventar step.
   */
  setBlueprintOwned(className: string, name: string, owned: boolean): Promise<PathResult> {
    return owned
      ? this.moveToInventar('blueprint', className, name, PLACE_BLUEPRINTS, 1)
      : this.removeFromInventar('blueprint', className, name);
  }

  /** The places the reader already uses, without the blueprint shelf. */
  knownPlaces(): string[] {
    const seen = new Set<string>();
    for (const i of this.inventory.items()) if (i.location !== PLACE_BLUEPRINTS) seen.add(i.location);
    return [...seen];
  }

  /** The reader's place right now (A8): the live location while playing, else "Bei mir". */
  currentPlaceDefault(): string {
    const state = this.live.state();
    if (state && isGameLive(state, this.live.events(), Date.now())) {
      const loc = readLocation(state);
      if (loc?.name) return loc.name;
    }
    return PLACE_WITH_ME;
  }

  /** Reactive state of one item. Cached per (kind, className, name). */
  state(kind: string, className: string, name?: string | null): Signal<ItemPathState> {
    const id = `${kind}|${className.toLowerCase()}|${name ?? ''}`;
    let s = this.cache.get(id);
    if (!s) {
      s = computed(() => this.read(kind, className, name));
      this.cache.set(id, s);
    }
    return s;
  }

  /** One-off read (what `state()` computes). */
  read(kind: string, className: string, name?: string | null): ItemPathState {
    const cls = className.toLowerCase();
    const ship = kind === 'ship' ? this.hangar.shipByClassName(className) : null;
    const owned = ship?.status === 'owned' ? ship : null;
    let places: PathPlace[] = [];
    let nachschubQty = 0;
    let nachschubUnit: SupplyUnit | null = null;
    if (kind !== 'upcoming') {
      for (const i of this.inventory.items()) {
        // Manual entries store `<kind>:<Class>` (hq-stock-ref); the path counts them like a bare class name.
        if ((parseStockRef(i.class_name)?.className ?? '').toLowerCase() !== cls) continue;
        const q = i.qty > 0 ? i.qty : 1;
        const have = places.find((p) => p.location === i.location);
        if (have) have.qty += q;
        else places.push({ location: i.location, qty: q });
      }
      const lines = this.supplies.openLinesFor(className);
      nachschubUnit = lines[0]?.unit ?? null;
      // Lines of the other kind of quantity (pieces vs SCU) are not added to the first one's.
      nachschubQty = roundAmount(lines.filter((l) => (l.unit ?? null) === nachschubUnit).reduce((n, l) => n + lineAmount(l), 0));
    }
    if (!places.length) places = NO_PLACES as PathPlace[];
    return {
      kind,
      className,
      wished: this.wishlist.has(kind, className, name),
      wishQty: this.wishlist.qtyOf(kind, className, name),
      nachschubQty,
      nachschubUnit,
      inventarQty: places.reduce((n, p) => n + p.qty, 0),
      places,
      inHangar: !!owned,
      hangarQty: owned ? (owned.qty ?? 1) : 0,
      hangarShipId: owned?.id ?? null,
      steps: stepsOf(kind),
      hint: kind === 'upcoming' ? 'notYetInGame' : null,
      signedIn: !!this.auth.user(),
    };
  }

  // ── wish ───────────────────────────────────────────────────────────────────

  /** One on the wishlist. An owned ship takes a wish too: one more copy (r1, second copy allowed). */
  async addWish(kind: string, className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    if (this.wishlist.has(kind, className, name)) return { ok: true, key: 'itemPath.done.wishOn', params: { name: name ?? className } };
    try {
      if (!(await this.wishlist.add(kind, className, name))) return fail('itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'addWish', err));
    }
    return { ok: true, key: 'itemPath.done.wishOn', params: { name: name ?? className }, undo: () => this.removeWish(kind, className, name) };
  }

  /** The cart counter of the detail page: set the wished quantity, 0 or less takes the entry off (with undo). */
  async setWishQty(kind: string, className: string, name: string | null | undefined, qty: number): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    if (qty <= 0) return this.removeWish(kind, className, name);
    if (!this.wishlist.has(kind, className, name)) return this.addWish(kind, className, name);
    try {
      if (!(await this.wishlist.setQty(kind, className, name, qty))) return fail('itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'setWishQty', err));
    }
    // A counter step is its own feedback: no toast, nothing to undo.
    return { ok: true, key: 'itemPath.done.wishQty', params: { name: name ?? className, qty } };
  }

  async removeWish(kind: string, className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    try {
      if (!(await this.wishlist.remove(kind, className, name))) return fail('itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'removeWish', err));
    }
    return { ok: true, key: 'itemPath.done.wishOff', params: { name: name ?? className }, undo: () => this.addWish(kind, className, name) };
  }

  /**
   * Inventar row "Nachholen": the item goes back on the wishlist, counted up by `qty` (the tile button's rule); the
   * stock stays as it is. SCU stock is wished as material, whole SCU rounded up. Undo sets the wish back.
   */
  async nachholen(kind: string, className: string, name: string, qty = 1, unit: 'pcs' | 'scu' = 'pcs'): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    if (kind === 'upcoming') return refuse('itemPath.err.unavailable');
    const wishKind = unit === 'scu' ? 'material' : kind;
    const n = unit === 'scu' ? Math.max(1, Math.ceil(qty - 1e-9)) : Math.max(1, Math.round(qty));
    const before = this.wishlist.qtyOf(wishKind, className, name);
    try {
      if (!(await this.wishlist.setQty(wishKind, className, name, before + n))) return fail('itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'nachholen', err));
    }
    return {
      ok: true,
      key: 'itemPath.done.wishOn',
      params: { name },
      undo: async () =>
        (await this.wishlist.setQty(wishKind, className, name, before)) ? { ok: true, key: 'itemPath.done.undone', params: { name } } : fail('itemPath.err.failed'),
    };
  }

  // ── Inventar ───────────────────────────────────────────────────────────────

  /**
   * The quantity lands in Inventar at `place`; a matching open Nachschub line closes (or shrinks by `qty`), and the
   * item's own wish shrinks by what arrived. Blueprints are collected, not counted: one row at PLACE_BLUEPRINTS.
   */
  async moveToInventar(kind: string, className: string, name: string, place: string, qty = 1, opts: MoveOpts = {}): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    if (!stepsOf(kind).includes('inventar')) return refuse('itemPath.err.unavailable');
    const where = (kind === 'blueprint' ? PLACE_BLUEPRINTS : place.trim()) || this.currentPlaceDefault();
    const open = this.supplies.openLinesFor(className);
    const line = (opts.lineId ? open.find((l) => l.id === opts.lineId) : undefined) ?? open[0];
    // An SCU amount lands in Inventar as SCU (the row's unit), exact; pieces stay whole numbers.
    const scu = (opts.unit ?? line?.unit) === 'scu';
    const n = scu ? roundAmount(Math.max(qty, 0)) : Math.max(1, Math.round(qty));
    if (n <= 0) return fail('itemPath.err.failed');
    try {
      if (!(await this.inventory.addStock(where, name, n, scu ? 'scu' : 'pcs', className))) return fail(this.inventory.error() ?? 'itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'moveToInventar', err));
    }
    const lineBefore = line ? { id: line.id, qty: line.qty, amount: line.amount } : null;
    if (line) {
      const have = lineAmount(line);
      if (n >= have - 1e-9) this.supplies.setDone(line.id, true);
      else if (line.amount !== null) this.supplies.setLine(line.id, Math.max(1, Math.round((line.qty * (have - n)) / have)), roundAmount(have - n));
      else this.supplies.setQty(line.id, line.qty - n);
    }
    // SCU stock answers a material wish; an item wished as such keeps its own kind.
    const wishKind = scu && !this.wishlist.has(kind, className, name) ? 'material' : kind;
    const wish = await this.fulfilOwnWish(wishKind, className, name, scu ? Math.ceil(n - 1e-9) : n);
    return {
      ok: true,
      ...(wish ? this.wishDone(name, wish) : { key: 'itemPath.done.inventar', params: { name, where } }),
      undo: async () => {
        const removed = await this.inventory.removeStock(where, name, n, className);
        if (lineBefore) {
          this.supplies.setDone(lineBefore.id, false);
          this.supplies.setLine(lineBefore.id, lineBefore.qty, lineBefore.amount);
        }
        const back = wish ? await wish.restore() : true;
        return removed && back ? { ok: true, key: 'itemPath.done.undone', params: { name } } : fail('itemPath.err.failed');
      },
    };
  }

  /** The stepper of the Inventar popover: stock at one place moves, a Nachschub line stays as it is. */
  async adjustInventar(className: string, name: string, place: string, delta: number): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    const n = Math.abs(Math.round(delta));
    const write = (more: boolean): Promise<boolean> =>
      more ? this.inventory.addStock(place, name, n, 'pcs', className) : this.inventory.removeStock(place, name, n, className);
    try {
      if (n && !(await write(delta > 0))) return fail(this.inventory.error() ?? 'itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'adjustInventar', err));
    }
    return {
      ok: true,
      key: 'itemPath.done.inventarOff',
      params: { name },
      undo: async () => ((await write(delta < 0)) ? { ok: true, key: 'itemPath.done.undone', params: { name } } : fail('itemPath.err.failed')),
    };
  }

  /** "Entfernen": the item leaves every place. */
  async removeFromInventar(kind: string, className: string, name: string): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    const places = this.read(kind, className, name).places;
    try {
      for (const p of places) {
        if (!(await this.inventory.removeStock(p.location, name, p.qty, className))) return fail(this.inventory.error() ?? 'itemPath.err.failed');
      }
    } catch (err) {
      return fail(toErrorKey('itemPath', 'removeFromInventar', err));
    }
    return {
      ok: true,
      key: 'itemPath.done.inventarOff',
      params: { name },
      undo: async () => {
        for (const p of places) {
          if (!(await this.inventory.addStock(p.location, name, p.qty, 'pcs', className))) return fail('itemPath.err.failed');
        }
        return { ok: true, key: 'itemPath.done.undone', params: { name } };
      },
    };
  }

  // ── Hangar ─────────────────────────────────────────────────────────────────

  /**
   * One copy more in the Hangar, and one copy less on the wishlist:
   *   not there yet        -> the first copy (owned);
   *   only wished (n)      -> the row turns owned with ONE copy; the other n-1 stay wished (as the owned ship's wish);
   *   owned already        -> one more copy on the same row (a second copy is allowed, r1).
   * Undo puts copies and wish back exactly as they were.
   */
  async addToHangar(className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    const label = name ?? className;
    const had = this.hangar.shipByClassName(className);
    try {
      if (had?.status === 'wishlist') return await this.buyWishedShip(had.id, had.qty ?? 1, className, label);
      if (had) {
        const before = had.qty ?? 1;
        const copies = await this.injector.get(NachschubEdgeService).addShipCopy(className);
        if (!copies) return fail('itemPath.err.failed');
        const wish = await this.fulfilOwnWish('ship', className, name, 1);
        return {
          ok: true,
          ...(wish ? this.wishDone(label, wish) : { key: 'itemPath.done.hangarCopy', params: { name: label, n: copies } }),
          undo: async () => {
            const ok = await this.hangar.updateShip(had.id, { qty: before });
            const back = wish ? await wish.restore() : true;
            return ok && back ? { ok: true, key: 'itemPath.done.undone', params: { name: label } } : fail('itemPath.err.failed');
          },
        };
      }
      const added = await this.hangar.addShip(className, 'owned');
      if (!added) return fail('itemPath.err.failed');
      // A wish kept from an earlier copy (removed from the Hangar since) is answered by this one.
      const wish = await this.fulfilOwnWish('ship', className, name, 1);
      return {
        ok: true,
        ...(wish ? this.wishDone(label, wish) : { key: 'itemPath.done.hangar', params: { name: label } }),
        undo: async () => {
          const ok = await this.hangar.removeShip(added.id);
          const back = wish ? await wish.restore() : true;
          return ok && back ? { ok: true, key: 'itemPath.done.undone', params: { name: label } } : fail('itemPath.err.failed');
        },
      };
    } catch (err) {
      return fail(toErrorKey('itemPath', 'addToHangar', err));
    }
  }

  /** A ship wished `wished` times is bought once: the row owns one copy, the rest stays on the wishlist. */
  private async buyWishedShip(id: string, wished: number, className: string, label: string): Promise<PathResult> {
    if (!(await this.hangar.updateShip(id, { status: 'owned', qty: 1 }))) return fail('itemPath.err.failed');
    const left = wished - 1;
    if (left > 0 && !(await this.wishlist.setQty('ship', className, label, left))) {
      // The move is one step for the reader: a wish that cannot stay keeps the purchase out too.
      await this.hangar.updateShip(id, { status: 'wishlist', qty: wished });
      return fail('itemPath.err.failed');
    }
    return {
      ok: true,
      ...this.wishDone(label, { left }),
      undo: async () => {
        // The owned ship's wish goes first, while the row is still owned (a wished row would go along with it).
        const gone = left > 0 ? await this.wishlist.remove('ship', className, label) : true;
        const ok = gone && (await this.hangar.updateShip(id, { status: 'wishlist', qty: wished }));
        return ok ? { ok: true, key: 'itemPath.done.undone', params: { name: label } } : fail('itemPath.err.failed');
      },
    };
  }

  /** The hangar row goes, and with it what hangs on it. No undo: the caller asks first. */
  async removeFromHangar(className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.err.failed');
    const ship = this.hangar.shipByClassName(className);
    if (!ship) return fail('itemPath.err.failed');
    try {
      if (!(await this.hangar.removeShip(ship.id))) return fail('itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'removeFromHangar', err));
    }
    return { ok: true, key: 'itemPath.done.hangarOff', params: { name: name ?? className } };
  }

  // ── owning fulfils the wish ──────────────────────────────────────────────────

  /**
   * `gained` copies arrived: the item's own wish (not material wished for a blueprint) shrinks by that, to zero = it
   * goes. Null when nothing was wished - or when the wishlist write failed: the add itself stands, the wish stays.
   */
  private async fulfilOwnWish(kind: string, className: string, name: string | null | undefined, gained: number): Promise<WishFulfilled | null> {
    const before = this.wishlist.qtyOf(kind, className, name);
    if (before <= 0 || gained <= 0) return null;
    const left = Math.max(0, before - gained);
    try {
      if (!(await this.wishlist.setQty(kind, className, name, left))) {
        logWarn('itemPath', 'wish not fulfilled', { kind });
        return null;
      }
    } catch (err) {
      logWarn('itemPath', 'wish not fulfilled', err);
      return null;
    }
    return { before, left, restore: () => this.wishlist.setQty(kind, className, name, before) };
  }

  /** The toast after owning answered a wish: fulfilled, or how many are still wished. */
  private wishDone(name: string, w: Pick<WishFulfilled, 'left'>): Pick<PathResult, 'key' | 'params'> {
    return w.left > 0 ? { key: 'itemPath.done.ownWishLeft', params: { name, left: w.left } } : { key: 'itemPath.done.ownWish', params: { name } };
  }
}
