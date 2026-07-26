#!/usr/bin/env node
// =============================================================================
// gen-codex-sql.mjs — emit codex_* INSERT SQL batches from an extractor out_dir.
//
// A keyless sibling of seed-codex.mjs: instead of upserting via the
// service-role key, it writes plain SQL files that can be applied through any
// service-role channel (e.g. the Supabase MCP execute_sql, the SQL editor, or
// psql). Used to seed the cloud DB from this agent session, which has DB
// access but not the service-role key.
//
// USAGE
//   node supabase/scripts/gen-codex-sql.mjs --out <out_dir> --dest <sql_dir> \
//        [--ships N --weapons N --components N --items N --ammo N --batch N]
//
// Subset defaults below produce a representative-but-correct catalog.
// =============================================================================
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

function arg(name, fb) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fb;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const OUT = arg('out', join(process.env.LOCALAPPDATA || '', 'sc-companion', 'extracts', 'LIVE-full'));
const DEST = arg('dest', join(process.cwd(), '.codex-seed-sql'));
const LIM = {
  ships: Number(arg('ships', 0)) || 0,
  weapons: Number(arg('weapons', 300)) || 0,
  components: Number(arg('components', 300)) || 0,
  items: Number(arg('items', 300)) || 0,
  ammunition: Number(arg('ammo', 0)) || 0,
  manufacturers: Number(arg('manufacturers', 0)) || 0,
};
const BATCH = Number(arg('batch', 250)) || 250;

const q = (v) => {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? 'null' : Number(v));
const bool = (v) => (v ? 'true' : 'false');
const jsonb = (o) => `${q(JSON.stringify(o))}::jsonb`;
const arr = (a) =>
  Array.isArray(a) && a.length ? `array[${a.map((x) => q(String(x))).join(',')}]::text[]` : `'{}'::text[]`;

async function readDir(sub, lim = 0) {
  const dir = join(OUT, sub);
  if (!existsSync(dir)) return [];
  let files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  if (lim > 0) files = files.slice(0, lim);
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(await readFile(join(dir, f), 'utf-8'))); } catch { /* skip */ }
  }
  return out;
}
const locName = (n) => {
  if (!n || typeof n !== 'object') return null;
  // Single clean display name — prefer EN, fall back to DE. Never concatenate
  // en+de (SC names are usually identical → doubled strings).
  return (n.en || '').trim() || (n.de || '').trim() || null;
};
const VARIANT = /(_PU_AI_|_AI_|_Template$|^MASTER_|_Unmanned_|_Renegade$)/i;
const mc = (e) => (e.manufacturer && typeof e.manufacturer === 'object' ? e.manufacturer.code ?? null : null);

function batched(rows, header, dest, file) {
  const stmts = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    stmts.push(`${header}\n${slice.join(',\n')};`);
  }
  return { dest, file, stmts };
}

