import { Injectable, Injector, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ReleaseChannel } from './channel-picker.component';
import { DesktopProduct, ReleaseRing } from './desktop-access';

/** One downloadable artifact inside `desktop_releases.platforms`. */
export interface PlatformAsset {
  url: string;
  size_bytes: number;
  sha512?: string | null;
  sha256?: string | null;
}

/** A registered desktop release as returned by `desktop_release_for_channel`. */
export interface ReleaseInfo {
  version: string;
  platforms: Record<string, PlatformAsset>;
  notes: string | null;
  created_at: string;
}

/** What one ring currently serves, flattened to a single downloadable asset. */
export interface RingRelease {
  ring: ReleaseRing;
  version: string;
  url: string;
  sizeBytes: number | null;
  hash: string | null;
  notes: string | null;
}

interface RingRpcRow {
  channel?: string;
  version?: string;
  platforms?: Record<string, PlatformAsset>;
  notes?: string | null;
}

/**
 * Single read path for the Data-Uploader release, shared by every surface that
 * offers the download (`/uploader`, `/download`, and the collapsible Codex
 * access panel). The RPC clamps the channel server-side to the caller's role,
 * so a viewer always ends up on stable no matter what is requested.
 */
@Injectable({ providedIn: 'root' })
export class DesktopReleaseService {
  private readonly injector = inject(Injector);

  // Resolved on first use, not at construction: `sc-uploader-access` is mounted
  // on the PUBLIC Codex Bridge and injects this service even when it renders
  // nothing (viewer), so constructing a Supabase client there would be pure
  // cost for every anonymous visitor.
  private get sb(): SupabaseClientProvider {
    return this.injector.get(SupabaseClientProvider);
  }

  async forChannel(
    channel: ReleaseChannel,
  ): Promise<{ release: ReleaseInfo | null; error: string | null }> {
    const { data, error } = await this.sb.client.rpc('desktop_release_for_channel', {
      p_channel: channel,
    });
    if (error) return { release: null, error: error.message };
    return { release: (data as unknown as ReleaseInfo[])?.[0] ?? null, error: null };
  }

  /**
   * Resolve one build per requested ring for either product, in the order the
   * rings were asked for.
   *
   * Both resolvers are SECURITY DEFINER and clamp the requested ring down to the
   * caller's tier, so asking for `alpha` as a viewer silently answers with the
   * stable row. Any row whose `channel` is not the ring we asked for is dropped:
   * labelling a stable build "Alpha" would be a lie, and Starscape derives its
   * locked ring from the downloaded FILENAME, so a mislabelled link would also
   * lock the install to the wrong ring. That drop is also what makes the
   * server-side gate visible in the UI — a viewer simply gets fewer buttons.
   */
  async ringsFor(
    product: DesktopProduct,
    rings: readonly ReleaseRing[],
  ): Promise<{ releases: RingRelease[]; error: string | null }> {
    if (rings.length === 0) return { releases: [], error: null };
    const rpc =
      product === 'starscape' ? 'starscape_release_for_channel' : 'desktop_release_for_channel';
    let firstError: string | null = null;
    const resolved = await Promise.all(
      rings.map(async (ring): Promise<RingRelease | null> => {
        try {
          const { data, error } = await this.sb.client.rpc(rpc, { p_channel: ring });
          if (error) {
            firstError ??= error.message;
            return null;
          }
          const row = (Array.isArray(data) ? data[0] : data) as RingRpcRow | null | undefined;
          if (!row?.version || row.channel !== ring) return null;
          const asset = pickAsset(product, row.platforms ?? {}, ring);
          if (!asset?.url) return null;
          return {
            ring,
            version: row.version,
            url: asset.url,
            sizeBytes: asset.size_bytes ?? null,
            hash: hashFingerprint(asset),
            notes: row.notes ?? null,
          };
        } catch (e) {
          firstError ??= e instanceof Error ? e.message : String(e);
          return null;
        }
      }),
    );
    const releases = resolved.filter((r): r is RingRelease => r !== null);
    // An error only surfaces when it cost us EVERY ring — one dead ring next to
    // two live ones is not worth an error banner over a working download.
    return { releases, error: releases.length > 0 ? null : firstError };
  }
}

/**
 * The Windows asset a ring's row should be downloaded from.
 *
 * Starscape publishes ring-suffixed assets (`win-x64-beta`) because the tray app
 * reads its locked ring off the filename; the plain key is the pre-ring fallback
 * for older catalog rows. The uploader ships an electron-updater setup exe.
 */
function pickAsset(
  product: DesktopProduct,
  platforms: Record<string, PlatformAsset>,
  ring: ReleaseRing,
): PlatformAsset | null {
  if (product === 'starscape') {
    return platforms[`win-x64-${ring}`] ?? platforms['win-x64'] ?? null;
  }
  return (
    platforms['win-x64-setup'] ?? platforms['win-x64'] ?? Object.values(platforms)[0] ?? null
  );
}

/** Short, human-checkable fingerprint of an asset's hash (or null if it has none). */
export function hashFingerprint(p: PlatformAsset): string | null {
  const h = p.sha512 ?? p.sha256 ?? '';
  return h ? h.slice(0, 12) : null;
}
