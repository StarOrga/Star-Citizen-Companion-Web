// Parse CHANGELOG.md (Keep a Changelog format) into public/release-notes.json,
// the data source for the in-app "What's New" page. Runs as the `prebuild`
// npm hook, so every deploy that updated the changelog refreshes the notes
// automatically — no separate content step. Safe to run standalone:
//   node scripts/gen-release-notes.js
//
// Output shape:
//   { generatedFrom, current, releases: [ { version, date,
//       sections: [ { type, items: [ { title, text } ] } ] } ] }
//
// Each item's leading bold run (`**Headline.** rest…`) becomes { title, text }
// so the UI can render a headline + body without any markdown/HTML injection.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'CHANGELOG.md');
const OUT = path.join(ROOT, 'public', 'release-notes.json');

/** Reduce the dev-facing markdown of a changelog line to clean reader text. */
function normalize(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1') // [text](url) -> text
    .replace(/`([^`]+)`/g, '$1') // `code` -> code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // stray **bold** -> bold
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a changelog bullet into an optional bold headline + the remaining text. */
function splitItem(raw) {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const bold = collapsed.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  if (bold) return { title: normalize(bold[1]), text: normalize(bold[2]) };
  return { title: '', text: normalize(collapsed) };
}

function parseChangelog(md) {
  const releases = [];
  let release = null;
  let section = null;
  let buffer = null; // accumulates a multi-line bullet

  const flush = () => {
    if (buffer !== null && section) section.items.push(splitItem(buffer));
    buffer = null;
  };

  for (const line of md.split(/\r?\n/)) {
    // ## [1.2.3] - 2026-07-07   (unreleased headings without a date are skipped)
    const rel = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+?)\s*$/);
    if (rel) {
      flush();
      section = null;
      release = { version: rel[1].trim(), date: rel[2].trim(), sections: [] };
      releases.push(release);
      continue;
    }
    if (!release) continue; // preamble before the first release

    const sec = line.match(/^###\s+(.+?)\s*$/);
    if (sec) {
      flush();
      // Headings look like "Added", "Fixed — News feeds restored", etc.
      // Split the leading category from an optional descriptive label so the
      // UI can render a colored category tag + a per-section subtitle.
      const heading = sec[1].trim();
      const dash = heading.match(/^(.*?)\s+[—–]\s+(.*)$/);
      const category = (dash ? dash[1] : heading).trim();
      const label = dash ? normalize(dash[2]) : '';
      section = { category, label, items: [] };
      release.sections.push(section);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flush();
      buffer = bullet[1];
      continue;
    }

    // Continuation of the current bullet (indented wrap line).
    if (buffer !== null && line.trim()) {
      buffer += ' ' + line.trim();
    }
  }
  flush();

  // Drop releases that ended up with no content (e.g. an empty section).
  for (const r of releases) r.sections = r.sections.filter((s) => s.items.length);
  return releases.filter((r) => r.sections.length);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.warn(`[gen-release-notes] ${SRC} not found — writing empty notes.`);
    fs.writeFileSync(OUT, JSON.stringify({ generatedFrom: 'CHANGELOG.md', current: null, releases: [] }, null, 2) + '\n');
    return;
  }
  const releases = parseChangelog(fs.readFileSync(SRC, 'utf8'));
  const payload = {
    generatedFrom: 'CHANGELOG.md',
    current: releases[0]?.version ?? null,
    releases,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[gen-release-notes] wrote ${releases.length} releases → ${path.relative(ROOT, OUT)}`);
}

main();
