import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ShipSkinsService } from './ship-skins.service';

/** One ship that has >=1 livery — a row of public.ship_skins_index, resolved. */
export interface ShowroomEntry {
  shipId: string;
  liveryCount: number;
  modelCount: number;
  sources: string[];
  latestAdded: string;
  posterUrl: string | null;
}

/**
 * Discovery plane for the Codex Showroom. Reads the cheap ship_skins_index view
 * (metadata + livery-icon poster only — NEVER a .glb URL) and exposes it as a
 * signal for the gallery and the Holo-Ready badge. Display names / ship preview
 * art are resolved by the component against CodexService, keeping this service a
 * pure, independently testable discovery read.
 */
@Injectable({ providedIn: 'root' })
export class ShowroomService {
  private readonly supabase = inject(SupabaseClientProvider);
  private readonly skins = inject(ShipSkinsService);

  private readonly _entries = signal<ShowroomEntry[]>([]);
  readonly entries: Signal<ShowroomEntry[]> = this._entries.asReadonly();
  /** Ship ids that have at least one 3D model — the badge probe. */
  readonly modelShipIds = computed<ReadonlySet<string>>(
    () => new Set(this._entries().filter((e) => e.modelCount > 0).map((e) => e.shipId)),
  );

  /** Ships with liveries, newest first. Discriminates empty from query failure. */
  async list(): Promise<{ entries: ShowroomEntry[]; error: boolean }> {
    const { data, error } = await this.supabase.client
      .from('ship_skins_index')
      .select('ship_id, livery_count, model_count, poster_path, sources, latest_added')
      .order('latest_added', { ascending: false });
    if (error) return { entries: [], error: true };
    const entries = (data ?? []).map((r) => ({
      shipId: r.ship_id,
      liveryCount: r.livery_count ?? 0,
      modelCount: r.model_count ?? 0,
      sources: r.sources ?? [],
      latestAdded: r.latest_added,
      posterUrl: this.skins.assetUrl(r.poster_path),
    }));
    return { entries, error: false };
  }

  private loadInFlight: Promise<void> | null = null;

  /**
   * Load once into the signal. Safe to call from many badge instances mounted in
   * the same render pass: an already-loaded cache short-circuits, and concurrent
   * callers share ONE in-flight query instead of each firing its own (the badge
   * lane renders dozens at once). On failure the in-flight handle is cleared so a
   * later mount can retry — without re-bursting the whole lane every time.
   */
  async load(): Promise<void> {
    if (this._entries().length > 0) return;
    if (this.loadInFlight) return this.loadInFlight;
    this.loadInFlight = (async () => {
      const { entries, error } = await this.list();
      if (!error) this._entries.set(entries);
    })().finally(() => {
      this.loadInFlight = null;
    });
    return this.loadInFlight;
  }
}
