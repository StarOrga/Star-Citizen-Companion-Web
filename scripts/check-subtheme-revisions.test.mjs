import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRevisions, parseAcks, findUnbumped } from './check-subtheme-revisions.mjs';

const subthemes = [
  { key: 'ships', revision: 2, sources: ['data-uploader/python/sc_extract/ship_discovery.py', 'shared/'] },
  { key: 'items', revision: 1, sources: ['shared/'] },
  { key: 'hulls', revision: 1, sources: ['data-uploader/python/sc_extract/assets3d/'] },
];

test('parseRevisions reads key + revision pairs', () => {
  const src = "{ key: 'ships', revision: 3, phases: [] },\n  {\n    key: 'codex_extra',\n    revision: 12,";
  assert.deepEqual(parseRevisions(src), { ships: 3, codex_extra: 12 });
});

test('parseAcks handles lists, case and "all"', () => {
  const keys = ['ships', 'items', 'hulls'];
  assert.deepEqual([...parseAcks('fix\n\nSubtheme-Unchanged: Ships, items\n', keys)].sort(), ['items', 'ships']);
  assert.deepEqual([...parseAcks('x\nsubtheme-unchanged: all', keys)].sort(), ['hulls', 'items', 'ships']);
  assert.equal(parseAcks('no trailer here', keys).size, 0);
});

test('a source change without bump fails, a bump passes', () => {
  const changed = ['shared/map.ts'];
  const res = findUnbumped({ changed, subthemes, oldRevs: { ships: 1, items: 1, hulls: 1 }, acks: new Set() });
  assert.deepEqual(res.map((r) => r.key), ['items']); // ships went 1 → 2
});

test('a trailer acknowledges an unchanged subtheme', () => {
  const res = findUnbumped({
    changed: ['shared/map.ts'],
    subthemes,
    oldRevs: { ships: 2, items: 1, hulls: 1 },
    acks: new Set(['ships', 'items']),
  });
  assert.equal(res.length, 0);
});

test('untouched sources and new subthemes need nothing', () => {
  assert.equal(findUnbumped({ changed: ['README.md'], subthemes, oldRevs: { ships: 2, items: 1, hulls: 1 }, acks: new Set() }).length, 0);
  assert.equal(
    findUnbumped({ changed: ['data-uploader/python/sc_extract/assets3d/x.py'], subthemes, oldRevs: { ships: 2, items: 1 }, acks: new Set() }).length,
    0,
  );
});

test('build recipes use their own trailer', () => {
  const keys = ['model3d', 'silhouette'];
  const body = 'fix\n\nSubtheme-Unchanged: hulls\nRecipe-Unchanged: model3d\n';
  assert.deepEqual([...parseAcks(body, keys, 'Recipe-Unchanged')], ['model3d']);
  assert.equal(parseAcks('Subtheme-Unchanged: all', keys, 'Recipe-Unchanged').size, 0);
});

test('the real build-recipes.ts parses like subthemes.ts', async () => {
  const { readFileSync } = await import('node:fs');
  const revs = parseRevisions(readFileSync('data-uploader/src/lib/build-recipes.ts', 'utf8'));
  assert.deepEqual(Object.keys(revs).sort(), ['model3d', 'silhouette']);
});

test('comment lines between key and revision are skipped', () => {
  const src = "{\n    key: 'ships',\n    // 2: #643 — readable again.\n    // 3: decks\n    revision: 5,\n  }";
  assert.deepEqual(parseRevisions(src), { ships: 5 });
});

test('the real subthemes.ts has a revision for every key', async () => {
  const { readFileSync } = await import('node:fs');
  const revs = parseRevisions(readFileSync('data-uploader/src/lib/subthemes.ts', 'utf8'));
  assert.deepEqual(Object.keys(revs).sort(),
    ['codex_extra', 'components', 'hulls', 'items', 'ships', 'silhouettes', 'strings', 'weapons']);
});
