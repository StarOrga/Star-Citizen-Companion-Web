import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';

/** What the landing page's "Bewerben" form sends. */
export interface AccessRequestInput {
  email: string;
  handle?: string | null;
  message?: string | null;
}

/**
 * Outcome of an application. `duplicate` is deliberately NOT an error path
 * for the caller: telling a stranger "an application for this address
 * already exists" would turn the form into an oracle over who has applied,
 * so the UI shows the same confirmation it shows for a fresh request.
 */
export type AccessRequestResult =
  | { kind: 'ok' }
  | { kind: 'duplicate' }
  | { kind: 'rate-limited' }
  | { kind: 'error'; message: string };

/** Postgres error codes the `access_requests_guard()` trigger raises. */
const DUPLICATE = '23505';
const RATE_LIMITED = '53400';

@Injectable({ providedIn: 'root' })
export class AccessRequestService {
  private readonly sb = inject(SupabaseClientProvider);

  /**
   * Files an invite application (migration 20260816120000). The caller is
   * anonymous: `anon` holds INSERT and nothing else on `access_requests`, so
   * this deliberately does not `.select()` the row back — there is no read
   * grant, and asking for one would fail the whole write.
   */
  async submit(input: AccessRequestInput): Promise<AccessRequestResult> {
    const { error } = await this.sb.client.from('access_requests').insert({
      email: input.email.trim().toLowerCase(),
      handle: input.handle?.trim() || null,
      message: input.message?.trim() || null,
    });

    if (!error) return { kind: 'ok' };
    if (error.code === DUPLICATE) return { kind: 'duplicate' };
    if (error.code === RATE_LIMITED) return { kind: 'rate-limited' };
    return { kind: 'error', message: error.message };
  }
}
