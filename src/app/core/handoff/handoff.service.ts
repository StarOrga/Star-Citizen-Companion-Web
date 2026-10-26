import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../auth/auth.service';
import { logWarn } from '../log';
import { safeRedirectTarget } from '../safe-redirect.util';
import { SupabaseClientProvider } from '../supabase.client';

/**
 * "Continue on your phone" (spec section 11). Contract and threat model:
 * docs/concepts/2026-10-25-header-footer-subheader-analyse/briefs/contract-handoff.md
 *
 * Desktop: `create()` -> show `url` as QR/link; `status` follows the code
 * (pending -> connected | expired | revoked); `revoke()` signs that phone out.
 * Phone: the `/handoff` route calls `redeem(code)`.
 * Fallback: `sendMagicLink()` mails a sign-in link to the user's own address.
 */
export type HandoffStatus = 'idle' | 'pending' | 'connected' | 'expired' | 'revoked' | 'error';

export interface HandoffCreated {
  readonly id: string;
  readonly code: string;
  /** Absolute `/handoff?c=<code>` URL on this origin. */
  readonly url: string;
  /** Epoch ms. */
  readonly expiresAt: number;
}

export const HANDOFF_PATH = '/handoff';
export const HANDOFF_POLL_MS = 2000;

/** Paths a hand-off / magic link must never land on (loops). */
const NO_TARGET = /^\/(handoff|login)(?:[/?#]|$)/;

/** Same-origin absolute path to continue on, falling back to `/`. */
export function handoffTargetPath(raw: string | null | undefined): string {
  const p = safeRedirectTarget(raw, '/');
  return NO_TARGET.test(p) ? '/' : p;
}

interface RowState {
  consumed_at: string | null;
  consumed_device: string | null;
  revoked_at: string | null;
  expires_at: string;
}

@Injectable({ providedIn: 'root' })
export class HandoffService implements OnDestroy {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly _status = signal<HandoffStatus>('idle');
  private readonly _device = signal<string | null>(null);
  private readonly _current = signal<HandoffCreated | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly status = this._status.asReadonly();
  /** Coarse label of the connected phone ("Android - Chrome"). */
  readonly device = this._device.asReadonly();
  readonly current = this._current.asReadonly();
  readonly connected = computed(() => this._status() === 'connected');

  /** Ask for a one-time code; starts watching its row. Throws a raw error (use `toErrorKey`). */
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
      url: `${location.origin}${HANDOFF_PATH}?c=${encodeURIComponent(String(data.code))}`,
      expiresAt: Date.parse(String(data.expires_at)),
    };
    this._current.set(created);
    this._device.set(null);
    this._status.set('pending');
    this.startWatching(created);
    return created;
  }

  /** Sign the connected phone out (or burn an unredeemed code). */
  async revoke(): Promise<void> {
    const cur = this._current();
    if (!cur) return;
    const { error } = await this.sb.realClient.functions.invoke('handoff-revoke', { body: { id: cur.id } });
    if (error) throw error;
    this.stopWatching();
    this._status.set('revoked');
  }

  /** Fallback: mail a sign-in link to the signed-in user's OWN address. */
  async sendMagicLink(targetPath?: string): Promise<void> {
    const email = this.auth.realUser()?.email;
    if (!email) throw new Error('handoff: no email on the session');
    const redirect = `${location.origin}${handoffTargetPath(targetPath ?? currentPath())}`;
    // Implicit flow on a throwaway client: the PKCE verifier would live on THIS
    // device, so a link opened on the phone could never complete.
    const { error } = await this.createOtpClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect, shouldCreateUser: false },
    });
    if (error) throw error;
  }

  /** Phone side: trade the code for a session of its own; returns the path to open. */
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

  stopWatching(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  ngOnDestroy(): void {
    this.stopWatching();
  }

  /** Overridable in specs. */
  protected createOtpClient(): SupabaseClient {
    return createClient(environment.supabase.url, environment.supabase.publishableKey, {
      auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: false, flowType: 'implicit' },
    });
  }

  private startWatching(created: HandoffCreated): void {
    const tick = async (): Promise<void> => {
      const { data, error } = await this.sb.realClient
        .from('handoff_codes')
        .select('consumed_at, consumed_device, revoked_at, expires_at')
        .eq('id', created.id)
        .maybeSingle();
      if (error) {
        logWarn('handoff', 'status poll failed', { error });
        return;
      }
      if (this._current()?.id !== created.id) return;
      const row = data as RowState | null;
      if (row?.revoked_at) return this.finish('revoked');
      if (row?.consumed_at) {
        this._device.set(row.consumed_device);
        // Keep polling: a later revoke from another desktop tab must show up.
        this._status.set('connected');
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
