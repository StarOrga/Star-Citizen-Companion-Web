#!/usr/bin/env node
// =============================================================================
// seed-codex.mjs — bulk-load an extractor out_dir into the codex_* cloud tables.
//
// Reads the typed JSON folders the extractor writes (ships/, weapons/,
// components/, items/, ammunition/, manufacturers/, blueprints/, localization/ —
// shape documented in docs/concepts/codex-extraction-output.md), maps them onto
// the 00008 + 00010 + 20260530 schema, and upserts everything under a single
// codex_builds row. On success it flips the build to is_current for its channel.
//
// TWO TRANSPORTS
//   (A) Direct service-role (default): writes straight to the DB, RLS bypassed.
//       SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.
//   (B) Edge-function (--via-function): POSTs batches to the deployed
//       `ingest-catalog` function, which holds the service-role secret
//       server-side. The LOCAL machine then needs only the public anon key + a
//       seed token (SUPABASE_ANON_KEY + SUPABASE_SEED_TOKEN) — never the
//       service-role key.
//
// USAGE
//   # (A) direct
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> \
//     node supabase/scripts/seed-codex.mjs --out <out_dir> [--limit N] [--no-current]
//   # (B) via edge function (keyless on this machine)
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> \
//   SUPABASE_SEED_TOKEN=<token> \
//     node supabase/scripts/seed-codex.mjs --via-function --out <out_dir> ...
//
//   --out             extractor output dir (default: %LOCALAPPDATA%/sc-companion/extracts/LIVE-full)
//   --limit           cap rows per entity kind (0/unset = FULL catalog; ships +
//                     manufacturers are always loaded in full regardless). Alias:
//                     --limit-per-kind (accepted for backwards compat).
//   --no-locale       skip the (large) localization table load
//   --no-current      do not flip is_current on completion
//
// Secrets are read from env and NEVER written to disk or logged.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// ---- args -------------------------------------------------------------------
function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const DEFAULT_OUT = join(
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'sc-companion', 'extracts', 'LIVE-full',
);
const OUT_DIR = arg('out', DEFAULT_OUT);
// --limit (canonical) OR --limit-per-kind (legacy alias), default = 0 = no cap.
const LIMIT = Number(arg('limit', arg('limit-per-kind', 0))) || 0; // 0 = no limit
const SET_CURRENT = arg('no-current') !== true;
const LOAD_LOCALE = arg('no-locale') !== true;
const VIA = arg('via-function') === true;

const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  console.error('ERROR: SUPABASE_URL env var is required.');
  process.exit(1);
}
if (!existsSync(OUT_DIR)) {
  console.error(`ERROR: out dir not found: ${OUT_DIR}`);
  process.exit(1);
}

// ---- transport --------------------------------------------------------------
// Either a direct service-role supabase client OR an edge-function POSTer.
let sb = null;
let postFn = null;
if (VIA) {
  const ANON = process.env.SUPABASE_ANON_KEY;
  const SEED_TOKEN = process.env.SUPABASE_SEED_TOKEN;
  if (!ANON || !SEED_TOKEN) {
    console.error('ERROR: --via-function needs SUPABASE_ANON_KEY and SUPABASE_SEED_TOKEN.');
    process.exit(1);
  }
  const ENDPOINT = `${SUPABASE_URL}/functions/v1/ingest-catalog`;
  postFn = async (op, extra) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        'x-sc-seed-token': SEED_TOKEN,
      },
      body: JSON.stringify({ op, ...extra }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${op} failed: HTTP ${res.status} ${j.error ?? ''} ${j.message ?? ''}`.trim());
    }
    return j;
  };
} else {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) {
    console.error('ERROR: direct mode needs SUPABASE_SERVICE_ROLE_KEY (or pass --via-function).');
    process.exit(1);
  }
  sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const CHUNK = 500;        // entity/string rows per request
const LOCALE_CHUNK = 1000; // locale rows per request (small rows)
const NAT_CONFLICT = 'channel,patch_version,build_number,class_name';

// ---- write primitives (branch on transport) ---------------------------------
async function initBuild(buildPayload) {
  if (VIA) {
    const j = await postFn('init', { build: buildPayload });
    return j.build_id;
  }
  const { data, error } = await sb
    .from('codex_builds')
    .upsert(buildPayload, { onConflict: 'channel,patch_version,build_number' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function sendEntity(table, rows) {
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    if (VIA) await postFn('upsert', { table, rows: slice });
    else {
      const { error } = await sb.from(table).upsert(slice, { onConflict: NAT_CONFLICT });
      if (error) throw error;
    }
    done += slice.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return done;
}

async function sendStrings(rows) {
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    if (VIA) await postFn('strings', { rows: slice });
    else {
      const { error } = await sb
        .from('codex_entity_strings')
        .upsert(slice, { onConflict: 'build_id,entity_class_name,lang,field' });
      if (error) throw error;
    }
    done += slice.length;
    process.stdout.write(`\r  codex_entity_strings: ${done}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return done;
}

