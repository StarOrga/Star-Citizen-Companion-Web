import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ImpersonationService } from '../auth/impersonation.service';
import { SupabaseClientProvider } from './supabase.client';

/**
 * AUD-054/073: `client` is the switch between the session-bearing client and
 * the anon preview client ("view as signed-out visitor"). This is the one spec
 * that builds the real clients — it tests exactly that building block. No
 * session is stored under `sc.auth` first, so nothing refreshes, and the
 * auto-refresh timer is stopped after each case.
 */
describe('SupabaseClientProvider', () => {
  const viewAs = signal<string | null>(null);
  let sb: SupabaseClientProvider;

  beforeEach(() => {
    localStorage.removeItem('sc.auth');
    viewAs.set(null);
    TestBed.configureTestingModule({
      providers: [{ provide: ImpersonationService, useValue: { viewAs } as unknown as ImpersonationService }],
    });
    sb = TestBed.inject(SupabaseClientProvider);
  });

  afterEach(async () => {
    await sb.realClient.auth.stopAutoRefresh();
  });

  it('hands out the real client normally', () => {
    expect(sb.client).toBe(sb.realClient);
  });

  it('hands out the real client while previewing a role other than anon', () => {
    viewAs.set('viewer');
    expect(sb.client).toBe(sb.realClient);
  });

  it('hands out a separate, session-less client while previewing as anon', () => {
    viewAs.set('anon');
    const anon = sb.client;
    expect(anon).not.toBe(sb.realClient);
    // Created once, then reused.
    expect(sb.client).toBe(anon);
    viewAs.set(null);
    expect(sb.client).toBe(sb.realClient);
  });
});
