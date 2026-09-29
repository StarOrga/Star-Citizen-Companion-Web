/**
 * A scriptable stand-in for the Supabase client, for specs.
 *
 * Specs that touch a service reading `SupabaseClientProvider` used to build
 * their own little query-builder stubs, one shape per file, or — worse — let
 * the real `createClient` run, with a real auto-refresh timer and real network
 * (AUD-314). This fake covers the surface the app uses:
 *
 * - `from(table)` returns a chain in which every method (`select`, `eq`,
 *   `insert`, `order`, `range`, `maybeSingle` …) is recorded as
 *   `[name, args]` and returns the chain again. Awaiting the chain resolves
 *   with `answer({ op: 'from', target: table, chain })`.
 * - `rpc(name, params)` works the same way, with `op: 'rpc'` and the params
 *   in `args` (a following `.select()` / `.single()` lands in `chain`).
 * - `functions.invoke(name, options)` answers `op: 'invoke'`.
 * - `storage.from(bucket)` answers `op: 'storage'` once awaited.
 * - `auth.getSession()` answers the scripted session; `onAuthStateChange`
 *   records the listener (fire it with `emitAuth`); every other auth method
 *   is a jasmine spy that resolves `{ data: {}, error: null }`.
 *
 * Every awaited call is appended to `calls` as it is sent, so a spec can
 * assert on the table, the payload and the order. `answer` defaults to
 * `{ data: null, error: null }` and may return a promise (keep one open to
 * test a busy state).
 *
 * Imported by specs only, so it is not part of `tsconfig.app.json` (same as
 * `frames.ts`).
 */
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

export type FakeChain = [string, unknown[]][];

export interface FakeCall {
  op: 'from' | 'rpc' | 'invoke' | 'storage';
  /** Table, RPC, edge function or bucket name. */
  target: string;
  /** The builder methods in call order, with their arguments. */
  chain: FakeChain;
  /** `rpc` params or `functions.invoke` options. */
  args?: unknown;
}

export interface FakeResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
  status?: number;
}

export interface FakeSession {
  access_token: string;
  user: { id: string; email?: string };
}

export interface FakeSupabaseOptions {
  session?: FakeSession | null;
  answer?: (call: FakeCall) => FakeResult | Promise<FakeResult>;
}

/** The builder method named `name` in a recorded chain, or undefined. */
export function chainArgs(call: FakeCall, name: string): unknown[] | undefined {
  return call.chain.find(([method]) => method === name)?.[1];
}

export function fakeSupabase(opts: FakeSupabaseOptions = {}) {
  const calls: FakeCall[] = [];
  const answer = opts.answer ?? (() => ({ data: null, error: null }));
  let session: FakeSession | null = opts.session ?? null;
  const authListeners: ((event: string, session: FakeSession | null) => void)[] = [];

  const resolve = (call: FakeCall): Promise<FakeResult> => {
    calls.push(call);
    return Promise.resolve()
      .then(() => answer(call))
      .then((result) => ({ data: null, error: null, ...result }));
  };

  /** A thenable builder: any method is recorded and chains; `then` answers. */
  const builder = (op: FakeCall['op'], target: string, args?: unknown): unknown => {
    const chain: FakeChain = [];
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'then') {
            return (res: (v: FakeResult) => unknown, rej?: (e: unknown) => unknown) =>
              resolve({ op, target, chain, args }).then(res, rej);
          }
          return (...methodArgs: unknown[]) => {
            chain.push([prop, methodArgs]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const ok = () => jasmine.createSpy().and.resolveTo({ data: {}, error: null });

  const client = {
    supabaseUrl: environment.supabase.url,
    from: (table: string) => builder('from', table),
    rpc: (name: string, params?: unknown) => builder('rpc', name, params),
    functions: {
      invoke: (name: string, options?: unknown) => resolve({ op: 'invoke', target: name, chain: [], args: options }),
    },
    storage: {
      from: (bucket: string) => builder('storage', bucket),
    },
    channel: () => builder('from', 'channel'),
    removeChannel: jasmine.createSpy('removeChannel').and.resolveTo('ok'),
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      onAuthStateChange: (cb: (event: string, s: FakeSession | null) => void) => {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: jasmine.createSpy('signOut').and.resolveTo({ error: null }),
      signInWithPassword: ok(),
      signInWithOAuth: ok(),
      updateUser: ok(),
      resetPasswordForEmail: ok(),
      stopAutoRefresh: () => undefined,
    },
  };

  return {
    client,
    calls,
    provider: {
      provide: SupabaseClientProvider,
      useValue: { client, realClient: client } as unknown as SupabaseClientProvider,
    },
    /** Change what `getSession()` answers from now on. */
    setSession(next: FakeSession | null) {
      session = next;
    },
    /** Fire every `onAuthStateChange` listener, as Supabase would. */
    emitAuth(event: string, next: FakeSession | null) {
      session = next;
      for (const cb of authListeners) cb(event, next);
    },
  };
}
