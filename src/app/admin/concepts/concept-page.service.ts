import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { SupabaseClientProvider } from '../../core/supabase.client';

/** What `POST concept-page/ticket` answers for an admin. */
export interface ConceptTicket {
  url: string;
  title: string;
  expiresAt: string;
}

export type ConceptTicketError = 'forbidden' | 'notFound' | 'error';

export class ConceptTicketFailure extends Error {
  constructor(readonly kind: ConceptTicketError) {
    super(kind);
  }
}

/**
 * Mints the short-lived link under which the `concept-page` edge function
 * serves one hosted concept (admin feedback #224).
 *
 * The concept document is a cross-origin iframe, so the browser cannot carry
 * the Supabase session into it; instead THIS call proves the session once
 * (Bearer JWT, admin role checked server-side) and gets back a URL whose
 * query string holds an HMAC ticket bound to that concept id for 12 hours.
 * The ticket is the whole authorisation of the page — it is never stored
 * here, only handed to the iframe.
 */
@Injectable({ providedIn: 'root' })
export class ConceptPageService {
  private readonly sb = inject(SupabaseClientProvider);

  async mintTicket(id: string): Promise<ConceptTicket> {
    const { data } = await this.sb.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new ConceptTicketFailure('forbidden');

    let res: Response;
    try {
      res = await fetch(`${environment.supabase.url}/functions/v1/concept-page/ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
    } catch {
      throw new ConceptTicketFailure('error');
    }
    if (res.status === 401 || res.status === 403) throw new ConceptTicketFailure('forbidden');
    if (res.status === 404 || res.status === 400) throw new ConceptTicketFailure('notFound');
    if (!res.ok) throw new ConceptTicketFailure('error');

    const body = (await res.json().catch(() => null)) as Partial<ConceptTicket> | null;
    if (!body?.url || typeof body.url !== 'string') throw new ConceptTicketFailure('error');
    return { url: body.url, title: body.title ?? '', expiresAt: body.expiresAt ?? '' };
  }
}
