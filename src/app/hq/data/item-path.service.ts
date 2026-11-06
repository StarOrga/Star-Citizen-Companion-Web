import { Injectable, Injector, Signal, computed, inject, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { CodexService } from '../../codex/codex.service';
import { cleanLocaleValue, formatQuantity, humanizeClassName } from '../../codex/codex-format';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { HangarService } from '../../hangar/hangar.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqLiveService } from '../now/hq-live.service';
import { isGameLive, readLocation } from '../now/hq-live.util';
import { AddedLine, HqSuppliesService, SupplyItem, SupplyUnit, lineAmount, roundAmount } from '../hq-supplies.service';
import type { StepKind } from '../../shared/step/sc-step.component';
import { parseStockRef } from '../stock/hq-stock-ref';
import { HqInventoryService } from './hq-inventory.service';

/*
 * ItemPathService - THE contract of the wish -> Nachschub -> Inventar (-> Hangar) path
 * (concept "Gegenstand weg", checklist section A). Every surface (search rows, Codex pages,
 * set editor, HQ, popups) reads and writes the path through this service only.
 *
 * READ  `state(kind, className, name?)` -> Signal<ItemPathState>
 *   wished        on the wishlist (live ships: hangar status wishlist; announced ships: by name)
 *   nachschubQty  units still open in Nachschub (sum of open lines of that class)
 *   inventarQty   units in Inventar over all places;  places[] = [{ location, qty }]
 *   inHangar      ship owned (kind ship);  hangarShipId for the link "Im Hangar ansehen"
 *   steps         the stops this kind has, in order: item/blueprint wish+nachschub+inventar,
 *                 ship wish+nachschub+hangar, upcoming ONLY wish (hint 'notYetInGame')
 *   Steps run in PARALLEL (gw-modell = par): all flags can be true at once.
 *   Ships: wished and inHangar exclude each other (one hangar_ships row, status flips).
 *
 * WRITE  every action resolves to a PathResult { ok, key, params?, undo? }:
 *   key is an i18n key (itemPath.done.* for a toast, errors.* when ok is false); `undo`
 *   is present where the checklist asks for it (A5 wish -> Nachschub, A6, A7) and returns
 *   another PathResult. Signed out -> { ok:false, key:'itemPath.needSignIn' }, nothing written.
 *     addWish / removeWish
 *     addToNachschub(qty, opts)  a wished item MOVES: the wish goes (A5), undo restores it
 *     setNachschubQty            qty <= 0 removes the line
 *     moveToInventar(place, qty) "Besorgt": writes Inventar (adds to the place) and closes the
 *                                line; an empty place falls back to currentPlaceDefault()
 *     tickOnly                   "Nur abhaken": closes the line, Inventar untouched
 *     nachholen(qty)             Inventar row "Nachholen": +qty in Nachschub, stock untouched
 *     addToHangar                ship owned (flips a wished ship); closes nothing else
 *     changeNachschubQty(delta)  the stepper of the Nachschub popover; 0 removes the line
 *     removeFromNachschub        all open lines of the class, undo brings them back
 *     adjustInventar(place, d)   the stepper of the Inventar popover; a Nachschub line stays
 *     removeFromInventar         every place of the class, undo brings them back
 *     removeFromHangar           the hangar row; no undo (loadouts go with it), the caller asks
 *   `ensureLoaded()`: surfaces call it once they show a state; loads once per user.
 *   `knownPlaces()`: the reader's Inventar places, for the place popover.
 *   `currentPlaceDefault()`: live location when the game runs and the app knows it, else
 *   PLACE_WITH_ME (A8).
 *
 * Blueprints (A9): all three stops. Inventar = "collected", stored as a stock row at
 * PLACE_BLUEPRINTS. Nachschub = the blueprint line PLUS its material: every ingredient with a class
 * name becomes a line of its own, with the EXACT SCU amount (`hq_supplies.amount` + `unit`, 0.36 stays
 * 0.36) and `for_class_name` = the blueprint. That link is the whole rule of removal: taking the
 * blueprint out of Nachschub takes the lines that point at it along; a line added on its own, or for
 * another blueprint, has another link (or none) and stays. Undo brings every line back. The same
 * material from two blueprints is two lines (each removable on its own); `nachschubQty` of the
 * material adds them up. `qty` of an amount line counts portions (one blueprint's worth = the step of
 * the -/+ buttons). The blueprint line stays plain until the build carries `missionSource`
 * (`codex/blueprint-missions.ts`, filled by the uploader): then "Zum Einsatz" on the blueprint page
 * passes `opts.stepKind = 'mission'`, and the line links back to that page from the popup.
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
  /** Open lines of the class added up: pieces, or SCU when `nachschubUnit` is 'scu'. */
  nachschubQty: number;
  /** 'scu' when the open lines count an exact SCU amount (a blueprint's material), else null = pieces. */
  nachschubUnit: SupplyUnit | null;
  inventarQty: number;
  places: readonly PathPlace[];
  inHangar: boolean;
  hangarShipId: string | null;
  steps: readonly PathStep[];
  /** 'notYetInGame' for announced ships (only the wish step exists). */
  hint: 'notYetInGame' | null;
  signedIn: boolean;
}

