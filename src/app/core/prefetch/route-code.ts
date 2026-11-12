import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Route, Routes, UrlSegment, UrlSegmentGroup } from '@angular/router';
import { isObservable, firstValueFrom } from 'rxjs';

/** Deepest route nesting the resolver follows (guards against a redirect loop). */
const MAX_DEPTH = 12;

/** What resolving a path loaded: the routes whose lazy code it touched, outermost first. */
export interface RouteCodeResult {
  /** The matched leaf route, or null when the path matches nothing the resolver can follow. */
  readonly leaf: Route | null;
  /** Every route on the way whose `loadComponent` / `loadChildren` was called. */
  readonly loaded: readonly Route[];
}

/**
 * Walks the router config for `segments` the way the router would match them and
 * calls each matched route's `loadComponent` / `loadChildren` on the way, so the
 * lazy chunks are fetched, parsed and evaluated before the click. The router's own
 * `import()` for the same module then resolves from the module map at once.
 *
 * Deliberately conservative — it only *loads code*, it never activates anything:
 * - `canMatch` guards run only when they are plain functions that answer `true`
 *   synchronously in the root injector; anything else (false, a UrlTree, a Promise,
 *   a class guard) skips that route, exactly like a failed match.
 * - String `redirectTo` is followed (absolute or relative); a redirect function is not.
 * - Only the primary outlet; auxiliary routes are ignored.
 * A failed import is swallowed: the real navigation loads it again and owns the error.
 */
export async function loadRouteCode(
  routes: Routes,
  segments: readonly string[],
  injector: EnvironmentInjector,
): Promise<RouteCodeResult> {
  const loaded: Route[] = [];
  const leaf = await walk(routes, routes, segments, [], injector, loaded, 0);
  return { leaf, loaded };
}

async function walk(
  root: Routes,
  routes: Routes,
  segments: readonly string[],
  consumed: readonly string[],
  injector: EnvironmentInjector,
  loaded: Route[],
  depth: number,
): Promise<Route | null> {
  if (depth > MAX_DEPTH) return null;
  for (const route of routes) {
    if (route.outlet && route.outlet !== 'primary') continue;
    const take = matchCount(route, segments);
    if (take < 0) continue;
    const rest = segments.slice(take);
    if (route.redirectTo !== undefined) {
      if (typeof route.redirectTo !== 'string' || rest.length) continue;
      const target = route.redirectTo.split('?')[0].split('#')[0];
      const next = target.startsWith('/')
        ? target.split('/').filter(Boolean)
        : [...consumed, ...target.split('/').filter(Boolean)];
      return walk(root, root, next, [], injector, loaded, depth + 1);
    }
    if (!canMatchSync(route, segments.slice(0, take), injector)) continue;

    const hasChildren = !!route.children || !!route.loadChildren;
    if (!hasChildren) {
      if (rest.length) continue;
      if (route.loadComponent) await call(route.loadComponent, route, loaded);
      return route;
    }
    // Children first: a layout route ('' with children) must not load its own
    // component for a path that only one of its siblings matches.
    let children: Routes | null = route.children ?? null;
    if (!children && route.loadChildren) children = asRoutes(await call(route.loadChildren, route, loaded));
    const hit = children ? await walk(root, children, rest, [...consumed, ...segments.slice(0, take)], injector, loaded, depth + 1) : null;
    if (!hit && (rest.length || !route.loadComponent)) continue;
    if (route.loadComponent) await call(route.loadComponent, route, loaded);
    return hit ?? route;
  }
  return null;
}

/** Number of segments `route` consumes from the front of `segments`, or -1 when it does not match. */
export function matchCount(route: Route, segments: readonly string[]): number {
  if (route.matcher) {
    const segs = segments.map((s) => new UrlSegment(s, {}));
    const res = route.matcher(segs, new UrlSegmentGroup(segs, {}), route);
    return res ? res.consumed.length : -1;
  }
  const path = route.path ?? '';
  const parts = path.split('/').filter(Boolean);
  if (path === '**') return segments.length;
  if (parts.length > segments.length) return -1;
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith(':') && parts[i] !== segments[i]) return -1;
  }
  if (route.pathMatch === 'full' && parts.length !== segments.length) return -1;
  return parts.length;
}

function canMatchSync(route: Route, consumed: readonly string[], injector: EnvironmentInjector): boolean {
  const guards = route.canMatch ?? [];
  if (!guards.length) return true;
  const segs = consumed.map((s) => new UrlSegment(s, {}));
  for (const guard of guards) {
    if (typeof guard !== 'function' || isClass(guard)) return false;
    let ok: unknown;
    try {
      ok = runInInjectionContext(injector, () => (guard as (r: Route, s: UrlSegment[]) => unknown)(route, segs));
    } catch {
      return false;
    }
    if (ok !== true) return false;
  }
  return true;
}

function isClass(fn: unknown): boolean {
  return typeof fn === 'function' && /^class\s/.test(Function.prototype.toString.call(fn));
}

/** Calls a route loader once per route; later calls reuse the same promise. */
const pending = new WeakMap<Route, Promise<unknown>>();

async function call(loader: () => unknown, route: Route, loaded: Route[]): Promise<unknown> {
  let p = pending.get(route);
  if (!p) {
    p = settle(loader()).catch(() => {
      pending.delete(route);
      return null;
    });
    pending.set(route, p);
  }
  loaded.push(route);
  return p;
}

function settle(value: unknown): Promise<unknown> {
  if (isObservable(value)) return firstValueFrom(value);
  return Promise.resolve(value);
}

function asRoutes(value: unknown): Routes | null {
  if (Array.isArray(value)) return value as Routes;
  const def = (value as { default?: unknown } | null)?.default;
  return Array.isArray(def) ? (def as Routes) : null;
}
