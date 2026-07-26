import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { normalizeRsiPledgeShipUrl } from '../core/rsi-pledge-link.util';

/**
 * User-supplied RSI pledge links for a ship (feedback f7d3bd9a).
 *
 * Two sources, deliberately separate tables:
 *   - `user_ship_links`   — the caller's OWN link. Owner-only RLS: nobody else,
 *                           admins included, can read it.
 *   - `ship_pledge_links` — the globally curated link. Public read, admin-only
 *                           write. A private link lands here only when an admin
 *                           explicitly promotes it, never automatically.
 *
 * READS go straight through PostgREST (RLS does the scoping). WRITES always go
 * through the `ship-link` edge function, which is the allowlist authority and
 * the rate limiter — this service validates too, but only to fail fast with a
 * friendly message. The stored value is pure data: it is bound with
 * `[href]` on a plain anchor and never touches innerHTML or any LLM prompt.
 */
interface ErrorPayload {
  ok?: boolean;
  error?: string;
  message?: string;
}

/**
 * Pull our JSON error body off a FunctionsHttpError. `error.context` is the raw
 * `Response`; anything else (network error, relay error) yields an empty payload
 * so the caller falls back to the generic message.
 */
async function readErrorBody(error: unknown): Promise<ErrorPayload> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!(ctx instanceof Response)) return {};
  try {
    const parsed: unknown = await ctx.clone().json();
    return parsed && typeof parsed === 'object' ? (parsed as ErrorPayload) : {};
  } catch {
    return {};
  }
}

@Injectable({ providedIn: 'root' })
export class ShipLinkService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);

  /** ship_slug -> the caller's own pledge link. */
  readonly myLinks = signal<Map<string, string>>(new Map());
  /** ship_slug -> the globally promoted pledge link. */
  readonly globalLinks = signal<Map<string, string>>(new Map());
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Best-effort resolve of both link sources for one ship. Never throws: a
   * missing link is a non-event for the detail page.
   */
  async loadForShip(shipSlug: string): Promise<void> {
    const slug = shipSlug.trim();
    if (!slug) return;

    const globalRes = await this.sb.client
      .from('ship_pledge_links')
      .select('ship_slug, url')
      .eq('ship_slug', slug)
      .maybeSingle();
    this.mergeInto(this.globalLinks, slug, this.readUrl(globalRes.data));

    const userId = this.auth.user()?.id ?? null;
    if (!userId) {
      this.mergeInto(this.myLinks, slug, null);
      return;
    }
    const ownRes = await this.sb.client
      .from('user_ship_links')
      .select('ship_slug, url')
      .eq('user_id', userId)
      .eq('ship_slug', slug)
      .maybeSingle();
    this.mergeInto(this.myLinks, slug, this.readUrl(ownRes.data));
  }

  /** The link to show for a ship: the user's own first, then the global one. */
  effectiveLink(shipSlug: string): string | null {
    return this.myLinks().get(shipSlug) ?? this.globalLinks().get(shipSlug) ?? null;
  }

  /**
   * Store the caller's own link. Returns null on success or an i18n key
   * suffix describing the failure. Client-side validation runs first purely so
   * an obviously wrong paste never costs a round-trip.
   */
  async setMyLink(shipSlug: string, rawUrl: string): Promise<string | null> {
    const url = normalizeRsiPledgeShipUrl(rawUrl);
    if (!url) return 'invalidUrl';

    this.saving.set(true);
    this.error.set(null);
    try {
      const res = await this.invoke({ action: 'set', shipSlug, url });
      if (res) return res;
      this.mergeInto(this.myLinks, shipSlug, url);
      this.analytics.capture('ship_link_set', { shipSlug });
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /** Delete the caller's own link for this ship. */
  async removeMyLink(shipSlug: string): Promise<string | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const res = await this.invoke({ action: 'remove', shipSlug });
      if (res) return res;
      this.mergeInto(this.myLinks, shipSlug, null);
      this.analytics.capture('ship_link_removed', { shipSlug });
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * ADMIN ONLY — publish a link for everyone. The server re-checks the role;
   * this is just the UI path. Nothing about a normal user's action can reach
   * this, which is the whole point of keeping global links in their own table.
   */
  async promote(shipSlug: string, rawUrl: string): Promise<string | null> {
    const url = normalizeRsiPledgeShipUrl(rawUrl);
    if (!url) return 'invalidUrl';

    this.saving.set(true);
    this.error.set(null);
    try {
      const res = await this.invoke({ action: 'promote', shipSlug, url });
      if (res) return res;
      this.mergeInto(this.globalLinks, shipSlug, url);
      this.analytics.capture('ship_link_promoted', { shipSlug });
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /** ADMIN ONLY — withdraw the globally visible link again. */
  async unpromote(shipSlug: string): Promise<string | null> {
    this.saving.set(true);
    this.error.set(null);
    try {
      const res = await this.invoke({ action: 'unpromote', shipSlug });
      if (res) return res;
      this.mergeInto(this.globalLinks, shipSlug, null);
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Returns null on success, or an i18n key suffix on failure. */
  private async invoke(body: Record<string, unknown>): Promise<string | null> {
    const { data, error } = await this.sb.client.functions.invoke('ship-link', { body });
    let payload = (data ?? {}) as ErrorPayload;
    // `functions.invoke` surfaces a non-2xx as a FunctionsHttpError and leaves
    // `data` null — the JSON body (our error code) only lives on the attached
    // Response. Without this, every server-side rejection would collapse into
    // the generic "could not save" message.
    if (error && !payload.error) payload = await readErrorBody(error);
    if (error || payload.error) {
      const code = payload.error ?? 'unknown';
      this.error.set(payload.message ?? error?.message ?? code);
      return this.errorKey(code);
    }
    return null;
  }

  private errorKey(code: string): string {
    switch (code) {
      case 'invalid_url':
      case 'invalid_slug':
        return 'invalidUrl';
      case 'rate_limited':
      case 'quota_exceeded':
        return 'rateLimited';
      case 'unauthorized':
      case 'forbidden':
        return 'forbidden';
      default:
        return 'saveFailed';
    }
  }

  private readUrl(row: unknown): string | null {
    const url = (row as { url?: unknown } | null)?.url;
    // Belt for the read path too: a row that predates (or somehow escaped) the
    // allowlist is dropped rather than rendered.
    return typeof url === 'string' ? normalizeRsiPledgeShipUrl(url) : null;
  }

  private mergeInto(
    target: WritableSignal<Map<string, string>>,
    slug: string,
    url: string | null,
  ): void {
    const next = new Map(target());
    if (url) next.set(slug, url);
    else next.delete(slug);
    target.set(next);
  }
}
