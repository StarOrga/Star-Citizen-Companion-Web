import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';

/** Scopes the UI can pick. Mirrors VALID_SCOPES in supabase/functions/api/handlers/tokens.ts. */
export const API_TOKEN_SCOPES = [
  'news:read',
  'patch:read',
  'ships:read',
  'components:read',
  'keybinds:read',
  '*:read',
  'admin:tokens',
] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedToken {
  plaintext: string;
  token: ApiTokenRow;
}

@Injectable({ providedIn: 'root' })
export class ApiTokensService {
  private readonly sb = inject(SupabaseClientProvider);

  /**
   * Build the absolute URL of the `api` Edge Function. We bypass the standard
   * `client.functions.invoke()` helper because that helper always POSTs with a
   * JSON body and doesn't natively support method-per-route in the way our
   * router expects. Direct fetch keeps the contract explicit (GET, POST, DELETE
   * with :id in the path) and lets the auth.interceptor inject the session JWT
   * the same way it does for other function calls.
   */
  private apiUrl(suffix = ''): string {
    const base = (this.sb.client as unknown as { supabaseUrl: string }).supabaseUrl;
    return `${base}/functions/v1/api${suffix}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const { data } = await this.sb.client.auth.getSession();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (data.session?.access_token) {
      headers['Authorization'] = `Bearer ${data.session.access_token}`;
    }
    return headers;
  }

  async list(): Promise<ApiTokenRow[]> {
    const res = await fetch(this.apiUrl('/v1/tokens'), {
      method: 'GET',
      headers: await this.authHeaders(),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message ?? `list_failed (${res.status})`);
    return (body?.data ?? []) as ApiTokenRow[];
  }

  async create(name: string, scopes: ApiTokenScope[]): Promise<CreatedToken> {
    const res = await fetch(this.apiUrl('/v1/tokens'), {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({ name, scopes }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message ?? `create_failed (${res.status})`);
    return body.data as CreatedToken;
  }

  async revoke(id: string): Promise<void> {
    const res = await fetch(this.apiUrl(`/v1/tokens/${id}`), {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message ?? `revoke_failed (${res.status})`);
    }
  }
}
