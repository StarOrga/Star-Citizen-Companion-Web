// Validate docs/readme-io/pages/ against ReadMe's Git-Sync repository contract
// and bundle the result into supabase/functions/readme-sync/content.ts.
//
//   node scripts/gen-readme-content.mjs
//   npm run gen:readme-content        (writes content.ts)
//   npm run check:readme-docs         (validate only, for CI)
//
// ---------------------------------------------------------------------------
// Why this file changed shape
// ---------------------------------------------------------------------------
// The ReadMe project is Git-backed, so the ReadMe content API refuses writes
// (403 API_ACCESS_UNAVAILABLE). Publishing happens through ReadMe's own Git
// Sync instead — see docs/readme-io/GIT-SYNC-SETUP.md. Git Sync reads the
// repository, not an API payload, and its contract is nothing like the old
// one:
//
//   category  -> the folder a page sits in, NOT frontmatter
//   slug      -> the file name, NOT frontmatter
//   order     -> _order.yaml, NOT a `position` field
//
// Frontmatter is limited to the keys ReadMe documents for a Guides page
// (title, excerpt, deprecated, hidden, icon, metadata, next). Anything else is
// ignored by ReadMe — so an unknown key here is almost always a mistake that
// would silently do nothing on the live site. This script fails on it.
//
// Reference: https://docs.readme.com/main/docs/documentation-structure
//
// content.ts is still generated because the readme-sync edge function reports
// the page inventory the repository expects, and the Supabase deploy bundler
// only ships what the JS import graph reaches — a Deno.readFile of a static
// .md is NOT included (the same lesson as starscape-summary's fonts.ts).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SYNC_ROOT = path.join(ROOT, 'docs', 'readme-io', 'pages');
const OUT = path.join(ROOT, 'supabase', 'functions', 'readme-sync', 'content.ts');

/** Top-level folders ReadMe's Git Sync recognises at the repository root. */
const SECTIONS = ['docs', 'reference', 'recipes', 'custom_pages', 'custom_blocks'];

/** Frontmatter keys ReadMe documents for a Guides page. Anything else is dead weight. */
const ALLOWED_KEYS = new Set([
  'title',
  'excerpt',
  'deprecated',
  'hidden',
  'icon',
  'metadata',
  'next',
]);

/**
 * Keys that used to be meaningful under the API-push model and are silently
 * ignored by Git Sync. Called out by name so the error explains the migration
 * instead of just saying "unknown key".
 */
const RETIRED_KEYS = {
  slug: 'Git Sync derives the slug from the file name — rename the file instead.',
  category: 'Git Sync derives the category from the parent folder — move the file instead.',
  position: 'Git Sync orders pages via _order.yaml — add the slug there instead.',
  order: 'Git Sync orders pages via _order.yaml — add the slug there instead.',
  parentDoc: 'Git Sync nests pages via folders + index.md — move the file instead.',
};

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);

/** Split `---\n<frontmatter>\n---\n<body>`. */
function splitFrontmatter(raw, where) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    fail(where, 'missing or malformed --- frontmatter block');
    return null;
  }
  return { head: match[1], body: match[2].trim() };
}

/**
 * Read the top-level keys of a YAML frontmatter block.
 *
 * Deliberately shallow: this validates which keys are present, not the nested
 * shape of `metadata` / `next`. Nested lines (indented) are skipped rather
 * than parsed, so a legitimate `metadata:` block does not trip the checker.
 */
function topLevelKeys(head, where) {
  const keys = new Map();
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line) || line.trimStart().startsWith('-')) continue; // nested / list item
    const sep = line.indexOf(':');
    if (sep === -1) {
      fail(where, `frontmatter line is not "key: value" -> ${line}`);
      continue;
    }
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    keys.set(key, value);
  }
  return keys;
}

/** Parse an `_order.yaml`: a flat list of slugs, no extensions. */
function readOrder(file) {
  const where = rel(file);
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith('- ')) {
      fail(where, `not a flat "- slug" list entry -> ${line}`);
      continue;
    }
    const slug = trimmed.slice(2).trim();
    if (slug.endsWith('.md')) fail(where, `entries must not carry a file extension -> ${slug}`);
    if (slug === 'index') {
      fail(where, 'must never contain an "index" entry — it is implied by index.md');
    }
    entries.push(slug);
  }
  return entries;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/**
 * Walk one folder of the Git-Sync tree.
 *
 * Contract enforced here:
 *   - a folder with children needs an _order.yaml listing every child exactly once
 *   - every _order.yaml entry must resolve to a sibling `<slug>.md` or `<slug>/`
 *   - page slugs are globally unique (ReadMe's slug namespace is flat)
 */
