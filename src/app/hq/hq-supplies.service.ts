import { Injectable, computed, signal } from '@angular/core';
import { logWarn } from '../core/log';

/** One line of the supplies list: a task you tick off, shaped like a cart line (name x quantity). */
export interface SupplyItem {
  readonly id: string;
  readonly name: string;
  readonly qty: number;
  readonly done: boolean;
}

export const SUPPLIES_STORAGE_KEY = 'sc.hq.supplies';
export const SUPPLIES_MAX_ITEMS = 100;
export const SUPPLY_NAME_MAX = 80;
export const SUPPLY_QTY_MAX = 999;

/**
 * The "Nachschub" list (shell beta): what your ships, sets and ops still need,
 * as a task list that behaves like a shopping cart. Local to this browser for
 * now - a server table would need a migration, and the list is a personal
 * scratch pad, not account data. Storage failures degrade to memory.
 */
@Injectable({ providedIn: 'root' })
export class HqSuppliesService {
  readonly items = signal<readonly SupplyItem[]>(read());
  readonly open = computed(() => this.items().filter((i) => !i.done));
  readonly done = computed(() => this.items().filter((i) => i.done));
  /** Units still to get (sum of the open lines' quantities). */
  readonly openUnits = computed(() => this.open().reduce((n, i) => n + i.qty, 0));

  add(name: string, qty: number): boolean {
    const clean = name.trim().slice(0, SUPPLY_NAME_MAX);
    if (!clean || this.items().length >= SUPPLIES_MAX_ITEMS) return false;
    const q = clampQty(qty);
    // Same name (case-insensitive) and still open: raise its quantity like a cart does.
    const same = this.items().find((i) => !i.done && i.name.toLowerCase() === clean.toLowerCase());
    if (same) {
      this.set(this.items().map((i) => (i === same ? { ...i, qty: clampQty(i.qty + q) } : i)));
    } else {
      this.set([...this.items(), { id: newId(), name: clean, qty: q, done: false }]);
    }
    return true;
  }

  toggle(id: string): void {
    this.set(this.items().map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }

  setQty(id: string, qty: number): void {
    this.set(this.items().map((i) => (i.id === id ? { ...i, qty: clampQty(qty) } : i)));
  }

  remove(id: string): void {
    this.set(this.items().filter((i) => i.id !== id));
  }

  clearDone(): void {
    this.set(this.items().filter((i) => !i.done));
  }

  private set(next: readonly SupplyItem[]): void {
    this.items.set(next);
    try {
      localStorage.setItem(SUPPLIES_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      logWarn('hq', 'supplies storage write failed', err);
    }
  }
}

function clampQty(n: number): number {
  return Number.isFinite(n) ? Math.min(SUPPLY_QTY_MAX, Math.max(1, Math.round(n))) : 1;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

function read(): readonly SupplyItem[] {
  try {
    const raw = localStorage.getItem(SUPPLIES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    const out: SupplyItem[] = [];
    for (const r of parsed.slice(0, SUPPLIES_MAX_ITEMS)) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      if (typeof o['id'] !== 'string' || typeof o['name'] !== 'string' || !o['name'].trim()) continue;
      out.push({
        id: o['id'],
        name: o['name'].slice(0, SUPPLY_NAME_MAX),
        qty: clampQty(Number(o['qty'])),
        done: o['done'] === true,
      });
    }
    return out;
  } catch (err) {
    logWarn('hq', 'supplies storage read failed', err);
    return [];
  }
}
