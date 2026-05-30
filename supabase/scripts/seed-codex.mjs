#!/usr/bin/env node
// =============================================================================
// seed-codex.mjs — bulk-load an extractor out_dir into the codex_* cloud tables.
//
// Reads the typed JSON folders the extractor writes (ships/, weapons/,
// components/, items/, ammunition/, manufacturers/ — shape documented in
// docs/concepts/codex-extraction-output.md), maps them onto the 00008 schema,
// and upserts everything under a single codex_builds row via the SERVICE-ROLE
// key (RLS bypass — writes are service-role only). On success it flips the
// build to is_current for its channel.
//
// TWO TRANSPORTS
//   (A) Direct service-role (default): writes straight to the DB, RLS bypassed.
//       SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.
//   (B) Edge-function (--via-function): POSTs batches to the deployed
//       `ingest-catalog` function, which holds the service-role secret
//       server-side. The LOCAL machine then needs only the public anon key +
//       a seed token (SUPABASE_ANON_KEY + SUPABASE_SEED_TOKEN) — never the
//       service-role key. This is how the cloud DB was seeded in Wave 2.
//
// USAGE
//   # (A) direct
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<key> \
//     node supabase/scripts/seed-codex.mjs --out <out_dir> [--limit-per-kind N] [--no-current]
//   # (B) via edge function (keyless on this machine)
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> \
//   SUPABASE_SEED_TOKEN=<token> \
//     node supabase/scripts/seed-codex.mjs --via-function --out <out_dir> ...
//
//   --out             extractor output dir (default: %LOCALAPPDATA%/sc-companion/extracts/LIVE-full)
//   --limit-per-kind  cap rows per entity kind (representative subset; ships +
//                     manufacturers are always loaded in full regardless)
//   --no-current      do not flip is_current on completion
//
// Secrets are read from env and NEVER written to disk or logged. To run the
// FULL extraction first, see desktop-tool/python (extract.py) and point --out
// at its output.
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
const LIMIT = Number(arg('limit-per-kind', 0)) || 0; // 0 = no limit
const SET_CURRENT = arg('no-current') !== true;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.');
  process.exit(1);
}
if (!existsSync(OUT_DIR)) {
  console.error(`ERROR: out dir not found: ${OUT_DIR}`);
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CHUNK = 500; // rows per upsert request (respect body limits)

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
  const en = (name.en || '').trim();
  const de = (name.de || '').trim();
  // Single clean display name (used by the list view + trigram search).
  // Prefer EN, fall back to DE. Do NOT concatenate en+de — SC names are
  // usually identical across languages, which produced doubled strings
  // like "Avenger Stalker Avenger Stalker".
  return en || de || null;
}

// AI/template variant heuristic (docs/concepts/codex-extraction-output.md §5).
const VARIANT_RE = /(_PU_AI_|_AI_|_Template$|^MASTER_|_Unmanned_|_Renegade$)/i;
const isVariant = (cn) => VARIANT_RE.test(cn || '');

const manuCode = (e) =>
  e.manufacturer && typeof e.manufacturer === 'object' ? e.manufacturer.code ?? null : null;

async function upsertChunks(table, rows, onConflict) {
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).upsert(slice, { onConflict });
    if (error) {
      console.error(`  upsert ${table} [${i}..${i + slice.length}] failed: ${error.message}`);
      throw error;
    }
    done += slice.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  if (rows.length) process.stdout.write('\n');
  return done;
}

// ---- main -------------------------------------------------------------------
async function main() {
  console.log(`seed-codex: out=${OUT_DIR}  limit-per-kind=${LIMIT || 'none'}`);

  const manifest = JSON.parse(await readFile(join(OUT_DIR, 'manifest.json'), 'utf-8'));
  const channel = manifest.channel ?? 'LIVE';
  const patch = manifest.patch_version ?? '4.x';
  const build = manifest.build_number ?? 'seed';
  const nat = { channel, patch_version: patch, build_number: build };

  // 1. build row -------------------------------------------------------------
  const { data: buildRow, error: buildErr } = await sb
    .from('codex_builds')
    .upsert(
      {
        ...nat,
        schema_version: manifest.schema_version ?? 1,
        quality_score: manifest.quality_score ?? null,
        tool_version: manifest.tool_version ?? null,
        entity_counts: manifest.entity_counts ?? {},
        manifest,
        extracted_at: new Date().toISOString(),
      },
      { onConflict: 'channel,patch_version,build_number' },
    )
    .select('id')
    .single();
  if (buildErr) throw buildErr;
  const buildId = buildRow.id;
  console.log(`build row: ${buildId} (${channel} ${patch} ${build})`);

  const tagged = (extra) => ({ build_id: buildId, ...nat, ...extra });
  const strings = []; // collected across all entity kinds
  const ports = [];

  function collectStrings(entityClassName, entityKind, fields) {
    // fields: array of { field, loc } where loc = {de,en,key}
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
    counts.manufacturers = await upsertChunks(
      'codex_manufacturers', rows, 'channel,patch_version,build_number,class_name',
    );
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
    counts.ships = await upsertChunks(
      'codex_ships', rows, 'channel,patch_version,build_number,class_name',
    );
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
    counts.weapons = await upsertChunks(
      'codex_weapons', rows, 'channel,patch_version,build_number,class_name',
    );
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
    counts.components = await upsertChunks(
      'codex_components', rows, 'channel,patch_version,build_number,class_name',
    );
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
    counts.items = await upsertChunks(
      'codex_items', rows, 'channel,patch_version,build_number,class_name',
    );
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
    counts.ammunition = await upsertChunks(
      'codex_ammunition', rows, 'channel,patch_version,build_number,class_name',
    );
  }

  // 8. strings + ports (deduped) --------------------------------------------
  // Dedupe strings on (entity_class_name, lang, field) — matches the table's
  // natural key; later collision wins (entities are distinct so collisions are
  // rare but cheap to guard).
  {
    const seen = new Map();
    for (const s of strings) seen.set(`${s.entity_class_name}|${s.lang}|${s.field}`, s);
    const deduped = [...seen.values()];
    counts.entity_strings = await upsertChunks(
      'codex_entity_strings', deduped, 'build_id,entity_class_name,lang,field',
    );
  }
  {
    // ports have no natural unique key; clear this build's ports then insert.
    await sb.from('codex_item_ports').delete().eq('build_id', buildId);
    let done = 0;
    for (let i = 0; i < ports.length; i += CHUNK) {
      const slice = ports.slice(i, i + CHUNK);
      const { error } = await sb.from('codex_item_ports').insert(slice);
      if (error) throw error;
      done += slice.length;
      process.stdout.write(`\r  codex_item_ports: ${done}/${ports.length}`);
    }
    if (ports.length) process.stdout.write('\n');
    counts.item_ports = done;
  }

  // 9. update build entity_counts + set current ------------------------------
  await sb.from('codex_builds').update({ entity_counts: { ...manifest.entity_counts, seeded: counts } }).eq('id', buildId);

  if (SET_CURRENT) {
    const { error } = await sb.rpc('set_current_codex_build', { p_build_id: buildId });
    if (error) console.warn(`set_current_codex_build failed (non-fatal): ${error.message}`);
    else console.log(`build ${buildId} set current for channel ${channel}`);
  }

  console.log('\nDONE. Seeded row counts:');
  console.table(counts);
}

main().catch((e) => {
  console.error('\nFATAL:', e.message ?? e);
  process.exit(1);
});