export interface PathResult {
  ok: boolean;
  /** i18n key: `itemPath.done.*` (toast text) on success, `itemPath.needSignIn` / `errors.*` on failure. */
  key: string;
  params?: Record<string, string | number>;
  /** Reverts exactly this action; absent where nothing sensible can be undone. */
  undo?: () => Promise<PathResult>;
}

/** `moveToInventar`: which line closes, and the unit of the quantity (default: the line's own). */
export interface MoveOpts {
  lineId?: string;
  unit?: 'pcs' | 'scu' | null;
}

export interface NachschubOpts {
  stepKind?: StepKind | null;
}

/** One ingredient of a blueprint as a Nachschub line. */
export interface MaterialLine {
  className: string;
  name: string;
  entityKind: string | null;
  /** The recipe's exact SCU (0.36); null when the recipe gives none (the line is then 1 piece). */
  amount: number | null;
}

/**
 * The ingredients of a recipe as Nachschub lines: unresolved slots (no class name) are skipped,
 * the same material in two slots is one line with the amounts added up, exact (never rounded up).
 */
export function materialLines(
  ingredients: readonly { ingredientClassName: string | null; nameLocalized: string | null; entityKind: string | null; quantity: number }[],
): MaterialLine[] {
  const out = new Map<string, MaterialLine & { scu: number }>();
  for (const ing of ingredients) {
    const cls = ing.ingredientClassName?.trim();
    if (!cls) continue;
    const key = cls.toLowerCase();
    const have = out.get(key);
    const scu = (have?.scu ?? 0) + Math.max(0, ing.quantity || 0);
    out.set(key, {
      className: cls,
      name: have?.name ?? (cleanLocaleValue(ing.nameLocalized) || humanizeClassName(cls)),
      // A material the catalog cannot place is stocked like an item, so its line can be fetched and stored too.
      entityKind: have?.entityKind ?? ing.entityKind ?? 'item',
      amount: scu > 0 ? roundAmount(scu) : null,
      scu,
    });
  }
  return [...out.values()].map(({ scu: _scu, ...line }) => line);
}

const NO_PLACES: readonly PathPlace[] = [];

/** The stops a kind has. */
export function stepsOf(kind: string): readonly PathStep[] {
  if (kind === 'upcoming') return ['wish'];
  if (kind === 'ship') return ['wish', 'nachschub', 'hangar'];
  return ['wish', 'nachschub', 'inventar'];
}

