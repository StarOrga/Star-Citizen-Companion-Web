// Tests for patch-outline.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type stripping:
//   node --test patch-outline.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NODES,
  isValidSlug,
  parseContentBlocks,
  parseThreadOutline,
  slugFromThreadUrl,
} from './patch-outline.ts';

const block = (type: string, text: string, extra: Record<string, unknown> = {}) => ({
  key: Math.random().toString(36).slice(2),
  text,
  type,
  depth: 0,
  inlineStyleRanges: [],
  entityRanges: [],
  data: [],
  ...extra,
});

const container = (blocks: unknown[], entityMap: unknown = []) => ([
  { id: 1, type: 'text', data: { blocks, entityMap } },
]);

test('reads headings, sub-headings and real list items', () => {
  const { nodes } = parseContentBlocks(container([
    block('header-one', 'Star Citizen Alpha Patch 4.9 LIVE'),
    block('blockquote', 'Ships & Vehicles'),
    block('unordered-list-item', '    Long Term Persistence: Preserved'),
  ]));
  assert.deepEqual(nodes.map((n) => [n.kind, n.text]), [
    ['heading', 'Star Citizen Alpha Patch 4.9 LIVE'],
    ['subheading', 'Ships & Vehicles'],
    ['bullet', 'Long Term Persistence: Preserved'],
  ]);
});

test('an unstyled line typed with a bullet glyph is a bullet', () => {
  // The 4.9 LIVE release notes write EVERY feature line this way; reading them
  // as prose loses the entire feature list of the current patch.
  const { nodes } = parseContentBlocks(container([
    block('unstyled', '► Vehicle Combat Hit Markers'),
    block('unstyled', '▪ Mining laser power increase'),
  ]));
  assert.deepEqual(nodes.map((n) => n.kind), ['bullet', 'bullet']);
  assert.equal(nodes[0].text, 'Vehicle Combat Hit Markers');
  assert.equal(nodes[1].text, 'Mining laser power increase');
});

test('a whole line typed in bold is a sub-heading, not prose', () => {
  // RSI writes "Important Build Info" as a plain paragraph in bold; read as
  // prose it stops labelling the bullets underneath it.
  const { nodes } = parseContentBlocks(container([
    block('unstyled', 'Testing/Feedback Focus', {
      inlineStyleRanges: [
        { offset: 0, length: 22, style: 'UNDERLINE' },
        { offset: 0, length: 22, style: 'BOLD' },
      ],
    }),
    block('unstyled', 'Only one bold word in this sentence.', {
      inlineStyleRanges: [{ offset: 9, length: 4, style: 'BOLD' }],
    }),
  ]));
  assert.deepEqual(nodes.map((n) => n.kind), ['subheading', 'text']);
});

test('a leading hyphen stays text — it is usually a minus sign', () => {
  const { nodes } = parseContentBlocks(container([
    block('unstyled', '-10% power draw on all size 3 shields'),
  ]));
  assert.equal(nodes[0].kind, 'text');
  assert.equal(nodes[0].text, '-10% power draw on all size 3 shields');
});

test('empty spacer blocks are dropped', () => {
  const { nodes } = parseContentBlocks(container([
    block('unstyled', ''),
    block('unstyled', '   '),
    block('unstyled', 'Important Build Info'),
  ]));
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].text, 'Important Build Info');
});

test('links are lifted out of the entity map', () => {
  const { nodes } = parseContentBlocks(container(
    [block('unstyled', 'See the full notes here.', { entityRanges: [{ offset: 4, length: 14, key: 0 }] })],
    [{ type: 'LINK', mutability: 'MUTABLE', data: { href: 'https://robertsspaceindustries.com/comm-link/x' } }],
  ));
  assert.deepEqual(nodes[0].links, ['https://robertsspaceindustries.com/comm-link/x']);
});

test('an entityMap keyed as an object is read too', () => {
  const { nodes } = parseContentBlocks(container(
    [block('unstyled', 'link', { entityRanges: [{ offset: 0, length: 4, key: '3' }] })],
    { '3': { type: 'LINK', data: { href: 'https://example.com/a' } } },
  ));
  assert.deepEqual(nodes[0].links, ['https://example.com/a']);
});

test('non-http entity hrefs are rejected', () => {
  const { nodes } = parseContentBlocks(container(
    [block('unstyled', 'link', { entityRanges: [{ offset: 0, length: 4, key: 0 }] })],
    [{ type: 'LINK', data: { href: 'javascript:alert(1)' } }],
  ));
  assert.equal(nodes[0].links, undefined);
});

test('nested bullet depth survives, clamped', () => {
  const { nodes } = parseContentBlocks(container([
    block('unordered-list-item', 'Parent', { depth: 0 }),
    block('unordered-list-item', 'Child', { depth: 2 }),
    block('unordered-list-item', 'Absurd', { depth: 99 }),
  ]));
  assert.deepEqual(nodes.map((n) => n.depth), [0, 2, 4]);
});

test('non-text containers are ignored', () => {
  const { nodes } = parseContentBlocks([
    { id: 1, type: 'image', data: { src: 'https://example.com/a.png' } },
    ...container([block('unstyled', 'Text survives')]),
  ]);
  assert.equal(nodes.length, 1);
});

test('the node cap reports itself instead of silently truncating', () => {
  const many = Array.from({ length: MAX_NODES + 20 }, (_, i) => block('unordered-list-item', `fix ${i}`));
  const { nodes, truncated } = parseContentBlocks(container(many));
  assert.equal(nodes.length, MAX_NODES);
  assert.equal(truncated, true);
});

test('a thread payload becomes an outline with a bullet count', () => {
  const outline = parseThreadOutline('star-citizen-alpha-4-9-live-release-notes', {
    data: {
      subject: 'Star Citizen Alpha 4.9 LIVE Release Notes',
      content_blocks: container([
        block('header-one', 'Features and Gameplay'),
        block('unstyled', '► Ordnance Cargo Holder'),
        block('unordered-list-item', 'Client Crash Fixes: 17 fixes'),
      ]),
    },
  });
  assert.ok(outline);
  assert.equal(outline!.slug, 'star-citizen-alpha-4-9-live-release-notes');
  assert.equal(outline!.subject, 'Star Citizen Alpha 4.9 LIVE Release Notes');
  assert.equal(outline!.bulletCount, 2);
  assert.equal(outline!.truncated, false);
});

test('an unparseable thread yields null, so the failure is not cached', () => {
  assert.equal(parseThreadOutline('x', { success: 0, msg: 'Validation failed' }), null);
  assert.equal(parseThreadOutline('x', { data: { content_blocks: [] } }), null);
  assert.equal(parseThreadOutline('x', null), null);
});

test('slugs are read out of the thread permalink', () => {
  assert.equal(
    slugFromThreadUrl('https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/star-citizen-alpha-4-9-live-release-notes'),
    'star-citizen-alpha-4-9-live-release-notes',
  );
  assert.equal(slugFromThreadUrl('https://robertsspaceindustries.com/comm-link/x'), '');
});

test('slug validation rejects anything that is not a slug', () => {
  assert.equal(isValidSlug('star-citizen-alpha-4-9-live-release-notes'), true);
  assert.equal(isValidSlug('a/../b'), false);
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug('UPPER'), false);
});
