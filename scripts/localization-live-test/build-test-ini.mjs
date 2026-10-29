#!/usr/bin/env node
// Build a marker global.ini for the localization live test.
//
// Pulls the current build's English table from the public R2 locale shards
// (codex-locale/<build>/en/…, the same files the web app reads) and prefixes
// every pause/options-menu string with a marker, so a glance at the in-game
// options menu shows which file the game is reading:
//
//   node scripts/localization-live-test/build-test-ini.mjs --marker A --out <file>
//
// Variant A is installed before the game starts; variant B is written over it
// while the game runs (install.ps1 -Variant B) — if the menu then shows [B],
// the game reloads the file without a restart.
import fs from 'node:fs';
import path from 'node:path';

const WORKER = 'https://sc-assets.sc-assets-worker.workers.dev/codex-locale';
const SUPABASE = 'https://hcnqhvzlavdycidqyaai.supabase.co';
const MENU_KEY = /^(pause|frontend|mainmenu)/i;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function currentBuildId() {
  const explicit = arg('build');
  if (explicit) return explicit;
  // codex_builds is public-readable through PostgREST with the publishable key.
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error('pass --build <uuid> or set SUPABASE_PUBLISHABLE_KEY');
  const r = await fetch(`${SUPABASE}/rest/v1/codex_builds?select=id&is_current=eq.true&limit=1`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  const rows = await r.json();
  if (!rows[0]) throw new Error('no current build');
  return rows[0].id;
}

async function englishTable(build) {
  const idx = await (await fetch(`${WORKER}/${build}/en/index.json`)).json();
  const shards = [];
  for (const [group, n] of Object.entries(idx.groups)) for (let i = 0; i < n; i++) shards.push(`${group}-${i}`);
  for (let i = 0; i < idx.misc; i++) shards.push(`_misc-${i}`);
  const table = {};
  for (const s of shards) {
    const r = await fetch(`${WORKER}/${build}/en/${idx.gen}/${s}.json`);
    if (!r.ok) throw new Error(`shard ${s}: HTTP ${r.status}`);
    Object.assign(table, await r.json());
  }
  return table;
}

const marker = arg('marker', 'A');
const out = arg('out', path.resolve(`global.${marker}.ini`));
const build = await currentBuildId();
const table = await englishTable(build);
let marked = 0;
const lines = Object.entries(table).map(([k, v]) => {
  if (MENU_KEY.test(k) && v.trim()) { marked++; return `${k}=[${marker}] ${v}`; }
  return `${k}=${v}`;
});
// UTF-8 with BOM and CRLF, like the files CIG ships.
fs.writeFileSync(out, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
console.log(`wrote ${out} · build ${build} · ${lines.length} keys · ${marked} menu strings marked [${marker}]`);
