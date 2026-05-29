// Minimal chainable router used by the public /v1 API.
// Concept §7 — Single Edge Function with internal router + middleware.
//
// Design intent:
//   - Zero deps (no Hono / itty-router) so cold-start stays predictable.
//   - Middleware chain runs left-to-right; the first one to return a Response
//     short-circuits the chain (e.g. auth 401, rate-limit 429).
//   - Handlers receive the same Context object, with `params` populated from
//     path placeholders (`/v1/tokens/:id`).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

export interface ApiTokenRow {
  id: string;
  owner_user_id: string;
  name: string;
  prefix: string;
  token_hash: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface Context {
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** Set by authMiddleware once a valid Bearer token is matched. */
  token?: ApiTokenRow;
  /** Service-role Supabase client. Always present (attached by router init). */
  supabase: SupabaseClient;
  /** Extra headers handlers/middleware can append before response is sent. */
  responseHeaders: Headers;
  /** Endpoint identifier for logging (e.g. "GET /v1/news"). */
  endpoint: string;
  /** Scope required for the matched route (or null for public endpoints). */
  requiredScope: string | null;
}

export type Handler = (ctx: Context) => Promise<Response> | Response;
export type Middleware = (ctx: Context, next: () => Promise<Response>) => Promise<Response>;

export interface RouteOptions {
  /** Scope required to access this route. Null = public (no auth). */
  scope?: string | null;
  /** Skip auth + rate-limit middleware for this route (e.g. /openapi.json). */
  public?: boolean;
}

interface Route {
  method: Method;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  options: RouteOptions;
  raw: string;
}

function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexBody = path
    .replace(/[/\-\\^$*+?.()|[\]{}]/g, (m) => (m === '/' ? '/' : '\\' + m))
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_full, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
  return { pattern: new RegExp('^' + regexBody + '$'), paramNames };
}

export class Router {
  private middlewares: Middleware[] = [];
  private routes: Route[] = [];

  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  private add(method: Method, path: string, handler: Handler, options: RouteOptions = {}): this {
    const { pattern, paramNames } = compilePath(path);
    this.routes.push({ method, pattern, paramNames, handler, options, raw: path });
    return this;
  }

  get(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('GET', path, handler, options);
  }
  post(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('POST', path, handler, options);
  }
  delete(path: string, handler: Handler, options?: RouteOptions): this {
    return this.add('DELETE', path, handler, options);
  }

  match(method: string, pathname: string): {
    handler: Handler;
    params: Record<string, string>;
    options: RouteOptions;
    raw: string;
  } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1] ?? '')));
      return { handler: r.handler, params, options: r.options, raw: r.raw };
    }
    return null;
  }

  /**
   * Build the Deno.serve handler. The `init` callback wires per-request
   * dependencies (Supabase service-role client, etc.) so unit tests can inject.
   */
  handler(init: (req: Request, url: URL) => Omit<Context, 'req' | 'url' | 'params' | 'endpoint' | 'requiredScope' | 'responseHeaders' | 'token'>): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      // Supabase Edge Functions are invoked at /functions/v1/api/<path>,
      // so the request URL inside the function has pathname starting with
      // "/api/...". Strip that function-name prefix before matching, so
      // routes can stay declared as /openapi.json, /v1/news, etc.
      let pathname = url.pathname;
      if (pathname.startsWith('/api/')) pathname = pathname.slice(4);
      else if (pathname === '/api') pathname = '/';
      const matched = this.match(req.method, pathname);
      const base = init(req, url);
      const ctx: Context = {
        req,
        url,
        params: matched?.params ?? {},
        responseHeaders: new Headers(),
        endpoint: `${req.method} ${matched?.raw ?? url.pathname}`,
        requiredScope: matched?.options.scope ?? null,
        ...base,
      };

      if (!matched) {
        return json({ error: { code: 'not_found', message: 'Route not found' } }, 404, ctx.responseHeaders);
      }

      // Build the middleware chain. Public routes skip the global mw entirely
      // (so /openapi.json and /docs don't trigger Bearer-auth lookups).
      const mwChain: Middleware[] = matched.options.public ? [] : this.middlewares;
      let i = -1;
      const dispatch = async (): Promise<Response> => {
        i++;
        if (i < mwChain.length) {
          return mwChain[i](ctx, dispatch);
        }
        return matched.handler(ctx);
      };
      try {
        return await dispatch();
      } catch (err) {
        console.error('router_error', { endpoint: ctx.endpoint, err: (err as Error)?.message });
        return json({ error: { code: 'internal_error', message: 'Unexpected server error' } }, 500, ctx.responseHeaders);
      }
    };
  }
}

export function json(body: unknown, status = 200, extraHeaders?: Headers): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  if (extraHeaders) {
    extraHeaders.forEach((v, k) => headers.set(k, v));
  }
  return new Response(JSON.stringify(body), { status, headers });
}
