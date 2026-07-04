import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { HangarService } from './hangar.service';

// Focused coverage for the Slice-2 flagship (pinned standard ship) capability:
// single-flagship exclusivity, toggle semantics, and per-user localStorage
// persistence. No Supabase round-trips are exercised here.
describe('HangarService flagship', () => {
  const USER_ID = 'user-abc';

  function makeService(): HangarService {
    const auth = { user: signal({ id: USER_ID }) } as unknown as AuthService;
    // The flagship path never touches the DB; a stub client satisfies inject().
    const sb = { client: {} } as unknown as SupabaseClientProvider;
    TestBed.configureTestingModule({
      providers: [
        HangarService,
        { provide: AuthService, useValue: auth },
        { provide: SupabaseClientProvider, useValue: sb },
      ],
    });
    return TestBed.inject(HangarService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('sets and clears the flagship, keeping a single value', () => {
    const svc = makeService();
    expect(svc.flagshipClassName()).toBeNull();

    svc.setFlagship('AEGS_Gladius');
    expect(svc.flagshipClassName()).toBe('AEGS_Gladius');
    expect(svc.isFlagship('AEGS_Gladius')).toBeTrue();

    // Pinning a new flagship un-pins the previous (single flagship).
    svc.setFlagship('ANVL_Arrow');
    expect(svc.flagshipClassName()).toBe('ANVL_Arrow');
    expect(svc.isFlagship('AEGS_Gladius')).toBeFalse();

    svc.setFlagship(null);
    expect(svc.flagshipClassName()).toBeNull();
  });

  it('toggleFlagship pins when unset and clears when it already is the flagship', () => {
    const svc = makeService();
    svc.toggleFlagship('AEGS_Gladius');
    expect(svc.isFlagship('AEGS_Gladius')).toBeTrue();
    svc.toggleFlagship('AEGS_Gladius');
    expect(svc.isFlagship('AEGS_Gladius')).toBeFalse();
  });

  it('persists the flagship to per-user localStorage and rehydrates it', () => {
    const svc = makeService();
    svc.setFlagship('AEGS_Gladius');
    expect(localStorage.getItem(`sc.hangar.flagship.${USER_ID}`)).toBe('AEGS_Gladius');

    // A fresh service instance for the same user reads the stored flagship.
    TestBed.resetTestingModule();
    const svc2 = makeService();
    expect(svc2.flagshipClassName()).toBe('AEGS_Gladius');
  });
});
