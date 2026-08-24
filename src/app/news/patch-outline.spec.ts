import {
  PatchOutline,
  PatchOutlineNode,
  filterSections,
  outlineHaystack,
  outlineMatchCount,
  outlineSections,
} from './patch-outline';

function node(kind: PatchOutlineNode['kind'], text: string, depth = 0): PatchOutlineNode {
  return { kind, text, depth };
}

/** A miniature note with the four shapes RSI actually publishes. */
const NODES: PatchOutlineNode[] = [
  node('text', 'Launcher should now show VERSION 4.9.0-LIVE'),
  node('heading', 'Features and Gameplay'),
  node('subheading', 'Ships and Vehicles'),
  node('bullet', 'Drake Cutlass Black rework'),
  node('bullet', 'Quantum Drive tuning'),
  node('subheading', 'Locations'),
  node('bullet', 'Orison instancing improvements'),
  node('heading', 'Bug Fixes'),
  node('bullet', 'Fixed a crash on Lorville landing'),
];

const OUTLINE: PatchOutline = {
  slug: 'star-citizen-alpha-4-9-live',
  subject: 'Star Citizen Alpha 4.9 LIVE Release Notes',
  nodes: NODES,
  bulletCount: 4,
  truncated: false,
};

describe('outlineSections — the tree derived from the flat wire format', () => {
  it('opens a section per heading', () => {
    expect(outlineSections(NODES).map((s) => s.heading))
      .toEqual(['', 'Features and Gameplay', 'Bug Fixes']);
  });

  it('keeps the preamble that arrives BEFORE the first heading', () => {
    const [preamble] = outlineSections(NODES);
    expect(preamble.heading).toBe('');
    expect(preamble.groups[0].nodes[0].text).toContain('4.9.0-LIVE');
  });

  it('groups the lines under their sub-heading', () => {
    const features = outlineSections(NODES)[1];
    expect(features.groups.map((g) => g.label)).toEqual(['Ships and Vehicles', 'Locations']);
    expect(features.groups[0].nodes.length).toBe(2);
  });

  it('puts lines with no sub-heading into an unlabelled group rather than dropping them', () => {
    const sections = outlineSections([
      node('heading', 'Known Issues'),
      node('bullet', 'Elevators may not arrive'),
    ]);
    expect(sections[0].groups).toEqual([
      { label: '', nodes: [node('bullet', 'Elevators may not arrive')] },
    ]);
  });

  it('counts the lines of a section, headings excluded', () => {
    expect(outlineSections(NODES).map((s) => s.lineCount)).toEqual([1, 3, 1]);
  });

  it('loses nothing: every non-heading line ends up in exactly one group', () => {
    const total = outlineSections(NODES)
      .reduce((n, s) => n + s.groups.reduce((m, g) => m + g.nodes.length, 0), 0);
    const expected = NODES.filter((n) => n.kind !== 'heading' && n.kind !== 'subheading').length;
    expect(total).toBe(expected);
  });

  it('keeps a heading with nothing under it — an empty section is still a fact', () => {
    const sections = outlineSections([node('heading', 'Bug Fixes and Technical Updates')]);
    expect(sections.length).toBe(1);
    expect(sections[0].lineCount).toBe(0);
  });
});

describe('filterSections', () => {
  const sections = outlineSections(NODES);

  it('is the identity when nothing is being searched', () => {
    expect(filterSections(sections, [])).toBe(sections);
  });

  it('keeps a whole section when its HEADING matches', () => {
    const out = filterSections(sections, ['bug', 'fixes']);
    expect(out.map((s) => s.heading)).toEqual(['Bug Fixes']);
    expect(out[0].lineCount).toBe(1);
  });

  it('keeps a whole group when its SUB-HEADING matches', () => {
    const out = filterSections(sections, ['ships']);
    expect(out.length).toBe(1);
    expect(out[0].groups.map((g) => g.label)).toEqual(['Ships and Vehicles']);
    expect(out[0].groups[0].nodes.length).toBe(2);
  });

  it('keeps just the matching LINE under its unmatched headings', () => {
    const out = filterSections(sections, ['orison']);
    expect(out.map((s) => s.heading)).toEqual(['Features and Gameplay']);
    expect(out[0].groups.map((g) => g.label)).toEqual(['Locations']);
    expect(out[0].groups[0].nodes.map((n) => n.text)).toEqual(['Orison instancing improvements']);
  });

  it('drops sections that keep nothing', () => {
    expect(filterSections(sections, ['pyro'])).toEqual([]);
  });

  it('re-derives lineCount from what survived', () => {
    const out = filterSections(sections, ['quantum']);
    expect(out[0].lineCount).toBe(1);
  });

  it('ANDs its tokens, like the rest of the page', () => {
    expect(filterSections(sections, ['orison', 'instancing']).length).toBe(1);
    expect(filterSections(sections, ['orison', 'lorville']).length).toBe(0);
  });
});

describe('outlineMatchCount', () => {
  it('counts the lines a query hits, headings included', () => {
    expect(outlineMatchCount(OUTLINE, ['drive'])).toBe(1);
    expect(outlineMatchCount(OUTLINE, ['fix'])).toBe(2); // "Bug Fixes" + "Fixed a crash…"
  });

  it('is zero without a query — the badge is about a search, not about the note', () => {
    expect(outlineMatchCount(OUTLINE, [])).toBe(0);
  });
});

describe('outlineHaystack', () => {
  it('carries every line, so a note is searchable by all of its contents', () => {
    const hay = outlineHaystack(OUTLINE);
    for (const n of NODES) expect(hay).toContain(n.text);
  });
});
