import { findInStack, findTotal, FIND_CAP_PER_GROUP } from './patch-find';
import type { PatchOutline } from './patch-outline';
import { tokenizeQuery } from './patch-search';
import type { StackCard } from './patch-stack';
import type { RoadmapCard, RoadmapRelease } from './roadmap';

function rmCard(id: string, name: string, description = '', thumbnail: string | null = null): RoadmapCard {
  return { id, slug: name.replace(/\s+/g, '-'), name, description, body: '', status: 'committed', category: 'Gameplay', thumbnail };
}

function release(cards: RoadmapCard[]): RoadmapRelease {
  return { id: 'r1', name: '4.10', quarter: 'Q3 2026', status: 'committed', patchLine: '4.10', cards };
}

function outline(nodes: [string, string][]): PatchOutline {
  return {
    slug: 'n1',
    subject: 'Star Citizen Alpha 4.10 LIVE Release Notes',
    nodes: nodes.map(([kind, text]) => ({ kind: kind as 'heading' | 'bullet', text, depth: 0 })),
    bulletCount: nodes.filter(([k]) => k === 'bullet').length,
    truncated: false,
  };
}

function card(line: string, opts: Partial<StackCard> = {}): StackCard {
  return {
    line,
    status: 'live',
    group: null,
    release: null,
    liveAt: Date.parse('2026-08-26T00:00:00Z'),
    firstTestAt: null,
    supersededAt: null,
    hotfixCount: 0,
    lastHotfixAt: null,
    waveCount: 0,
    noteCount: 0,
    plannedCount: 0,
    ...opts,
  };
}

/** A card whose single note is the given outline, keyed by slug 'n1'. */
function withNote(line: string, entries: string[]): StackCard {
  return card(line, {
    group: {
      line,
      segments: line.split('.').map(Number),
      entries: entries.map((title, i) => ({
        item: { id: String(i), title, url: 'https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/n1', publishedAt: '2026-08-26T00:00:00Z' },
        facet: 'live',
        version: line,
        stage: 'live',
        hotfix: false,
      })),
    } as unknown as StackCard['group'],
  });
}

describe('findInStack', () => {
  it('returns the matching roadmap items with their picture and RSI deep link', () => {
    const cards = [card('4.10', {
      release: release([
        rmCard('1544', 'Instancing', 'Server meshing instancing work', 'https://media.rsi/x.png'),
        rmCard('1543', 'Siege Of Orison', 'A new event'),
      ]),
    })];
    const groups = findInStack(cards, () => null, tokenizeQuery('instancing'));
    expect(groups.length).toBe(1);
    expect(groups[0].roadmapTotal).toBe(1);
    expect(groups[0].hits[0].text).toBe('Instancing');
    expect(groups[0].hits[0].thumbnail).toBe('https://media.rsi/x.png');
    expect(groups[0].hits[0].url).toBe('https://robertsspaceindustries.com/roadmap/release-view/1544-Instancing');
  });

  it('returns note bullets with the heading path they sit under', () => {
    const o = outline([
      ['heading', 'Bug Fixes'],
      ['bullet', 'Fixed an issue where the Quantum Drive would not spool'],
      ['bullet', 'Fixed a crash on login'],
    ]);
    const groups = findInStack([withNote('4.10', ['Alpha 4.10 LIVE'])], () => o, tokenizeQuery('quantum'));
    expect(groups[0].noteTotal).toBe(1);
    expect(groups[0].hits[0].kind).toBe('note');
    expect(groups[0].hits[0].context).toBe('Bug Fixes');
  });

  // The whole point of the rework: the answer is the content, grouped by patch —
  // not a list of patches with a number next to them.
  it('groups across patches in stack order, roadmap items first inside a group', () => {
    const cards = [
      card('4.11', { status: 'next', release: release([rmCard('1580', 'Armor rework')]) }),
      card('4.10', { release: release([rmCard('1551', 'Heavy Armor')]) }),
    ];
    const groups = findInStack(cards, () => null, tokenizeQuery('armor'));
    expect(groups.map((g) => g.line)).toEqual(['4.11', '4.10']);
    expect(findTotal(groups)).toBe(2);
  });

  it('matches across British and American spelling in both directions', () => {
    const cards = [card('4.10', { release: release([rmCard('1551', 'Heavy Combat Armor')]) })];
    expect(findInStack(cards, () => null, tokenizeQuery('armour')).length).toBe(1);

    const british = [card('4.10', { release: release([rmCard('1552', 'Manoeuvre thrusters', 'Better centre of mass')]) })];
    expect(findInStack(british, () => null, tokenizeQuery('maneuver')).length).toBe(1);
    expect(findInStack(british, () => null, tokenizeQuery('center')).length).toBe(1);
  });

  it('an empty query finds nothing at all — the board shows its stack instead', () => {
    const cards = [card('4.10', { release: release([rmCard('1544', 'Instancing')]) })];
    expect(findInStack(cards, () => null, [])).toEqual([]);
  });

  it('caps each group but keeps the honest total', () => {
    const many = Array.from({ length: FIND_CAP_PER_GROUP + 5 }, (_, i) => rmCard(String(2000 + i), `Orison thing ${i}`));
    const groups = findInStack([card('4.10', { release: release(many) })], () => null, tokenizeQuery('orison'));
    expect(groups[0].hits.length).toBe(FIND_CAP_PER_GROUP);
    expect(groups[0].total).toBe(FIND_CAP_PER_GROUP + 5);
  });
});
