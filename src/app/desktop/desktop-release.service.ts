import { Injectable, Injector, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ReleaseChannel } from './channel-picker.component';

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
}

/** Short, human-checkable fingerprint of an asset's hash (or null if it has none). */
export function hashFingerprint(p: PlatformAsset): string | null {
  const h = p.sha512 ?? p.sha256 ?? '';
  return h ? h.slice(0, 12) : null;
}
