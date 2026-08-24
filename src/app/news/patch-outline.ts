/**
 * A patch note's contents, as the patch board renders and searches them
 * (feedback 961ab0a5).
 *
 * Until now a patch note was a title and a link: the board could tell you that
 * "Star Citizen Alpha 4.9 LIVE Release Notes" exists, and nothing whatsoever
 * about what is in it. The `rsi-roadmap` edge function now reads the Spectrum
 * post behind that title and returns it as a flat list of typed lines
 * (`supabase/functions/rsi-roadmap/patch-outline.ts`); this module is the
 * client half — it gives that list a shape to render and to search.
 *
 * FLAT on the wire, TREE on screen. RSI's own document is a flat Draft.js block
 * list with no nesting, so a flat payload is a faithful copy of the source and
 * cannot lose a line to a mis-nested parent. The reader, though, needs the
 * hierarchy the headings imply — which bullets belong to "Ships & Vehicles" —
 * so the tree is derived here, at the point of use, and stays re-derivable when
 * a filter changes it.
 */
import { HighlightSegment, highlightSegments, matchesTokens } from './patch-search';

export type PatchOutlineKind = 'heading' | 'subheading' | 'bullet' | 'text';

export interface PatchOutlineNode {
  kind: PatchOutlineKind;
  text: string;
  /** Nesting level of a bullet (0–4); 0 for everything else. */
  depth: number;
  /** Absolute links the line carries, in reading order. */
  links?: string[];
}

export interface PatchOutline {
  /** RSI thread slug — the join key back to the feed item's url. */
  slug: string;
  subject: string;
  nodes: PatchOutlineNode[];
  bulletCount: number;
  /** RSI's post was longer than the parser's cap; the tail is not here. */
  truncated: boolean;
}

/** A run of lines under one sub-heading. `label` is '' for the lines before the first. */
export interface OutlineGroup {
  label: string;
  nodes: PatchOutlineNode[];
}

/** A section of a note: one heading and everything under it. */
export interface OutlineSection {
  heading: string;
  /** Links on the heading line itself (RSI puts the "full notes" link there). */
  links?: string[];
  groups: OutlineGroup[];
  /** Lines in this section, across all its groups — the collapsed row's count. */
  lineCount: number;
}

/**
 * Give the flat node list the hierarchy its headings imply.
 *
 * Lines that arrive before any heading are NOT dropped: they land in a leading
 * section with an empty heading, which is where the "Launcher should now show
 * VERSION 4.9.0-LIVE" preamble lives. Same rule one level down for the lines
 * before the first sub-heading. Nothing the server sent can fall out of the
 * tree — that is the whole point of deriving it here rather than on the wire.
 */
export function outlineSections(nodes: readonly PatchOutlineNode[]): OutlineSection[] {
  const sections: OutlineSection[] = [];
  let group: OutlineGroup | null = null;

  for (const node of nodes) {
    if (node.kind === 'heading') {
      sections.push({ heading: node.text, groups: [], lineCount: 0, ...(node.links ? { links: node.links } : {}) });
      group = null;
      continue;
    }
    if (sections.length === 0) {
      sections.push({ heading: '', groups: [], lineCount: 0 });
      group = null;
    }
    const section = sections[sections.length - 1];
    if (node.kind === 'subheading') {
      group = { label: node.text, nodes: [] };
      section.groups.push(group);
      continue;
    }
    if (!group) {
      group = { label: '', nodes: [] };
      section.groups.push(group);
    }
    group.nodes.push(node);
    section.lineCount++;
  }
  // A heading with nothing under it is still information ("Bug Fixes and
  // Technical Updates" followed by an empty list is a fact about the patch), so
  // empty sections stay.
  return sections;
}

/** Everything in a note that a query may match — title included. */
export function outlineHaystack(outline: PatchOutline): string {
  return outline.nodes.map((n) => n.text).join(' \n ');
}

/**
 * Narrow an outline to the lines that match, keeping their context.
 *
 * Three levels of "match", because a reader searching "ships" means different
 * things depending on where the word sits:
 *   - the heading matches   → the whole section is a hit, shown intact,
 *   - the sub-heading matches → the whole group is a hit, shown intact,
 *   - a line matches        → that line, under its (unmatched) headings.
 * Empty groups and empty sections drop out, so the result is only what was
 * asked for. `lineCount` is re-derived from what survived.
 */
export function filterSections(
  sections: readonly OutlineSection[],
  tokens: readonly string[],
): OutlineSection[] {
  if (tokens.length === 0) return sections as OutlineSection[];
  const out: OutlineSection[] = [];
  for (const section of sections) {
    const headingHit = !!section.heading && matchesTokens(section.heading, tokens);
    const groups: OutlineGroup[] = [];
    for (const group of section.groups) {
      const groupHit = headingHit || (!!group.label && matchesTokens(group.label, tokens));
      const nodes = groupHit ? group.nodes : group.nodes.filter((n) => matchesTokens(n.text, tokens));
      if (nodes.length > 0) groups.push({ label: group.label, nodes });
    }
    if (groups.length === 0) continue;
    out.push({
      ...section,
      groups,
      lineCount: groups.reduce((n, g) => n + g.nodes.length, 0),
    });
  }
  return out;
}

/** How many lines of a note the query hits — the "N Treffer" badge on the row. */
export function outlineMatchCount(outline: PatchOutline, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  return outline.nodes.reduce((n, node) => n + (matchesTokens(node.text, tokens) ? 1 : 0), 0);
}

/** Marked-up runs of a line, for `<mark>` in the template. */
export function outlineHighlight(text: string, tokens: readonly string[]): HighlightSegment[] {
  return highlightSegments(text, tokens);
}
