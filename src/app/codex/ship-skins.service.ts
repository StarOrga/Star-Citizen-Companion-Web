import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

/** A 3D paint livery for a ship — row of public.ship_skins. */
export interface ShipSkin {
  shipId: string;
  skinId: string;
  name: string;
  description: string;
  source: string; // store | event | subscriber | factory | pu_npc
  nameVerified: boolean;
  modelPath: string | null; // ship-skins object path to the .glb (null = no 3D)
  iconPath: string | null; // ship-skins object path to the .webp icon
  modelBytes: number | null;
  sort: number;
}

const BUCKET_PUBLIC = `${environment.supabase.url}/storage/v1/object/public/ship-skins/`;

/**
 * Loads the per-ship skin catalog from public.ship_skins and resolves
 * ship-skins bucket asset URLs. Assets are produced by the data-uploader
 * sc_extract.hull3d pipeline (100% from Data.p4k).
 */
@Injectable({ providedIn: 'root' })
export class ShipSkinsService {
  private readonly supabase = inject(SupabaseClientProvider);

  /** Public URL for a ship-skins object path (glb model or webp icon). */
  assetUrl(path: string | null | undefined): string | null {
    if (!path) return null;
    // Encode each segment so spaces / '#' / '?' / non-ASCII don't break the URL
    // (segments are slugged at ingest, but be defensive against future data).
    const encoded = path
      .replace(/^\/+/, '')
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    return BUCKET_PUBLIC + encoded;
  }

  /**
   * Skins for a ship, ordered by sort. Returns a discriminated result so the UI
   * can tell a genuinely skin-less ship (`error:false, skins:[]`) apart from a
   * transient query/RLS failure (`error:true`) and offer a retry.
   */
  async listSkins(shipId: string): Promise<{ skins: ShipSkin[]; error: boolean }> {
    if (!shipId) return { skins: [], error: false };
    const { data, error } = await this.supabase.client
      .from('ship_skins')
      .select(
        'ship_id, skin_id, name, description, source, name_verified, model_path, icon_path, model_bytes, sort',
      )
      .eq('ship_id', shipId)
      .order('sort', { ascending: true });
    if (error) return { skins: [], error: true };
    const skins = (data ?? []).map((r) => ({
      shipId: r.ship_id,
      skinId: r.skin_id,
      name: r.name,
      description: r.description ?? '',
      source: r.source ?? 'store',
      nameVerified: !!r.name_verified,
      modelPath: r.model_path,
      iconPath: r.icon_path,
      modelBytes: r.model_bytes,
      sort: r.sort ?? 100,
    }));
    return { skins, error: false };
  }
}
