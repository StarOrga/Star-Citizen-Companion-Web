import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { readErrorBody } from '../edge-error';
import { toErrorKey } from '../describe-error';
import { logWarn } from '../log';
import { safeRedirectTarget } from '../safe-redirect.util';
import { SupabaseClientProvider } from '../supabase.client';

/**
 * "Continue on your phone" (spec section 11). Contract and threat model:
 * docs/concepts/2026-10-25-header-footer-subheader-analyse/briefs/contract-handoff.md
 *
 * Desktop: `create()` -> show `url` as QR/link; `status` follows the code
 * (pending -> connected | expired | revoked); `listConnected()` / `revoke(id)`
 * manage phones that are already signed in (also after a reload).
 * Phone: the `/handoff` route calls `peek(code)` (read-only), shows the account,
 * and only after an explicit tap `redeem(code)`.
 *
 * Revoking signs the phone out at the latest within an hour: its refresh chain
 * dies at once, an access token already issued runs out on its own.
 */
export type HandoffStatus = 'idle' | 'pending' | 'connected' | 'expired' | 'revoked' | 'error';

export interface HandoffCreated {
  readonly id: string;
  readonly code: string;
  /** Absolute `/handoff#c=<code>` URL on this origin (fragment: never sent to a server). */
  readonly url: string;
  /** Epoch ms. */
  readonly expiresAt: number;
}

export interface HandoffConnection {
  readonly id: string;
  readonly device: string | null;
  /** Epoch ms. */
  readonly connectedAt: number;
}

/** Read-only look at a code: masked email for display, user id for the account comparison. */
export interface HandoffPeek {
  readonly account: string;
  readonly userId: string;
  /** Sanitised path the hand-off was created for. */
  readonly targetPath: string;
}

export const HANDOFF_PATH = '/handoff';
export const HANDOFF_POLL_MS = 2000;
/** Keep watching a connected phone this long (revoke from another tab), then stop. */
export const HANDOFF_CONNECTED_WATCH_MS = 2 * 60 * 1000;
export const HANDOFF_MAX_POLL_ERRORS = 3;

