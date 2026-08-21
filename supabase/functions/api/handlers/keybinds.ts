// GET /v1/keybinds — default input actions of the current build, each with the
// admin-curated category hierarchy on top (feedback fd58a5eb).
//
// This is the endpoint the SCC app pulls: `codex_keybinds` alone is the raw
// datamine (actionmap + default binding per device), and `keybind_categories`
// adds where an action sits in the Context hierarchy — L1 Scope, L2
// Environment, L3 Role, L4 Activity, L5 Action Group. The two are joined here
// rather than in the client so an integrator never has to know that the
// curation lives in its own, build-independent table.
//
// Query parameters
//   assigned_only=true  — only actions that carry a curated category
//   actionmap=<name>    — one actionmap (e.g. spaceship_movement)
//
// Both tables are paged: a build's profile is ~1.1k actions and PostgREST caps
// a response at 1000 rows *silently* (short, not an error).

import type { Context } from '../_router.ts';
import { json } from '../_router.ts';

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

interface KeybindRow {
  actionmap: string;
  action_name: string;
  label_key: string | null;
  description_key: string | null;
  category_label_key: string | null;
  activation_mode: string | null;
  binding_keyboard: string | null;
  binding_mouse: string | null;
  binding_gamepad: string | null;
  binding_joystick: string | null;
  sort: number;
}

interface CategoryRow {
  actionmap: string;
  action_name: string;
  scope: string | null;
  environment: string | null;
  role: string | null;
  activity: string | null;
  action_group: string | null;
}

const key = (actionmap: string, actionName: string) => `${actionmap}::${actionName}`;

export async function list(ctx: Context): Promise<Response> {
  const assignedOnly = ctx.url.searchParams.get('assigned_only') === 'true';
  const actionmap = ctx.url.searchParams.get('actionmap');

  const { data: build } = await ctx.supabase
    .from('codex_builds')
    .select('id, build_number, patch_version, channel')
    // Same pair the web app resolves the live build with (CodexService
    // .fetchCurrentBuild): LIVE channel + the one row flagged current.
    .eq('channel', 'LIVE')
    .eq('is_current', true)
    .maybeSingle();

  ctx.responseHeaders.set('X-Cache', 'MISS');
  if (!build) {
    return json(
      { data: [], meta: { build_number: null, patch_version: null, count: 0, assigned_count: 0,
                          message: 'No current codex build.' } },
      200,
      ctx.responseHeaders,
    );
  }
  if (build.patch_version) ctx.responseHeaders.set('X-Patch-Version', build.patch_version);

  // ── curated categories (build-independent, keyed by actionmap+action) ──
  const categories = new Map<string, CategoryRow>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    let q = ctx.supabase
      .from('keybind_categories')
      .select('actionmap, action_name, scope, environment, role, activity, action_group')
      .order('actionmap', { ascending: true })
      .order('action_name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (actionmap) q = q.eq('actionmap', actionmap);
    const { data, error } = await q;
    if (error) {
      return json(
        { error: { code: 'query_failed', message: error.message } },
        500,
        ctx.responseHeaders,
      );
    }
    const batch = (data ?? []) as CategoryRow[];
    for (const r of batch) categories.set(key(r.actionmap, r.action_name), r);
    if (batch.length < PAGE_SIZE) break;
  }

  // ── extracted bindings for the current build ──
  const rows: KeybindRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    let q = ctx.supabase
      .from('codex_keybinds')
      .select(
        'actionmap, action_name, label_key, description_key, category_label_key, ' +
          'activation_mode, binding_keyboard, binding_mouse, binding_gamepad, ' +
          'binding_joystick, sort',
      )
      .eq('build_id', build.id)
      .order('sort', { ascending: true })
      .order('action_name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (actionmap) q = q.eq('actionmap', actionmap);
    const { data, error } = await q;
    if (error) {
      return json(
        { error: { code: 'query_failed', message: error.message } },
        500,
        ctx.responseHeaders,
      );
    }
    const batch = (data ?? []) as KeybindRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const data = rows
    .filter((r) => !assignedOnly || categories.has(key(r.actionmap, r.action_name)))
    .map((r) => {
      const c = categories.get(key(r.actionmap, r.action_name)) ?? null;
      return {
        actionmap: r.actionmap,
        action_name: r.action_name,
        label_key: r.label_key,
        description_key: r.description_key,
        category_label_key: r.category_label_key,
        activation_mode: r.activation_mode,
        bindings: {
          keyboard: r.binding_keyboard,
          mouse: r.binding_mouse,
          gamepad: r.binding_gamepad,
          joystick: r.binding_joystick,
        },
        // null (not an all-null object) when nobody classified this action yet:
        // "unassigned" must stay distinguishable from "assigned to nothing".
        categories: c
          ? {
              scope: c.scope,
              environment: c.environment,
              role: c.role,
              activity: c.activity,
              action_group: c.action_group,
            }
          : null,
        sort: r.sort,
      };
    });

  return json(
    {
      data,
      meta: {
        build_number: build.build_number ?? null,
        patch_version: build.patch_version ?? null,
        channel: build.channel ?? null,
        count: data.length,
        assigned_count: data.filter((d) => d.categories !== null).length,
      },
    },
    200,
    ctx.responseHeaders,
  );
}
