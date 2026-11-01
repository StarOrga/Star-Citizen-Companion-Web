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
    expect(deAll.length).toBeGreaterThan(40);
    expect(enAll.map(([k]) => k).sort()).toEqual(deAll.map(([k]) => k).sort());
  });

  it('never uses the banned words in German', () => {
    expect(deAll.filter(([, v]) => BANNED.some((w) => v.toLowerCase().includes(w.toLowerCase())))).toEqual([]);
  });

  it('names the Was / Wie switch, the Auswahl, the three mood pairs and "liegt bereit"', () => {
    const d = Object.fromEntries(deAll);
    expect(d['hq.plan.switch.what']).toBe('Was brauche ich');
    expect(d['hq.plan.switch.how']).toBe('Wie komme ich hin');
    expect(d['hq.plan.selection']).toBe('Auswahl');
    expect(d['hq.plan.saveEinsatz']).toBe('Als Einsatz speichern');
    expect(d['hq.supply.ready']).toBe('liegt bereit');
    expect(d['hq.einsatz.multi']).toBe('Einsatz ×{{n}}');
    expect(d['hq.einsatz.stepsTooltip']).toBe('{{n}} Schritte');
    for (const m of ['peaceful', 'combat', 'quick', 'long', 'solo', 'group']) expect(d[`hq.mood.${m}`]).toBeTruthy();
    for (const a of ['kopfgeld', 'bunker', 'medizin', 'rennen', 'bergbau', 'fracht', 'bergung', 'erkunden', 'piraterie']) {
      expect(d[`hq.activity.${a}`]).toBeTruthy();
    }
  });
});
