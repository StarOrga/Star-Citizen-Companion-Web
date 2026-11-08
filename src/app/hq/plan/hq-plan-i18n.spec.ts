import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';

interface Tree {
  [key: string]: string | Tree;
}

function leaves(node: Tree, prefix: string): [string, string][] {
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}.${k}`, v] as [string, string]] : leaves(v, `${prefix}.${k}`),
  );
}

const SCOPE = /^hq\.(plan|mood|place|set|supply|einsatz|activity)\./;
const BANNED = ['gedeckt', 'Auftrag', 'Operation', 'Schritt-Modus'];

describe('hq.plan / mood / place / set / supply / einsatz / activity wording', () => {
  const pick = (t: unknown) =>
    leaves((t as { hq: Tree }).hq, 'hq').filter(([k]) => SCOPE.test(k));
  const deAll = pick(de);
  const enAll = pick(en);

  it('exists in German and English with the same keys', () => {
    expect(deAll.length).toBeGreaterThan(15);
    expect(enAll.map(([k]) => k).sort()).toEqual(deAll.map(([k]) => k).sort());
  });

  it('never uses the banned words in German', () => {
    expect(deAll.filter(([, v]) => BANNED.some((w) => v.toLowerCase().includes(w.toLowerCase())))).toEqual([]);
  });

  it('W5.2: names neither Route, Quellen nor Bedarf (German) / route, sources, needs (English) in the Planen text', () => {
    const planen = (all: [string, string][], re: RegExp) =>
      all.filter(([k, v]) => /^hq\.(plan|panel|slots|flow|route|nachschub)\./.test(k) && re.test(v)).map(([k]) => k);
    const deAllHq = leaves((de as unknown as { hq: Tree }).hq, 'hq');
    const enAllHq = leaves((en as unknown as { hq: Tree }).hq, 'hq');
    expect(planen(deAllHq, /route|quelle|bedarf/i)).toEqual([]);
    expect(planen(enAllHq, /\broutes?\b|\bsources?\b|\bneeds\b/i)).toEqual([]);
  });

  it('names the Einsatz wording and "liegt bereit"', () => {
    const d = Object.fromEntries(deAll);
    expect(d['hq.einsatz.multi']).toBe('Einsatz ×{{n}}');
    expect(d['hq.einsatz.stepsTooltip']).toBe('{{n}} Schritte');
    for (const m of ['peaceful', 'combat', 'quick', 'long', 'solo', 'group']) expect(d[`hq.mood.${m}`]).toBeTruthy();
    for (const a of ['kopfgeld', 'bunker', 'medizin', 'rennen', 'bergbau', 'fracht', 'bergung', 'erkunden', 'piraterie']) {
      expect(d[`hq.activity.${a}`]).toBeTruthy();
    }
  });
});
