// C3 learned style: regex statistics over a language's trusted pairs, stored in
// `translation_languages.style` and rendered into the system prompt on top of the static STYLE
// block. Pure (node --test + Deno). Only CIG and admin pairs teach style — CIG is the house style
// the precedence rule follows; community pairs count only while CIG gives too little evidence
// (ru: the game has no Russian CIG table).

export interface StylePair {
  key: string;
  en: string;
  t: string;
}

export interface LearnedStyle {
  v: 1;
  /** Pairs the statistics were taken from. */
  n: number;
  /** Which origins taught it, e.g. ['cig','admin'] or ['cig','admin','community']. */
  from: string[];
  /** Informal vs formal address hits; ratio = informal / (informal + formal); null without hits. */
  address: { informal: number; formal: number; ratio: number | null } | null;
  /** Decimal numbers in the target: comma vs point; share = comma / all. */
  decimal: { comma: number; point: number; share: number | null };
  /** "40 %" vs "40%": share with a space. */
  percent: { spaced: number; tight: number; share: number | null };
  /** Quote style counts in the target and the dominant one. */
  quotes: { counts: Record<string, number>; dominant: string | null };
  /** Per key prefix (first `_` segment): share of targets in full upper case where the English is not. */
  upper: Record<string, { n: number; share: number }>;
  at?: string;
}

/** Address pronouns per language: informal / formal. German formal only capitalised mid-sentence. */
const ADDRESS: Record<string, { informal: RegExp; formal: RegExp }> = {
  de: { informal: /(?<![\p{L}])(du|dich|dir|dein|deine|deinen|deinem|deiner|deines)(?![\p{L}])/giu, formal: /(?<=[\p{L}\p{N},;:] )(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?![\p{L}])/gu },
  fr: { informal: /(?<![\p{L}])(tu|toi|ton|ta|tes)(?![\p{L}])/giu, formal: /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/giu },
  es: { informal: /(?<![\p{L}])(tú|tu|tus|te|ti)(?![\p{L}])/giu, formal: /(?<![\p{L}])(usted|ustedes|su|sus)(?![\p{L}])/giu },
  it: { informal: /(?<![\p{L}])(tu|ti|tuo|tua|tuoi|tue)(?![\p{L}])/giu, formal: /(?<=[\p{L}\p{N},;:] )(Lei|Suo|Sua|Suoi|Sue)(?![\p{L}])/gu },
  'pt-BR': { informal: /(?<![\p{L}])(você|vocês|seu|sua|te)(?![\p{L}])/giu, formal: /(?<![\p{L}])(o senhor|a senhora)(?![\p{L}])/giu },
  ru: { informal: /(?<![\p{L}])(ты|тебя|тебе|твой|твоя|твои)(?![\p{L}])/giu, formal: /(?<![\p{L}])(вы|вас|вам|ваш|ваша|ваши)(?![\p{L}])/giu },
};

const QUOTES: Record<string, RegExp> = {
  '„“': /„[^“”"]{1,200}[“”]/gu,
  '«»': /«[^»]{1,200}»/gu,
  '»«': /»[^«]{1,200}«/gu,
  '“”': /“[^”„]{1,200}”/gu,
  '""': /"[^"]{1,200}"/gu,
  '「」': /「[^」]{1,200}」/gu,
};

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const share = (a: number, b: number) => (a + b ? Math.round((a / (a + b)) * 1000) / 1000 : null);

function isUpper(s: string): boolean {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

export function styleStats(lang: string, pairs: StylePair[], from: string[] = []): LearnedStyle {
  const addr = ADDRESS[lang];
  let informal = 0;
  let formal = 0;
  let comma = 0;
  let point = 0;
  let spaced = 0;
  let tight = 0;
  const q: Record<string, number> = {};
  const up = new Map<string, { n: number; u: number }>();
  for (const p of pairs) {
    const t = p.t;
    if (addr) {
      informal += count(t, addr.informal);
      formal += count(t, addr.formal);
    }
    // Decimal numbers only where the English has one (so "1.000" thousands groups do not count).
    if (/\d\.\d/.test(p.en)) {
      comma += count(t, /\d,\d/g);
      point += count(t, /\d\.\d/g);
    }
    if (/\d\s?%/.test(p.en)) {
      spaced += count(t, /\d[\s  ]%/g);
      tight += count(t, /\d%/g);
    }
    for (const [name, re] of Object.entries(QUOTES)) {
      const n = count(t, re);
      if (n) q[name] = (q[name] ?? 0) + n;
    }
    if (!isUpper(p.en) && /\p{L}{3}/u.test(t)) {
      const head = p.key.split('_', 1)[0].toLowerCase();
      const s = up.get(head) ?? { n: 0, u: 0 };
      s.n++;
      if (isUpper(t)) s.u++;
      up.set(head, s);
    }
  }
  const upper: LearnedStyle['upper'] = {};
  for (const [head, s] of [...up].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) {
    if (s.n >= 20) upper[head] = { n: s.n, share: Math.round((s.u / s.n) * 1000) / 1000 };
  }
  const dominant = Object.entries(q).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    v: 1,
    n: pairs.length,
    from,
    address: addr ? { informal, formal, ratio: share(informal, formal) } : null,
    decimal: { comma, point, share: share(comma, point) },
    percent: { spaced, tight, share: share(spaced, tight) },
    quotes: { counts: q, dominant },
    upper,
  };
}

/** Minimum hits before a statistic becomes an instruction (below it the static STYLE decides). */
const MIN_HITS = 20;
/** A preference is stated only when it is clear (≥ 80 % one way); mixed usage stays unstated. */
const CLEAR = 0.8;

/** Prompt lines from a learned style; '' when nothing is clear enough. */
export function styleBlock(style: LearnedStyle | null | undefined): string {
  if (!style || style.v !== 1 || !style.n) return '';
  const out: string[] = [];
  const a = style.address;
  if (a && a.ratio !== null && a.informal + a.formal >= MIN_HITS) {
    if (a.ratio >= CLEAR) out.push(`- Address the player informally (${pct(a.ratio)} of the reference translations do).`);
    else if (a.ratio <= 1 - CLEAR) out.push(`- Address the player formally (${pct(1 - a.ratio)} of the reference translations do).`);
  }
  const d = style.decimal;
  if (d.share !== null && d.comma + d.point >= MIN_HITS) {
    if (d.share >= CLEAR) out.push('- Decimal separator: comma ("1,5").');
    else if (d.share <= 1 - CLEAR) out.push('- Decimal separator: point ("1.5").');
  }
  const p = style.percent;
  if (p.share !== null && p.spaced + p.tight >= MIN_HITS) {
    if (p.share >= CLEAR) out.push('- Put a space before the percent sign ("40 %").');
    else if (p.share <= 1 - CLEAR) out.push('- No space before the percent sign ("40%").');
  }
  const qs = style.quotes;
  const qTotal = Object.values(qs.counts).reduce((x, y) => x + y, 0);
  if (qs.dominant && qTotal >= MIN_HITS && (qs.counts[qs.dominant] ?? 0) / qTotal >= CLEAR) {
    out.push(`- Quotation marks: ${qs.dominant[0]}…${qs.dominant[1]}.`);
  }
  const upHeads = Object.entries(style.upper).filter(([, s]) => s.share >= CLEAR).map(([h]) => h);
  if (upHeads.length) out.push(`- Strings whose key starts with ${upHeads.map((h) => `"${h}_"`).join(', ')} are written in full upper case.`);
  if (!out.length) return '';
  return `Learned from ${style.n} official/admin translations of this language (follow these over the general rules above):\n${out.join('\n')}`;
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}
