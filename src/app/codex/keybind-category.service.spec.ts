import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { KeybindCategoryService, keybindKey } from './keybind-category.service';
import { EMPTY_ASSIGNMENT, KeybindAssignment } from './keybind-taxonomy';

interface Call {
  method: string;
  args: unknown[];
}

describe('KeybindCategoryService', () => {
  let calls: Call[];
  let pages: { data: unknown[] | null; error: { message: string } | null }[];
  let writeError: { message: string } | null;

  /** Chain that records every call; `then` resolves the next page / write result. */
  function fakeClient() {
    return {
      from: (table: string) => {
        calls.push({ method: 'from', args: [table] });
        let isRead = false;
        const p: unknown = new Proxy(
          {},
          {
            get(_t, prop: string) {
              if (prop === 'then') {
                return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
                  const r = isRead ? (pages.shift() ?? { data: [], error: null }) : { error: writeError };
                  return Promise.resolve(r).then(res, rej);
                };
              }
              return (...args: unknown[]) => {
                if (prop === 'select') isRead = true;
                calls.push({ method: prop, args });
                return p;
              };
            },
          },
        );
        return p;
      },
    };
  }

  function setup(): KeybindCategoryService {
    calls = [];
    pages = [];
    writeError = null;
    const client = fakeClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: { client, realClient: client } },
        { provide: AuthService, useValue: { user: signal({ id: 'admin1' }) } },
      ],
    });
    return TestBed.inject(KeybindCategoryService);
  }

  function rows(n: number, offset = 0) {
    return Array.from({ length: n }, (_, i) => ({
      actionmap: 'map',
      action_name: `a${offset + i}`,
      scope: 'verse',
      environment: null,
      role: null,
      activity: null,
      action_group: null,
    }));
  }

  const assigned: KeybindAssignment = { ...EMPTY_ASSIGNMENT, scope: 'verse' };
  const rangesOf = () => calls.filter((c) => c.method === 'range').map((c) => c.args);

  it('load() pages in 1000-row ranges and stops at the first short page', async () => {
    const svc = setup();
    pages = [
      { data: rows(1000), error: null },
      { data: rows(5, 1000), error: null },
    ];
    await svc.load();
    expect(rangesOf()).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(svc.assignedCount()).toBe(1005);
    expect(svc.loaded()).toBeTrue();
    expect(svc.error()).toBeNull();
    expect(svc.get('map', 'a3').scope).toBe('verse');
    expect(svc.get('map', 'missing')).toEqual(EMPTY_ASSIGNMENT);
  });

  it('load() with a single short page issues one request', async () => {
    const svc = setup();
    pages = [{ data: rows(2), error: null }];
    await svc.load();
    expect(rangesOf().length).toBe(1);
  });

  it('load() error sets an errors.* key and leaves loaded false', async () => {
    const svc = setup();
    pages = [{ data: null, error: { message: 'boom' } }];
    await svc.load();
    expect(svc.error()).toMatch(/^errors\./);
    expect(svc.loaded()).toBeFalse();
  });

  it('apply() with an assignment upserts rows and mirrors them locally', async () => {
    const svc = setup();
    const ok = await svc.apply(
      [
        { actionmap: 'm', actionName: 'x' },
        { actionmap: 'm', actionName: 'y' },
      ],
      assigned,
    );
    expect(ok).toBeTrue();
    const up = calls.find((c) => c.method === 'upsert');
    expect(up).toBeTruthy();
    const sent = up!.args[0] as Record<string, unknown>[];
    expect(sent.length).toBe(2);
    expect(sent[0]).toEqual(
      jasmine.objectContaining({ actionmap: 'm', action_name: 'x', scope: 'verse', updated_by: 'admin1' }),
    );
    expect(up!.args[1]).toEqual({ onConflict: 'actionmap,action_name' });
    expect(svc.byAction().has(keybindKey('m', 'x'))).toBeTrue();
    expect(svc.saving()).toBeFalse();
  });

  it('apply() with an all-null assignment deletes per actionmap and drops the local entries', async () => {
    const svc = setup();
    await svc.apply([{ actionmap: 'm', actionName: 'x' }], assigned);
    calls.length = 0;
    const ok = await svc.apply(
      [
        { actionmap: 'm', actionName: 'x' },
        { actionmap: 'm', actionName: 'y' },
        { actionmap: 'n', actionName: 'z' },
      ],
      EMPTY_ASSIGNMENT,
    );
    expect(ok).toBeTrue();
    expect(calls.some((c) => c.method === 'upsert')).toBeFalse();
    expect(calls.filter((c) => c.method === 'delete').length).toBe(2);
    expect(calls.filter((c) => c.method === 'in').map((c) => c.args)).toEqual([
      ['action_name', ['x', 'y']],
      ['action_name', ['z']],
    ]);
    expect(svc.assignedCount()).toBe(0);
  });

  it('apply() failure returns false with an errors.* key and does not touch local state', async () => {
    const svc = setup();
    writeError = { message: 'rls' };
    expect(await svc.apply([{ actionmap: 'm', actionName: 'x' }], assigned)).toBeFalse();
    expect(svc.error()).toMatch(/^errors\./);
    expect(svc.assignedCount()).toBe(0);
    expect(svc.saving()).toBeFalse();
  });

  it('apply() with no targets is a no-op success', async () => {
    const svc = setup();
    expect(await svc.apply([], assigned)).toBeTrue();
    expect(calls.length).toBe(0);
  });
});