function walk(dir, sectionSlug, depth, pages, seenSlugs) {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const mdFiles = dirents
    .filter((d) => d.isFile() && d.name.endsWith('.md') && d.name !== 'index.md')
    .map((d) => d.name.replace(/\.md$/, ''));
  const subDirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  const children = [...mdFiles, ...subDirs];

  for (const d of dirents) {
    if (d.isFile() && !d.name.endsWith('.md') && d.name !== '_order.yaml') {
      fail(rel(path.join(dir, d.name)), 'unexpected file — Git Sync reads .md and _order.yaml only');
    }
  }

  const orderPath = path.join(dir, '_order.yaml');
  const hasOrder = fs.existsSync(orderPath);

  if (children.length && !hasOrder) {
    fail(rel(dir), `folder has ${children.length} child page(s) but no _order.yaml`);
  }

  let ordered = children;
  if (hasOrder) {
    const entries = readOrder(orderPath);
    for (const slug of entries) {
      if (!children.includes(slug)) {
        fail(rel(orderPath), `"${slug}" resolves to neither ${slug}.md nor ${slug}/`);
      }
    }
    for (const child of children) {
      if (!entries.includes(child)) {
        fail(rel(orderPath), `"${child}" exists on disk but is missing from the order`);
      }
    }
    if (new Set(entries).size !== entries.length) {
      fail(rel(orderPath), 'contains duplicate entries');
    }
    ordered = entries.filter((e) => children.includes(e));
  }

  ordered.forEach((slug, index) => {
    const asFile = path.join(dir, `${slug}.md`);
    const asDir = path.join(dir, slug);

    if (fs.existsSync(asFile)) {
      readPage(asFile, slug, sectionSlug, index + 1, pages, seenSlugs);
      return;
    }
    if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
      const indexFile = path.join(asDir, 'index.md');
      if (fs.existsSync(indexFile)) {
        readPage(indexFile, slug, sectionSlug, index + 1, pages, seenSlugs);
      }
      // depth 1 = a category folder under docs/; deeper = a page with subpages.
      walk(asDir, depth === 0 ? slug : sectionSlug, depth + 1, pages, seenSlugs);
    }
  });
}

function readPage(file, slug, category, position, pages, seenSlugs) {
  const where = rel(file);
  const parsed = splitFrontmatter(fs.readFileSync(file, 'utf8'), where);
  if (!parsed) return;

  const keys = topLevelKeys(parsed.head, where);
  if (!keys.get('title')) fail(where, 'frontmatter is missing the required "title"');

  for (const [key] of keys) {
    if (ALLOWED_KEYS.has(key)) continue;
    const hint = RETIRED_KEYS[key];
    fail(
      where,
      hint
        ? `"${key}" is ignored by ReadMe Git Sync. ${hint}`
        : `"${key}" is not a ReadMe Git-Sync frontmatter key (allowed: ${[...ALLOWED_KEYS].join(', ')})`,
    );
  }

  if (seenSlugs.has(slug)) {
    fail(where, `duplicate slug "${slug}" — ReadMe slugs are unique across the whole site`);
  }
  seenSlugs.add(slug);

  pages.push({
    slug,
    title: keys.get('title') ?? slug,
    category,
    position,
    excerpt: keys.get('excerpt') ?? '',
    body: parsed.body,
    source: where,
  });
}

/** Report `doc:` cross-links that point at a slug the tree does not contain. */
function checkCrossLinks(pages) {
  const slugs = new Set(pages.map((p) => p.slug));
  for (const page of pages) {
    for (const [, target] of page.body.matchAll(/\]\(doc:([a-z0-9-]+)\)/g)) {
      if (!slugs.has(target)) fail(page.source, `doc:${target} does not resolve to any page`);
    }
  }
}

function main() {
  const writeBundle = !process.argv.includes('--check');

  if (!fs.existsSync(SYNC_ROOT)) throw new Error(`sync root not found: ${SYNC_ROOT}`);

  for (const entry of fs.readdirSync(SYNC_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && !SECTIONS.includes(entry.name)) {
      fail(rel(path.join(SYNC_ROOT, entry.name)), `not a ReadMe section folder (${SECTIONS.join(', ')})`);
    }
  }

  const pages = [];
  const seenSlugs = new Set();
  for (const section of SECTIONS) {
    const dir = path.join(SYNC_ROOT, section);
    if (fs.existsSync(dir)) walk(dir, section, 0, pages, seenSlugs);
  }

  if (!pages.length) fail(rel(SYNC_ROOT), 'no pages found');
  checkCrossLinks(pages);

  if (errors.length) {
    console.error(`\nreadme-docs: ${errors.length} problem(s) with the Git-Sync tree\n`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('\nContract: docs/readme-io/README.md\n');
    process.exit(1);
  }

  console.log(`readme-docs: ${pages.length} page(s), tree is a valid ReadMe Git-Sync source`);
  for (const p of pages) console.log(`  ${p.category.padEnd(12)} ${p.slug}`);

  if (!writeBundle) return;

  const out =
    '// GENERATED by scripts/gen-readme-content.mjs — do not edit by hand.\n' +
    '// Edit the markdown under docs/readme-io/pages/ and re-run:\n' +
    '//   npm run gen:readme-content\n\n' +
    'export interface ReadmePage {\n' +
    '  slug: string;\n' +
    '  title: string;\n' +
    '  category: string;\n' +
    '  position: number;\n' +
    '  excerpt: string;\n' +
    '  body: string;\n' +
    '  source: string;\n' +
    '}\n\n' +
    `export const PAGES: ReadmePage[] = ${JSON.stringify(pages, null, 2)};\n`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`readme-docs: bundled -> ${rel(OUT)}`);
}

main();