const fail = (key: string): PathResult => ({ ok: false, key });

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
      nachschubQty,
      nachschubUnit,
      inventarQty: places.reduce((n, p) => n + p.qty, 0),
      places,
      inHangar: ship?.status === 'owned',
      hangarShipId: ship?.status === 'owned' ? ship.id : null,
      steps: stepsOf(kind),
      hint: kind === 'upcoming' ? 'notYetInGame' : null,
      signedIn: !!this.auth.user(),
    };
  }

  // ── wish ───────────────────────────────────────────────────────────────────

  async addWish(kind: string, className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    if (this.wishlist.has(kind, className, name)) return { ok: true, key: 'itemPath.done.wishOn', params: { name: name ?? className } };
    try {
      if (!(await this.wishlist.add(kind, className, name))) return fail(wishFailKey(kind, this.hangar.shipByClassName(className)?.status));
    } catch (err) {
      return fail(toErrorKey('itemPath', 'addWish', err));
    }
    return { ok: true, key: 'itemPath.done.wishOn', params: { name: name ?? className }, undo: () => this.removeWish(kind, className, name) };
  }

  async removeWish(kind: string, className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    try {
      if (!(await this.wishlist.remove(kind, className, name))) return fail('itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'removeWish', err));
    }
    return { ok: true, key: 'itemPath.done.wishOff', params: { name: name ?? className }, undo: () => this.addWish(kind, className, name) };
  }

  // ── Nachschub ──────────────────────────────────────────────────────────────

  /**
   * A wished item moves into Nachschub (A5): the wish disappears, undo restores it and the line.
   * A blueprint brings its material along (A9): one extra line per ingredient, undone together.
   */
  async addToNachschub(kind: string, className: string, name: string, qty = 1, opts: NachschubOpts = {}): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    if (!stepsOf(kind).includes('nachschub')) return fail('itemPath.err.unavailable');
    const materials = kind === 'blueprint' ? await this.materialsOf(className) : [];
    const wasWished = this.wishlist.has(kind, className, name);
    const line = this.supplies.addLine(name, qty, { entityKind: kind, className, stepKind: opts.stepKind ?? null, source: 'search' });
    if (!line) return fail('itemPath.err.listFull');
    const added: AddedLine[] = [line];
    for (const m of materials) {
      // One portion per blueprint asked for; the amount is that many recipes' worth, exact.
      const l = this.supplies.addLine(m.name, qty, {
        entityKind: m.entityKind,
        className: m.className,
        source: 'search',
        forClassName: className,
        ...(m.amount !== null ? { amount: m.amount * qty, unit: 'scu' as const } : {}),
      });
      if (l) added.push(l);
    }
    const revertAll = (): void => {
      for (const l of added) this.revertLine(l);
    };
    if (wasWished) {
      // The line reaches the server first: a push that fails must not cost the reader the wish.
      await this.supplies.sync();
      if (this.supplies.syncError()) {
        revertAll();
        return fail('itemPath.err.failed');
      }
      let removed: boolean;
      try {
        removed = await this.wishlist.remove(kind, className, name);
      } catch {
        removed = false;
      }
      if (!removed) {
        // The move is atomic for the reader: a wish that cannot go keeps the line out too.
        revertAll();
        return fail('itemPath.err.failed');
      }
    }
    const withMaterial = added.length > 1;
    return {
      ok: true,
      key: wasWished ? (withMaterial ? 'itemPath.done.movedMaterial' : 'itemPath.done.moved') : withMaterial ? 'itemPath.done.nachschubMaterial' : 'itemPath.done.nachschub',
      params: { name, n: added.length - 1 },
      undo: async () => {
        revertAll();
        if (wasWished) await this.wishlist.add(kind, className, name);
        return { ok: true, key: 'itemPath.done.undone', params: { name } };
      },
    };
  }

  /** The recipe's material; an unreadable recipe leaves the blueprint line plain. */
  private async materialsOf(className: string): Promise<MaterialLine[]> {
    try {
      const detail = await this.injector.get(CodexService).getBlueprint(className);
      return materialLines(detail?.ingredients ?? []);
    } catch (err) {
      logWarn('itemPath', 'blueprint material unavailable', err);
      return [];
    }
  }

  /** `qty` is the line's own count: pieces, or portions on an SCU line (its amount follows). */
  setNachschubQty(kind: string, className: string, qty: number): PathResult {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    // A blueprint that goes takes its material along, like "Entfernen".
    if (qty <= 0 && kind === 'blueprint') return this.removeFromNachschub(kind, className);
    const line = this.supplies.openLinesFor(className)[0];
    if (!line) return fail('itemPath.err.noLine');
    const before = { qty: line.qty, amount: line.amount };
    if (qty <= 0) this.supplies.remove(line.id);
    else this.supplies.setQty(line.id, qty);
    const now = this.supplies.items().find((i) => i.id === line.id);
    return {
      ok: true,
      key: qty <= 0 ? 'itemPath.done.nachschubOff' : 'itemPath.done.qty',
      params: { name: line.name, qty: now && now.amount !== null ? `${formatQuantity(now.amount)} SCU` : qty },
      undo: async () => {
        if (qty <= 0) this.supplies.restore(line.id);
        else this.supplies.setLine(line.id, before.qty, before.amount);
        return { ok: true, key: 'itemPath.done.undone', params: { name: line.name } };
      },
    };
  }

  /** The stepper of the Nachschub popover: the first open line moves by `delta`, 0 removes it. */
  changeNachschubQty(kind: string, className: string, delta: number): PathResult {
    const line = this.supplies.openLinesFor(className)[0];
    return this.setNachschubQty(kind, className, (line?.qty ?? 0) + delta);
  }

  /**
   * "Entfernen": all open lines of the class leave Nachschub. A blueprint also takes the material lines
   * that were added for it (`forClassName`); lines added on their own or for another blueprint stay.
   * Undo restores every line exactly as it was.
   */
  removeFromNachschub(kind: string, className: string): PathResult {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    const own = this.supplies.openLinesFor(className);
    const material = kind === 'blueprint' ? this.supplies.openLinesForBlueprint(className).filter((m) => !own.some((o) => o.id === m.id)) : [];
    const lines: SupplyItem[] = [...own, ...material];
    if (!lines.length) return fail('itemPath.err.noLine');
    for (const l of lines) this.supplies.remove(l.id);
    const name = own[0]?.name ?? lines[0].name;
    return {
      ok: true,
      key: material.length ? 'itemPath.done.nachschubOffMaterial' : 'itemPath.done.nachschubOff',
      params: { name, n: material.length },
      undo: async () => {
        for (const l of lines) this.supplies.restore(l.id);
        return { ok: true, key: 'itemPath.done.undone', params: { name } };
      },
    };
  }

  /** Inventar row "Nachholen" (A7): +qty in Nachschub, the stock stays as it is. */
  nachholen(kind: string, className: string, name: string, qty = 1, unit: 'pcs' | 'scu' = 'pcs'): PathResult {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    if (!stepsOf(kind).includes('nachschub')) return fail('itemPath.err.unavailable');
    // SCU stock comes back as the same exact amount, never as pieces.
    const exact = unit === 'scu' && qty > 0;
    const line = exact
      ? this.supplies.addLine(name, 1, { entityKind: kind, className, source: 'search', amount: qty, unit: 'scu' })
      : this.supplies.addLine(name, qty, { entityKind: kind, className, source: 'search' });
    if (!line) return fail('itemPath.err.listFull');
    return {
      ok: true,
      key: 'itemPath.done.nachholen',
      params: { name, qty: exact ? `${formatQuantity(qty)} SCU` : qty },
      undo: async () => {
        this.revertLine(line);
        return { ok: true, key: 'itemPath.done.undone', params: { name } };
      },
    };
  }

  // ── Inventar ───────────────────────────────────────────────────────────────

  /**
   * "Besorgt" (A6): the quantity lands in Inventar at `place` and the Nachschub line closes (or
   * shrinks by `qty`). Also the inline add of an empty Inventar node: without a line only the
   * stock is written. Blueprints are collected, not counted: one row at PLACE_BLUEPRINTS.
   */
  async moveToInventar(kind: string, className: string, name: string, place: string, qty = 1, opts: MoveOpts = {}): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    if (!stepsOf(kind).includes('inventar')) return fail('itemPath.err.unavailable');
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
    return {
      ok: true,
      key: 'itemPath.done.inventar',
      params: { name, where },
      undo: async () => {
        const removed = await this.inventory.removeStock(where, name, n, className);
        if (lineBefore) {
          this.supplies.setDone(lineBefore.id, false);
          this.supplies.setLine(lineBefore.id, lineBefore.qty, lineBefore.amount);
        }
        return removed ? { ok: true, key: 'itemPath.done.undone', params: { name } } : fail('itemPath.err.failed');
      },
    };
  }

  /** The stepper of the Inventar popover: stock at one place moves, a Nachschub line stays as it is. */
  async adjustInventar(className: string, name: string, place: string, delta: number): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
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
    if (!this.auth.user()) return fail('itemPath.needSignIn');
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

  /** "Nur abhaken": the line is done, Inventar untouched. */
  tickOnly(className: string, lineId?: string): PathResult {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    const open = this.supplies.openLinesFor(className);
    const line = (lineId ? open.find((l) => l.id === lineId) : undefined) ?? open[0];
    if (!line) return fail('itemPath.err.noLine');
    this.supplies.setDone(line.id, true);
    return {
      ok: true,
      key: 'itemPath.done.ticked',
      params: { name: line.name },
      undo: async () => {
        this.supplies.setDone(line.id, false);
        return { ok: true, key: 'itemPath.done.undone', params: { name: line.name } };
      },
    };
  }

  // ── Hangar ─────────────────────────────────────────────────────────────────

  /** The ship is in the hangar now. A wished ship flips to owned (one row per class). */
  async addToHangar(className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    const label = name ?? className;
    const had = this.hangar.shipByClassName(className);
    if (had?.status === 'owned') return { ok: true, key: 'itemPath.done.hangar', params: { name: label } };
    try {
      if (had) {
        if (!(await this.hangar.updateShip(had.id, { status: 'owned' }))) return fail('itemPath.err.failed');
      } else if (!(await this.hangar.addShip(className, 'owned'))) {
        return fail('itemPath.err.failed');
      }
    } catch (err) {
      return fail(toErrorKey('itemPath', 'addToHangar', err));
    }
    return {
      ok: true,
      key: 'itemPath.done.hangar',
      params: { name: label },
      undo: async () => {
        const now = this.hangar.shipByClassName(className);
        if (!now) return fail('itemPath.err.failed');
        const ok = had ? await this.hangar.updateShip(now.id, { status: 'wishlist' }) : await this.hangar.removeShip(now.id);
        return ok ? { ok: true, key: 'itemPath.done.undone', params: { name: label } } : fail('itemPath.err.failed');
      },
    };
  }

  /** The hangar row goes, and with it what hangs on it. No undo: the caller asks first. */
  async removeFromHangar(className: string, name?: string | null): Promise<PathResult> {
    if (!this.auth.user()) return fail('itemPath.needSignIn');
    const ship = this.hangar.shipByClassName(className);
    if (!ship) return fail('itemPath.err.failed');
    try {
      if (!(await this.hangar.removeShip(ship.id))) return fail('itemPath.err.failed');
    } catch (err) {
      return fail(toErrorKey('itemPath', 'removeFromHangar', err));
    }
    return { ok: true, key: 'itemPath.done.hangarOff', params: { name: name ?? className } };
  }

  private revertLine(l: AddedLine): void {
    if (l.prevQty <= 0) this.supplies.remove(l.id);
    else this.supplies.setLine(l.id, l.prevQty, l.prevAmount);
  }
}

function wishFailKey(kind: string, status: string | undefined): string {
  return kind === 'ship' && status === 'owned' ? 'itemPath.err.alreadyOwned' : 'itemPath.err.failed';
}