async function main() {
  if (existsSync(DEST)) await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  const manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf-8'));
  const channel = manifest.channel ?? 'LIVE';
  const patch = manifest.patch_version ?? '4.x';
  const build = manifest.build_number ?? 'seed';
  const NK = `${q(channel)},${q(patch)},${q(build)}`;
  const files = [];

  // build row (single statement; uses a CTE so child rows can resolve build_id)
  const buildSql = `
insert into public.codex_builds
  (channel, patch_version, build_number, schema_version, quality_score, tool_version, entity_counts, manifest, extracted_at)
values
  (${q(channel)}, ${q(patch)}, ${q(build)}, ${manifest.schema_version ?? 1},
   ${num(manifest.quality_score)}, ${q(manifest.tool_version)},
   ${jsonb(manifest.entity_counts ?? {})}, ${jsonb(manifest)}, now())
on conflict (channel, patch_version, build_number) do update
  set entity_counts = excluded.entity_counts, manifest = excluded.manifest,
      quality_score = excluded.quality_score, extracted_at = now();`;
  await writeFile(join(DEST, '00_build.sql'), buildSql, 'utf-8');
  files.push('00_build.sql');

  // shared build_id lookup prefix for child inserts
  const BID = `(select id from public.codex_builds where channel=${q(channel)} and patch_version=${q(patch)} and build_number=${q(build)})`;

  const strings = new Map(); // key -> row sql
  const ports = [];

  const addStrings = (cn, kind, fields) => {
    for (const { field, loc } of fields) {
      if (!loc || typeof loc !== 'object') continue;
      for (const lang of ['en', 'de']) {
        const value = loc[lang];
        if (value == null || value === '') continue;
        const k = `${cn}|${lang}|${field}`;
        strings.set(
          k,
          `(${BID}, ${NK}, ${q(cn)}, ${q(kind)}, ${q(lang)}, ${q(field)}, ${q(value)}, ${q(loc.key)})`,
        );
      }
    }
  };
  // A finite numeric tuple as a jsonb literal, else NULL. Hardpoint coordinates
  // (#137 part 3) exist only for ports the extractor matched to a hull helper
  // node; anything malformed is stored as "unknown", never as a coordinate.
  const vecJson = (value, length) =>
    Array.isArray(value) &&
    value.length === length &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
      ? jsonb(value)
      : 'null';
  const addPorts = (cn, kind, ip) => {
    if (!Array.isArray(ip)) return;
    ip.forEach((p, idx) => {
      const pos = vecJson(p.position, 3);
      ports.push(
        `(${BID}, ${NK}, ${q(cn)}, ${q(kind)}, ${q(p.portName)}, ${num(p.minSize)}, ${num(p.maxSize)}, ${arr(p.types)}, ${arr(p.flags)}, ${idx}, ${q(p.helperName)}, ${pos}, ${pos === 'null' ? 'null' : vecJson(p.rotation, 4)})`,
      );
    });
  };

  // manufacturers
  {
    const list = await readDir('manufacturers', LIM.manufacturers); // 0 = all
    const rows = list.map((m) => {
      addStrings(m.className, 'manufacturer', [{ field: 'name', loc: m.name }, { field: 'description', loc: m.description }]);
      return `(${BID}, ${NK}, ${q(m.className)}, ${q(m.guid)}, ${q(m.code)}, ${q(locName(m.name))}, ${jsonb(m)})`;
    });
    const hdr = `insert into public.codex_manufacturers (build_id, channel, patch_version, build_number, class_name, guid, manufacturer_code, name_localized, payload) values`;
    files.push(...emit('10_manufacturers', batched(rows, hdr).stmts, DEST));
  }
  // ships
  {
    const list = await readDir('ships', LIM.ships);
    const rows = list.map((s) => {
      addStrings(s.className, 'ship', [{ field: 'name', loc: s.name }, { field: 'description', loc: s.description }, { field: 'vehicleName', loc: s.vehicleName }]);
      addPorts(s.className, 'ship', s.itemPorts);
      return `(${BID}, ${NK}, ${q(s.className)}, ${q(s.guid)}, 'ship', ${q(mc(s))}, ${q(s.role)}, ${num(s.crew?.size)}, ${bool(VARIANT.test(s.className))}, ${q(locName(s.name))}, ${jsonb(s)})`;
    });
    const hdr = `insert into public.codex_ships (build_id, channel, patch_version, build_number, class_name, guid, entity_kind, manufacturer_code, role, crew_size, is_variant, name_localized, payload) values`;
    files.push(...emit('20_ships', batched(rows, hdr).stmts, DEST));
  }
  // weapons
  {
    const list = await readDir('weapons', LIM.weapons);
    const rows = list.map((w) => {
      addStrings(w.className, 'weapon', [{ field: 'name', loc: w.name }, { field: 'description', loc: w.description }]);
      addPorts(w.className, 'weapon', w.itemPorts);
      return `(${BID}, ${NK}, ${q(w.className)}, ${q(w.guid)}, 'weapon', ${q(w.weaponClass)}, ${q(w.subType)}, ${num(w.size)}, ${q(w.grade)}, ${q(mc(w))}, ${bool(VARIANT.test(w.className))}, ${q(locName(w.name))}, ${jsonb(w)})`;
    });
    const hdr = `insert into public.codex_weapons (build_id, channel, patch_version, build_number, class_name, guid, entity_kind, weapon_class, sub_type, size, grade, manufacturer_code, is_variant, name_localized, payload) values`;
    files.push(...emit('30_weapons', batched(rows, hdr).stmts, DEST));
  }
  // components
  {
    const list = await readDir('components', LIM.components);
    const rows = list.map((c) => {
      addStrings(c.className, 'component', [{ field: 'name', loc: c.name }, { field: 'description', loc: c.description }]);
      addPorts(c.className, 'component', c.itemPorts);
      return `(${BID}, ${NK}, ${q(c.className)}, ${q(c.guid)}, 'component', ${q(c.kind)}, ${q(c.attachType)}, ${q(c.subType)}, ${num(c.size)}, ${q(c.grade)}, ${q(mc(c))}, ${bool(VARIANT.test(c.className))}, ${q(locName(c.name))}, ${jsonb(c)})`;
    });
    const hdr = `insert into public.codex_components (build_id, channel, patch_version, build_number, class_name, guid, entity_kind, kind, attach_type, sub_type, size, grade, manufacturer_code, is_variant, name_localized, payload) values`;
    files.push(...emit('40_components', batched(rows, hdr).stmts, DEST));
  }
  // items
  {
    const list = await readDir('items', LIM.items);
    const rows = list.map((it) => {
      addStrings(it.className, 'item', [{ field: 'name', loc: it.name }, { field: 'description', loc: it.description }]);
      return `(${BID}, ${NK}, ${q(it.className)}, ${q(it.guid)}, 'item', ${q(it.attachType)}, ${q(it.subType)}, ${num(it.size)}, ${q(it.grade)}, ${q(mc(it))}, ${bool(VARIANT.test(it.className))}, ${q(locName(it.name))}, ${jsonb(it)})`;
    });
    const hdr = `insert into public.codex_items (build_id, channel, patch_version, build_number, class_name, guid, entity_kind, attach_type, sub_type, size, grade, manufacturer_code, is_variant, name_localized, payload) values`;
    files.push(...emit('50_items', batched(rows, hdr).stmts, DEST));
  }
  // ammunition
  {
    const list = await readDir('ammunition', LIM.ammunition);
    const rows = list.map((a) =>
      `(${BID}, ${NK}, ${q(a.className)}, ${q(a.guid)}, ${num(a.speed)}, ${num(a.lifetime)}, ${num(a.size)}, ${jsonb(a)})`,
    );
    const hdr = `insert into public.codex_ammunition (build_id, channel, patch_version, build_number, class_name, guid, speed, lifetime, size, payload) values`;
    files.push(...emit('60_ammunition', batched(rows, hdr).stmts, DEST));
  }
  // strings
  {
    const rows = [...strings.values()];
    const hdr = `insert into public.codex_entity_strings (build_id, channel, patch_version, build_number, entity_class_name, entity_kind, lang, field, value, loc_key) values`;
    const tail = ` on conflict (build_id, entity_class_name, lang, field) do nothing`;
    const stmts = [];
    for (let i = 0; i < rows.length; i += BATCH) stmts.push(`${hdr}\n${rows.slice(i, i + BATCH).join(',\n')}${tail};`);
    files.push(...emit('70_strings', stmts, DEST));
  }
  // ports
  {
    const hdr = `insert into public.codex_item_ports (build_id, channel, patch_version, build_number, parent_class_name, parent_kind, port_name, min_size, max_size, types, flags, port_index, helper_name, position, rotation) values`;
    const stmts = [];
    for (let i = 0; i < ports.length; i += BATCH) stmts.push(`${hdr}\n${ports.slice(i, i + BATCH).join(',\n')};`);
    files.push(...emit('80_ports', stmts, DEST));
  }
  // set current
  await writeFile(join(DEST, '90_current.sql'), `select public.set_current_codex_build(${BID});`, 'utf-8');
  files.push('90_current.sql');

  await writeFile(join(DEST, '_manifest.json'), JSON.stringify({ files, dest: DEST }, null, 2), 'utf-8');
  console.log(`generated ${files.length} sql files in ${DEST}`);
}

function emit(prefix, stmts, dest) {
  const out = [];
  stmts.forEach((s, i) => {
    const name = `${prefix}_${String(i).padStart(3, '0')}.sql`;
    writeFileSync(join(dest, name), s, 'utf-8');
    out.push(name);
  });
  return out;
}

import { writeFileSync } from 'node:fs';
main().catch((e) => { console.error(e); process.exit(1); });
