import type { PatchOutline } from './patch-outline';
import { outlineSections } from './patch-outline';
import { normalizeSearchText } from './patch-search';
import type { RoadmapCard } from './roadmap';

/**
 * Note ↔ roadmap-card matching (2026-09-04 rethink, design Ⓚ).
 *
 * The roadmap says what was PLANNED for a patch ("Fuel Tanks and Consumption
 * Rebalance"), the release note says what SHIPPED ("Hydrogen & Quantum Fuel
 * Rebalance"). The dossier shows both on one card: the roadmap item with its
 * picture and text, and underneath it the bullet points of the note that talk
 * about the same thing. This module decides which bullets belong to which
 * card — by shared significant words, nothing cleverer.
 *
 * Deliberately conservative: a false match puts a bullet under the wrong
 * picture, a missed match only leaves it in the "further points" line below
 * the cards, where it is still visible. Every bullet lands in exactly one of
 * the two places, so nothing the note says can disappear.
 */

/** Words that carry no meaning for matching a feature name. */
const STOPWORDS = new Set([
  'the', 'and', 'of', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'new', 'update', 'updates',
  'updated', 'improvements', 'improvement', 'rework', 'v2', 'v1', 'version', 'alpha',
  'star', 'citizen', 'added', 'fixed', 'fix', 'fixes', 'issue', 'issues', 'system', 'systems',
  'various', 'now', 'should', 'no', 'longer', 'when', 'from', 'into', 'at', 'is', 'are',
]);

/** Headings whose bullets are facts about the build, not features — never matched. */
const NON_FEATURE = /\b(build\s+info|known\s+issues?|testing\s+focus|bug\s+fixes?|technical\s+updates?)\b/i;

/** Crude stem: plural/possessive endings, so "tanks" meets "tank". */
function stem(word: string): string {
  return word.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
}

/** The words of a phrase worth matching on: normalized, stemmed, ≥ 3 letters, no stopwords. */
export function significantTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of normalizeSearchText(text).replace(/[^a-z0-9 ]+/g, ' ').split(' ')) {
    const w = stem(raw);
    if (w.length < 3 || STOPWORDS.has(w) || STOPWORDS.has(raw)) continue;
    seen.add(w);
  }
  return [...seen];
}

export interface NoteCardMatches {
  /** Card id → the bullet lines of the note that talk about it. */
  byCard: ReadonlyMap<string, string[]>;
  /** Feature bullets no card claimed — shown below the cards so nothing is lost. */
  leftover: string[];
}

/** Does a bullet talk about the card? Needs a real overlap, not one common word. */
export function matchScore(cardTokens: readonly string[], bulletTokens: readonly string[]): number {
  if (cardTokens.length === 0 || bulletTokens.length === 0) return 0;
  const set = new Set(bulletTokens);
  const overlap = cardTokens.filter((t) => set.has(t)).length;
  if (overlap === 0) return 0;
  const ratio = overlap / cardTokens.length;
  if (cardTokens.length === 1) return ratio; // a one-word card ("Instancing") matches on that word
  if (overlap >= 2 || ratio >= 0.6) return ratio;
  return 0;
}

/**
 * Assign the note's FEATURE bullets to the roadmap cards they describe.
 *
 * Feature bullets are the ones under headings that are not build facts, bug
 * fixes or known issues — the "Features and Gameplay" part of the note, in
 * practice. Each bullet goes to the single best-scoring card, or to `leftover`.
 */
export function matchNotesToCards(cards: readonly RoadmapCard[], outline: PatchOutline | null): NoteCardMatches {
  const byCard = new Map<string, string[]>();
  const leftover: string[] = [];
  if (!outline) return { byCard, leftover };

  const tokensByCard = cards.map((c) => ({ id: c.id, tokens: significantTokens(c.name) }));
  for (const section of outlineSections(outline.nodes)) {
    if (section.heading && NON_FEATURE.test(section.heading)) continue;
    for (const group of section.groups) {
      if (group.label && NON_FEATURE.test(group.label)) continue;
      for (const node of group.nodes) {
        if (node.kind !== 'bullet') continue;
        const text = node.text.trim();
        if (!text) continue;
        const bulletTokens = significantTokens(text);
        let best: { id: string; score: number } | null = null;
        for (const card of tokensByCard) {
          const score = matchScore(card.tokens, bulletTokens);
          if (score > 0 && (best === null || score > best.score)) best = { id: card.id, score };
        }
        if (best) {
          const list = byCard.get(best.id);
          if (list) list.push(text);
          else byCard.set(best.id, [text]);
        } else {
          leftover.push(text);
        }
      }
    }
  }
  return { byCard, leftover };
}
