import type { PatchOutline, PatchOutlineNode } from './patch-outline';

/**
 * "Wie bereite ich mich vor?" — what a patch keeps and what it wipes, read off
 * the release note itself (2026-09-04 rethink, owner's ask: "wie man sich
 * drauf vorbereitet — was wird gelöscht und was nicht laut Spectrum").
 *
 * RSI's release-note posts open with an "Important Build Info" block of
 * `Label: Value` lines — "Long Term Persistence: Preserved", "Starting aUEC:
 * 20,000", occasionally "Reputation: Reset" — followed, on PTU waves, by a
 * "Testing Focus" list and, on most notes, a "Known Issues" list. Those lines
 * are the whole answer to "do I need to do anything before this patch", so
 * they get a section of their own instead of being three bullets inside the
 * note.
 *
 * Pure and forgiving: the block is recognised by heading text, the lines by
 * their colon, the tone by a handful of words. A note without the block yields
 * `null` and the section simply does not render — absence is information, an
 * empty box is not.
 */

export type PrepTone = 'kept' | 'wiped' | 'neutral';

export interface PrepItem {
  label: string;
  value: string;
  tone: PrepTone;
}

export interface PatchPrep {
  items: PrepItem[];
  /** True when any item says something is wiped/reset — the loud case. */
  wipe: boolean;
  knownIssues: string[];
  testingFocus: string[];
}

const BUILD_INFO = /\b(important\s+)?build\s+info(rmation)?\b/i;
const KNOWN_ISSUES = /\bknown\s+issues?\b/i;
const TESTING_FOCUS = /\b(testing|test)\s+focus\b/i;
const LABEL_VALUE = /^([^:]{2,60}?)\s*:\s*(.+)$/;
const WIPED = /\b(wipe[sd]?|reset|cleared|removed|deleted|lost)\b/i;
const KEPT = /\b(preserv\w*|kept|keep|retain\w*|carr(y|ied)\s+over|unchanged|maintained|no\s+wipe)\b/i;

/** How many lines of a list are worth surfacing before "see the note". */
const LIST_CAP = 8;

function isHeading(node: PatchOutlineNode): boolean {
  return node.kind === 'heading' || node.kind === 'subheading';
}

/** The content lines under the first heading matching `re`, up to the next heading. */
function linesUnder(nodes: readonly PatchOutlineNode[], re: RegExp): string[] {
  const out: string[] = [];
  let inside = false;
  for (const node of nodes) {
    if (isHeading(node)) {
      if (inside) break;
      inside = re.test(node.text);
      continue;
    }
    if (inside && node.text.trim()) out.push(node.text.trim());
  }
  return out;
}

export function prepTone(value: string): PrepTone {
  if (WIPED.test(value) && !KEPT.test(value)) return 'wiped';
  if (KEPT.test(value)) return 'kept';
  return 'neutral';
}

/** `Label: Value` → item; a line without a colon is not a fact, skip it. */
export function parsePrepLine(line: string): PrepItem | null {
  const m = LABEL_VALUE.exec(line.trim());
  if (!m) return null;
  const label = m[1].trim();
  const value = m[2].trim();
  if (!label || !value) return null;
  return { label, value, tone: prepTone(value) };
}

/**
 * Pull the preparation facts out of a note. RSI sometimes writes the facts as
 * bullets directly under the section heading and sometimes under a
 * "Build Info" sub-heading inside the preamble; both are covered by matching
 * heading OR sub-heading text.
 */
export function extractPrep(outline: PatchOutline | null): PatchPrep | null {
  if (!outline) return null;
  const nodes = outline.nodes;
  const items = linesUnder(nodes, BUILD_INFO)
    .map(parsePrepLine)
    .filter((i): i is PrepItem => i !== null);
  const knownIssues = linesUnder(nodes, KNOWN_ISSUES).slice(0, LIST_CAP);
  const testingFocus = linesUnder(nodes, TESTING_FOCUS).slice(0, LIST_CAP);
  if (items.length === 0 && knownIssues.length === 0 && testingFocus.length === 0) return null;
  return {
    items,
    wipe: items.some((i) => i.tone === 'wiped'),
    knownIssues,
    testingFocus,
  };
}
