// Pure parts of patch-teaser: prompt, reply parsing, the hard length limit.

export const TEASER_MAX = 44;
export const VERSION_RE = /^\d{1,2}\.\d{1,2}(\.\d{1,2})?$/;

export interface Teaser { de: string; en: string }
export interface OutlineNode { kind: string; text: string }

/** One headline line: collapsed whitespace, no quotes / trailing dots, cut at a word to <= TEASER_MAX. */
export function clampTitle(v: unknown): string {
  const t = String(v ?? '').replace(/\s+/g, ' ').replace(/^["'„“]+|["'“”.]+$/g, '').trim();
  if (t.length <= TEASER_MAX) return t;
  const cut = t.slice(0, TEASER_MAX);
  const sp = cut.lastIndexOf(' ');
  return (sp > TEASER_MAX * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/, '');
}

/** Model reply -> both titles, or null when either is unusable (never a half teaser). */
export function parseTeaser(text: string): Teaser | null {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { de?: unknown; en?: unknown };
    const de = clampTitle(v.de);
    const en = clampTitle(v.en);
    return de && en ? { de, en } : null;
  } catch {
    return null;
  }
}

export function buildPrompt(version: string, nodes: readonly OutlineNode[]): string {
  const lines = nodes
    .filter((n) => n.kind === 'heading' || n.kind === 'subheading' || n.kind === 'bullet')
    .slice(0, 60)
    .map((n) => `${n.kind === 'bullet' ? '-' : '#'} ${n.text.slice(0, 140)}`)
    .join('\n');
  return [
    `Star Citizen patch ${version}. Below are the patch-note headings and bullets.`,
    `Write ONE teaser headline naming the most notable thing (a feature, ship or system) - at most ${TEASER_MAX} characters, no version number, no channel name, no quotes, no trailing period.`,
    'Give it in German and in English. Reply with JSON only: {"de":"...","en":"..."}.',
    '', lines,
  ].join('\n');
}
