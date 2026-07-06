/**
 * Catalog promotion — feeds an extractor out_dir into the public Codex.
 *
 * The desktop upload flow writes a bundle to `p4k_bundles` via `ingest-bundle`,
 * but the public Codex (`/codex`) reads the `codex_*` tables, which are only
 * populated by `ingest-catalog`. This bridge closes that gap: after a bundle
 * upload succeeds, it reads the SAME out_dir the extractor produced and drives
 * the `ingest-catalog` init→upsert→…→finalize protocol using the operator's JWT
 * + the built-in release token (the production auth gate — no seed token).
 *
 * It is a faithful port of `supabase/scripts/seed-codex.mjs --via-function`,
 * reusing the pure row mappers in `../lib/catalog-map.ts` so a desktop upload
 * produces the same codex rows as the seed script. Progress is streamed so the
 * renderer can show a live per-table counter.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log';
import { API_BASE, RELEASE_TOKEN } from '../lib/release-token.js';
import {
  makeTagger,
  collectStrings,
  collectPorts,
  collectIngredients,
  dedupeStrings,
  mapManufacturers,
  mapShips,
  mapWeapons,
  mapComponents,
  mapItems,
  mapAmmunition,
  mapBlueprints,
  type Nat,
  type StringRow,
  type PortRow,
} from '../lib/catalog-map.js';

const CHUNK = 500; // entity/string rows per request
const LOCALE_CHUNK = 1000; // locale rows per request (small rows)

export interface CatalogProgress {
  phase: string; // human/i18n key-ish label, e.g. 'ships'
  current: number;
  total: number;
}
export type CatalogProgressCb = (p: CatalogProgress) => void;

export interface CatalogUploadResult {
  ok: boolean;
  buildId?: string;
  counts?: Record<string, number>;
  error?: string;
}

function endpoint(): string {
  return `${API_BASE.replace(/\/$/, '')}/functions/v1/ingest-catalog`;
}

async function readJsonDir(outDir: string, sub: string): Promise<Record<string, unknown>[]> {
  const dir = join(outDir, sub);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out: Record<string, unknown>[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(join(dir, f), 'utf-8')));
    } catch (e) {
      log.warn(`[catalog] skip ${sub}/${f}: ${(e as Error).message}`);
    }
  }
  return out;
}

/**
 * Drive the full ingest-catalog protocol for one extractor out_dir.
 * Best-effort per op with a hard failure surfaced as { ok:false, error }.
 */
