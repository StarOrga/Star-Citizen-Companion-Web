// The two shipped catalogues must describe the same set of strings.
// -----------------------------------------------------------------------------
// A key that exists in only one language renders as its own dotted path in the
// other one, and nothing fails at build time. The dead-key sweep (AUD-243) left
// de and en with identical leaf paths; this spec keeps them that way. It reads
// the files directly (`resolveJsonModule`), like codex/i18n-keys.spec.ts: the
// point is the FILES, not the loader.
import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';

type Catalogue = Record<string, unknown>;

function leaves(node: unknown, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node as Catalogue)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, node);
  }
  return out;
}

describe('i18n catalogues (de/en)', () => {
  const deLeaves = leaves(de);
  const enLeaves = leaves(en);

  it('have the same leaf paths', () => {
    const onlyDe = [...deLeaves.keys()].filter((k) => !enLeaves.has(k));
    const onlyEn = [...enLeaves.keys()].filter((k) => !deLeaves.has(k));
    expect(onlyDe).withContext('keys missing in en.json').toEqual([]);
    expect(onlyEn).withContext('keys missing in de.json').toEqual([]);
  });

  it('carry a non-empty string in every leaf', () => {
    for (const [lang, map] of [['de', deLeaves], ['en', enLeaves]] as const) {
      const bad = [...map.entries()]
        .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
        .map(([k]) => k);
      expect(bad).withContext(`empty or non-string leaves in ${lang}.json`).toEqual([]);
    }
  });
});
