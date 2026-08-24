import { Injectable, Injector, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ConnectionState, DesktopProduct, connectionState } from './desktop-access';

/** One product's last check-in for the signed-in account. */
export interface DesktopConnection {
  product: DesktopProduct;
  lastSeenAt: string;
  appVersion: string | null;
}

interface ConnectionRow {
  product?: string;
  last_seen_at?: string;
  app_version?: string | null;
}

/**
 * "Has this account's desktop app ever phoned home, and how long ago?"
 *
 * Reads `my_desktop_connections()` — a SECURITY DEFINER RPC that only ever sees
 * `auth.uid()`'s own rows. A check-in is written whenever the account completes
 * a loopback handoff (`/uploader/auth` → uploader, `/desktop/connect` →
 * Starscape) via `touch()`, and the desktop apps can call the same
 * `desktop_touch_connection` RPC directly on startup with their stored session.
 * For the uploader the RPC additionally falls back to the newest `p4k_bundles`
 * upload, so accounts that fed the Codex before this ledger existed still read
 * as connected.
 *
 * Anything older than 30 days counts as expired — see `desktop-access.ts`.
 */
@Injectable({ providedIn: 'root' })
export class DesktopConnectionService {
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);

  private readonly _connections = signal<readonly DesktopConnection[]>([]);
  private readonly _loading = signal(false);
  private inflight: Promise<void> | null = null;
  private loadedForUser: string | null = null;

  readonly connections = this._connections.asReadonly();
  readonly loading = this._loading.asReadonly();

  // Lazily resolved: the menu injects this service even for visitors who never
  // open it, and an anonymous visitor must not pay for a Supabase client.
  private get sb(): SupabaseClientProvider {
    return this.injector.get(SupabaseClientProvider);
  }

  /** This product's last check-in, or null when there is none. */
  for(product: DesktopProduct): DesktopConnection | null {
    return this._connections().find((c) => c.product === product) ?? null;
  }

  stateFor(product: DesktopProduct, now: number = Date.now()): ConnectionState {
    return connectionState(this.for(product)?.lastSeenAt ?? null, now);
  }

  /**
   * Load the caller's check-ins. No-op for anonymous visitors (the RPC would
   * return nothing anyway) and deduped per user, so several menus on one page
   * share a single round trip.
   */
  async refresh(force = false): Promise<void> {
    const userId = this.auth.user()?.id ?? null;
    if (!userId) {
      this._connections.set([]);
      this.loadedForUser = null;
      return;
    }
    if (!force && this.loadedForUser === userId) return;
    if (this.inflight) return this.inflight;
    this.inflight = this.load(userId).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(userId: string): Promise<void> {
    this._loading.set(true);
    try {
      const { data, error } = await this.sb.client.rpc('my_desktop_connections');
      if (error) return; // silent — the menu simply shows "not connected yet"
      const rows = (Array.isArray(data) ? data : []) as ConnectionRow[];
      this._connections.set(
        rows
          .filter((r): r is ConnectionRow & { product: string; last_seen_at: string } =>
            (r.product === 'uploader' || r.product === 'starscape') && !!r.last_seen_at,
          )
          .map((r) => ({
            product: r.product as DesktopProduct,
            lastSeenAt: r.last_seen_at,
            appVersion: r.app_version ?? null,
          })),
      );
      this.loadedForUser = userId;
    } catch {
      /* offline / RPC missing — treat as "no check-in on record" */
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Record a check-in for the signed-in account. Called by the two loopback
   * handoff pages the moment the desktop app receives a session — that IS the
   * connection event, and it is the only one the website can observe itself.
   * Never throws: a failed bookkeeping write must not break a token handoff.
   */
  async touch(product: DesktopProduct, appVersion: string | null = null): Promise<void> {
    if (!this.auth.user()) return;
    try {
      await this.sb.client.rpc('desktop_touch_connection', {
        p_product: product,
        p_app_version: appVersion,
      });
      this.loadedForUser = null;
    } catch {
      /* ignore — see doc comment */
    }
  }
}
