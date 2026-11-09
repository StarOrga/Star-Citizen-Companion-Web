/** Aliases for paths that used to exist (alpha cleanup) or that people guess. */
const ALIASES: Readonly<Record<string, string>> = {
  news: 'verse',
  home: 'verse',
  start: 'verse',
  hangar: 'hq',
  tools: 'apps',
  profile: 'settings',
  users: 'admin',
  ships: 'codex',
  ship: 'codex',
};

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** First path segment, lower-cased, without query or fragment. */
export function firstSegment(url: string): string {
  const path = url.split(/[?#]/)[0];
  return (path.split('/').find((s) => s.length > 0) ?? '').toLowerCase();
}

/**
 * Up to two known top-level routes that plausibly were meant by `url`: an
 * alias, a prefix match or a small edit distance on the first segment. An
 * empty list means nothing fits, so the UI hides the block.
 */
export function suggestRoutes(url: string, known: readonly string[], max = 2): string[] {
  const typed = firstSegment(url);
  if (!typed) return [];
  const scored: { seg: string; score: number }[] = [];
  const alias = ALIASES[typed];
  for (const seg of known) {
    if (seg === typed) continue; // the first segment is right, the rest is unknown
    let score = Infinity;
    if (alias === seg) score = 0;
    else if (typed.length >= 3 && (seg.startsWith(typed) || typed.startsWith(seg))) score = 1;
    else {
      const d = distance(typed, seg);
      if (d <= (seg.length > 5 ? 2 : 1)) score = 1 + d;
    }
    if (score !== Infinity) scored.push({ seg, score });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, max).map((s) => s.seg);
}

/** Top-level segments of a route config that make sense to offer as a destination. */
export function knownTopLevel(paths: readonly string[]): string[] {
  const skip = new Set(['login', 'handoff', 'set-password', 'unavailable', 'shared', 'invite', 'badge', 'concept', 'friends']);
  const out = new Set<string>();
  for (const p of paths) {
    const seg = p.split('/')[0];
    if (!seg || seg === '**' || seg.startsWith(':') || skip.has(seg)) continue;
    out.add(seg);
  }
  return [...out];
}