export async function uploadCatalog(
  accessToken: string,
  outDir: string,
  onProgress: CatalogProgressCb,
): Promise<CatalogUploadResult> {
  if (!existsSync(outDir)) return { ok: false, error: 'out_dir_missing' };
  const manifestPath = join(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) return { ok: false, error: 'manifest_missing' };

  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${accessToken}`,
    'x-sc-release-token': RELEASE_TOKEN,
  };

  const post = async (op: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ op, ...extra }),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`${op} → HTTP ${res.status} ${(j.error as string) ?? ''} ${(j.message as string) ?? ''}`.trim());
    }
    return j;
  };

  const sendEntity = async (table: string, rows: unknown[]): Promise<number> => {
    let done = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      await post('upsert', { table, rows: slice });
      done += slice.length;
      onProgress({ phase: table, current: done, total: rows.length });
    }
    return done;
  };

  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Record<string, unknown>;
    const nat: Nat = {
      // Uppercase to match the codex read path (codex.service queries
      // channel='LIVE'); the extractor already emits 'LIVE'/'PTU'/… but this
      // guarantees the promoted build is actually visible.
      channel: String(manifest.channel ?? 'LIVE').toUpperCase(),
      patch_version: String(manifest.patch_version ?? '4.x'),
      // build_number is often empty from the extractor; fall back to a stable
      // label so the (channel,patch,build) natural key stays consistent.
      build_number: String(manifest.build_number ?? '').trim() || 'desktop',
    };

    // 1. build row ----------------------------------------------------------
    onProgress({ phase: 'init', current: 0, total: 1 });
    const initRes = await post('init', {
      build: {
        ...nat,
        schema_version: manifest.schema_version ?? 1,
        quality_score: manifest.quality_score ?? null,
        tool_version: manifest.tool_version ?? null,
        entity_counts: manifest.entity_counts ?? {},
        manifest,
      },
    });
    const buildId = String(initRes.build_id ?? '');
    if (!buildId) return { ok: false, error: 'no_build_id' };
    const tag = makeTagger(buildId, nat);

    const strings: StringRow[] = [];
    const ports: PortRow[] = [];
    const counts: Record<string, number> = {};

    // 2. manufacturers (always full) ---------------------------------------
    {
      const list = await readJsonDir(outDir, 'manufacturers');
      for (const m of list) {
        collectStrings(strings, buildId, nat, m.className as string, 'manufacturer', [
          { field: 'name', loc: m.name },
          { field: 'description', loc: m.description },
        ]);
      }
      counts.manufacturers = await sendEntity('codex_manufacturers', mapManufacturers(list, tag));
    }

    // 3. ships (always full) -----------------------------------------------
    {
      const list = await readJsonDir(outDir, 'ships');
      for (const s of list) {
        collectStrings(strings, buildId, nat, s.className as string, 'ship', [
          { field: 'name', loc: s.name },
          { field: 'description', loc: s.description },
          { field: 'vehicleName', loc: (s as { vehicleName?: unknown }).vehicleName },
        ]);
        collectPorts(ports, buildId, nat, s.className as string, 'ship', (s as { itemPorts?: unknown }).itemPorts);
      }
      counts.ships = await sendEntity('codex_ships', mapShips(list, tag));
    }

    // 4. weapons -----------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'weapons');
      for (const w of list) {
        collectStrings(strings, buildId, nat, w.className as string, 'weapon', [
          { field: 'name', loc: w.name },
          { field: 'description', loc: w.description },
        ]);
        collectPorts(ports, buildId, nat, w.className as string, 'weapon', (w as { itemPorts?: unknown }).itemPorts);
      }
      counts.weapons = await sendEntity('codex_weapons', mapWeapons(list, tag));
    }

    // 5. components --------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'components');
      for (const c of list) {
        collectStrings(strings, buildId, nat, c.className as string, 'component', [
          { field: 'name', loc: c.name },
          { field: 'description', loc: c.description },
        ]);
        collectPorts(ports, buildId, nat, c.className as string, 'component', (c as { itemPorts?: unknown }).itemPorts);
      }
      counts.components = await sendEntity('codex_components', mapComponents(list, tag));
    }

    // 6. items -------------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'items');
      for (const it of list) {
        collectStrings(strings, buildId, nat, it.className as string, 'item', [
          { field: 'name', loc: it.name },
          { field: 'description', loc: it.description },
        ]);
      }
      counts.items = await sendEntity('codex_items', mapItems(list, tag));
    }

    // 7. ammunition --------------------------------------------------------
    {
      const list = await readJsonDir(outDir, 'ammunition');
      counts.ammunition = await sendEntity('codex_ammunition', mapAmmunition(list, tag));
    }

    // 7b. blueprints + ingredients -----------------------------------------
    {
      const list = await readJsonDir(outDir, 'blueprints');
      for (const bp of list) {
        collectStrings(strings, buildId, nat, bp.className as string, 'blueprint', [
          { field: 'name', loc: bp.name },
          { field: 'description', loc: bp.description },
        ]);
      }
      counts.blueprints = await sendEntity('codex_blueprints', mapBlueprints(list, tag));

      const ingredientRows = collectIngredients(buildId, nat, list);
      await post('clear_ingredients', { build_id: buildId });
      let ing = 0;
      for (let i = 0; i < ingredientRows.length; i += CHUNK) {
        const slice = ingredientRows.slice(i, i + CHUNK);
        await post('ingredients', { build_id: buildId, rows: slice });
        ing += slice.length;
        onProgress({ phase: 'codex_blueprint_ingredients', current: ing, total: ingredientRows.length });
      }
      counts.blueprint_ingredients = ing;
    }

    // 8. entity strings (deduped) + ports ----------------------------------
    {
      const deduped = dedupeStrings(strings);
      let done = 0;
      for (let i = 0; i < deduped.length; i += CHUNK) {
        const slice = deduped.slice(i, i + CHUNK);
        await post('strings', { rows: slice });
        done += slice.length;
        onProgress({ phase: 'codex_entity_strings', current: done, total: deduped.length });
      }
      counts.entity_strings = done;
    }
    {
      await post('clear_ports', { build_id: buildId });
      let done = 0;
      for (let i = 0; i < ports.length; i += CHUNK) {
        const slice = ports.slice(i, i + CHUNK);
        await post('ports', { build_id: buildId, rows: slice });
        done += slice.length;
        onProgress({ phase: 'codex_item_ports', current: done, total: ports.length });
      }
      counts.item_ports = done;
    }

    // 9. full localization tables ------------------------------------------
    {
      const dir = join(outDir, 'localization');
      const localeRows: { build_id: string; lang: string; key: string; value: string }[] = [];
      if (existsSync(dir)) {
        for (const f of (await readdir(dir)).filter((n) => n.endsWith('.json'))) {
          const lang = f.replace(/\.json$/, '');
          const table = JSON.parse(await readFile(join(dir, f), 'utf-8')) as Record<string, unknown>;
          for (const [key, value] of Object.entries(table)) {
            if (value == null) continue;
            localeRows.push({ build_id: buildId, lang, key, value: String(value) });
          }
        }
      }
      let done = 0;
      for (let i = 0; i < localeRows.length; i += LOCALE_CHUNK) {
        const slice = localeRows.slice(i, i + LOCALE_CHUNK);
        await post('locale_strings', { rows: slice });
        done += slice.length;
        onProgress({ phase: 'codex_locale_strings', current: done, total: localeRows.length });
      }
      counts.locale_strings = done;
    }

    // 9b. preview images ----------------------------------------------------
    {
      const dir = join(outDir, 'previews');
      if (existsSync(dir)) {
        const files = (await readdir(dir)).filter((f) => f.endsWith('.webp'));
        let done = 0;
        for (const name of files) {
          const bytes = await readFile(join(dir, name));
          await post('preview', {
            build_number: nat.build_number,
            name,
            content_base64: bytes.toString('base64'),
          });
          done += 1;
          onProgress({ phase: 'codex_previews', current: done, total: files.length });
        }
        counts.previews = done;
      }
    }

    // 10. finalize (flip is_current) ---------------------------------------
    onProgress({ phase: 'finalize', current: 0, total: 1 });
    await post('finalize', { build_id: buildId, entity_counts: { ...(manifest.entity_counts as object), seeded: counts } });
    onProgress({ phase: 'finalize', current: 1, total: 1 });

    log.info(`[catalog] promoted build ${buildId} (${nat.channel} ${nat.patch_version} ${nat.build_number})`);
    return { ok: true, buildId, counts };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`[catalog] promotion failed: ${error}`);
    return { ok: false, error };
  }
}
