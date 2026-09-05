import type { PatchOutline } from './patch-outline';
import { outlineSections } from './patch-outline';
import { matchesFuzzy } from './patch-search';
import type { StackCard, StackStatus } from './patch-stack';
import { roadmapCardUrl } from './roadmap';
import { threadSlugOf } from './roadmap.service';

/**
 * What the patch board's search actually returns (owner, 2026-09-05: "Wenn man
 * sucht und inhalte findet in den patch notes, dann nicht patches sondern
 * dessen inhalte gefunden werden … blende die relevanten inhalte direkt
 * inklusive bild ein und ggf. gruppiert nach patch").
 *
 * The board used to answer a query with the same patch cards it always shows,
 * annotated with a hit count — "4.10 · 12 Stichpunkte". That is a table of
 * contents for the answer, not the answer: the reader still had to open the
 * dossier and search again to see the twelve lines. This module produces the
 * CONTENT: every roadmap item and every release-note bullet that matches,
 * grouped by the patch it belongs to, each one carrying whatever picture and
 * link it has.
 *
 * Pure: the caller supplies the loaded outlines through `outlineOf`, so this
 * stays testable and the service stays out of the module graph's way.
 */

export type FindHitKind = 'roadmap' | 'note';

export interface FindHit {
  kind: FindHitKind;
  /** Stable across renders: the roadmap card id, or note slug + line index. */
  id: string;
  /** The headline of the hit — a feature name, or the bullet itself. */
  text: string;
  /** Where it sits: the roadmap description, or the note's heading path. */
  context: string;
  thumbnail: string | null;
  /** RSI deep link — the roadmap card's own view, or the note's thread. */
  url: string;
  /** Roadmap only: RSI's own delivery status for the item. */
  status: string;
}

export interface FindGroup {
  line: string;
  cardStatus: StackStatus;
  /** Hits in display order, capped. */
  hits: FindHit[];
  /** How many matched in total, before the cap. */
  total: number;
  /** Roadmap items among `total` — the "with a picture" half. */
  roadmapTotal: number;
  /** Note bullets among `total`. */
  noteTotal: number;
}

/** Roadmap items lead (they have pictures), then bullets; enough to scan, not to drown in. */
export const FIND_CAP_PER_GROUP = 12;

/** Bullets long enough to be a paragraph are trimmed for the result row. */
const MAX_TEXT = 260;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TEXT ? flat.slice(0, MAX_TEXT).trimEnd() + '…' : flat;
}

/** Every matching roadmap item of one card, newest board data first. */
function roadmapHits(card: StackCard, tokens: readonly string[]): FindHit[] {
  const cards = card.release?.cards ?? [];
  const out: FindHit[] = [];
  for (const item of cards) {
    if (!matchesFuzzy(`${item.name} ${item.description} ${item.body} ${item.category}`, tokens)) continue;
    out.push({
      kind: 'roadmap',
      id: `rm:${item.id}`,
      text: item.name,
      context: clip(item.description || item.body || item.category),
      thumbnail: item.thumbnail,
      url: roadmapCardUrl(item),
      status: item.status,
    });
  }
  return out;
}

/**
 * Every matching bullet across the line's LOADED notes, with the headings it
 * sits under. A note that has not been fetched yet contributes nothing — the
 * board says how many it searched rather than pretending it saw them all.
 */
function noteHits(
  card: StackCard,
  outlineOf: (slug: string) => PatchOutline | null | undefined,
  tokens: readonly string[],
): FindHit[] {
  const out: FindHit[] = [];
  for (const entry of card.group?.entries ?? []) {
    const slug = threadSlugOf(entry.item.url);
    const outline = outlineOf(slug);
    if (!outline) continue;
    let index = 0;
    for (const section of outlineSections(outline.nodes)) {
      for (const group of section.groups) {
        for (const node of group.nodes) {
          index++;
          if (!matchesFuzzy(node.text, tokens)) continue;
          out.push({
            kind: 'note',
            id: `${slug}:${index}`,
            text: clip(node.text),
            context: [section.heading, group.label].filter(Boolean).join(' › ') || entry.item.title,
            thumbnail: null,
            url: entry.item.url,
            status: entry.facet,
          });
        }
      }
    }
  }
  return out;
}

/**
 * The whole result set: one group per patch that has anything to say, in the
 * stack's own order (future → past), so the newest answer is on top.
 */
export function findInStack(
  cards: readonly StackCard[],
  outlineOf: (slug: string) => PatchOutline | null | undefined,
  tokens: readonly string[],
  cap: number = FIND_CAP_PER_GROUP,
): FindGroup[] {
  if (tokens.length === 0) return [];
  const groups: FindGroup[] = [];
  for (const card of cards) {
    const roadmap = roadmapHits(card, tokens);
    const notes = noteHits(card, outlineOf, tokens);
    const total = roadmap.length + notes.length;
    if (total === 0) continue;
    groups.push({
      line: card.line,
      cardStatus: card.status,
      hits: [...roadmap, ...notes].slice(0, cap),
      total,
      roadmapTotal: roadmap.length,
      noteTotal: notes.length,
    });
  }
  return groups;
}

/** Total hits across every group — the summary line's headline number. */
export function findTotal(groups: readonly FindGroup[]): number {
  return groups.reduce((n, g) => n + g.total, 0);
}