/** Same rules as `validateTargetPath` in supabase/functions/handoff-create/_handoff.ts. */
const NO_TARGET = /^\/(handoff|login)(?:[/?#]|$)/;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000- \u007f]/;

/** Same-origin absolute path to continue on, falling back to `/`. */
export function handoffTargetPath(raw: string | null | undefined): string {
  const p = safeRedirectTarget(raw, '/');
  if (p.length > 512 || UNSAFE_CHARS.test(p) || NO_TARGET.test(p)) return '/';
  return p;
}

/** "jane.doe@gmail.com" -> "j***@g***.com". Same algorithm as the edge function. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${host[0] ?? ''}***${tld}`;
}

/** Hand-off body codes -> i18n keys. Anything else falls through to `errors.*`. */
const CODE_KEYS: Record<string, string> = {
  invalid_code: 'handoff.errors.invalidCode',
  rate_limited: 'handoff.errors.rateLimit',
  auth_rate_limited: 'handoff.errors.authRateLimit',
  mint_failed: 'handoff.errors.mintFailed',
  revoked: 'handoff.errors.revoked',
  revoke_unavailable: 'handoff.errors.revokeUnavailable',
  invalid_path: 'handoff.errors.invalidPath',
  not_found: 'handoff.errors.notFound',
};

interface RowState {
  consumed_at: string | null;
  consumed_device: string | null;
  session_attached: boolean;
  revoked_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class HandoffService implements OnDestroy {
  private readonly sb = inject(SupabaseClientProvider);

  private readonly _status = signal<HandoffStatus>('idle');
  private readonly _device = signal<string | null>(null);
  private readonly _current = signal<HandoffCreated | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly status = this._status.asReadonly();
  /** Coarse label of the connected phone ("Android - Chrome"). */
  readonly device = this._device.asReadonly();
  readonly current = this._current.asReadonly();
  readonly connected = computed(() => this._status() === 'connected');

  /** Ask for a one-time code; starts watching its row. Rejects with the raw error: use `errorKey`. */
  async create(targetPath?: string): Promise<HandoffCreated> {
    const path = handoffTargetPath(targetPath ?? currentPath());
    this.stopWatching();
    const { data, error } = await this.sb.realClient.functions.invoke('handoff-create', {
      body: { target_path: path },
    });
    if (error || !data?.code || !data?.id) {
      this._status.set('error');
      throw error ?? new Error('handoff-create: empty answer');
    }
    const created: HandoffCreated = {
      id: String(data.id),
      code: String(data.code),
      url: `${location.origin}${HANDOFF_PATH}#c=${encodeURIComponent(String(data.code))}`,
      expiresAt: Date.parse(String(data.expires_at)),
    };
    this._current.set(created);
    this._device.set(null);
    this._status.set('pending');
    this.startWatching(created);
    return created;
  }

  /** Phones that are signed in through a hand-off and not revoked (survives a reload). */
  async listConnected(): Promise<HandoffConnection[]> {
    const { data, error } = await this.sb.realClient
      .from('handoff_codes')
      .select('id, consumed_device, consumed_at')
      .eq('session_attached', true)
      .is('revoked_at', null)
      .order('consumed_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return ((data ?? []) as { id: string; consumed_device: string | null; consumed_at: string }[]).map((r) => ({
      id: r.id,
      device: r.consumed_device,
      connectedAt: Date.parse(r.consumed_at),
    }));
  }

  /**
   * Sign a phone out (or burn an unredeemed code). Without an id: the one from
   * the last `create()`. Throws when nothing was revoked (see `errorKey`).
   */
  async revoke(id?: string): Promise<void> {
    const target = id ?? this._current()?.id;
    if (!target) return;
    const { data, error } = await this.sb.realClient.functions.invoke('handoff-revoke', { body: { id: target } });
    if (error) throw error;
    if (data?.revoked !== true && data?.outcome !== 'already') throw new Error('handoff-revoke: nothing revoked');
    if (this._current()?.id === target) {
      this.stopWatching();
      this._status.set('revoked');
    }
  }

  /** Phone side, read-only: the masked account this code would sign in. Consumes nothing. */
  async peek(code: string): Promise<HandoffPeek> {
    const { data, error } = await this.sb.realClient.functions.invoke('handoff-redeem', {
      body: { code, peek: true },
    });
    if (error || typeof data?.email_masked !== 'string' || typeof data?.user_id !== 'string') {
      throw error ?? new Error('handoff peek: empty answer');
    }
    return {
      account: data.email_masked,
      userId: data.user_id,
      targetPath: handoffTargetPath(typeof data.target_path === 'string' ? data.target_path : null),
    };
  }

  /** Phone side: trade the code for a session of its own; returns the path to open. Call only after an explicit tap. */
  async redeem(code: string): Promise<string> {
    const { data, error } = await this.sb.realClient.functions.invoke('handoff-redeem', { body: { code } });
    if (error || !data?.access_token || !data?.refresh_token) {
      throw error ?? new Error('handoff-redeem: empty answer');
    }
    const { error: setErr } = await this.sb.realClient.auth.setSession({
      access_token: String(data.access_token),
      refresh_token: String(data.refresh_token),
    });
    if (setErr) throw setErr;
    return handoffTargetPath(typeof data.target_path === 'string' ? data.target_path : null);
  }

  /**
   * i18n key for a failed hand-off call: a specific `handoff.errors.*` when the
   * edge function named the reason (expired/used vs rate limit vs mint failure),
   * else the generic `errors.*` (offline, timeout, ...). Logs once.
   */
  async errorKey(op: string, err: unknown): Promise<string> {
    const body = await readErrorBody(err);
    const mapped = body.error ? CODE_KEYS[body.error] : undefined;
    if (mapped) {
      logWarn('handoff', `${op} failed`, { code: body.error });
      return mapped;
    }
    return toErrorKey('handoff', op, err);
  }

  stopWatching(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  ngOnDestroy(): void {
    this.stopWatching();
  }

  private startWatching(created: HandoffCreated): void {
    let errors = 0;
    let connectedSince = 0;
    const tick = async (): Promise<void> => {
      const { data, error } = await this.sb.realClient
        .from('handoff_codes')
        .select('consumed_at, consumed_device, revoked_at, session_attached')
        .eq('id', created.id)
        .maybeSingle();
      if (this._current()?.id !== created.id) return;
      const row = data as RowState | null;
      // A failed poll or a vanished row is neither "expired" nor "connected":
      // count it, and give up honestly after a few in a row.
      if (error || !row) {
        errors += 1;
        logWarn('handoff', 'status poll failed', { error, missing: !row });
        if (errors >= HANDOFF_MAX_POLL_ERRORS) this.finish('error');
        return;
      }
      errors = 0;
      if (row.revoked_at) return this.finish('revoked');
      // "Connected" = the session is attached, not merely the code consumed.
      if (row.consumed_at && row.session_attached) {
        this._device.set(row.consumed_device);
        this._status.set('connected');
        connectedSince ||= Date.now();
        if (Date.now() - connectedSince >= HANDOFF_CONNECTED_WATCH_MS) this.stopWatching();
        return;
      }
      if (Date.now() >= created.expiresAt) this.finish('expired');
    };
    this.timer = setInterval(() => void tick(), HANDOFF_POLL_MS);
  }

  private finish(status: HandoffStatus): void {
    this.stopWatching();
    this._status.set(status);
  }
}

function currentPath(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}
