import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { toErrorKey } from '../../core/describe-error';

/** One commodity at one terminal (`commodity-prices` edge function, UEX community data). */
export interface CommodityPrice {
  commodityId: number;
  commodity: string;
  terminalId: number;
  terminal: string;
  /** UEC per SCU; null = not bought / sold at this terminal. */
  buy: number | null;
  sell: number | null;
  buyAvg: number | null;
  sellAvg: number | null;
  /** UEX's own last-change time (ISO), null if UEX sent none. */
  updatedAt: string | null;
}

export interface CommodityEntry {
  id: number;
  name: string;
}

export interface CommodityPriceSet {
  source: 'uex';
  fetchedAt: string;
  prices: CommodityPrice[];
}

export type PriceAge = { unit: 'minutes' | 'hours' | 'days'; n: number };

/** How old a price is, in the largest whole unit; null when the source gave no timestamp. */
export function priceAge(updatedAt: string | null, now: number): PriceAge | null {
  if (!updatedAt) return null;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 60) return { unit: 'minutes', n: min };
  if (min < 60 * 48) return { unit: 'hours', n: Math.floor(min / 60) };
  return { unit: 'days', n: Math.floor(min / (60 * 24)) };
}

/** Commodity prices per terminal with source and age, for HQ Planen (#902). Read-only, no user data. */
@Injectable({ providedIn: 'root' })
export class CommodityPriceService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/commodity-prices`;

  readonly commodities = signal<CommodityEntry[]>([]);
  readonly prices = signal<CommodityPrice[]>([]);
  readonly source = signal<'uex' | null>(null);
  readonly listLoading = signal(false);
  readonly pricesLoading = signal(false);
  /** An `errors.*` key, never a raw message. */
  readonly error = signal<string | null>(null);
  readonly selectedId = signal<number | null>(null);
  readonly loading = computed(() => this.listLoading() || this.pricesLoading());

  private requestSeq = 0;

  async loadCommodities(): Promise<void> {
    if (this.commodities().length > 0 || this.listLoading()) return;
    this.listLoading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.http.get<{ commodities?: CommodityEntry[] }>(`${this.endpoint}?list=commodities`).pipe(timeout(15_000)),
      );
      this.commodities.set(Array.isArray(res?.commodities) ? res.commodities : []);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'commodityList', err));
    } finally {
      this.listLoading.set(false);
    }
  }

  async select(id: number | null): Promise<void> {
    this.selectedId.set(id);
    this.prices.set([]);
    if (id === null) return;
    const seq = ++this.requestSeq;
    this.pricesLoading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.http.get<CommodityPriceSet>(`${this.endpoint}?id_commodity=${encodeURIComponent(String(id))}`).pipe(timeout(15_000)),
      );
      if (seq !== this.requestSeq) return;
      this.source.set(res?.source ?? 'uex');
      this.prices.set(Array.isArray(res?.prices) ? res.prices : []);
    } catch (err) {
      if (seq === this.requestSeq) this.error.set(toErrorKey('hq', 'commodityPrices', err, { id }));
    } finally {
      if (seq === this.requestSeq) this.pricesLoading.set(false);
    }
  }

  /** Retry whatever failed: the list when it never loaded, else the selected commodity. */
  async retry(): Promise<void> {
    if (this.commodities().length === 0) return this.loadCommodities();
    return this.select(this.selectedId());
  }
}