async function sendLocale(rows) {
  let done = 0;
  for (let i = 0; i < rows.length; i += LOCALE_CHUNK) {
    const slice = rows.slice(i, i + LOCALE_CHUNK);
    if (VIA) await postFn('locale_strings', { rows: slice });
    else {
      const { error } = await sb
        .from('codex_locale_strings')
        .upsert(slice, { onConflict: 'build_id,lang,key' });
      if (error) throw error;
    }
    done += slice.length;
    process.stdout.write(`\r  codex_locale_strings: ${done}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return done;
}

async function sendPorts(buildId, rows) {
  if (VIA) await postFn('clear_ports', { build_id: buildId });
  else await sb.from('codex_item_ports').delete().eq('build_id', buildId);
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    if (VIA) await postFn('ports', { build_id: buildId, rows: slice });
    else {
      const { error } = await sb.from('codex_item_ports').insert(slice);
      if (error) throw error;
    }
    done += slice.length;
    process.stdout.write(`\r  codex_item_ports: ${done}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return done;
}

async function sendIngredients(buildId, rows) {
  // Clear then re-insert (same pattern as codex_item_ports / clear_ports).
  if (VIA) await postFn('clear_ingredients', { build_id: buildId });
  else await sb.from('codex_blueprint_ingredients').delete().eq('build_id', buildId);
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    if (VIA) await postFn('ingredients', { build_id: buildId, rows: slice });
    else {
      const { error } = await sb.from('codex_blueprint_ingredients').insert(slice);
      if (error) throw error;
    }
    done += slice.length;
    process.stdout.write(`\r  codex_blueprint_ingredients: ${done}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return done;
}

async function sendPreviews(buildNumber) {
  const dir = join(OUT_DIR, 'previews');
  if (!existsSync(dir)) return 0;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.webp'));
  let done = 0;
  for (const name of files) {
    const bytes = await readFile(join(dir, name));
    if (VIA) {
      await postFn('preview', {
        build_number: buildNumber,
        name,
        content_base64: bytes.toString('base64'),
      });
    } else {
      const { error } = await sb.storage
        .from('codex-previews')
        .upload(`${buildNumber}/${name}`, bytes, { contentType: 'image/webp', upsert: true });
      if (error) throw error;
    }
    done += 1;
    process.stdout.write(`\r  codex-previews: ${done}/${files.length}`);
  }
  if (files.length) process.stdout.write('\n');
  return done;
}

async function finalize(buildId, entityCounts) {
  if (VIA) {
    await postFn('finalize', { build_id: buildId, entity_counts: entityCounts });
    return;
  }
  await sb.from('codex_builds').update({ entity_counts: entityCounts }).eq('id', buildId);
  if (SET_CURRENT) {
    const { error } = await sb.rpc('set_current_codex_build', { p_build_id: buildId });
    if (error) console.warn(`set_current_codex_build failed (non-fatal): ${error.message}`);
  }
}

// ---- helpers ----------------------------------------------------------------
async function readJsonDir(sub, limit = 0) {
  const dir = join(OUT_DIR, sub);
  if (!existsSync(dir)) return [];
  let files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  if (limit > 0) files = files.slice(0, limit);
  const out = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await readFile(join(dir, f), 'utf-8')));
    } catch (e) {
      console.warn(`  skip ${sub}/${f}: ${e.message}`);
    }
  }
  return out;
}

function localizedName(name) {
  if (!name || typeof name !== 'object') return null;
  // Drop unresolved keys (value still '@...') so the UI falls back to the
  // className rather than showing a raw global.ini key.
  const clean = (v) => {
    const s = (v || '').trim();
    return s && !s.startsWith('@') ? s : '';
  };
  const en = clean(name.en);
  const de = clean(name.de);
  // Prefer EN, fall back to DE. Do NOT concatenate (SC names are usually
  // identical across languages → doubled strings otherwise).
  return en || de || null;
}

const VARIANT_RE = /(_PU_AI_|_AI_|_Template$|^MASTER_|_Unmanned_|_Renegade$)/i;
const isVariant = (cn) => VARIANT_RE.test(cn || '');

const manuCode = (e) =>
  e.manufacturer && typeof e.manufacturer === 'object' ? e.manufacturer.code ?? null : null;

// ---- main -------------------------------------------------------------------
async function main() {
  console.log(
    `seed-codex: out=${OUT_DIR}  transport=${VIA ? 'edge-function' : 'service-role'}  ` +
      `limit-per-kind=${LIMIT || 'none'}  locale=${LOAD_LOCALE}`,
  );

  const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf-8'));
  const channel = manifest.channel ?? 'LIVE';
  const patch = manifest.patch_version ?? '4.x';
  const build = manifest.build_number ?? 'seed';
  const nat = { channel, patch_version: patch, build_number: build };

  // 1. build row -------------------------------------------------------------
  const buildId = await initBuild({
    ...nat,
    schema_version: manifest.schema_version ?? 1,
    quality_score: manifest.quality_score ?? null,
    tool_version: manifest.tool_version ?? null,
    entity_counts: manifest.entity_counts ?? {},
    manifest,
    extracted_at: new Date().toISOString(),
  });
  console.log(`build row: ${buildId} (${channel} ${patch} ${build})`);

  const tagged = (extra) => ({ build_id: buildId, ...nat, ...extra });
  const strings = [];
  const ports = [];

  function collectStrings(entityClassName, entityKind, fields) {
    for (const { field, loc } of fields) {
      if (!loc || typeof loc !== 'object') continue;
      for (const lang of ['en', 'de']) {
        const value = loc[lang];
        if (value == null || value === '') continue;
        strings.push(
          tagged({
            entity_class_name: entityClassName,
            entity_kind: entityKind,
            lang,
            field,
            value,
            loc_key: loc.key ?? null,
          }),
        );
      }
    }
  }

  function collectPorts(parentClassName, parentKind, itemPorts) {
    if (!Array.isArray(itemPorts)) return;
    itemPorts.forEach((p, idx) =>
      ports.push(
        tagged({
          parent_class_name: parentClassName,
          parent_kind: parentKind,
          port_name: p.portName ?? null,
          min_size: p.minSize ?? null,
          max_size: p.maxSize ?? null,
          types: Array.isArray(p.types) ? p.types : [],
          flags: Array.isArray(p.flags) ? p.flags : [],
          port_index: idx,
        }),
      ),
    );
  }

  const counts = {};

  // 2. manufacturers (always full) ------------------------------------------
  {
    const list = await readJsonDir('manufacturers');
    const rows = list.map((m) =>
      tagged({
        class_name: m.className,
        guid: m.guid ?? null,
        manufacturer_code: m.code ?? null,
        name_localized: localizedName(m.name),
        payload: m,
      }),
    );
    for (const m of list) {
      collectStrings(m.className, 'manufacturer', [
        { field: 'name', loc: m.name },
        { field: 'description', loc: m.description },
      ]);
    }
    counts.manufacturers = await sendEntity('codex_manufacturers', rows);
  }

  // 3. ships (always full) ---------------------------------------------------
  {
    const list = await readJsonDir('ships');
    const rows = list.map((s) =>
      tagged({
        class_name: s.className,
        guid: s.guid ?? null,
        entity_kind: 'ship',
        manufacturer_code: manuCode(s),
        role: s.role ?? null,
        crew_size: s.crew?.size ?? null,
        is_variant: isVariant(s.className),
        name_localized: localizedName(s.name),
        payload: s,
      }),
    );
    for (const s of list) {
      collectStrings(s.className, 'ship', [
        { field: 'name', loc: s.name },
        { field: 'description', loc: s.description },
        { field: 'vehicleName', loc: s.vehicleName },
      ]);
      collectPorts(s.className, 'ship', s.itemPorts);
    }
    counts.ships = await sendEntity('codex_ships', rows);
  }

  // 4. weapons ---------------------------------------------------------------
  {
    const list = await readJsonDir('weapons', LIMIT);
    const rows = list.map((w) =>
      tagged({
        class_name: w.className,
        guid: w.guid ?? null,
        entity_kind: 'weapon',
        weapon_class: w.weaponClass ?? null,
        attach_type: w.attachType ?? null,
        sub_type: w.subType ?? null,
        size: w.size ?? null,
        grade: w.grade ?? null,
        manufacturer_code: manuCode(w),
        is_variant: isVariant(w.className),
        name_localized: localizedName(w.name),
        payload: w,
      }),
    );
    for (const w of list) {
      collectStrings(w.className, 'weapon', [
        { field: 'name', loc: w.name },
        { field: 'description', loc: w.description },
      ]);
      collectPorts(w.className, 'weapon', w.itemPorts);
    }
    counts.weapons = await sendEntity('codex_weapons', rows);
  }

  // 5. components ------------------------------------------------------------
  {
    const list = await readJsonDir('components', LIMIT);
    const rows = list.map((c) =>
      tagged({
        class_name: c.className,
        guid: c.guid ?? null,
        entity_kind: 'component',
        kind: c.kind ?? null,
        attach_type: c.attachType ?? null,
        sub_type: c.subType ?? null,
        size: c.size ?? null,
        grade: c.grade ?? null,
        manufacturer_code: manuCode(c),
        is_variant: isVariant(c.className),
        name_localized: localizedName(c.name),
        payload: c,
      }),
    );
    for (const c of list) {
      collectStrings(c.className, 'component', [
        { field: 'name', loc: c.name },
        { field: 'description', loc: c.description },
      ]);
      collectPorts(c.className, 'component', c.itemPorts);
    }
    counts.components = await sendEntity('codex_components', rows);
  }

  // 6. items -----------------------------------------------------------------
  {
    const list = await readJsonDir('items', LIMIT);
    const rows = list.map((it) =>
      tagged({
        class_name: it.className,
        guid: it.guid ?? null,
        entity_kind: 'item',
        attach_type: it.attachType ?? null,
        sub_type: it.subType ?? null,
        size: it.size ?? null,
        grade: it.grade ?? null,
        manufacturer_code: manuCode(it),
        is_variant: isVariant(it.className),
        name_localized: localizedName(it.name),
        payload: it,
      }),
    );
    for (const it of list) {
      collectStrings(it.className, 'item', [
        { field: 'name', loc: it.name },
        { field: 'description', loc: it.description },
      ]);
    }
    counts.items = await sendEntity('codex_items', rows);
  }

  // 7. ammunition ------------------------------------------------------------
  {
    const list = await readJsonDir('ammunition', LIMIT);
    const rows = list.map((a) =>
      tagged({
        class_name: a.className,
        guid: a.guid ?? null,
        speed: a.speed ?? null,
        lifetime: a.lifetime ?? null,
        size: a.size ?? null,
        name_localized: null,
        payload: a,
      }),
    );
    counts.ammunition = await sendEntity('codex_ammunition', rows);
  }

  // 7b. blueprints + ingredients + blueprint strings -------------------------
  {
    const ingredientRows = [];
    const list = await readJsonDir('blueprints', LIMIT);
    const rows = list.map((bp) => {
      // Primary output className = outputs[0].className (null if no output resolved)
      const outputClassName =
        Array.isArray(bp.outputs) && bp.outputs.length > 0
          ? (bp.outputs[0].className ?? null)
          : null;
      return tagged({
        class_name: bp.className,
        guid: bp.guid ?? null,
        entity_kind: 'blueprint',
        category: bp.category ?? null,
        tier: bp.tier ?? null,
        craft_time_seconds: bp.craftTimeSeconds ?? null,
        dismantle_time_seconds: bp.dismantleTimeSeconds ?? null,
        dismantle_efficiency: bp.dismantleEfficiency ?? null,
        output_class_name: outputClassName,
        is_default: bp.isDefault ?? null,
        is_variant: false,
        name_localized: localizedName(bp.name),
        payload: bp,
      });
    });

    // Collect ingredient rows from all blueprints
    for (const bp of list) {
      if (!Array.isArray(bp.ingredients)) continue;
      bp.ingredients.forEach((ing, idx) => {
        ingredientRows.push(
          tagged({
            blueprint_class_name: bp.className,
            ingredient_class_name: ing.className ?? null,
            ingredient_guid: ing.guid ?? null,
            quantity: ing.quantity ?? null,
            min_quality: ing.minQuality ?? null,
            role: ing.role ?? null,
            ingredient_index: idx,
          }),
        );
      });
    }

    // Collect entity strings for blueprints (name + description, en + de)
    for (const bp of list) {
      collectStrings(bp.className, 'blueprint', [
        { field: 'name', loc: bp.name },
        { field: 'description', loc: bp.description },
      ]);
    }

    counts.blueprints = await sendEntity('codex_blueprints', rows);
    counts.blueprint_ingredients = await sendIngredients(buildId, ingredientRows);
  }

  // 8. entity strings + ports (deduped) -------------------------------------
  {
    const seen = new Map();
    for (const s of strings) seen.set(`${s.entity_class_name}|${s.lang}|${s.field}`, s);
    counts.entity_strings = await sendStrings([...seen.values()]);
  }
  counts.item_ports = await sendPorts(buildId, ports);

  // 9. full localization tables ----------------------------------------------
  if (LOAD_LOCALE) {
    const localeRows = [];
    const dir = join(OUT_DIR, 'localization');
    if (existsSync(dir)) {
      for (const f of (await readdir(dir)).filter((n) => n.endsWith('.json'))) {
        const lang = f.replace(/\.json$/, '');
        const table = JSON.parse(await readFile(join(dir, f), 'utf-8'));
        for (const [key, value] of Object.entries(table)) {
          if (value == null) continue;
          localeRows.push({ build_id: buildId, lang, key, value: String(value) });
        }
      }
    }
    counts.locale_strings = await sendLocale(localeRows);
  }

  // 9b. preview images (deduped WebP) → public storage bucket ----------------
  counts.previews = await sendPreviews(build);

  // 10. finalize -------------------------------------------------------------
  await finalize(buildId, { ...manifest.entity_counts, seeded: counts });
  if (SET_CURRENT) console.log(`build ${buildId} set current for channel ${channel}`);

  console.log('\nDONE. Seeded row counts:');
  console.table(counts);
}

main().catch((e) => {
  console.error('\nFATAL:', e.message ?? e);
  process.exit(1);
});
