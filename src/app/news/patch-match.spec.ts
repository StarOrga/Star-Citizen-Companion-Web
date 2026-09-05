import { matchNotesToCards, matchScore, significantTokens } from './patch-match';
import type { PatchOutline, PatchOutlineNode } from './patch-outline';
import type { RoadmapCard } from './roadmap';

function node(kind: PatchOutlineNode['kind'], text: string): PatchOutlineNode {
  return { kind, text, depth: 0 };
}

function card(id: string, name: string): RoadmapCard {
  return { id, slug: id, name, description: '', body: '', status: 'released', category: 'Gameplay', thumbnail: null };
}

const OUTLINE: PatchOutline = {
  slug: 'x', subject: 'x', truncated: false, bulletCount: 9,
  nodes: [
    node('heading', 'Star Citizen Alpha Patch 4.10 LIVE'),
    node('subheading', 'Important Build Info'),
    node('bullet', 'Long Term Persistence: Preserved'),
    node('heading', 'Features and Gameplay'),
    node('subheading', 'Gameplay'),
    node('bullet', 'Siege of Orison V2'),
    node('bullet', 'Recco Battaglia Returns'),
    node('bullet', 'Loot Generation & Drop Rates'),
    node('subheading', 'Ships & Vehicles'),
    node('bullet', 'Hydrogen & Quantum Fuel Rebalance'),
    node('bullet', 'Vehicle Armor Update'),
    node('subheading', 'Core Tech & Audio'),
    node('bullet', 'Introduction of Instancing'),
    node('bullet', 'Server Load & Instance Scaling Updates'),
    node('heading', 'Bug Fixes and Technical Updates'),
    node('bullet', 'Client crashes: 20'),
  ],
};

describe('significantTokens', () => {
  it('drops stopwords and short words, stems plurals, dedupes', () => {
    expect(significantTokens('Fuel Tanks and Consumption Rebalance')).toEqual(['fuel', 'tank', 'consumption', 'rebalance']);
    expect(significantTokens('New Wikelo Ship Offerings (4.10.0)')).toEqual(['wikelo', 'ship', 'offering', '410']);
    expect(significantTokens('Instancing')).toEqual(['instancing']);
  });
});

describe('matchScore', () => {
  it('needs two shared words, or most of a short name, or the one word of a one-word card', () => {
    expect(matchScore(['fuel', 'tank', 'consumption', 'rebalance'], ['hydrogen', 'quantum', 'fuel', 'rebalance'])).toBeGreaterThan(0);
    expect(matchScore(['siege', 'orison'], ['siege', 'orison'])).toBe(1);
    expect(matchScore(['instancing'], ['introduction', 'instancing'])).toBe(1);
    // one common word out of four is noise, not a match
    expect(matchScore(['fuel', 'tank', 'consumption', 'rebalance'], ['vehicle', 'armor', 'fuel'])).toBe(0);
    expect(matchScore([], ['x'])).toBe(0);
  });
});

describe('matchNotesToCards — every feature bullet lands under one card or in the leftover line', () => {
  const cards = [
    card('orison', 'Siege of Orison'),
    card('fuel', 'Fuel Tanks and Consumption Rebalance'),
    card('inst', 'Instancing'),
    card('recco', 'Mission Giver: Recco Battaglia'),
  ];

  it('assigns bullets by shared significant words', () => {
    const m = matchNotesToCards(cards, OUTLINE);
    expect(m.byCard.get('orison')).toEqual(['Siege of Orison V2']);
    expect(m.byCard.get('fuel')).toEqual(['Hydrogen & Quantum Fuel Rebalance']);
    expect(m.byCard.get('recco')).toEqual(['Recco Battaglia Returns']);
    expect(m.byCard.get('inst')).toEqual(['Introduction of Instancing', 'Server Load & Instance Scaling Updates']);
  });

  it('keeps unmatched feature bullets as leftover, and never touches build info or bug-fix stats', () => {
    const m = matchNotesToCards(cards, OUTLINE);
    expect(m.leftover).toEqual(['Loot Generation & Drop Rates', 'Vehicle Armor Update']);
    const all = [...m.byCard.values()].flat().concat(m.leftover);
    expect(all).not.toContain('Long Term Persistence: Preserved');
    expect(all).not.toContain('Client crashes: 20');
  });

  it('is empty without an outline', () => {
    const m = matchNotesToCards(cards, null);
    expect(m.byCard.size).toBe(0);
    expect(m.leftover).toEqual([]);
  });
});
