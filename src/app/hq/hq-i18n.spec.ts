import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';

interface Tree {
  [key: string]: string | Tree;
}

/** Every string leaf under `node` as `[dotted.key, value]`. */
function leaves(node: Tree, prefix: string): [string, string][] {
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}.${k}`, v] as [string, string]] : leaves(v, `${prefix}.${k}`),
  );
}

/** HQ wording (concept 2026-10-30 §2.2): these words never appear in the German `hq.*` strings. */
const BANNED = ['gedeckt', 'Auftrag', 'Operation', 'Schritt-Modus'];

describe('hq.* wording', () => {
  const deHq = leaves((de as unknown as { hq: Tree }).hq, 'hq');

  it('has German hq strings to check', () => {
    expect(deHq.length).toBeGreaterThan(40);
  });

  it('German hq.* strings never use the banned words', () => {
    const hits = deHq.filter(([, v]) => BANNED.some((w) => v.toLowerCase().includes(w.toLowerCase())));
    expect(hits).toEqual([]);
  });

  it('every German hq.pages/rail/start/first/step key exists in English too (and vice versa)', () => {
    const scope = (tree: Tree) =>
      leaves((tree as unknown as { hq: Tree }).hq, 'hq')
        .map(([k]) => k)
        .filter((k) => /^hq\.(pages|rail|start|first|step)\./.test(k))
        .sort();
    expect(scope(en as unknown as Tree)).toEqual(scope(de as unknown as Tree));
  });

  it('names the five pages and the seven step verbs', () => {
    const hq = (de as unknown as { hq: { pages: Tree; step: { kind: Tree } } }).hq;
    expect(Object.keys(hq.pages)).toEqual(jasmine.arrayContaining(['start', 'planen', 'jetzt', 'bestand', 'statistik']));
    expect(Object.keys(hq.step.kind).sort()).toEqual(['buy', 'craft', 'mine', 'mission', 'pickup', 'refine', 'transport']);
  });
});
